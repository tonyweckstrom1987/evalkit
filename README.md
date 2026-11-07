# evalkit

[![CI](https://github.com/tonyweckstrom1987/evalkit/actions/workflows/ci.yml/badge.svg)](https://github.com/tonyweckstrom1987/evalkit/actions/workflows/ci.yml) ![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)

Run the same prompt set against several models and block regressions in CI. Evalkit compares the results with the previous accepted run (the baseline) and fails the run only if a case that used to pass stops passing.

It is a small CLI that talks to any OpenAI-compatible endpoint (LiteLLM, OpenRouter). Features: a zod-validated eval set format, hard call caps, and no API keys in output. The runner takes an injectable `fetch`, so it works with [llm-cassette](https://github.com/tonyweckstrom1987/llm-cassette) for free, deterministic CI runs.

**Tech:** TypeScript, Node.js 22/24, zod, vitest.

> **Status:** Version 0.3.0, published to npm as `@tonyweckstrom/evalkit`. The core (schema, runner, checks, baseline, CLI and `--cassette`) is tested without calling a model. A GitHub Action (`action.yml`) is included.
>
> **Note on language:** The repository's `main` branch prints its help, errors and report in English, as shown in this README. The published 0.3.0 package still prints them in Finnish; the English text arrives with the next release. Exit codes, flag names and the baseline format are the same in both. The bundled example eval set (`examples/yleinen-fi.json`) has Finnish prompts.

## Installation

You need Node.js 22 or 24. No installation is needed, just try it:

```bash
npx @tonyweckstrom/evalkit --version
```

Or add it to a project:

```bash
npm install --save-dev @tonyweckstrom/evalkit
npx evalkit --help
```

## Quick start

> `examples/yleinen-fi.json` is in the repository but not in the npm package (the package contains only `dist/`). If you installed from npm, download the file from the [examples folder](https://github.com/tonyweckstrom1987/evalkit/blob/main/examples/yleinen-fi.json) or write your own eval set (format below).

```bash
export LLM_API_KEY=...   # not needed if the endpoint requires no key

# 1) Create a baseline from a state you have accepted
npx @tonyweckstrom/evalkit run examples/yleinen-fi.json \
  --models openrouter/deepseek/deepseek-v4.1-flash \
  --base-url https://litellm.local/v1 \
  --baseline evalkit.baseline.json --update-baseline

# 2) Run in CI: fails only on a regression
npx @tonyweckstrom/evalkit run examples/yleinen-fi.json \
  --models openrouter/deepseek/deepseek-v4.1-flash \
  --base-url https://litellm.local/v1 \
  --baseline evalkit.baseline.json
```

Commit `evalkit.baseline.json` to the repository. When you change a prompt or a model and the result is intentionally different, update the baseline with `--update-baseline` and review the diff.

## Example output

Below are the repository's own test recordings (`test/fixtures/action/`) run with `--cassette` replay. The answers come from a fake model, not a real one, but the output is exactly what evalkit prints. First the baseline matches, so the run passes (exit code 0) even though one case fails: it was already failing in the baseline.

```text
$ npx evalkit run examples/yleinen-fi.json --models demo --base-url https://litellm.example/v1 \
    --baseline test/fixtures/action/baseline-ok.json --cassette test/fixtures/action/yleinen.cassette.json
Evalkit: yleinen-fi
  demo: passed 2/3 (67 %), errors 0
Failed cases:
  - demo / lasku-01: regex: response does not match /^\s*42\s*\.?\s*$/
Comparison to baseline:
  regressions: 0, fixed: 0, new: 0, missing: 0
```

When the same case had passed in the baseline, the same result is a regression and the run fails (exit code 1):

```text
Comparison to baseline:
  regressions: 1, fixed: 0, new: 0, missing: 0
  REGRESSION demo::lasku-01: regex: response does not match /^\s*42\s*\.?\s*$/
  demo: pass rate dropped by 33 percentage points
```

A three-minute walkthrough with before/after examples and GitHub Action snippets (written in Finnish, with an English summary at the end): [docs/demo.md](docs/demo.md).

## Validate an eval set at no cost

```bash
npx evalkit validate examples/yleinen-fi.json evals/*.json
```

`validate` reads the files and checks the format (zod), duplicate ids and invalid regular expressions. It makes no network calls. It returns 0 when all files are valid and 2 if any file is invalid; every file is checked, so you get all the errors at once. A good first step in CI.

## Eval set format (version 1)

```json
{
  "version": 1,
  "name": "general",
  "cases": [
    {
      "id": "general-01",
      "prompt": "What is the capital of Sweden?",
      "systemPrompt": "Answer with one word.",
      "tags": ["general knowledge"],
      "expect": {
        "contains": "Stockholm",
        "notContains": ["Helsinki"],
        "regex": "^Stockholm\\.?$",
        "minJudgeScore": 4
      }
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `version` | Always `1`. |
| `name` | Optional name of the set, shown in the report. |
| `cases[].id` | Unique identifier. The same id cannot be used twice. |
| `cases[].prompt` | The user message sent to the model. |
| `cases[].systemPrompt` | Optional system message. |
| `cases[].tags` | Optional. The first tag is the reporting group; without tags the group is derived from the id prefix (`general-01` → `general`). |
| `cases[].expect` | Optional set of conditions. A case passes when **all** given conditions hold. Without `expect` the case is not evaluated (the response is only stored in the report). |
| `expect.contains` | The response contains the text (case-insensitive). |
| `expect.notContains` | The response contains none of the texts in the list (case-insensitive). |
| `expect.regex` | The response matches the regular expression. An invalid expression is rejected before the run. |
| `expect.minJudgeScore` | The judge model's score (1–5) is at least this value. Requires `--judge-model`. |

**Legacy format:** the array format of mcp-model-router (`expectedContains`, `category`) is still read and converted to version 1, so existing prompt files work as they are.

## Baseline and regression gate

`evalkit.baseline.json` stores the result of every evaluated case under the key `model::caseId`.

- **Regression:** the case passed in the baseline but does not now (an error such as a timeout also counts as a failure).
- **Fixed:** the case failed in the baseline but passes now.
- **New:** the case is not in the baseline. A new failing case does not fail the run; update the baseline once you have reviewed it.
- **Missing:** the case is in the baseline but not in this run (the case was removed or the model was not run).
- **Flaky model:** `--max-pass-drop 0.1` allows individual regressions as long as no model's pass rate drops by more than 10 percentage points. The default is 0: a single regression fails the run.

Without `--baseline`, every evaluated case must pass.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Ok |
| 1 | Regression, or (without a baseline) failed cases |
| 2 | Usage or configuration error (missing option, broken eval set, missing baseline, exceeded call cap) |

## Options

| Option | Meaning |
| --- | --- |
| `--models a,b` | Comma-separated models (or `EVALKIT_MODELS`). |
| `--base-url <url>` | OpenAI-compatible base URL (or `EVALKIT_BASE_URL`). |
| `--api-key-env <NAME>` | Environment variable the API key is read from (default `LLM_API_KEY`). The key is never passed on the command line. |
| `--judge-model <model>` | Judge model. Pick a different model than the ones under test, because a model favors its own answer style. |
| `--baseline <file>` | Compare to the baseline. |
| `--update-baseline` | Write this run's results as the baseline. Needs `--baseline <file>`. |
| `--max-pass-drop <0-1>` | Allowed drop in pass rate (default 0). |
| `--concurrency <n>` | Concurrent requests (default 4). |
| `--timeout-ms <ms>` | Timeout per request (default 60000). |
| `--max-tokens <n>` | `max_tokens` per request (default 1024, cap 4096). |
| `--cassette <file>` | Replay or record model responses with an [llm-cassette](https://github.com/tonyweckstrom1987/llm-cassette) file (see below). Requires the package `@tonyweckstrom/llm-cassette`. |
| `--cassette-mode <mode>` | `replay` (default: never uses the network), `record` or `auto`. Needs `--cassette`. |
| `--json <file>` | Write the full report to a JSON file. |

## Cost and safety

- **Hard caps in code:** one run makes at most 200 model calls (judge calls included), and `max_tokens` is at most 4096 per call. The cap is checked before any call is made. It can be exceeded only when using the library, with the `maxCalls` option.
- **The API key** is read only from an environment variable and is never printed in the report or in error messages.
- The report (`--json`) contains the models' responses as they are. Do not commit it if your prompts contain sensitive data.

## Free CI runs: llm-cassette

Real model calls cost money, and responses vary from run to run. Record the responses once into an [llm-cassette](https://github.com/tonyweckstrom1987/llm-cassette) file and replay them in CI:

```bash
npm install --save-dev @tonyweckstrom/llm-cassette

# Once, locally, with a real key: records the responses
npx evalkit run examples/yleinen-fi.json --models m --base-url https://litellm.local/v1 \
  --baseline evalkit.baseline.json --cassette test/cassettes/yleinen.json --cassette-mode record

# In CI: replays the recordings, no network and no cost (replay is the default)
npx evalkit run examples/yleinen-fi.json --models m --base-url https://litellm.local/v1 \
  --baseline evalkit.baseline.json --cassette test/cassettes/yleinen.json
```

Commit the cassette file and the baseline to the repository. A recording is matched by the request URL (so also `--base-url`) and the request body (model, messages and parameters). If the prompt, the model, the base URL or the task changes, `replay` finds no recording and that case fails with the message "No recorded response ... Run once with --cassette-mode record to record it". Record again in `record` mode. Note that this tests whether your **eval set and conditions** work against recorded responses, not the model's current quality: a change in model quality shows only in a new recording.

As a library, `runEval` takes a `fetch` option:

```ts
import { runEval, loadEvalSet } from "@tonyweckstrom/evalkit";
import { cassetteFetch } from "@tonyweckstrom/llm-cassette";

const report = await runEval({
  set: loadEvalSet("examples/yleinen-fi.json"),
  models: ["m"],
  baseUrl: "https://litellm.local/v1",
  fetch: cassetteFetch({ path: "test/cassettes/yleinen.json" }), // default: replay
});
```

## GitHub Action

Run evalkit in another repository's CI with one step. The action installs and builds evalkit itself, so you do not need to publish or install anything. **Pin the version to a commit SHA** (not a branch), so that an outside change cannot reach your workflow:

```yaml
jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      # Free and fast: checks the file format without network access
      - uses: tonyweckstrom1987/evalkit@<commit-sha>
        with:
          mode: validate
          eval-set: evals/yleinen.json

      # Replay recorded responses (no cost, no key)
      - uses: tonyweckstrom1987/evalkit@<commit-sha>
        with:
          eval-set: evals/yleinen.json
          models: openrouter/deepseek/deepseek-v4.1-flash
          base-url: https://litellm.example/v1
          baseline: evals/evalkit.baseline.json
          cassette: evals/yleinen.cassette.json
```

For real model calls (these cost money), pass the key from a secret in the step's `env` block. It is never given as an input and never printed:

```yaml
      - uses: tonyweckstrom1987/evalkit@<commit-sha>
        env:
          LLM_API_KEY: ${{ secrets.LLM_API_KEY }}
        with:
          eval-set: evals/yleinen.json
          models: m1,m2
          base-url: https://litellm.example/v1
          baseline: evals/evalkit.baseline.json
```

| Input | Meaning |
| --- | --- |
| `eval-set` | Eval set file (several files separated by spaces in `validate` mode). Required. |
| `mode` | `run` (default) or `validate`. |
| `models`, `base-url` | Required in `run` mode. |
| `baseline`, `max-pass-drop` | Regression gate (see above). |
| `cassette`, `cassette-mode` | Replay or record responses; in CI leave `cassette-mode` out (the default is `replay`). |
| `judge-model`, `max-tokens`, `concurrency`, `timeout-ms` | Same as the CLI options. |
| `api-key-env` | Name of the environment variable that holds the key (default `LLM_API_KEY`). |
| `json-report` | Write the report to a JSON file. The report contains the models' responses; do not commit it. |

Inputs are passed to the shell as environment variables, not on the command line, so special characters in values cannot run commands. The action never updates the baseline: accept changes locally with `--update-baseline` and review the baseline diff in a pull request. The action uses Node 24.

## Limitations

- The judge model gives only a single-number score (1–5) and does not replace human review. Use it as a complementary measure.
- Streaming is not supported, and only text responses are evaluated.

## Alternatives and why this one

Evalkit is not the first eval tool, and larger, more mature alternatives exist. Choose according to what you need:

- **[promptfoo](https://github.com/promptfoo/promptfoo)** is the most comprehensive open-source option: many built-in grading methods, many model providers, a comparison view and its own GitHub Action. If you need red-team tests, a web UI or a wide feature set, use it.
- **[DeepEval](https://github.com/confident-ai/deepeval)** and **[Inspect](https://inspect.aisi.org.uk/)** are Python tools. They fit if your project is in Python and you want evaluations in the style of pytest or research work.
- Evalkit is deliberately small (about 700 lines of source, one runtime dependency, `zod`) and focuses on one question: **did something that used to work just break?** The baseline comparison is the core, not an add-on, and only a regression fails the CI run. In addition, the eval set is a simple JSON file whose format is checked without network access (`validate`), the number of calls has a hard cap in code, and compatibility with [llm-cassette](https://github.com/tonyweckstrom1987/llm-cassette) gives free, repeatable CI runs.

This comparison is based on searching and on the tools' own descriptions, not on trying out all of their features. Check the current situation on their own pages.

## Development

```bash
npm ci
npm run typecheck
npm test
npm run build
```
