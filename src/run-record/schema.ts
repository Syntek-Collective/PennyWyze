import { z } from 'zod';

/**
 * The machine-readable record of one audit.
 *
 * Written by `--json-out` and, later, read back by anything that compares two
 * runs: the GitHub Action diffing against a committed baseline, a report page
 * charting cost across prompt versions, resume after a failure.
 *
 * Defined as a schema rather than a plain type because the reader is the real
 * beneficiary — a baseline file on disk may be old, hand-edited, or written by
 * a different version, and parsing it should fail loudly rather than quietly
 * produce undefined fields.
 */

/** Bump when a change would break a reader of an older file. */
export const RUN_RECORD_SCHEMA_VERSION = 1;

export const missSchema = z.object({
  input: z.string(),
  answer: z.string(),
  expected: z.string(),
});

export const modelResultSchema = z.object({
  /** The model's api id, e.g. 'claude-haiku-4-5'. */
  name: z.string(),
  passes: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  /** Early stopping cut this model short of the full dataset. */
  stopped: z.boolean(),
  /** Calls that never produced a gradeable answer — failures, truncations. */
  incomplete: z.number().int().nonnegative(),
  monthlyCost: z.number().nonnegative(),
  passed: z.boolean(),
  misses: z.array(missSchema),
});

export const verdictSchema = z.object({
  recommended: z.string().nullable(),
  savingsPerMonth: z.number(),
  baseline: z.string().nullable(),
  baselineIsAssumed: z.boolean(),
  reason: z.enum(['cheaper_model_passes', 'nothing_passed', 'already_optimal']),
});

export const runRecordSchema = z.object({
  schemaVersion: z.literal(RUN_RECORD_SCHEMA_VERSION),
  /** When the audit started, ISO 8601. */
  startedAt: z.string(),
  /** The pennywyze version that produced this record. */
  toolVersion: z.string(),

  // Fingerprints of what was measured. These are what let a reader tell
  // "quality regressed" apart from "this baseline measured a different
  // prompt, so comparing them is meaningless".
  promptSha256: z.string().length(64),
  datasetSha256: z.string().length(64),
  datasetSize: z.number().int().positive(),

  // The settings the run used. A verdict is only true for these.
  passRate: z.number(),
  volume: z.number(),
  grader: z.string(),
  /** The --current model, when one was given. */
  currentModel: z.string().nullable(),

  models: z.array(modelResultSchema),
  verdict: verdictSchema,
  /** What this audit itself cost to run, in USD. */
  auditCostUsd: z.number().nonnegative(),
});

export type RunRecord = z.infer<typeof runRecordSchema>;
