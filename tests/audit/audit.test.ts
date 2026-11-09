import { describe, it, expect } from 'vitest'
import { runAudit } from '../../src/audit.js'
import { createFakeProvider } from '../../src/providers/fake-provider.js'
import { exactMatchScorer } from '../../src/scorers/exact-match-scorer.js'
import type { ModelProvider } from '../../src/providers/provider.js'
import { createJudgeScorer } from '../../src/scorers/judge/llm-judge-scorer.js'
import { fakeJudgeClient } from '../../src/scorers/judge/fake-judge-client.js'
import type { JudgeClient } from '../../src/scorers/judge/judge-client.js'

// authored here so the tests own their truth — expecteds match the fake's
// first two deals, so this set passes cleanly
const tinyDataset = [
  { input: 'q1', expected: 'billing' },
  { input: 'q2', expected: 'tech-problem' },
]

// expecteds no answer in the fake's list can ever match — guarantees a miss
// on every question
const impossibleDataset = [
  { input: 'q1', expected: 'purple-elephant' },
  { input: 'q2', expected: 'pink-mongoose' },
  { input: 'q3', expected: 'teal-walrus' },
]

// Fails on the 2nd call, succeeds on the 1st — proves the audit keeps what it
// already paid for instead of discarding the whole run.
const flakyProvider: ModelProvider = {
  calls: 0,
  async run() {
    // @ts-expect-error -- counter lives on the object for test bookkeeping
    this.calls++
    // @ts-expect-error -- see above
    if (this.calls > 1) throw new Error('connection reset')
    return {
      text: 'billing',
      inputTokens: 50,
      outputTokens: 4,
      stopReason: 'end_turn',
    }
  },
} as ModelProvider

const truncatingProvider: ModelProvider = {
  async run() {
    return {
      text: 'bil',
      inputTokens: 50,
      outputTokens: 1000,
      stopReason: 'max_tokens',
    }
  },
}

describe('runAudit incomplete handling', () => {
  it('keeps results already paid for when a call fails', async () => {
    const results = await runAudit(
      flakyProvider,
      [
        { input: 'q1', expected: 'billing' },
        { input: 'q2', expected: 'billing' },
        { input: 'q3', expected: 'billing' },
      ],
      'test prompt',
      ['model-a'],
      1,
      exactMatchScorer,
    )

    // The first answer survives; the failure is recorded, not thrown.
    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({ status: 'graded', pass: true })
    expect(results[1]).toMatchObject({ status: 'incomplete', pass: false })
    expect(results[1]?.note).toContain('connection reset')
  })

  it('records a truncated answer as incomplete, not as a wrong answer', async () => {
    const results = await runAudit(
      truncatingProvider,
      [{ input: 'q1', expected: 'billing' }],
      'test prompt',
      ['model-a'],
      1,
      exactMatchScorer,
    )

    expect(results[0]).toMatchObject({ status: 'incomplete' })
    expect(results[0]?.note).toContain('max_tokens')
  })

  it('lets later models run after an earlier one fails', async () => {
    const results = await runAudit(
      flakyProvider,
      [{ input: 'q1', expected: 'billing' }],
      'test prompt',
      ['model-a', 'model-b'],
      1,
      exactMatchScorer,
    )

    expect(results.map(r => r.modelId)).toEqual(['model-a', 'model-b'])
  })
})

describe('runAudit', () => {

  it('returns one record per model per question, with the right fields', async () => {
    const results = await runAudit(createFakeProvider(), tinyDataset, 'test prompt', ['model-a'], 1, exactMatchScorer)

    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({ modelId: 'model-a', question: 'q1', expected: 'billing' })
    expect(typeof results[0]?.pass).toBe('boolean')
    expect(typeof results[0]?.inputTokens).toBe('number')
  })

  it('stops a failing model early at the full pass bar', async () => {
    // full bar allows 0 misses — the first guaranteed miss breaks the loop
    const results = await runAudit(createFakeProvider(), impossibleDataset, 'test prompt', ['model-a'], 1, exactMatchScorer)

    expect(results).toHaveLength(1)
    expect(results[0]?.pass).toBe(false)
  })

  it('lets a model survive misses at a loosened pass bar', async () => {
    // 3 questions at 0.6 → floor(3 × 0.4) = 1 miss allowed —
    // survives the 1st, breaks on the 2nd: exactly 2 records
    const results = await runAudit(createFakeProvider(), impossibleDataset, 'test prompt', ['model-a'], 0.6, exactMatchScorer)

    expect(results).toHaveLength(2)
  })

})

