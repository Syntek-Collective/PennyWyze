import { describe, it, expect } from 'vitest';

import { decideVerdict } from '../src/verdict.js';
import type { ModelSummary } from '../src/summarize.js';

const model = (overrides: Partial<ModelSummary> = {}): ModelSummary => ({
  name: 'model',
  passes: 50,
  total: 50,
  stopped: false,
  incomplete: 0,
  monthlyCost: 100,
  passed: true,
  misses: [],
  ...overrides,
});

describe('decideVerdict', () => {
  it('recommends the cheapest passing model', () => {
    const verdict = decideVerdict([
      model({ name: 'pricey', monthlyCost: 900, passed: true }),
      model({ name: 'cheap', monthlyCost: 100, passed: true }),
    ]);

    expect(verdict).toMatchObject({
      recommended: 'cheap',
      savingsPerMonth: 800,
      reason: 'cheaper_model_passes',
    });
  });

  it('never recommends a cheaper model that failed', () => {
    const verdict = decideVerdict([
      model({ name: 'cheap-but-failed', monthlyCost: 10, passed: false }),
      model({ name: 'mid-and-passed', monthlyCost: 50, passed: true }),
      model({ name: 'pricey-and-passed', monthlyCost: 200, passed: true }),
    ]);

    expect(verdict.recommended).toBe('mid-and-passed');
  });

  it('recommends nothing when no model passed', () => {
    const verdict = decideVerdict([
      model({ name: 'a', monthlyCost: 900, passed: false }),
      model({ name: 'b', monthlyCost: 100, passed: false }),
    ]);

    expect(verdict).toMatchObject({
      recommended: null,
      savingsPerMonth: 0,
      reason: 'nothing_passed',
    });
  });

  it('recommends nothing when the only passing model is the priciest', () => {
    // Savings would be zero — telling the user to "switch" to the tier they
    // are already paying for.
    const verdict = decideVerdict([
      model({ name: 'cheap-but-failed', monthlyCost: 10, passed: false }),
      model({ name: 'pricey-but-passed', monthlyCost: 50, passed: true }),
    ]);

    expect(verdict).toMatchObject({
      recommended: null,
      savingsPerMonth: 0,
      reason: 'already_optimal',
    });
  });

  it('measures savings against --current, not the priciest model audited', () => {
    const models = [
      model({ name: 'never-used', monthlyCost: 900, passed: true }),
      model({ name: 'what-we-run', monthlyCost: 300, passed: true }),
      model({ name: 'cheapest', monthlyCost: 100, passed: true }),
    ];

    expect(decideVerdict(models, 'what-we-run')).toMatchObject({
      recommended: 'cheapest',
      savingsPerMonth: 200, // 300 - 100, not 900 - 100
      baseline: 'what-we-run',
      baselineIsAssumed: false,
    });
  });

  it('flags the baseline as assumed when --current was not given', () => {
    const verdict = decideVerdict([
      model({ name: 'pricey', monthlyCost: 900, passed: true }),
      model({ name: 'cheap', monthlyCost: 100, passed: true }),
    ]);

    expect(verdict).toMatchObject({
      baseline: 'pricey',
      baselineIsAssumed: true,
    });
  });

  it('says already optimal when the cheapest passer is what the user runs', () => {
    const verdict = decideVerdict(
      [
        model({ name: 'what-we-run', monthlyCost: 100, passed: true }),
        model({ name: 'pricier', monthlyCost: 900, passed: true }),
      ],
      'what-we-run',
    );

    expect(verdict.reason).toBe('already_optimal');
    expect(verdict.recommended).toBeNull();
  });

  it('ignores a model with incomplete calls, since it cannot pass', () => {
    const verdict = decideVerdict([
      model({ name: 'had-errors', monthlyCost: 10, passed: false, incomplete: 3 }),
      model({ name: 'clean', monthlyCost: 500, passed: true }),
    ]);

    expect(verdict.recommended).not.toBe('had-errors');
    expect(verdict.reason).toBe('already_optimal');
  });

  it('does not fall over on an empty model list', () => {
    const verdict = decideVerdict([]);

    expect(verdict).toMatchObject({
      recommended: null,
      baseline: null,
      reason: 'nothing_passed',
    });
    expect(Number.isFinite(verdict.savingsPerMonth)).toBe(true);
  });
});
