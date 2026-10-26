import type { AuditResult } from './audit.js';
import { MODELS_BY_ID } from './providers/anthropic-models.js';
import { costOfCall } from './cost/calculator.js';
import type { GraderUsage } from './scorers/scorer.js';

export type Miss = {
  input: string;
  answer: string;
  expected: string;
  /** Why the judge failed it. Absent when exact match decided. */
  rationale?: string;
};

export type ModelSummary = {
  name: string;
  passes: number;
  total: number;
  /** True when early stopping cut this model short of the full dataset. */
  stopped: boolean;
  /** Calls that never produced a gradeable answer — failures, truncations. */
  incomplete: number;
  monthlyCost: number;
  passed: boolean;
  misses: Miss[];
};

/** Total USD spent on the given calls, priced per model from real token counts. */
export const calculateResultsCost = (results: AuditResult[]): number =>
  results.reduce((sum, result) => {
    const model = MODELS_BY_ID.get(result.modelId);
    if (!model) return sum;

    return (
      sum +
      costOfCall(
        result.inputTokens,
        result.outputTokens,
        model.inputPrice,
        model.outputPrice,
      )
    );
  }, 0);

/** Total USD spent on grader (judge) calls, priced from their real token counts. */
export const costOfUsage = (usage: GraderUsage[]): number =>
  usage.reduce((sum, u) => {
    const model = MODELS_BY_ID.get(u.modelId);
    if (!model) return sum;
    return sum + costOfCall(u.inputTokens, u.outputTokens, model.inputPrice, model.outputPrice);
  }, 0);

/** What the judge cost across these results. Zero for exact-match audits. */
export const calculateGraderCost = (results: AuditResult[]): number =>
  costOfUsage(results.flatMap(r => (r.graderUsage ? [r.graderUsage] : [])));

export type EarlyStopSavings = {
  /** Model calls actually made. */
  callsMade: number;
  /** Model calls a run with no early stopping would have made. */
  callsPossible: number;
  /** Calls skipped because a model could no longer reach the pass bar. */
  callsSkipped: number;
  /** Estimated USD those skipped calls (and their grading) would have cost. */
  savedUsd: number;
  /** savedUsd as a share of what the full run would have cost, 0–1. */
  savedFraction: number;
};

/**
 * How much early stopping saved. Only calls skipped because a model could no
 * longer pass count — a model cut short by a failed call didn't "save" those,
 * it just didn't finish. Each skipped call is priced at that model's own
 * average cost per question so far, model call plus grading.
 */
export const summarizeEarlyStopping = (
  results: AuditResult[],
  modelIds: string[],
  datasetSize: number,
): EarlyStopSavings => {
  let callsSkipped = 0;
  let savedUsd = 0;

  for (const modelId of modelIds) {
    const records = results.filter(r => r.modelId === modelId);
    const stoppedForQuality =
      records.length > 0 &&
      records.length < datasetSize &&
      records.every(r => r.status === 'graded');
    if (!stoppedForQuality) continue;

    const skipped = datasetSize - records.length;
    const perQuestion =
      (calculateResultsCost(records) + calculateGraderCost(records)) /
      records.length;

    callsSkipped += skipped;
    savedUsd += skipped * perQuestion;
  }

  const spent = calculateResultsCost(results) + calculateGraderCost(results);
  const fullRun = spent + savedUsd;

  return {
    callsMade: results.length,
    callsPossible: modelIds.length * datasetSize,
    callsSkipped,
    savedUsd,
    savedFraction: fullRun > 0 ? savedUsd / fullRun : 0,
  };
};

/**
 * The bridge between the audit loop and the report: turns one flat list of
 * per-question results into one row per model.
 *
 * Returns plain numbers and booleans, never formatted strings — rendering is
 * the report's job, so this stays testable and reusable by non-terminal
 * callers.
 */
export const summarize = (
  results: AuditResult[],
  modelIds: string[],
  datasetSize: number,
  volume: number,
  passBar: number,
): ModelSummary[] =>
  modelIds.map(modelId => {
    const records = results.filter(r => r.modelId === modelId);

    // Only graded answers say anything about quality or cost. An incomplete
    // call is missing data, not a wrong answer.
    const graded = records.filter(r => r.status === 'graded');
    const incomplete = records.length - graded.length;
    const passes = graded.filter(r => r.pass).length;

    // Cost per call is averaged over the calls actually graded, so an
    // early-stopped model still projects a fair per-message rate.
    const averageCostPerCall = graded.length
      ? calculateResultsCost(graded) / graded.length
      : 0;

    return {
      name: modelId,
      passes,
      total: datasetSize,
      stopped: records.length < datasetSize,
      incomplete,
      monthlyCost: averageCostPerCall * volume,
      // A model with any incomplete call cannot be recommended: part of its
      // score is unknown, so "it passed" would be a claim the data can't
      // support. Otherwise measured against calls made, not dataset size —
      // early stopping only fires once the bar is already unreachable, so a
      // stopped model can never pass this check.
      passed:
        incomplete === 0 &&
        graded.length > 0 &&
        passes / graded.length >= passBar,
      misses: graded
        .filter(r => !r.pass)
        .map(r => ({
          input: r.question,
          answer: r.answer,
          expected: r.expected,
          ...(r.rationale !== undefined ? { rationale: r.rationale } : {}),
        })),
    };
  });
