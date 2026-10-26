# Architecture

A tour of PennyWyze's source, in the order one audit actually travels through it. If you're contributing, this is the fastest way to build a mental model before touching code.

## The pipeline, at a glance

```
cli.ts (parse + validate flags)
  → loaders (validate prompt + dataset)
  → provider (fake or real)
  → audit.ts (the loop) → progress.ts (draws the bar)
  → scorer (grade each answer)
  → summarize.ts (results → one row per model) → cost/calculator.ts (price it)
  → verdict.ts (decide what to recommend)
  → report.ts (print the table and verdict)
  → run-record/ (optionally write the whole run as JSON)
```

Two boundaries are worth knowing before you move code across them:

- **`audit.ts` and `summarize.ts` never touch the terminal.** The loop reports
  progress through callbacks it is handed; the summary returns numbers, not
  formatted strings. Everything that writes to stdout lives in `cli.ts`,
  `progress.ts` and `report.ts`. This is what keeps both testable, and what a
  non-CLI caller would reuse.
- **Incomplete is not the same as wrong.** A call that failed, was truncated,
  or was declined never produced an answer, so it is recorded as `incomplete`
  and excluded from scores, misses and cost — never counted as a miss.

## `src/cli.ts` — the entry point

The only file that imports from every layer of the pipeline. Defines the `audit` command with Commander, validates and converts the CLI flags (everything typed into a terminal arrives as text, so `--volume` and `--pass-rate` are cast to numbers and range-checked here, and `--current` is checked against the known model ids so a typo fails loudly instead of silently changing the savings baseline), loads the prompt and dataset, picks the fake or real provider, runs the audit, and hands the summarized results to the report.

It also owns the terminal mechanics the rest of the code deliberately avoids: hiding and restoring the cursor, and the `SIGINT` handler that puts the cursor back before exiting on Ctrl+C.

**Gotcha:** the two `try/catch` blocks in the action handler are separate on purpose. The first catches problems with the user's input (bad files); the second catches problems with the run itself (network failures). They produce different error messages because they're different kinds of failure.

## `src/golden-dataset/load-prompt.ts` — the prompt loader

Reads the prompt file and returns it verbatim, minus a UTF-8 BOM and zero-width characters, which editors and copy-paste insert invisibly and which would otherwise be sent to the model as part of the instructions. Nothing else is interpreted or reformatted: whatever the user wrote *is* the prompt, and rewriting it would mean auditing something other than their real instructions. Empty files and missing paths throw with a message naming the path.

## `src/golden-dataset/schema.ts` — the dataset contract

A single Zod schema: a golden dataset line must have an `input` string and an `expected` string, nothing else required. The `GoldenExample` type is derived from this schema with `z.infer`, so the type and the validation rule can never drift apart.

## `src/golden-dataset/load-golden-dataset.ts` — the loader

Reads the dataset file, splits it into lines, and validates each one against the schema above. A blank line is silently skipped (files often end with one). Any other failure, bad JSON or a missing field, throws immediately with the exact line number and stops the whole load. There is no partial success: either every line is valid and the function returns a full list, or it throws before returning anything.

**Gotcha:** this is why the dataset format is JSONL and not a single JSON array. JSONL fails one line at a time, which is what makes "line 3 is invalid" possible instead of "something in this file is broken."

## `src/providers/provider.ts` — the model-caller contract

One interface, `ModelProvider`, with one method: `run(modelId, systemPrompt, userInput)` returns `{ text, inputTokens, outputTokens, stopReason }`. This is the seam that lets a free fake stand-in and the real Anthropic API be interchangeable. The audit loop is written against this shape, not against any specific implementation.

`stopReason` is the one field that isn't obvious. It exists so the loop can tell a *wrong* answer apart from one that was never finished: `end_turn` is a real attempt, while `max_tokens` (cut off) and `refusal` (declined) are not, and grading either as a miss would quietly lower a model's score for something it never got wrong.

