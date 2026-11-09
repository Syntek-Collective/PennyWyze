import { z } from 'zod';

/**
 * The structured verdict the judge must return. Rationale comes before the
 * verdict on purpose: the model writes its reasoning first and decides second,
 * rather than picking an answer and justifying it afterwards.
 */
export const judgeDecisionSchema = z.object({
  rationale: z
    .string()
    .describe('One or two sentences on why the answer is or is not correct.'),
  verdict: z.enum(['pass', 'fail']),
});

export type JudgeDecision = z.infer<typeof judgeDecisionSchema>;

export type JudgeResponse = {
  /** Null when the judge produced nothing parseable. */
  decision: JudgeDecision | null;
  inputTokens: number;
  outputTokens: number;
  /** Same vocabulary as ProviderResponse.stopReason. */
  stopReason: string | null;
};

/**
 * The seam between the judge scorer and whatever answers its questions — the
 * real API, or a free stand-in for --fake and tests. Same pattern as
 * ModelProvider.
 */
export interface JudgeClient {
  judge(modelId: string, system: string, user: string): Promise<JudgeResponse>;
}
