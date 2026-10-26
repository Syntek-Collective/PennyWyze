import { describe, it, expect } from 'vitest';

import {
  DEFAULT_JUDGE_MODEL,
  resolveJudgeModel,
} from '../../src/scorers/judge/resolve-judge-model.js';
import { pickGraderKind } from '../../src/scorers/build-grader.js';

describe('resolveJudgeModel', () => {
  it('prefers --judge-model over the environment', async () => {
    expect(
      await resolveJudgeModel({
        flag: 'claude-sonnet-5-5',
        env: 'claude-haiku-4-5',
      }),
    ).toMatchObject({ modelId: 'claude-sonnet-5-5', source: 'flag' });
  });

  it('falls back to PENNYWYZE_JUDGE_MODEL, then the default', async () => {
    expect(await resolveJudgeModel({ env: 'claude-haiku-4-5' })).toMatchObject({
      modelId: 'claude-haiku-4-5',
      source: 'env',
    });
    expect(await resolveJudgeModel({})).toMatchObject({
      modelId: DEFAULT_JUDGE_MODEL,
      source: 'default',
    });
  });

  it('refuses a model it cannot price, naming where the id came from', async () => {
    await expect(resolveJudgeModel({ env: 'gpt-judge' })).rejects.toThrow(
      /Unknown judge model 'gpt-judge' \(from PENNYWYZE_JUDGE_MODEL\)/,
    );
  });

  it('confirms the model with the API when a lookup is given', async () => {
    const looked: string[] = [];
    const resolved = await resolveJudgeModel({
      flag: 'claude-opus-5-5',
      lookup: async id => {
        looked.push(id);
        return { display_name: 'Claude Opus 5.5' };
      },
    });

    expect(looked).toEqual(['claude-opus-5-5']);
    expect(resolved.displayName).toBe('Claude Opus 5.5');
  });

  it('fails clearly when the API cannot confirm the model', async () => {
    await expect(
      resolveJudgeModel({
        lookup: async () => {
          throw new Error('404 not_found_error');
        },
      }),
    ).rejects.toThrow(/could not be confirmed.*404/);
  });
});

describe('pickGraderKind', () => {
  it('defaults to exact match', () => {
    expect(pickGraderKind({})).toBe('exact');
  });

  it('treats --judge-model alone as asking for the judge', () => {
    expect(pickGraderKind({ judgeModel: 'claude-opus-5-5' })).toBe('judge');
  });

  it('refuses exact match combined with a judge model', () => {
    expect(() =>
      pickGraderKind({ grader: 'exact', judgeModel: 'claude-opus-5-5' }),
    ).toThrow();
  });

  it('refuses an unknown grader', () => {
    expect(() => pickGraderKind({ grader: 'vibes' })).toThrow(
      /Unknown --grader/,
    );
  });
});
