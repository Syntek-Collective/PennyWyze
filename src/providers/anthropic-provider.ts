import type { ModelProvider } from './provider.js';
import { MODELS_BY_ID } from './anthropic-models.js';
import Anthropic from '@anthropic-ai/sdk';

// Created once and shared by every call — reads ANTHROPIC_API_KEY from the
// environment on its own; maxRetries handles rate-limit hiccups with growing
// waits. This is the only retry layer: if we ever add our own backoff, set
// maxRetries to 0 first, or the two multiply instead of one replacing the other.
// No client-level timeout — it is set per request from the model's catalog
// entry, because a thinking model and Haiku do not deserve the same ceiling.
const client = new Anthropic({ maxRetries: 4 });

export const anthropicProvider: ModelProvider = {
  async run(modelId, systemPrompt, userInput) {
    const model = MODELS_BY_ID.get(modelId);
    const effort = model?.effort ?? null;

    const response = await client.messages.create({
      model: modelId,
      // system is a TOP-LEVEL field on Anthropic's API, not a message role
      system: systemPrompt,
      messages: [{ role: 'user', content: userInput }],
      //Required by the API — generous ceiling for one-word answers
      max_tokens: 1000, // Raised from 300 so adaptive thinking doesn't starve the text block
      // No temperature: the current Claude models reject the parameter
      // outright (400 error), so it is not sent to any tier — Haiku, which
      // would accept it, is left at its default for consistency with the
      // other three. Repeatability is verified separately instead — see the
      // README's Repeatability section (same real audit run five times, same
      // verdict).
      //
      // Effort comes from the model catalog and is only sent where the model
      // accepts it. Spread rather than a literal so Haiku's request carries no
      // output_config field at all, which it would reject.
      ...(effort ? { output_config: { effort } } : {}),
    }, model ? { timeout: model.timeoutMs } : {});

    // Search for the text block instead of assuming it's at index 0 —
    // Opus's adaptive thinking can insert a 'thinking' block first
    const textBlock = response.content.find(block => block.type === 'text');
    const text: string =
      textBlock && textBlock.type === 'text' ? textBlock.text.trim() : '';

    return {
      text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      // Passed through so the audit can tell a wrong answer apart from a
      // truncated or declined one. Graded as a miss, they would quietly
      // lower a model's score for something it never actually got wrong.
      stopReason: response.stop_reason,
    };
  },
};
