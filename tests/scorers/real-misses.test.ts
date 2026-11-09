import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

import { exactMatch } from '../../src/scorers/exact-match-scorer.js';

// Real wrong answers captured from actual audit runs (via --capture-misses).
// They guard the scorer's normalization — the quote, code-fence and trailing
// punctuation stripping. Loosen that logic too far and one of these genuine
// misses starts passing, which is a silently wrong verdict, not a crash.
// Invented examples only cover the cases we already thought of; these don't.
const rows = readFileSync(
  new URL('./fixtures/real-misses.jsonl', import.meta.url).pathname,
  'utf8',
)
  .trim()
  .split('\n')
  .filter(Boolean)
  .map(line => JSON.parse(line) as { answer: string; expected: string });

describe('exactMatchScorer against real captured misses', () => {
  it('has captured fixtures to check against', () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  it('still scores every captured miss as a miss', async () => {
    for (const { answer, expected } of rows) {
      const scored = exactMatch(answer, expected);
      expect(scored, `expected a miss for ${JSON.stringify({ answer, expected })}`).toBe(false);
    }
  });
});
