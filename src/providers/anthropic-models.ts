export const ANTHROPIC_MODELS = {
  // Prices are dollars per million tokens (divided out in cost/calculator.ts).
  // Verified against platform.claude.com/docs/en/about-claude/pricing and the
  // models overview on 2026-10-02. Re-check both before editing: IDs and prices
  // change, and a stale catalog makes every number this tool prints wrong.
  //
  // Ordered most to least expensive. The report's row order comes from this
  // object's key order, so the table reads top-down as a price ladder.
  //
  // `effort` caps how much reasoning a model spends before answering. It is
  // set for every model that accepts it, because current Claude models run
  // adaptive thinking by default and thinking tokens bill at the OUTPUT rate —
  // so without it, the pricier tiers are charged for deliberation this task
  // never asked for, and the cost comparison this tool exists to produce is
  // skewed toward whichever tier thinks most. Each model's own default is
  // noted, since that is what we are overriding.
  fable: {
    id: 'claude-fable-5-1',
    label: 'fable',
    inputPrice: 10,
    outputPrice: 50,
    // Thinking is always on and cannot be disabled — effort is the only lever.
    // Defaults to 'high'.
    effort: 'low',
    // Single requests can run minutes on a hard input.
    timeoutMs: 300_000,
  },
  opus: {
    id: 'claude-opus-5-5',
    label: 'opus',
    inputPrice: 4,
    outputPrice: 20,
    // Thinking always on, defaults to 'medium' effort.
    effort: 'low',
    timeoutMs: 180_000,
  },
  sonnet: {
    id: 'claude-sonnet-5-5',
    label: 'sonnet',
    inputPrice: 2,
    outputPrice: 10,
    // Adaptive thinking, defaults to 'high' effort.
    effort: 'low',
    timeoutMs: 120_000,
  },
  haiku: {
    id: 'claude-haiku-4-5',
    label: 'haiku',
    inputPrice: 1,
    outputPrice: 5,
    timeoutMs: 60_000,
    // Haiku 4.5 does not support the effort parameter at all — sending
    // output_config.effort returns a 400. It also has no adaptive thinking to
    // cap, so there is nothing to equalize.
    effort: null,
  },
} as const;

export type AnthropicModel =
  (typeof ANTHROPIC_MODELS)[keyof typeof ANTHROPIC_MODELS];

/** Model config by API id, so callers don't re-scan the object per call. */
export const MODELS_BY_ID: ReadonlyMap<string, AnthropicModel> = new Map(
  Object.values(ANTHROPIC_MODELS).map(model => [model.id, model]),
);
