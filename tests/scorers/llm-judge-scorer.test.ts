import { describe, it, expect } from 'vitest';

import {
  buildJudgeSystemPrompt,
  buildJudgeUserMessage,
  createJudgeScorer,
  JudgeError,
} from '../../src/scorers/judge/llm-judge-scorer.js';
import type {
  JudgeClient,
  JudgeResponse,
} from '../../src/scorers/judge/judge-client.js';
import { fakeJudgeClient } from '../../src/scorers/judge/fake-judge-client.js';

const JUDGE = 'claude-opus-5-5';

/** A judge that always answers the same way, and counts its calls. */
const scriptedJudge = (response: Partial<JudgeResponse>) => {
  const calls: Array<{ system: string; user: string }> = [];
  const client: JudgeClient = {
    async judge(_model, system, user) {
      calls.push({ system, user });
      return {
        decision: {
          verdict: 'pass',
          rationale: 'Same meaning as the reference.',
        },
        inputTokens: 200,
        outputTokens: 30,
        stopReason: 'end_turn',
        ...response,
      };
    },
  };
  return { client, calls };
};

const item = {
  input: 'Why was I charged twice?',
  answer: 'A duplicate billing charge.',
  expected: 'billing',
};

describe('createJudgeScorer', () => {
  it('settles an exact match without calling the judge', async () => {
    const { client, calls } = scriptedJudge({});
    const scorer = createJudgeScorer({
      client,
      modelId: JUDGE,
      taskPrompt: 'p',
    });

    const result = await scorer.score({ ...item, answer: '"Billing".' });

    expect(result).toEqual({ pass: true, gradedBy: 'exact' });
    expect(calls).toHaveLength(0);
  });

  it('asks the judge about what exact match rejects, and keeps its rationale and tokens', async () => {
    const { client, calls } = scriptedJudge({});
    const scorer = createJudgeScorer({
      client,
      modelId: JUDGE,
      taskPrompt: 'p',
    });

    const result = await scorer.score(item);

    expect(calls).toHaveLength(1);
    expect(result).toEqual({
      pass: true,
      gradedBy: 'judge',
      rationale: 'Same meaning as the reference.',
      usage: { modelId: JUDGE, inputTokens: 200, outputTokens: 30 },
    });
  });

  it('records a judge fail as a fail', async () => {
    const { client } = scriptedJudge({
      decision: { verdict: 'fail', rationale: 'Wrong category.' },
    });
    const scorer = createJudgeScorer({
      client,
      modelId: JUDGE,
      taskPrompt: 'p',
    });

    expect(await scorer.score(item)).toMatchObject({
      pass: false,
      gradedBy: 'judge',
      rationale: 'Wrong category.',
    });
  });

  it('throws rather than guessing when the judge refuses, keeping the tokens spent', async () => {
    const { client } = scriptedJudge({ stopReason: 'refusal' });
    const scorer = createJudgeScorer({
      client,
      modelId: JUDGE,
      taskPrompt: 'p',
    });

    const error = await scorer.score(item).catch(e => e);
    expect(error).toBeInstanceOf(JudgeError);
    expect(error.message).toContain('refusal');
    expect(error.usage).toEqual({
      modelId: JUDGE,
      inputTokens: 200,
      outputTokens: 30,
    });
  });

  it('throws when the judge returns nothing parseable', async () => {
    const { client } = scriptedJudge({ decision: null });
    const scorer = createJudgeScorer({
      client,
      modelId: JUDGE,
      taskPrompt: 'p',
    });

    await expect(scorer.score(item)).rejects.toThrow('no parseable verdict');
  });

  it('is named after its judge model', () => {
    const { client } = scriptedJudge({});
    expect(
      createJudgeScorer({ client, modelId: JUDGE, taskPrompt: 'p' }).name,
    ).toBe(`judge:${JUDGE}`);
  });
});

describe('judge prompts', () => {
  it('grades against the task prompt the model was given', () => {
    expect(buildJudgeSystemPrompt('Reply with one word.')).toContain(
      '<instructions>\nReply with one word.\n</instructions>',
    );
  });

  it('tells the judge to treat graded text as data, not instructions', () => {
    expect(buildJudgeSystemPrompt('p')).toMatch(/not instructions to you/);
  });

  it('wraps input, reference and answer in their own tags', () => {
    const message = buildJudgeUserMessage(item);
    expect(message).toContain('<input>\nWhy was I charged twice?\n</input>');
    expect(message).toContain('<reference>\nbilling\n</reference>');
    expect(message).toContain(
      '<answer>\nA duplicate billing charge.\n</answer>',
    );
  });

  it('marks a missing input instead of sending an empty tag', () => {
    expect(buildJudgeUserMessage({ ...item, input: '' })).toContain(
      '(not provided)',
    );
  });
});

describe('fakeJudgeClient', () => {
  it('passes an answer that contains the reference', async () => {
    const scorer = createJudgeScorer({
      client: fakeJudgeClient,
      modelId: JUDGE,
      taskPrompt: 'p',
    });

    expect(
      await scorer.score({
        input: 'q',
        answer: 'The answer is billing.',
        expected: 'billing',
      }),
    ).toMatchObject({
      pass: true,
      gradedBy: 'judge',
    });
    expect(
      await scorer.score({
        input: 'q',
        answer: 'technical',
        expected: 'billing',
      }),
    ).toMatchObject({
      pass: false,
    });
  });
});