describe('runAudit progress reporting', () => {
  it('reports progress through the callback, with no terminal involved', async () => {
    const questions: Array<[string, number, number]> = []
    const finished: Array<[string, string]> = []

    await runAudit(
      createFakeProvider(),
      tinyDataset,
      'test prompt',
      ['model-a'],
      1,
      exactMatchScorer,
      {
        onQuestion: (tier, current, total) =>
          questions.push([tier, current, total]),
        onModelDone: (tier, outcome) => finished.push([tier, outcome]),
      },
    )

    // One call per question, 1-based, carrying the dataset size.
    expect(questions).toEqual([
      ['model-a', 1, 2],
      ['model-a', 2, 2],
    ])
    expect(finished).toEqual([['model-a', 'complete']])
  })

  it('reports early stopping and incompleteness as distinct outcomes', async () => {
    const outcomes: string[] = []
    const record = { onModelDone: (_t: string, o: string) => outcomes.push(o) }

    await runAudit(createFakeProvider(), impossibleDataset, 'p', ['m'], 1, exactMatchScorer, record)
    await runAudit(truncatingProvider, tinyDataset, 'p', ['m'], 1, exactMatchScorer, record)

    expect(outcomes).toEqual(['early_stop', 'incomplete'])
  })

  it('runs fine with no progress callbacks at all', async () => {
    const results = await runAudit(
      createFakeProvider(),
      tinyDataset,
      'test prompt',
      ['model-a'],
      1,
      exactMatchScorer,
    )

    expect(results).toHaveLength(2)
  })
})

describe('runAudit early stopping at the described scale', () => {
  it('ends a 50-question run at 90% on the sixth miss — 8 calls, not 50', async () => {
    // floor(50 × 0.1) = 5 misses allowed. Answers alternate so the sixth
    // miss lands on question 8: misses at 1, 2, 3, 5, 6, 8.
    const script = ['x', 'x', 'x', 'ok', 'x', 'x', 'ok', 'x']
    let call = 0
    const provider: ModelProvider = {
      async run() {
        const text = script[call++] ?? 'ok'
        return { text, inputTokens: 50, outputTokens: 4, stopReason: 'end_turn' }
      },
    }
    const dataset = Array.from({ length: 50 }, (_, i) => ({ input: `q${i}`, expected: 'ok' }))

    const results = await runAudit(provider, dataset, 'p', ['model-a'], 0.9, exactMatchScorer)

    expect(results).toHaveLength(8)
    expect(results.filter(r => !r.pass)).toHaveLength(6)
  })
})

describe('runAudit with an LLM judge', () => {
  it('keeps the judge rationale and token usage on each judged answer', async () => {
    const results = await runAudit(
      { async run() { return { text: 'The answer is billing.', inputTokens: 50, outputTokens: 6, stopReason: 'end_turn' } } },
      [{ input: 'q1', expected: 'billing' }],
      'p',
      ['model-a'],
      1,
      createJudgeScorer({ client: fakeJudgeClient, modelId: 'claude-opus-5-5', taskPrompt: 'p' }),
    )

    expect(results[0]).toMatchObject({
      status: 'graded',
      pass: true,
      gradedBy: 'judge',
      graderUsage: { modelId: 'claude-opus-5-5' },
    })
    expect(results[0]?.rationale).toBeTruthy()
  })

  it('records an answer the judge could not decide as incomplete, not a miss', async () => {
    const refusingJudge: JudgeClient = {
      async judge() {
        return { decision: null, inputTokens: 80, outputTokens: 0, stopReason: 'refusal' }
      },
    }

    const results = await runAudit(
      createFakeProvider(),
      [{ input: 'q1', expected: 'something-else' }, { input: 'q2', expected: 'x' }],
      'p',
      ['model-a'],
      1,
      createJudgeScorer({ client: refusingJudge, modelId: 'claude-opus-5-5', taskPrompt: 'p' }),
    )

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ status: 'incomplete', pass: false })
    expect(results[0]?.note).toContain('grader failed')
    // The refused judge call still cost tokens, and the audit keeps them.
    expect(results[0]?.graderUsage).toMatchObject({ inputTokens: 80 })
  })
})

describe('runAudit pass-bar arithmetic', () => {
  it('lets a model finish that lands exactly on the bar (45/50 at 90%)', async () => {
    // Misses on the first five questions, then all correct: 45/50 = 90%.
    let call = 0
    const provider: ModelProvider = {
      async run() {
        return { text: call++ < 5 ? 'x' : 'ok', inputTokens: 1, outputTokens: 1, stopReason: 'end_turn' }
      },
    }
    const dataset = Array.from({ length: 50 }, (_, i) => ({ input: `q${i}`, expected: 'ok' }))

    const results = await runAudit(provider, dataset, 'p', ['model-a'], 0.9, exactMatchScorer)

    expect(results).toHaveLength(50)
  })
})
