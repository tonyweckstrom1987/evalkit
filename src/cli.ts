import { writeFileSync } from "node:fs";
import { compare, readBaseline, toBaseline, writeBaseline, type Comparison } from "./baseline.js";
import { runEval, type Report } from "./run.js";
import { loadEvalSet } from "./schema.js";
import { VERSIO } from "./versio.js";

export const EXIT_OK = 0;
export const EXIT_GATE_FAILED = 1;
export const EXIT_USAGE = 2;

export interface CliIo {
  env: Record<string, string | undefined>;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  /** Injektoitava fetch (testit, llm-cassette). */
  fetch?: typeof fetch;
}

const USAGE = `Usage:
  evalkit run <evalset.json> --models a,b --base-url <url> [options]
  evalkit validate <evalset.json> [more files]   Checks the files without network access or cost
  evalkit --version

Options:
  --models a,b            Comma-separated models (or EVALKIT_MODELS)
  --base-url <url>        OpenAI-compatible base URL, e.g. https://litellm.local/v1 (or EVALKIT_BASE_URL)
  --api-key-env <NAME>    Environment variable the API key is read from (default LLM_API_KEY)
  --judge-model <model>   Judge model for the minJudgeScore check (pick a different model than the ones under test)
  --baseline <file>       Compare to the previous accepted run; only regressions fail the run
  --update-baseline       Write this run's results as the baseline
  --max-pass-drop <0-1>   Allow individual regressions if the pass rate does not drop by more than this (default 0)
  --concurrency <n>       Concurrent requests (default 4)
  --timeout-ms <ms>       Timeout per request (default 60000)
  --max-tokens <n>        max_tokens per request (default 1024, cap 4096)
  --cassette <file>       Replay/record model responses with an llm-cassette file (requires the package @tonyweckstrom/llm-cassette)
  --cassette-mode <mode>  replay (default, never uses the network), record or auto
  --json <file>           Write the full report to a JSON file

Exit codes: 0 = ok, 1 = regression or failed cases, 2 = usage or configuration error.
`;

interface Args {
  command: "run" | "validate";
  /** run: evalset-tiedosto (ensimmäinen); validate: kaikki tiedostot. */
  files: string[];
  flags: Record<string, string | true>;
}

const BOOL_FLAGS = new Set(["update-baseline", "help"]);

function parseArgs(argv: string[]): Args {
  const flags: Record<string, string | true> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const name = a.slice(2);
      if (BOOL_FLAGS.has(name)) flags[name] = true;
      else {
        const v = argv[++i];
        if (v === undefined || v.startsWith("--")) throw new Error(`Option --${name} needs a value`);
        flags[name] = v;
      }
    } else positional.push(a);
  }
  const command = positional[0];
  if (command !== "run" && command !== "validate") throw new Error(command ? `Unknown command '${command}'` : "Missing command");
  return { command, files: positional.slice(1), flags };
}

