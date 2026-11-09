import {
  ANTHROPIC_MODELS,
  MODELS_BY_ID,
} from '../../providers/anthropic-models.js';

/** Used when neither --judge-model nor PENNYWYZE_JUDGE_MODEL is set. */
export const DEFAULT_JUDGE_MODEL = ANTHROPIC_MODELS.opus.id;

export type ResolvedJudgeModel = {
  modelId: string;
  /** Where the choice came from — printed, so nobody wonders which judge ran. */
  source: 'flag' | 'env' | 'default';
  /** The Models API's name for it, when it was looked up. */
  displayName: string | null;
};

/**
 * Picks the judge model at run time: --judge-model, then the
 * PENNYWYZE_JUDGE_MODEL environment variable, then the default.
 *
 * The id must be in the pricing catalog, because judge calls are part of the
 * audit's cost and an unpriced judge would under-report it. When a lookup is
 * given (real runs), the model is then confirmed with the Models API before a
 * single paid call — a judge your key can't reach should fail in one second,
 * not halfway through an audit.
 */
export const resolveJudgeModel = async (options: {
  flag?: string | undefined;
  env?: string | undefined;
  lookup?: (modelId: string) => Promise<{ display_name: string }>;
}): Promise<ResolvedJudgeModel> => {
  const flag = options.flag?.trim();
  const env = options.env?.trim();

  const [modelId, source]: [string, ResolvedJudgeModel['source']] = flag
    ? [flag, 'flag']
    : env
      ? [env, 'env']
      : [DEFAULT_JUDGE_MODEL, 'default'];

  if (!MODELS_BY_ID.has(modelId)) {
    const from = source === 'env' ? 'PENNYWYZE_JUDGE_MODEL' : '--judge-model';
    throw new Error(
      `Unknown judge model '${modelId}' (from ${from}). Expected one of: ${[...MODELS_BY_ID.keys()].join(', ')}.`,
    );
  }

  if (!options.lookup) return { modelId, source, displayName: null };

  try {
    const info = await options.lookup(modelId);
    return { modelId, source, displayName: info.display_name };
  } catch (err) {
    throw new Error(
      `Judge model '${modelId}' could not be confirmed with the Anthropic API (${
        err instanceof Error ? err.message : String(err)
      }).`,
    );
  }
};
