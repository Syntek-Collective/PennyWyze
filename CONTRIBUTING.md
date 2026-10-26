# Contributing to PennyWyze

Thanks for considering a contribution. This project is built around a couple of small, deliberate seams that make most contributions smaller than they look, this doc points you at them.

## Development setup

```bash
git clone https://github.com/Syntek-Collective/PennyWyze.git
cd PennyWyze
npm install
```

Run from source without building:

```bash
npm run dev -- audit --prompt examples/prompt.md --dataset examples/demo-dataset.jsonl
```

Add `--fake` to any command to run the full pipeline against a free, instant, offline stand-in provider, no Anthropic API key or spend required. This is how the project is meant to be developed day to day; real API calls should be reserved for verifying a real audit actually works.

## Running tests

```bash
npm test
```

## How the codebase is organized

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for a full file-by-file tour. The short version: the pipeline runs CLI → loaders → provider → audit loop → scorer → cost math → report, and two small interfaces (`ModelProvider` and `Scorer`) are what let pieces of it be swapped independently.

## Extending PennyWyze

**Adding a new model provider** (OpenAI, Google, etc.): implement `ModelProvider` from `src/providers/provider.ts`. Your `run()` method returns `{ text, inputTokens, outputTokens, stopReason }`. Look at `src/providers/anthropic-provider.ts` as a reference implementation, and note the response-parsing gotchas documented there before assuming a different provider's response shape is simpler than it looks.

`stopReason` is the one that isn't obvious, and it carries real weight: it's how the audit tells a *wrong* answer apart from one that was never finished. A truncated or declined response is recorded as incomplete and kept out of the score, instead of counting as a miss.

**`'end_turn'` is the only value that means "complete answer". Any other string marks the answer incomplete.** So you have to translate your provider's vocabulary into ours: OpenAI's `"stop"` and Google's `"STOP"` both mean a finished answer, and must be mapped to `'end_turn'`. Pass them through unmapped and every model's run stops at its first call, marked incomplete — so no model ever passes.

`null` is the exception, and means "this provider tells us nothing". Those answers are graded normally — the audit has no basis to call them incomplete. Use it only when that's genuinely true, never to satisfy the type: a provider that *could* report truncation but returns `null` instead gets its cut-off answers graded as wrong, silently.

**Adding a new grading strategy**: implement `Scorer` from `src/scorers/scorer.ts`. Your `score()` method takes the model's answer and the expected answer and returns a boolean. `src/scorers/exact-match-scorer.ts` is the reference implementation.

**Every new provider or scorer should ship with its own test file** modeled on `tests/scorers/exact-match-scorer.test.ts`, covering both the cases it should pass and the cases it should correctly fail. This isn't a formality, the tool's entire value proposition is that it measures instead of guesses, and that standard applies to its own code too.

## Submitting a change

Work lands on `dev`, not `main`. `main` tracks what's published to npm; `dev` is where finished-but-unreleased work accumulates until a release. So day-to-day contributions branch from `dev` and target `dev`.

1. Fork the repo
2. Create a feature branch from `dev` (`git checkout dev && git pull && git checkout -b feature/your-feature`)
3. Make your change, with tests if it touches logic
4. Commit (`git commit -m 'Add your feature'`)
5. Push to your fork and open a pull request against `dev`

Small, focused PRs are easier to review than large ones that bundle unrelated changes, if your change naturally splits into independent pieces, consider opening it as more than one PR.

## Reporting bugs or proposing features

Open an issue describing what you expected versus what happened (for a bug), or what problem you're trying to solve (for a feature request). If you're proposing something from the [Roadmap](README.md#roadmap), mention that too, someone may already be working on it.