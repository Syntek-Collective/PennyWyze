<div align='center'>

<img src="./assets/banner.png" alt="PennyWyze" width="100%"/>

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/badge/npm-pennywyze-CB3837.svg)](https://www.npmjs.com/package/pennywyze)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing--development)
[![GitHub](https://img.shields.io/badge/GitHub-repo-181717.svg)](https://github.com/Syntek-Collective/PennyWyze)

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
![Commander](https://img.shields.io/badge/Commander.js-000000)
![Zod](https://img.shields.io/badge/Zod-3E67B1)
[![Vitest](https://img.shields.io/badge/Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
![Claude](https://img.shields.io/badge/Claude-D97757)

</div>

#

Most teams default to the smartest, most expensive Claude tier because checking whether a cheaper one would work means building a whole test harness — so they never check, and quietly overpay every month.

PennyWyze is that evaluation harness, already built. Point it at your real prompt and a handful of examples you know the right answer to; it runs all four Claude tiers — Fable, Opus, Sonnet and Haiku — against them, grades every answer, prices each tier from real token usage, and tells you the cheapest one that still passes.

**What makes it different:**
- Costs are measured from real API token counts, never estimated
- Grading is strict on purpose — a correct answer wearing decoration passes, a right answer buried in a sentence doesn't
- Free-form answers can be graded by an LLM judge, which explains every verdict — and every audit shows how often that judge agrees with your own hand grading
- A tier that's mathematically already failed stops spending immediately, mid-run
- Verdicts held identical across 5 consecutive real audits

## Contents

- [Getting Started](#getting-started)
- [See It Run](#see-it-run)
- [Flags](#flags)
- [How It Grades](#how-it-grades)
- [Grading Free-Form Answers](#grading-free-form-answers)
- [Repeatability](#repeatability)
- [Troubleshooting](#troubleshooting)
- [Contributing & Development](#contributing--development)
- [Roadmap](#roadmap)
- [Contributors](#contributors)
- [License](#license)

## Getting Started

Requires [Node 20+](https://nodejs.org/) on macOS, Linux, or Windows.

```bash
npm install -g pennywyze
```

Add your key — get one at [console.anthropic.com](https://console.anthropic.com/), then create a `.env` file wherever you're running the command from:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Write a prompt (`prompt.md`) — the exact instructions your feature already sends to Claude — and a golden dataset: real inputs paired with the answer you know is right.

```jsonl
{"input": "I was charged twice this month", "expected": "billing"}
{"input": "The app crashes on upload", "expected": "technical"}
```

Then run it:

```bash
pennywyze audit --prompt prompt.md --dataset dataset.jsonl --pass-rate 90
```

## See It Run

<img src="./assets/demo.gif" alt="PennyWyze running a real audit" width="500"/>

*(Sped up for length — a real 50-example audit takes about 3 minutes. The final report and verdict play at real speed.)*

*Figures below are an illustrative run at the default 100,000 messages/month.*

```
 ✓ fable audited — 50 questions
 ✓ opus audited — 50 questions
 ✓ sonnet audited — 50 questions
 ✓ haiku audited — 50 questions

  PENNYWYZE AUDIT REPORT
┌───────────────────┬────────────┬────────────────┐
│ MODEL             │  ACCURACY  │ EST. COST / MO │
├───────────────────┼────────────┼────────────────┤
│ claude-fable-5-1  │ 48/50 PASS │   $401.88 / mo │
├───────────────────┼────────────┼────────────────┤
│ claude-opus-5-5   │ 48/50 PASS │   $160.75 / mo │
├───────────────────┼────────────┼────────────────┤
│ claude-sonnet-5-5 │ 49/50 PASS │    $77.92 / mo │
├───────────────────┼────────────┼────────────────┤
│ claude-haiku-4-5  │ 49/50 PASS │    $26.26 / mo │
└───────────────────┴────────────┴────────────────┘

  FAILED TEST DETAILS
-------------------------------------------------------

 ● claude-opus-5-5
   ├─ Input:    "The site keeps logging me out every five minutes, super a..."
   │  Received: "account"
   │  Expected: "technical"
   │
   └─ Input:    "I can't log in and honestly at this point I just want my ..."
      Received: "account"
      Expected: "billing"

-------------------------------------------------------

 ● claude-sonnet-5-5
   └─ Input:    "The site keeps logging me out every five minutes, super a..."
      Received: "account"
      Expected: "technical"

-------------------------------------------------------

 ● claude-haiku-4-5
   └─ Input:    "I can't log in and honestly at this point I just want my ..."
      Received: "account"
      Expected: "billing"

-------------------------------------------------------

 VERDICT  Switch to claude-haiku-4-5 - save ~$375.62/mo.

  ℹ Audit cost: $0.32
```

## Flags

| Flag | Required | Default | What it does |
|---|---|---|---|
| `--prompt <filepath>` | yes | — | your instructions file |
| `--dataset <filepath>` | yes | — | your golden dataset |
| `--volume <count>` | no | 100000 | messages/month — scales cost, never the verdict |
| `--pass-rate <percent>` | no | 100 | minimum score to pass, 1–100 |
| `--capture-misses <filepath>` | no | off | append every wrong answer to this file, as grader fixtures |
| `--current <model-id>` | no | — | the model you run today; savings are measured against it |
| `--json-out <filepath>` | no | off | also write the full run to this file as JSON, for CI or later comparison. **Contains the full text of every missed question** — don't commit it if your inputs are sensitive |
| `--grader <kind>` | no | `exact` | `exact`, or `judge` — exact match first, an LLM judge for the rest. See [Grading Free-Form Answers](#grading-free-form-answers) |
| `--judge-model <model-id>` | no | `$PENNYWYZE_JUDGE_MODEL`, then `claude-opus-5-5` | the judge model; implies `--grader judge` |
| `--calibration <filepath>` | no | off | your hand-labeled answers — measures how often the grader agrees with you, printed in the report |
| `--min-agreement <percent>` | no | off | stop before the audit if grader agreement is below this, 1–100. Needs `--calibration` |
| `--fake` | no | off | run the whole pipeline against a built-in stand-in, free and offline |
| `--version` | — | — | print the installed version |

## How It Grades

Both sides are cleaned first (quotes, casing, code fences, trailing punctuation stripped), then compared **exactly** — not "contains." A decorated correct answer passes; a wrong answer never does, and an answer buried in a sentence fails on purpose, because ignoring "respond with one word" is a real bug in production. The winner is always the *cheapest tier that passed* — never just the cheapest tier.

## Grading Free-Form Answers

Exact match is right for labels. For answers that can be correct in many wordings — a support reply, a summary, an explanation — use the LLM judge:

```bash
pennywyze audit --prompt prompt.md --dataset dataset.jsonl --grader judge --calibration labels.jsonl
```

- **Exact match still runs first.** The judge only sees answers exact match rejected, so a matching answer costs nothing extra and can't be talked into a fail.
- **Every judged verdict comes with a rationale.** The judge returns structured output — `{ rationale, verdict }` — and the rationale prints under each miss.
- **The judge model is picked at run time:** `--judge-model`, then `PENNYWYZE_JUDGE_MODEL`, then `claude-opus-5-5`. On real runs it's confirmed with the Anthropic Models API before any paid call. Judge calls count toward the audit cost, never toward a model's monthly projection.
- **You see how far to trust it.** `--calibration` takes answers you graded by hand:

  ```jsonl
  {"input": "Can I return a gift card?", "answer": "Gift cards are non-returnable.", "expected": "No — gift cards cannot be returned.", "label": "pass"}
  {"input": "Can I return a gift card?", "answer": "Yes, within 30 days.", "expected": "No — gift cards cannot be returned.", "label": "fail"}
  ```

  The grader runs over them first, exactly as the audit will use it, and the report prints its agreement rate, false passes and false fails before the verdict. Without `--calibration`, a judge audit carries a loud `UNMEASURED` warning. Add `--min-agreement 90` to stop before the audit if the judge disagrees with you too often. `input` is optional, so labeled `--capture-misses` output works too.

To tune a judge without running an audit:

```bash
pennywyze calibrate --prompt prompt.md --calibration labels.jsonl --judge-model claude-sonnet-5-5
```

A worked example lives in [`examples/freeform/`](examples/freeform/). Its labels are illustrative — write your own from real answers to your own prompt; agreement on someone else's labels says nothing about your task.

## Repeatability

Verdict stability tested across 5 consecutive real audits: identical verdicts
and identical per-model scores every run. Per-answer output-token counts vary
slightly on the newest models (adaptive thinking is non-deterministic), which
moves cost projections a few percent between runs — but scores and the verdict
held constant in every trial. Re-run/threshold logic deliberately omitted:
the data says it isn't needed.

## Troubleshooting

PennyWyze fails loud and specific rather than crashing with a stack trace.
If you hit one of these, the fix is usually immediate:

| You'll see | It means | Fix |
|---|---|---|
| `Prompt file not found: '...'` | `--prompt` points at a path that doesn't exist | Check the path, or that you're running from the right directory |
| `Dataset file not found: '...'` | `--dataset` points at a path that doesn't exist | Same as above |
| `Prompt file '...' contains no readable text.` | The prompt file exists but is empty | Add your instructions to the file |
| `Line N of your golden dataset is not valid JSON.` | Line N has a syntax error (missing quote, trailing comma, ...) | Fix that exact line — nothing before or after it was touched |
| `Line N of your golden dataset is invalid: ...` | Line N parsed as JSON but is missing `input` or `expected` | Add the missing field named in the message |
| `Dataset file '...' is empty. Provide at least 1 test example.` | The file has no usable rows | Add at least one `{"input": ..., "expected": ...}` line |
| `Error: Volume must be a positive number.` | `--volume` wasn't a number, or was ≤ 0 | Pass a positive number, e.g. `--volume 5000` |
| `Error: Pass rate must be a number between 1 and 100.` | `--pass-rate` was outside 1–100 | Pass a percentage in that range |
| `Unknown judge model '...'` | `--judge-model` or `PENNYWYZE_JUDGE_MODEL` isn't a model PennyWyze can price | Use one of the ids the message lists |
| `Judge model '...' could not be confirmed with the Anthropic API` | Your key can't reach that model | Check the id and your key's access, or pick another judge |
| `Line N of your calibration file is invalid: ...` | A label line is missing `answer` or `expected`, or `label` isn't `pass`/`fail` | Fix that line |
| `Grader agreed with your labels N% of the time, below --min-agreement` | The judge disagrees with your hand grading too often to trust | Read the disagreements (`pennywyze calibrate`), try another `--judge-model`, or fix ambiguous labels |
| `Error: Could not connect to Anthropic API. Check your network connection.` | A network or timeout failure reaching Anthropic | Check your connection and retry, or run with `--fake` to confirm the rest of the pipeline works |

## Contributing & Development

Contributions are welcome — fork the repo, branch from `dev`, commit, and open a PR against `dev`. (`main` tracks what's published to npm; `dev` is where finished work waits for a release.) See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

Build from source instead of installing from npm:

```bash
git clone https://github.com/Syntek-Collective/PennyWyze.git
cd PennyWyze
npm install
npm run dev -- audit --prompt examples/prompt.md --dataset examples/demo-dataset.jsonl   # run without building
npm test                                                                                  # run the test suite
```

**Developing without an API key or cost:** add `--fake` to any command to run the full pipeline against a free, instant, built-in stand-in provider instead of the real Anthropic API. This is how the tool gets built and tested day to day — real API calls are only for real audits.

**Extending PennyWyze:** the audit loop is built around two swappable contracts — `ModelProvider` (anything that can answer a question and report what it cost, see `src/providers/provider.ts`) and `Scorer` (anything that can grade an answer and say why, see `src/scorers/scorer.ts`). Most new features — a new model provider, a new grading strategy — are a single new file implementing one of these two interfaces, not a change to the core loop.

Questions or Code of Conduct concerns: [pennywyzeosp@gmail.com](mailto:pennywyzeosp@gmail.com)

## Roadmap

| Feature | Status |
|---|---|
| Real audits against live Claude models | ✅ |
| Strict, decoration-tolerant grading | ✅ |
| Early stopping — never pay for a run that's already lost | ✅ |
| Configurable pass bar (`--pass-rate`) | ✅ |
| Real cost projections + audit self-cost | ✅ |
| Free offline `--fake` mode for development | ✅ |
| Published to the npm registry | ✅ |
| Claude Fable 5.1 as a fourth tier | ✅ |
| Structured JSON output (`--json-out`) | ✅ |
| JSON grading (deterministic, for structured answers) | 🙏🏻 |
| Shareable HTML report | 🙏🏻 |
| GitHub Action — re-audit in CI against a committed baseline | 🙏🏻 |
| Flexible dataset input formats (CSV, etc.) | 🙏🏻 |
| `pennywyze init` — guided golden-dataset builder | 🙏🏻 |
| Cross-provider audits — OpenAI, Google, and Grok, run in parallel per provider | 🙏🏻 |
| LLM-as-judge — exact match runs first, the judge only sees the rest, and reports how often it agrees with your own grading | ✅ |
| Prompt trimming — cheaper prompts, not just cheaper models | 🙏🏻 |

✅ = Ready to use · ⏳ = In progress · 🙏🏻 = Looking for contributors

See [CHANGELOG.md](CHANGELOG.md) for release history.

## Contributors

- Olivia McKelvey: [GitHub 🐙](https://github.com/Oliviamckelvey) | [LinkedIn 🖇️](https://www.linkedin.com/in/mckelveyolivia/)
- Edward Zgonc: [GitHub 🐙](https://github.com/Edward-Zgonc) | [LinkedIn 🖇️](https://www.linkedin.com/in/edward-zgonc/)
- Maia Bard: [GitHub 🐙](https://github.com/MaiaKBard) | [LinkedIn 🖇️](https://www.linkedin.com/in/maiakbard/)

## License

Distributed under the MIT License. See [LICENSE](LICENSE) for details.