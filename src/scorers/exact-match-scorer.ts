import type { Scorer } from './scorer.js';

const normalize = (text: string): string => {
  // Order matters: strip wrappers (code fences, quotes) before touching the
  // core text, so a quoted or fenced answer normalizes the same as a bare one.
  let s = text
    .trim()
    .replace(/```[a-z]*\n?/g, '')
    .replace(/```/g, '')
    .trim();
  s = s.toLowerCase().replace(/[.!]+$/, '');
  return s.replace(/^["']|["']$/g, '');
};

/** True when the answer matches the expected one after cleanup. */
export const exactMatch = (modelOutput: string, expected: string): boolean =>
  normalize(modelOutput) === normalize(expected);

export const exactMatchScorer: Scorer = {
  name: 'exact',
  async score({ answer, expected }) {
    return { pass: exactMatch(answer, expected), gradedBy: 'exact' };
  },
};
