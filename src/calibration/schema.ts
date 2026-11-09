import { z } from 'zod';

/**
 * One hand-labeled grading decision: an answer a model gave, the reference
 * answer, and whether a person judged it correct. `input` is optional so the
 * answer/expected pairs written by --capture-misses can be labeled and reused
 * as-is.
 */
export const labeledExampleSchema = z.object({
  input: z.string().optional(),
  answer: z.string(),
  expected: z.string(),
  label: z.enum(['pass', 'fail']),
});

export type LabeledExample = z.infer<typeof labeledExampleSchema>;
