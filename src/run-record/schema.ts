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
  /** The judge's explanation, when the judge decided this miss. */
  rationale: z.string().optional(),
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
  /** Savings as a percentage of the baseline's cost. Absent in older records. */
  savingsPercent: z.number().optional(),
  baseline: z.string().nullable(),
  baselineIsAssumed: z.boolean(),
  reason: z.enum(['cheaper_model_passes', 'nothing_passed', 'already_optimal']),
});

export const agreementSchema = z.object({
  scored: z.number().int().nonnegative(),
  agreed: z.number().int().nonnegative(),
  rate: z.number().min(0).max(1).nullable(),
  falsePasses: z.number().int().nonnegative(),
  falseFails: z.number().int().nonnegative(),
  unscored: z.number().int().nonnegative(),
  disagreements: z.array(
    z.object({
      input: z.string(),
      answer: z.string(),
      expected: z.string(),
      human: z.enum(['pass', 'fail']),
      grader: z.enum(['pass', 'fail']),
      rationale: z.string().nullable(),
    }),
  ),
});

export const earlyStopSchema = z.object({
  callsMade: z.number().int().nonnegative(),
  callsPossible: z.number().int().nonnegative(),
  callsSkipped: z.number().int().nonnegative(),
  savedUsd: z.number().nonnegative(),
  savedFraction: z.number().min(0).max(1),
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

  // Added after schema version 1 shipped. Optional, so records written
  // before them still parse.
  /** The judge model and where it was resolved from. Null for exact-match audits. */
  judge: z
    .object({ model: z.string(), source: z.enum(['flag', 'env', 'default']) })
    .nullable()
    .optional(),
  /** The grader's agreement with hand labels. Null when none were given. */
  graderAgreement: agreementSchema.nullable().optional(),
  /** The part of auditCostUsd spent on judge calls. */
  graderCostUsd: z.number().nonnegative().optional(),
  /** What early stopping skipped and saved. */
  earlyStop: earlyStopSchema.optional(),
});

export type RunRecord = z.infer<typeof runRecordSchema>;
