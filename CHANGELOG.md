# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added
- Claude Fable 5.1 as a fourth tier ($10/$50 per million tokens), so the audit covers the current flagship rather than stopping below it
- `--json-out <filepath>`: writes the full audit to a JSON file alongside the usual table — every model's score and cost, the verdict as data, the settings used, and sha256 fingerprints of the prompt and dataset so a saved run can be compared to a later one meaningfully. The path is validated before the audit runs, and refused if it points at your prompt or dataset. Note the file contains the full text of every missed question
- `--current <model-id>`: names the model you run today, so savings are measured against what you actually pay instead of the most expensive tier audited
- CI on every pull request (typecheck, tests, build) across Node 20 and 22
- Prettier config and `format` / `format:check` scripts

### Fixed
- When no model met the pass bar, the verdict claimed "You are currently on the optimal pricing tier" — which isn't true if nothing worked. That case now reads "No model met your pass bar", with a pointer to the misses or a lower `--pass-rate`. The two findings were indistinguishable before the verdict carried a reason
- A failed API call no longer discards the whole audit. The failure is recorded, that model stops, and the remaining models finish
- A truncated or declined response is no longer graded as a wrong answer. Providers report `stop_reason`, and anything other than `end_turn` is recorded as incomplete and excluded from scores, misses and cost
- Opus and Sonnet are no longer billed for reasoning this task never asked for. Effort is set per model from the catalog, and omitted for Haiku 4.5, which rejects the parameter
- Progress labels no longer fall back to "haiku" for unrecognized model ids
- Haiku's model id corrected to the canonical `claude-haiku-4-5`
- Request timeouts are per model (5 min for Fable, 3 min for Opus, 2 min for Sonnet, 1 min for Haiku). A single 20s ceiling made slow-but-valid answers look like network failures
- `README.md` and `docs/ARCHITECTURE.md` corrected where they described behaviour the code no longer has

### Changed
- Model lineup moved to the current generation: Opus 5 → **Opus 5.5** ($5/$25 → $4/$20) and Sonnet 5 → **Sonnet 5.5**. Opus 5 and Sonnet 5 are now legacy models, and Opus 5.5 is both newer and 20% cheaper than the tier we were previously pricing
- Breaking: `--current` no longer accepts `claude-opus-5` or `claude-sonnet-5`. Use `claude-opus-5-5` or `claude-sonnet-5-5`
- Node 20 or newer is required (18 is end-of-life)
- The audit loop no longer writes to the terminal; progress is reported through callbacks, with the rendering in `progress.ts`
- The fake provider is a factory, so tests no longer share answer-list position

## [1.1.0] - 9/22/26

### Added
- `--capture-misses <filepath>`: opt-in capture of wrong answers as grader fixtures, written only to the path you name
- Test asserting every captured miss in `real-misses.jsonl` still scores as a miss, so the saved fixtures now guard the scorer's normalization
- `--version` flag, read from `package.json` so it always matches the published release

### Fixed
- Audits no longer write a `tests/scorers/fixtures/` directory into the current working directory. Capture is off unless `--capture-misses` is passed
- Verdict no longer says "Switch to <model> - save ~$0.00/mo" when the only passing model is also the most expensive one. That case now reports that you are already on the optimal tier

### Changed
- Published package contains only the built CLI (4 files, ~10 kB, down from 43 files and ~272 kB)

## [1.0.0] - 9/22/26

### Added
- `pennywyze audit` command: benchmarks Claude Opus, Sonnet, and Haiku against a user-provided golden dataset
- Real cost projections and audit self-cost, built from actual token usage
- Strict, decoration-tolerant grading (exact-match scorer)
- Early stopping for tiers that mathematically can't pass
- `--fake` mode: full pipeline at zero cost, no API key required
- Installable globally via `npm install -g pennywyze`