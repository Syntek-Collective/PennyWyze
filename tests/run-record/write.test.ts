import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { writeRunRecord } from '../../src/run-record/write.js';
import { runRecordSchema, type RunRecord } from '../../src/run-record/schema.js';

const record: RunRecord = {
  schemaVersion: 1,
  startedAt: '2026-10-03T12:00:00.000Z',
  toolVersion: '1.1.0',
  promptSha256: 'a'.repeat(64),
  datasetSha256: 'b'.repeat(64),
  datasetSize: 2,
  passRate: 90,
  volume: 100000,
  grader: 'exact',
  currentModel: null,
  models: [
    {
      name: 'claude-haiku-4-5',
      passes: 2,
      total: 2,
      stopped: false,
      incomplete: 0,
      monthlyCost: 26.26,
      passed: true,
      misses: [],
    },
  ],
  verdict: {
    recommended: 'claude-haiku-4-5',
    savingsPerMonth: 100,
    baseline: 'claude-opus-5-5',
    baselineIsAssumed: true,
    reason: 'cheaper_model_passes',
  },
  auditCostUsd: 0.32,
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pennywyze-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('writeRunRecord', () => {
  it('writes a file that parses back as the same record', () => {
    const path = join(dir, 'run.json');

    writeRunRecord(path, record);

    const readBack = JSON.parse(readFileSync(path, 'utf8'));
    expect(runRecordSchema.parse(readBack)).toEqual(record);
  });

  it('creates the containing folder when it does not exist', () => {
    const path = join(dir, 'nested', 'deeper', 'run.json');

    writeRunRecord(path, record);

    expect(existsSync(path)).toBe(true);
  });

  it('writes pretty-printed JSON ending in a newline', () => {
    // These files get committed as CI baselines and read in diffs, so one
    // field per line matters.
    const path = join(dir, 'run.json');

    writeRunRecord(path, record);

    const contents = readFileSync(path, 'utf8');
    expect(contents).toContain('\n  "schemaVersion": 1,');
    expect(contents.endsWith('\n')).toBe(true);
  });

  it('overwrites a previous record rather than appending', () => {
    const path = join(dir, 'run.json');

    writeRunRecord(path, record);
    writeRunRecord(path, { ...record, auditCostUsd: 0.99 });

    const readBack = JSON.parse(readFileSync(path, 'utf8'));
    expect(readBack.auditCostUsd).toBe(0.99);
  });
});
