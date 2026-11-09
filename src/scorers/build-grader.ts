import type { Scorer } from './scorer.js';
import { exactMatchScorer } from './exact-match-scorer.js';
import { createJudgeScorer } from './judge/llm-judge-scorer.js';
import {
  resolveJudgeModel,
  type ResolvedJudgeModel,
} from './judge/resolve-judge-model.js';
import { anthropicJudgeClient } from './judge/anthropic-judge-client.js';
import { fakeJudgeClient } from './judge/fake-judge-client.js';
import { anthropicClient } from '../providers/anthropic-client.js';

export type GraderKind = 'exact' | 'judge';

export type BuiltGrader = {
  kind: GraderKind;
  scorer: Scorer;
  /** Null for exact match. */
  judge: ResolvedJudgeModel | null;
};

/**
 * Turns the grader flags into a scorer. --judge-model on its own implies the
 * judge; asking for exact match and naming a judge is a contradiction, and
 * refused rather than silently ignoring one of them.
 */
export const pickGraderKind = (options: {
  grader?: string | undefined;
  judgeModel?: string | undefined;
}): GraderKind => {
  const kind = options.grader ?? (options.judgeModel ? 'judge' : 'exact');
  if (kind !== 'exact' && kind !== 'judge') {
    throw new Error(`Unknown --grader '${kind}'. Expected 'exact' or 'judge'.`);
  }
  if (kind === 'exact' && options.judgeModel) {
    throw new Error(`--judge-model only applies with --grader judge.`);
  }
  return kind;
};

/**
 * Builds the grader for one run. The judge model is resolved here, at run
 * time, and on real runs confirmed with the Models API before any paid call.
 */
export const buildGrader = async (options: {
  kind: GraderKind;
  judgeModel?: string | undefined;
  taskPrompt: string;
  fake: boolean;
}): Promise<BuiltGrader> => {
  if (options.kind === 'exact') {
    return { kind: 'exact', scorer: exactMatchScorer, judge: null };
  }

  const judge = await resolveJudgeModel({
    flag: options.judgeModel,
    env: process.env.PENNYWYZE_JUDGE_MODEL,
    ...(options.fake
      ? {}
      : { lookup: (id: string) => anthropicClient.models.retrieve(id) }),
  });

  return {
    kind: 'judge',
    judge,
    scorer: createJudgeScorer({
      client: options.fake ? fakeJudgeClient : anthropicJudgeClient,
      modelId: judge.modelId,
      taskPrompt: options.taskPrompt,
    }),
  };
};
