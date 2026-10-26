import type { ModelSummary } from './summarize.js';

/** Why the verdict came out the way it did. */
export type VerdictReason =
  /** A passing model costs less than the baseline. */
  | 'cheaper_model_passes'
  /** No model met the pass bar, so there is nothing to recommend. */
  | 'nothing_passed'
  /** Something passed, but nothing cheaper than what the user already runs. */
  | 'already_optimal';

export type Verdict = {
  /** The model to switch to, or null when there is nothing to switch to. */
  recommended: string | null;
  /** Dollars per month saved by switching. Zero unless a switch is recommended. */
  savingsPerMonth: number;
  /** The model savings were measured against. */
  baseline: string | null;
  /**
   * True when the baseline was inferred rather than given. Without --current
   * we fall back to the most expensive tier audited, which overstates savings
   * for anyone not already on that tier — so callers can qualify the number.
   */
  baselineIsAssumed: boolean;
  reason: VerdictReason;
};

/**
 * Decides which model to recommend, and what switching saves.
 *
 * Returns the decision rather than printing it, so the report and the saved
 * run record describe the same verdict instead of each deriving its own.
 */
export const decideVerdict = (
  models: ModelSummary[],
  currentModelId?: string,
): Verdict => {
  // Only ever recommend a model that passed — a cheap wrong answer must
  // never win. Models with incomplete calls are already excluded upstream,
  // because part of their score is unknown.
  const passing = models.filter(model => model.passed);
  const cheapest = [...passing].sort(
    (a, b) => a.monthlyCost - b.monthlyCost,
  )[0];

  // --current names what the user actually pays for today, which is the only
  // honest comparison. Falling back to the priciest tier audited preserves
  // the original behaviour, flagged via baselineIsAssumed.
  const current = currentModelId
    ? models.find(model => model.name === currentModelId)
    : undefined;

  const mostExpensive = [...models].sort(
    (a, b) => b.monthlyCost - a.monthlyCost,
  )[0];
  const baselineModel = current ?? mostExpensive;

  const savings = cheapest && baselineModel
    ? baselineModel.monthlyCost - cheapest.monthlyCost
    : 0;

  const base = {
    baseline: baselineModel?.name ?? null,
    baselineIsAssumed: !current,
  };

  // Two ways there is nothing to switch to: nothing passed at all, or the
  // cheapest passing model is not actually cheaper than the baseline. Both
  // are legitimate outcomes, not errors.
  if (!cheapest) {
    return { ...base, recommended: null, savingsPerMonth: 0, reason: 'nothing_passed' };
  }

  if (savings <= 0) {
    return { ...base, recommended: null, savingsPerMonth: 0, reason: 'already_optimal' };
  }

  return {
    ...base,
    recommended: cheapest.name,
    savingsPerMonth: savings,
    reason: 'cheaper_model_passes',
  };
};