## `src/providers/anthropic-models.ts` — pricing and model IDs

A single object mapping each tier (`fable`, `opus`, `sonnet`, `haiku`) to its model id, display label, input/output price per million tokens, request timeout, and reasoning effort. This is the one place to edit when Anthropic changes pricing or model ids. The CLI derives its list of models to audit from this object, so the report's row order comes from this object's own key order, nothing sorts it explicitly — the entries are kept most-expensive-first so the table reads as a price ladder, and a test enforces that. `MODELS_BY_ID` is the same data keyed by api id, so per-call lookups don't rescan the object.

Two fields carry decisions rather than facts:

- **`effort`** caps how much a model deliberates. On Claude 5 models thinking is on by default and thinking tokens bill at the *output* rate, so without a cap the pricier tiers are charged for reasoning a one-word classification never needed — skewing the very comparison this tool exists to produce. It is `null` for Haiku 4.5, which does not support the parameter at all and returns a 400, and which has no adaptive thinking to cap. Every other tier defaults to `medium` or `high` effort, so capping it to `low` is what makes a one-word classification cost comparable across tiers.
- **`timeoutMs`** is per model because a thinking tier and Haiku don't deserve the same ceiling. A single short client-level timeout made slow-but-fine answers look like network failures. Fable gets the longest (5 minutes): a single request can run minutes on a hard input.

## `src/providers/fake-provider.ts` — the free stand-in

Implements `ModelProvider` but never makes a network call. Cycles through a short list of canned answers, deliberately including a correct-but-decorated one (`"billing"` in quotes) so development exercises the grader's cleanup logic without spending anything. This is what `--fake` swaps in, and it's how the entire pipeline gets built and tested at zero cost.

Exported as a factory, `createFakeProvider()`, plus one shared `fakeProvider` instance for the CLI. Position in the answer list is state: a single module-level counter leaks between tests in the same file, so which answers a test received depended on what ran before it. Tests should always build their own.

## `src/providers/anthropic-provider.ts` — the real caller

Implements `ModelProvider` against the real Anthropic API. A few non-obvious decisions worth knowing before you touch this file:

- No `temperature` parameter. Opus 5 and Sonnet 5 both reject it with an HTTP 400 (see `docs/api-validation.md`). Repeatability is verified separately, by running the same real audit five times and checking the verdict holds, not by pinning temperature.
- `system` is a top-level field on Anthropic's API, not a message with a system role.
- The response's `content` array is searched for the first `text` block rather than assumed to be at index 0, because Opus's adaptive thinking can insert a `thinking` block first.
- `max_tokens` is set generously (1000) so that thinking doesn't consume the budget before the model emits a real answer.
- Effort and timeout come from the model catalog, not from constants here. Effort is spread in conditionally so that a model which rejects the parameter sends no `output_config` field at all.
- `maxRetries` is left at the SDK default behaviour (4) because it is currently the *only* retry layer. If we add our own backoff, this must go to 0 first, or the two multiply instead of one replacing the other.

## `src/scorers/scorer.ts` — the grading contract

One interface, `Scorer`, with one method: `score(actual, expected)` returns `Promise<boolean>`. It's async even though the current grader never awaits anything, on purpose: a future LLM-as-judge grader will need to make its own API call, and declaring the contract async now means it drops into this exact socket later without touching the audit loop.

Known limitation, left deliberately unaddressed: a judge would also need the original *input* (not just the two answers), and would want to return a reason and its own token cost. That's a real change to this interface, and it should be made by whoever builds the judge, when the right shape is knowable, rather than guessed at now.

## `src/scorers/exact-match-scorer.ts` — the real grader

