import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

import { anthropicClient } from '../../providers/anthropic-client.js';
import { MODELS_BY_ID } from '../../providers/anthropic-models.js';
import type { JudgeClient } from './judge-client.js';
import { judgeDecisionSchema } from './judge-client.js';

/**
 * The real judge. Structured outputs constrain the reply to the verdict
 * schema, so there is no free text to scrape a "pass" out of.
 */
export const anthropicJudgeClient: JudgeClient = {
  async judge(modelId, system, user) {
    const model = MODELS_BY_ID.get(modelId);
    // Effort is only sent where the model accepts it (Haiku 4.5 rejects it).
    // Medium rather than the audit's low: the judge's accuracy is what every
    // verdict rests on, and it only grades the answers exact match rejected.
    const effort = model?.effort === null ? null : 'medium';

    const response = await anthropicClient.messages.parse(
      {
        model: modelId,
        system,
        messages: [{ role: 'user', content: user }],
        // Room for adaptive thinking plus a short rationale.
        max_tokens: 4000,
        output_config: {
          format: zodOutputFormat(judgeDecisionSchema),
          ...(effort ? { effort } : {}),
        },
      },
      model ? { timeout: model.timeoutMs } : {},
    );

    return {
      decision: response.parsed_output ?? null,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      stopReason: response.stop_reason,
    };
  },
};
