import { describe, it, expect } from 'vitest';

import {
  ANTHROPIC_MODELS,
  MODELS_BY_ID,
} from '../../src/providers/anthropic-models.js';

const models = Object.values(ANTHROPIC_MODELS);

// The catalog is the single source of truth for what gets audited, what it
// costs, and how each model is called. A typo here is silently wrong rather
// than loud, so these guard its shape — not its exact values, which are
// expected to change whenever Anthropic's lineup does.
describe('ANTHROPIC_MODELS', () => {
  it('has a unique api id per entry', () => {
    const ids = models.map(m => m.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never pins a dated model id', () => {
    // Dated snapshots like 'claude-haiku-4-5-20251001' go stale and are not
    // the published form we want to audit against.
    for (const model of models) {
      expect(model.id).not.toMatch(/-\d{8}$/);
    }
  });

  it('prices every model, output above input', () => {
    for (const model of models) {
      expect(model.inputPrice).toBeGreaterThan(0);
      expect(model.outputPrice).toBeGreaterThan(model.inputPrice);
    }
  });

  it('lists models most expensive first, so the report reads as a price ladder', () => {
    const outputPrices = models.map(m => m.outputPrice);
    const descending = [...outputPrices].sort((a, b) => b - a);

    expect(outputPrices).toEqual(descending);
  });

  it('gives every model a timeout long enough for a real answer', () => {
    for (const model of models) {
      expect(model.timeoutMs).toBeGreaterThanOrEqual(60_000);
    }
  });

  it('leaves effort unset only where the model rejects it', () => {
    // Haiku 4.5 returns a 400 for output_config.effort. Everything else in
    // the lineup runs adaptive thinking that needs capping for a fair
    // cost comparison.
    expect(ANTHROPIC_MODELS.haiku.effort).toBeNull();

    for (const model of models) {
      if (model.id !== ANTHROPIC_MODELS.haiku.id) {
        expect(model.effort).toBe('low');
      }
    }
  });

  it('indexes every model by id', () => {
    expect(MODELS_BY_ID.size).toBe(models.length);

    for (const model of models) {
      expect(MODELS_BY_ID.get(model.id)).toBe(model);
    }
  });
});
