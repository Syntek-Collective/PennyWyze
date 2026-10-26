import { describe, it, expect } from 'vitest';

import { measureAgreement } from '../../src/calibration/agreement.js';
import { loadLabels } from '../../src/calibration/load-labels.js';
import { exactMatchScorer } from '../../src/scorers/exact-match-scorer.js';
import { createJudgeScorer } from '../../src/scorers/judge/llm-judge-scorer.js';
import type { JudgeClient } from '../../src/scorers/judge/judge-client.js';
import type { LabeledExample } from '../../src/calibration/schema.js';

const fixture = (name: string) =>
  new URL(`./fixtures/${name}`, import.meta.url).pathname;

const labels: LabeledExample[] = [
  { answer: 'billing', expected: 'billing', label: 'pass' },
  { answer: 'The answer is billing.', expected: 'billing', label: 'pass' },
  { answer: 'technical', expected: 'billing', label: 'fail' },
  {
    answer: 'Not billing — it is technical.',
    expected: 'billing',
    label: 'fail',
  },
];

describe('measureAgreement', () => {
  it('counts agreement, false passes and false fails against the hand labels', async () => {
    // Exact match is too strict for the sentence-wrapped answer a person passed.
    const report = await measureAgreement(exactMatchScorer, labels);

    expect(report).toMatchObject({
      grader: 'exact',
      scored: 4,
      agreed: 3,
      rate: 0.75,
      falsePasses: 0,
      falseFails: 1,
      unscored: 0,
    });
    expect(report.disagreements[0]).toMatchObject({
      answer: 'The answer is billing.',
      human: 'pass',
      grader: 'fail',
    });
  });

  it('catches a judge that passes an answer a person failed, with its rationale', async () => {
    const gullible: JudgeClient = {
      async judge() {
        return {
          decision: { verdict: 'pass', rationale: 'Mentions billing.' },
          inputTokens: 100,
          outputTokens: 20,
          stopReason: 'end_turn',
        };
      },
    };
    const scorer = createJudgeScorer({
      client: gullible,
      modelId: 'claude-opus-5-5',
      taskPrompt: 'p',
    });

    const report = await measureAgreement(scorer, labels);

    expect(report.falsePasses).toBe(2);
    expect(report.agreed).toBe(2);
    expect(report.disagreements.find(d => d.grader === 'pass')?.rationale).toBe(
      'Mentions billing.',
    );
    // Three answers went to the judge; the exact match was free.
    expect(report.usage).toHaveLength(3);
  });

  it('leaves undecided labels out of the rate, but still counts their cost', async () => {
    const refusing: JudgeClient = {
      async judge() {
        return {
          decision: null,
          inputTokens: 100,
          outputTokens: 0,
          stopReason: 'refusal',
        };
      },
    };
    const scorer = createJudgeScorer({
      client: refusing,
      modelId: 'claude-opus-5-5',
      taskPrompt: 'p',
    });

    const report = await measureAgreement(scorer, labels);

    expect(report).toMatchObject({
      scored: 1,
      agreed: 1,
      rate: 1,
      unscored: 3,
    });
    expect(report.usage).toHaveLength(3);
  });
});

describe('loadLabels', () => {
  it('reads labels, with or without an input', () => {
    const loaded = loadLabels(fixture('valid.jsonl'));

    expect(loaded).toHaveLength(2);
    expect(loaded[0]?.input).toBe('charged twice');
    expect(loaded[1]?.input).toBeUndefined();
  });

  it('names the line with an invalid label', () => {
    expect(() => loadLabels(fixture('bad-label.jsonl'))).toThrow(
      /Line 1 of your calibration file is invalid/,
    );
  });

  it('reports a missing file by path', () => {
    expect(() => loadLabels('nope.jsonl')).toThrow(
      "Calibration file not found: 'nope.jsonl'",
    );
  });
});