Normalizes both sides (strip code fences, quotes, capitalization, trailing punctuation) and then requires exact equality, not "contains." A correct answer wearing decoration passes; a right answer buried in a sentence still fails, because ignoring an output-format instruction is a real production bug, not a technicality. This file's tests are partly seeded by `tests/scorers/fixtures/real-misses.jsonl` — real wrong answers captured from real audits, which `tests/scorers/real-misses.test.ts` replays to assert each one still scores as a miss. Loosen the normalization too far and a genuine miss starts passing, and that test goes red. The file grows only when someone opts in with `--capture-misses <path>`; it is never written automatically, because a relative default path lands in whatever directory the installed CLI happened to be run from.

## `src/audit.ts` — the loop

Everything upstream feeds this file; everything downstream reads what it produces. For each model, for each question, it calls the provider, grades the answer with the scorer, and pushes one record onto a results list. The provider, the scorer, and the progress reporter are all received as parameters, never imported directly, which is the entire swap mechanism for fake-vs-real, exact-match-vs-future-grader, and terminal-vs-silent.

A call that throws does not end the audit. It is recorded as `incomplete`, that model stops, and the remaining models still run — every result already collected has been paid for, and one provider having a bad minute shouldn't discard it.

Before each model's run, it computes how many misses that model can absorb and still clear the pass bar. The moment a model's failure count exceeds that number, the loop breaks for that model rather than finishing the remaining questions, since it's already mathematically impossible for it to pass.

## `src/progress.ts` — the progress bar

The terminal implementation of the audit's `AuditProgress` hooks. Every ANSI escape for the live ticker lives here: `\r` to return to the start of the line, `\x1b[K` to clear to end of line so a redraw doesn't need padding spaces, and a trailing `\n` on the per-model line to release it so the next model starts fresh. Nothing in `audit.ts` knows any of this exists.

## `src/summarize.ts` — results into rows

Turns the flat list of per-question results into one row per model: pass count, whether early stopping cut it short, how many calls came back incomplete, projected monthly cost, whether it cleared the bar, and its misses.

Returns numbers and booleans, never formatted strings, for two reasons: tests can assert on `passes === 48` instead of matching text with invisible colour codes in it, and a non-terminal caller needs the values rather than a rendering of them.

**Gotcha:** a model with *any* incomplete call can never be reported as passed. Part of its score is unknown, so "it passed" would be a claim the data can't support — it shows as `N/A`, not `FAIL`, and is excluded from the verdict.

## `src/cost/calculator.ts` — the pricing math

One function, `costOfCall`, that turns token counts and per-token rates into a dollar amount. The divide by 1,000,000 exists because rates are quoted per million tokens; forgetting it is the classic bug here; the code still runs, every number is just silently wrong by a factor of a million.

## `src/verdict.ts` — the decision

Takes the model summaries and returns which model to recommend, what switching saves, and which model the savings were measured against. Returns the decision; prints nothing.

It used to live inside `report.ts`, computed in the same breath as the sentence that announced it — so the decision existed only as text on screen, and the only way to test it was to capture `console.log` output and search it for the words "Switch to." Now the report and the saved run record both read the same verdict, which is also why they can't disagree about who won.

`reason` is the field worth knowing: `cheaper_model_passes`, `nothing_passed`, or `already_optimal`. The last two print the same message to a user but are different findings, and a machine reading a saved run needs them apart.

**Gotcha:** `baselineIsAssumed` is true whenever `--current` wasn't passed. The savings figure is still real, but it's measured against the most expensive tier audited rather than what the user pays — so anything displaying that number should say so.

## `src/run-record/` — the machine-readable run

What `--json-out` writes: one JSON file describing an entire audit. The terminal output answers "what should I do right now"; this answers "what exactly did we measure, and when."

- **`schema.ts`** — a Zod schema, with the type derived from it, same as the dataset schema. Defined as a schema rather than a plain type because the *reader* is the real beneficiary: a baseline file on disk may be old, hand-edited, or written by a different version, and parsing it should fail loudly rather than silently produce undefined fields.
- **`build.ts`** — assembles a record and validates it on the way out. Validating what we write looks redundant but keeps the schema honest: add a field to the builder and forget the schema, and this throws in development instead of producing files that readers reject later.
- **`write.ts`** — writes it, creating the containing folder if needed. Only ever to the path the user named, same contract as `--capture-misses`.

