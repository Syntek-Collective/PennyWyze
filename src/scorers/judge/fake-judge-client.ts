import type { JudgeClient } from './judge-client.js';

const between = (text: string, tag: string): string =>
  text.match(new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`))?.[1] ?? '';

/**
 * A free, offline judge for --fake and tests. Passes an answer that contains
 * the reference anywhere (so "The answer is billing." passes where exact match
 * failed it), and explains itself the way the real judge does.
 */
export const fakeJudgeClient: JudgeClient = {
  async judge(_modelId, _system, user) {
    const reference = between(user, 'reference').trim().toLowerCase();
    const answer = between(user, 'answer').trim().toLowerCase();
    const pass = reference.length > 0 && answer.includes(reference);

    return {
      decision: {
        verdict: pass ? 'pass' : 'fail',
        rationale: pass
          ? 'The answer states the reference answer, with extra wording.'
          : 'The answer does not state the reference answer.',
      },
      inputTokens: 300,
      outputTokens: 40,
      stopReason: 'end_turn',
    };
  },
};
