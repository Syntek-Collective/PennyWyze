import { describe, it, expect } from 'vitest';

import { summarize, calculateResultsCost } from '../src/summarize.js';
import type { AuditResult } from '../src/audit.js';
import { ANTHROPIC_MODELS } from '../src/providers/anthropic-models.js';

const HAIKU = ANTHROPIC_MODELS.haiku.id;
const OPUS = ANTHROPIC_MODELS.opus.id;

const result = (overrides: Partial<AuditResult> = {}): AuditResult => ({
  modelId: HAIKU,
  question: 'q',
  answer: 'billing',
  expected: 'billing',
  pass: true,
  inputTokens: 100,
  outputTokens: 10,
  status: 'graded',
  ...overrides,
});

describe('summarize', () => {
  it('builds one row per model, in the order the model ids were given', () => {
    const rows = summarize(
      [result({ modelId: HAIKU }), result({ modelId: OPUS })],
      [OPUS, HAIKU],
      1,
      1000,
      1,
    );

    expect(rows.map(r => r.name)).toEqual([OPUS, HAIKU]);
  });

  it('counts passes against the full dataset size, not the calls made', () => {
    // Two of three questions ran before early stopping cut the model off.
    const rows = summarize(
      [result({ pass: true }), result({ pass: false })],
      [HAIKU],
      3,
      1000,
      0.6,
    );

    expect(rows[0]).toMatchObject({ passes: 1, total: 3, stopped: true });
  });

  it('is not marked stopped when every question ran', () => {
    const rows = summarize([result(), result()], [HAIKU], 2, 1000, 1);

    expect(rows[0]?.stopped).toBe(false);
  });

  it('fails a model that misses at the full pass bar', () => {
    const rows = summarize([result({ pass: false })], [HAIKU], 1, 1000, 1);

    expect(rows[0]?.passed).toBe(false);
  });

  it('passes a model whose miss still clears a loosened bar', () => {
    const rows = summarize(
      [result({ pass: true }), result({ pass: false })],
      [HAIKU],
      2,
      1000,
      0.5,
    );

    expect(rows[0]?.passed).toBe(true);
  });

  it('never reports a model as passed once early stopping cut it short', () => {
    // Early stopping only fires once the bar is already unreachable, so a
    // stopped model must never be recommended.
    const rows = summarize(
      [result({ pass: false }), result({ pass: false })],
      [HAIKU],
      10,
      1000,
      0.9,
    );

    expect(rows[0]?.stopped).toBe(true);
    expect(rows[0]?.passed).toBe(false);
  });

  it('projects monthly cost from the average cost per call', () => {
    // Haiku: $1/M in, $5/M out. One call of 100 in + 10 out
    // = (100 × 1 + 10 × 5) / 1_000_000 = $0.00015 per call.
    const rows = summarize([result()], [HAIKU], 1, 1000, 1);

    expect(rows[0]?.monthlyCost).toBeCloseTo(0.15, 10);
  });

  it('collects every wrong answer, and nothing else, as a miss', () => {
    const rows = summarize(
      [
        result({ pass: true, question: 'right' }),
        result({ pass: false, question: 'wrong', answer: 'account' }),
      ],
      [HAIKU],
      2,
      1000,
      0.5,
    );

    expect(rows[0]?.misses).toEqual([
      { input: 'wrong', answer: 'account', expected: 'billing' },
    ]);
  });
});

describe('summarize with incomplete calls', () => {
  it('does not count an incomplete call as a miss', () => {
    const rows = summarize(
      [
        result({ pass: true }),
        result({ pass: false, status: 'incomplete', note: 'network' }),
      ],
      [HAIKU],
      2,
      1000,
      1,
    );

    // One graded pass, one call that never produced an answer.
    expect(rows[0]?.passes).toBe(1);
    expect(rows[0]?.misses).toEqual([]);
    expect(rows[0]?.incomplete).toBe(1);
  });

  it('never marks a model passed when any call was incomplete', () => {
    // Every graded answer was correct, but part of the run is missing, so
    // "it passed" is a claim the data cannot support.
    const rows = summarize(
      [
        result({ pass: true }),
        result({ pass: false, status: 'incomplete', note: 'max_tokens' }),
      ],
      [HAIKU],
      2,
      1000,
      0.5,
    );

    expect(rows[0]?.passed).toBe(false);
  });

  it('prices only graded calls, so zero-token failures do not deflate cost', () => {
    const gradedOnly = summarize([result()], [HAIKU], 2, 1000, 1);
    const withFailure = summarize(
      [result(), result({ status: 'incomplete', inputTokens: 0, outputTokens: 0 })],
      [HAIKU],
      2,
      1000,
      1,
    );

    expect(withFailure[0]?.monthlyCost).toBeCloseTo(
      gradedOnly[0]?.monthlyCost ?? 0,
      10,
    );
  });

  it('reports a model with no gradeable answers at all as not passed', () => {
    const rows = summarize(
      [result({ status: 'incomplete', note: 'network' })],
      [HAIKU],
      5,
      1000,
      1,
    );

    expect(rows[0]).toMatchObject({ passes: 0, passed: false, incomplete: 1 });
    expect(rows[0]?.monthlyCost).toBe(0);
  });
});

describe('calculateResultsCost', () => {
  it('prices each call against its own model', () => {
    // Hand-computed, per the convention in these tests — recompute by hand
    // if prices change, don't derive from the code under test.
    // haiku  (100 x $1  + 10 x $5)  / 1e6 = $0.00015
    // opus   (100 x $4  + 10 x $20) / 1e6 = $0.00060
    const total = calculateResultsCost([
      result({ modelId: HAIKU }),
      result({ modelId: OPUS }),
    ]);

    expect(total).toBeCloseTo(0.00075, 10);
  });

  it('skips results from a model it has no prices for, instead of crashing', () => {
    const total = calculateResultsCost([result({ modelId: 'not-a-model' })]);

    expect(total).toBe(0);
  });
});
