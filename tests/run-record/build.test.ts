import { describe, it, expect } from 'vitest';

import {
  buildRunRecord,
  hashDataset,
  hashPrompt,
  type BuildRunRecordInput,
} from '../../src/run-record/build.js';
import { runRecordSchema } from '../../src/run-record/schema.js';
import type { ModelSummary } from '../../src/summarize.js';

const dataset = [
  { input: 'charged twice', expected: 'billing' },
  { input: 'app crashes', expected: 'technical' },
];

const model = (overrides: Partial<ModelSummary> = {}): ModelSummary => ({
  name: 'claude-haiku-4-5',
  passes: 2,
  total: 2,
  stopped: false,
  incomplete: 0,
  monthlyCost: 26.26,
  passed: true,
  misses: [],
  ...overrides,
});

const input = (
  overrides: Partial<BuildRunRecordInput> = {},
): BuildRunRecordInput => ({
  startedAt: new Date('2026-10-03T12:00:00Z'),
  toolVersion: '1.1.0',
  prompt: 'Reply with one word.',
  dataset,
  passRate: 90,
  volume: 100000,
  grader: 'exact',
  currentModel: null,
  models: [model()],
  verdict: {
    recommended: 'claude-haiku-4-5',
    savingsPerMonth: 100,
    baseline: 'claude-opus-5-5',
    baselineIsAssumed: true,
    reason: 'cheaper_model_passes',
  },
  auditCostUsd: 0.32,
  ...overrides,
});

describe('hashPrompt', () => {
  it('is stable for the same prompt', () => {
    expect(hashPrompt('hello')).toBe(hashPrompt('hello'));
  });

  it('changes when the prompt changes', () => {
    expect(hashPrompt('hello')).not.toBe(hashPrompt('hello.'));
  });

  it('produces a 64-character hex digest', () => {
    expect(hashPrompt('hello')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('hashDataset', () => {
  it('is stable for the same examples', () => {
    expect(hashDataset(dataset)).toBe(hashDataset([...dataset]));
  });

  it('changes when an expected answer is edited', () => {
    const edited = [dataset[0]!, { input: 'app crashes', expected: 'account' }];

    expect(hashDataset(dataset)).not.toBe(hashDataset(edited));
  });

  it('changes when examples are reordered', () => {
    // Order is part of the dataset's identity — early stopping means a
    // reordered dataset can produce a different run.
    expect(hashDataset(dataset)).not.toBe(
      hashDataset([dataset[1]!, dataset[0]!]),
    );
  });

  it('ignores key order within an example', () => {
    // Same data, written the other way round in the JSONL file.
    const reversedKeys = [
      { expected: 'billing', input: 'charged twice' },
      { expected: 'technical', input: 'app crashes' },
    ];

    expect(hashDataset(dataset)).toBe(hashDataset(reversedKeys));
  });
});

describe('buildRunRecord', () => {
  it('produces a record that validates against the schema', () => {
    const record = buildRunRecord(input());

    expect(() => runRecordSchema.parse(record)).not.toThrow();
  });

  it('records the settings the run actually used', () => {
    const record = buildRunRecord(
      input({ passRate: 75, volume: 5000, currentModel: 'claude-sonnet-5-5' }),
    );

    expect(record).toMatchObject({
      schemaVersion: 1,
      passRate: 75,
      volume: 5000,
      currentModel: 'claude-sonnet-5-5',
      datasetSize: 2,
      grader: 'exact',
      toolVersion: '1.1.0',
    });
  });

  it('writes startedAt as an ISO timestamp', () => {
    expect(buildRunRecord(input()).startedAt).toBe('2026-10-03T12:00:00.000Z');
  });

  it('keeps miss text in full, unlike the report', () => {
    const long = 'x'.repeat(200);
    const record = buildRunRecord(
      input({
        models: [
          model({
            misses: [{ input: long, answer: 'billing', expected: 'account' }],
          }),
        ],
      }),
    );

    expect(record.models[0]?.misses[0]?.input).toHaveLength(200);
  });

  it('carries the verdict as data rather than a sentence', () => {
    const record = buildRunRecord(input());

    expect(record.verdict).toMatchObject({
      recommended: 'claude-haiku-4-5',
      reason: 'cheaper_model_passes',
      baselineIsAssumed: true,
    });
  });

  it('rejects a record missing a required field', () => {
    // Guards the schema itself: if a field is dropped from the builder, this
    // throws in development instead of writing a file readers will reject.
    expect(() =>
      // @ts-expect-error -- deliberately incomplete
      buildRunRecord({ ...input(), models: [{ name: 'x' }] }),
    ).toThrow();
  });
});
