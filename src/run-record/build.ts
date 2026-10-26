import { createHash } from 'crypto';

import type { GoldenExample } from '../golden-dataset/schema.js';
import type { ModelSummary } from '../summarize.js';
import type { Verdict } from '../verdict.js';
import {
  RUN_RECORD_SCHEMA_VERSION,
  runRecordSchema,
  type RunRecord,
} from './schema.js';

const sha256 = (input: string): string =>
  createHash('sha256').update(input, 'utf8').digest('hex');

/**
 * Fingerprints the prompt as it was actually sent to the model, not the raw
 * file. The loader already strips a BOM and zero-width characters, so an
 * invisible edit that never reached the model doesn't register as a change.
 */
export const hashPrompt = (prompt: string): string => sha256(prompt);

/**
 * Fingerprints the parsed examples rather than the file's bytes, so
 * reformatting whitespace or reordering keys within a line is not a change,
 * while editing an input or an expected answer is.
 */
export const hashDataset = (dataset: GoldenExample[]): string =>
  sha256(
    JSON.stringify(
      dataset.map(example => [example.input, example.expected]),
    ),
  );

export type BuildRunRecordInput = {
  startedAt: Date;
  toolVersion: string;
  prompt: string;
  dataset: GoldenExample[];
  passRate: number;
  volume: number;
  grader: string;
  currentModel: string | null;
  models: ModelSummary[];
  verdict: Verdict;
  auditCostUsd: number;
};

/**
 * Assembles one audit into its saved form, and validates it on the way out.
 *
 * Validating what we write may look redundant, but it is what keeps the
 * schema honest: if a field is added here and not to the schema, this throws
 * during development rather than producing a file that readers reject later.
 */
export const buildRunRecord = (input: BuildRunRecordInput): RunRecord =>
  runRecordSchema.parse({
    schemaVersion: RUN_RECORD_SCHEMA_VERSION,
    startedAt: input.startedAt.toISOString(),
    toolVersion: input.toolVersion,

    promptSha256: hashPrompt(input.prompt),
    datasetSha256: hashDataset(input.dataset),
    datasetSize: input.dataset.length,

    passRate: input.passRate,
    volume: input.volume,
    grader: input.grader,
    currentModel: input.currentModel,

    models: input.models.map(model => ({
      name: model.name,
      passes: model.passes,
      total: model.total,
      stopped: model.stopped,
      incomplete: model.incomplete,
      monthlyCost: model.monthlyCost,
      passed: model.passed,
      // Full text, deliberately untruncated — the report shortens inputs to
      // 60 characters so its tree view doesn't wrap, and a saved record that
      // inherited that would be useless for diagnosing a miss later.
      misses: model.misses,
    })),
    verdict: input.verdict,
    auditCostUsd: input.auditCostUsd,
  });