function intFlag(flags: Args["flags"], name: string): number | undefined {
  const v = flags[name];
  if (v === undefined) return undefined;
  const n = Number(v);
  if (typeof v !== "string" || !Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a positive integer`);
  return n;
}

function formatReport(report: Report): string {
  const lines: string[] = [];
  lines.push(`Evalkit${report.name ? `: ${report.name}` : ""}`);
  for (const m of report.perModel) {
    const summary = m.passRate === null ? "nothing to evaluate" : `passed ${m.passed}/${m.evaluated} (${Math.round(m.passRate * 100)} %)`;
    lines.push(`  ${m.model}: ${summary}, errors ${m.errors}`);
  }
  const failed = report.cases.filter((c) => c.passed === false);
  if (failed.length) {
    lines.push("Failed cases:");
    for (const c of failed) lines.push(`  - ${c.model} / ${c.caseId}: ${c.failures[0] ?? "failed"}`);
  }
  return lines.join("\n");
}

function formatComparison(cmp: Comparison): string {
  const lines: string[] = ["Comparison to baseline:"];
  lines.push(`  regressions: ${cmp.regressions.length}, fixed: ${cmp.fixed.length}, new: ${cmp.newCases.length}, missing: ${cmp.missing.length}`);
  for (const r of cmp.regressions) lines.push(`  REGRESSION ${r.key}: ${r.reason}`);
  for (const [model, d] of Object.entries(cmp.passRateDrop)) {
    if (d !== 0) lines.push(`  ${model}: pass rate ${d > 0 ? "dropped" : "rose"} by ${Math.abs(Math.round(d * 100))} percentage points`);
  }
  return lines.join("\n");
}

function validateFiles(files: string[], io: CliIo): number {
  if (files.length === 0) {
    io.stderr(`Error: validate needs at least one eval set file\n\n${USAGE}`);
    return EXIT_USAGE;
  }
  let bad = 0;
  for (const f of files) {
    try {
      const set = loadEvalSet(f);
      io.stdout(`OK ${f}: ${set.cases.length} ${set.cases.length === 1 ? "case" : "cases"}\n`);
    } catch (err) {
      bad++;
      io.stderr(`${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
  return bad === 0 ? EXIT_OK : EXIT_USAGE;
}

async function cassetteFetchFor(path: string, mode: string | undefined, realFetch: typeof fetch | undefined): Promise<typeof fetch> {
  if (mode !== undefined && mode !== "replay" && mode !== "record" && mode !== "auto") {
    throw new Error(`--cassette-mode must be replay, record or auto (got '${mode}')`);
  }
  let mod: typeof import("@tonyweckstrom/llm-cassette");
  try {
    mod = await import("@tonyweckstrom/llm-cassette");
  } catch {
    throw new Error("--cassette requires the package @tonyweckstrom/llm-cassette: npm install --save-dev @tonyweckstrom/llm-cassette");
  }
  const inner = mod.cassetteFetch({ path, mode: (mode as "replay" | "record" | "auto" | undefined) ?? "replay", fetch: realFetch });
  // evalkit always passes an explicit mode, so LLM_CASSETTE_MODE has no effect here.
  // Replace llm-cassette's miss message, which names that variable, with advice that works.
  return (async (input, init) => {
    try {
      return await inner(input, init);
    } catch (err) {
      if (err instanceof mod.CassetteMissError) {
        throw new Error(`No recorded response for ${err.method} ${err.url} in cassette '${err.path}'. Run once with --cassette-mode record to record it`);
      }
      throw err;
    }
  }) as typeof fetch;
}

/** Ajaa komentorivin ja palauttaa poistumiskoodin. Ei kutsu process.exit-funktiota. */
export async function main(argv: string[], io: CliIo): Promise<number> {
  let args: Args;
  try {
    if (argv[0] === "--version" || argv[0] === "-v") {
      io.stdout(`${VERSIO}\n`);
      return EXIT_OK;
    }
    if (argv.includes("--help") || argv.length === 0) {
      io.stdout(USAGE);
      return argv.length === 0 ? EXIT_USAGE : EXIT_OK;
    }
    args = parseArgs(argv);
  } catch (err) {
    io.stderr(`${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
    return EXIT_USAGE;
  }

  if (args.command === "validate") return validateFiles(args.files, io);

  try {
    const setFile = args.files[0];
    if (!setFile) throw new Error("Missing eval set file");
    const modelsRaw = (args.flags["models"] as string | undefined) ?? io.env.EVALKIT_MODELS;
    const baseUrl = (args.flags["base-url"] as string | undefined) ?? io.env.EVALKIT_BASE_URL;
    if (!modelsRaw) throw new Error("Missing models (--models or EVALKIT_MODELS)");
    if (!baseUrl) throw new Error("Missing base URL (--base-url or EVALKIT_BASE_URL)");
    const models = modelsRaw.split(",").map((s) => s.trim()).filter(Boolean);
    const keyEnv = (args.flags["api-key-env"] as string | undefined) ?? "LLM_API_KEY";
    const maxPassDropRaw = args.flags["max-pass-drop"];
    const maxPassDrop = maxPassDropRaw === undefined ? 0 : Number(maxPassDropRaw);
    if (typeof maxPassDropRaw === "string" && !(maxPassDrop >= 0 && maxPassDrop <= 1)) throw new Error("--max-pass-drop must be a number between 0 and 1");

    const set = loadEvalSet(setFile);
    const baselinePath = args.flags["baseline"] as string | undefined;
    const update = args.flags["update-baseline"] === true;
    if (update && !baselinePath) throw new Error("--update-baseline needs --baseline <file>");
    const baseline = baselinePath && !update ? readBaseline(baselinePath) : null;
    if (baselinePath && !update && !baseline) {
      throw new Error(`Baseline '${baselinePath}' not found. Create it first by adding --update-baseline`);
    }

    const cassettePath = args.flags["cassette"] as string | undefined;
    const cassetteMode = args.flags["cassette-mode"] as string | undefined;
    if (cassetteMode !== undefined && !cassettePath) throw new Error("--cassette-mode needs --cassette <file>");
    const fetchImpl = cassettePath ? await cassetteFetchFor(cassettePath, cassetteMode, io.fetch) : io.fetch;

    const report = await runEval({
      set,
      models,
      baseUrl,
      apiKey: io.env[keyEnv],
      fetch: fetchImpl,
      judgeModel: args.flags["judge-model"] as string | undefined,
      concurrency: intFlag(args.flags, "concurrency"),
      timeoutMs: intFlag(args.flags, "timeout-ms"),
      maxTokens: intFlag(args.flags, "max-tokens"),
    });

    io.stdout(formatReport(report) + "\n");
    const jsonPath = args.flags["json"] as string | undefined;
    if (jsonPath) writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n", "utf8");

    if (update && baselinePath) {
      writeBaseline(baselinePath, toBaseline(report));
      io.stdout(`Baseline updated: ${baselinePath}\n`);
      return EXIT_OK;
    }
    if (baseline) {
      const cmp = compare(report, baseline, maxPassDrop);
      io.stdout(formatComparison(cmp) + "\n");
      return cmp.ok ? EXIT_OK : EXIT_GATE_FAILED;
    }
    // Ei baselinea: kaikkien arvioitavien tapausten pitää läpäistä.
    const anyFailed = report.cases.some((c) => c.passed === false);
    return anyFailed ? EXIT_GATE_FAILED : EXIT_OK;
  } catch (err) {
    io.stderr(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT_USAGE;
  }
}