Three decisions in here that aren't obvious:

- **The hashes cover what was measured, not the file bytes.** The prompt hash is of the sanitized prompt actually sent to the model, and the dataset hash is of the parsed examples. So reformatting a dataset's whitespace isn't a change, while editing an expected answer is. Their purpose is to let a reader tell "quality regressed" apart from "this baseline measured a different prompt, so comparing them is meaningless" — without that, a CI gate reports failures that aren't real, which is how a team ends up switching the check off.
- **Misses are stored in full.** The report truncates inputs to 60 characters so its tree view doesn't wrap; a saved record that inherited that would be useless for diagnosing a miss a week later. **This makes the file more sensitive than it looks:** it contains the complete text of every question a model got wrong — real customer messages, for a support classifier — where `--capture-misses` stores only the answer and the expected label. These records are meant to be committed as CI baselines, so say so in any docs that recommend committing them, and don't commit one built from sensitive inputs.
- **`schemaVersion` is checked, not just recorded.** Bump it whenever a change would break a reader of an older file.
- **There is deliberately no `provider` field.** Considered and deferred: the model id already identifies its provider through the catalog, so a reader can derive it, and adding the field later as an *optional* one needs no `schemaVersion` bump and leaves existing records valid. Deciding its shape now — per model or per run, provider id or display name, and what to do with a model the catalog no longer knows — would be guesswork until a second provider exists. Add it with that work.
- **The output path is validated before the audit, not at write time.** `--json-out` pointing at the prompt or the dataset is refused outright, because the record is written with a plain overwrite and the audit has already finished by then — the user would lose both the file and the run. An uncreatable folder is also caught up front, since discovering it afterwards means paying for every call a second time. Both live in `output-path.ts`.

## `src/report.ts` — the printed output

The only part of the tool a user ever sees. Prints the comparison table, the miss details for any model that had at least one, and the verdict. The verdict logic is the one rule this file owns and the easiest to get subtly wrong: it names the cheapest model that *passed*, never just the cheapest model outright, so a fast wrong answer can never win.

Two rules that were each a bug once:

- **Zero savings is not a recommendation.** If the cheapest passing model isn't actually cheaper than the baseline, the verdict says the user is already on the optimal tier instead of advising them to "switch" to what they already run.
- **The baseline is `--current` when given.** Without it, savings fall back to the most expensive tier audited, which overstates them for anyone not already on that tier — so the report says so explicitly rather than letting the number stand unqualified.

## Tests

Vitest covers the loaders, the audit loop's shape and early-stopping math, its incomplete-call handling and progress reporting, the summary rollup, the cost calculator, the report's verdict rules, and the exact-match scorer — including a replay of real captured misses.

Two conventions worth keeping:

- **Hand-computed expected values.** Cost tests spell out the arithmetic rather than deriving it from the same code under test, which would prove nothing.
- **Tests are typechecked.** `tsconfig.json` covers only `src`, so `tsconfig.test.json` exists to typecheck `src` and `tests` together; `npm run typecheck` runs both. Without it Vitest happily runs tests whose fixtures no longer match the types they claim to be, which is exactly what was happening before it was added.

## Scripts

`scripts/api-test.ts` is a manual, one-off script for probing the real API directly (model ids, accepted parameters, response shape). It is not an automated test, it costs real money, and it's meant to be run and read by a human. It lives outside `src/` on purpose: it makes a live API call at import time, and inside the compiled tree it was being typechecked on every build and was easy to open by accident.

## CI

`.github/workflows/ci.yml` runs typecheck, tests and build on every pull request, on Node 20 and 22. `npm run format` applies Prettier; `format:check` is not in CI yet because a repo-wide reformat needs to land as its own pull request first.