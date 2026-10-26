import { describe, it , expect } from 'vitest'
import { exactMatch } from '../../src/scorers/exact-match-scorer.js'

describe("exactMatchScorer", () => {
  it("passes a quoted answer", async () => {
    expect(exactMatch("billing", "billing")).toBe(true)
  })

  it("passes a capitalized answer with a period", async () => {
    expect(exactMatch("Billing.", "billing")).toBe(true);
  });

  it("passes a code-fenced answer", async () => {
    expect(exactMatch("```\nbilling\n```", "billing")).toBe(true);
  });

  it("passes a code-fenced answer with a language label", async () => {
    expect(exactMatch("```json\nbilling\n```", "billing")).toBe(true);
  });

  it("passes quotes and a trailing period together", async () => {
    expect(exactMatch('"billing".', "billing")).toBe(true);
  });
  
  it("fails a sentence-wrapped answer, on purpose", async () => {
    expect(exactMatch("The answer is billing.", "billing")).toBe(false);
  });

  it("fails a plainly wrong answer", async () => {
    expect(exactMatch("technical", "billing")).toBe(false);
  });
})