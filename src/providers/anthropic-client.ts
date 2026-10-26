import Anthropic from '@anthropic-ai/sdk';

// Created once and shared by the provider, the judge and the model lookup —
// reads ANTHROPIC_API_KEY from the environment on its own; maxRetries handles
// rate-limit hiccups with growing waits. This is the only retry layer: if we
// ever add our own backoff, set maxRetries to 0 first, or the two multiply
// instead of one replacing the other.
// No client-level timeout — it is set per request from the model's catalog
// entry, because a thinking model and Haiku do not deserve the same ceiling.
export const anthropicClient = new Anthropic({ maxRetries: 4 });
