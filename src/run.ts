import { chat, type ChatMessage } from "./client.js";
import { evaluate } from "./checks.js";
import { groupOf, type EvalCase, type EvalSet } from "./schema.js";

/** Kova katto: yksi ajo ei saa tehdä rajattomasti mallikutsuja. */
export const MAX_CALLS_PER_RUN = 200;

export interface RunOptions {
  set: EvalSet;
  models: string[];
  baseUrl: string;
  apiKey?: string;
  fetch?: typeof fetch;
  concurrency?: number;
  timeoutMs?: number;
  maxTokens?: number;
  /** Pakollinen, jos jokin tapaus käyttää minJudgeScore-ehtoa. Valitse eri malli kuin arvioitavat. */
  judgeModel?: string;
  maxCalls?: number;
}

export interface CaseResult {
  caseId: string;
  group: string;
  model: string;
  /** null = tapauksella ei odotuksia. Virhe tapauksella, jolla on odotukset, = false. */
  passed: boolean | null;
  failures: string[];
  latencyMs: number;
  response: string;
  judgeScore: number | null;
  error: string | null;
}

export interface ModelSummary {
  model: string;
  total: number;
  /** Tapaukset, joilla on odotukset. */
  evaluated: number;
  passed: number;
  errors: number;
  /** passed / evaluated; virheet lasketaan läpäisemättömiksi. null jos ei arvioitavia. */
  passRate: number | null;
}

export interface Report {
  name?: string;
  models: string[];
  judgeModel?: string;
  cases: CaseResult[];
  perModel: ModelSummary[];
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function loop(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]);
    }
  }
  const n = Math.min(Math.max(1, concurrency), items.length) || 1;
  await Promise.all(Array.from({ length: n }, loop));
  return results;
}

async function judge(opts: RunOptions, c: EvalCase, response: string): Promise<number | null> {
  if (!opts.judgeModel) return null;
  const user = [
    `Tehtävänanto:\n${c.prompt}`,
    c.expect?.contains ? `Odotettu sisältö: ${c.expect.contains}` : null,
    `Mallin vastaus:\n${response}`,
    "Anna laatuarvio asteikolla 1-5 (pelkkä numero, ei muuta tekstiä).",
  ]
    .filter(Boolean)
    .join("\n\n");
  try {
    const r = await chat({
      baseUrl: opts.baseUrl,
      apiKey: opts.apiKey,
      model: opts.judgeModel,
      timeoutMs: opts.timeoutMs,
      fetch: opts.fetch,
      maxTokens: 16,
      messages: [
        { role: "system", content: "Olet tiukka arvioija. Arvioi vastauksen laatu asteikolla 1-5 ja vastaa PELKÄLLÄ numerolla." },
        { role: "user", content: user },
      ],
    });
    const m = r.text.match(/[1-5](\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  } catch {
    return null;
  }
}

function summarize(models: string[], cases: CaseResult[]): ModelSummary[] {
  return models.map((model) => {
    const rows = cases.filter((r) => r.model === model);
    const evaluated = rows.filter((r) => r.passed !== null);
    const passed = evaluated.filter((r) => r.passed === true).length;
    return {
      model,
      total: rows.length,
      evaluated: evaluated.length,
      passed,
      errors: rows.filter((r) => r.error !== null).length,
      passRate: evaluated.length ? passed / evaluated.length : null,
    };
  });
}

export async function runEval(opts: RunOptions): Promise<Report> {
  const { set, models } = opts;
  if (models.length === 0) throw new Error("At least one model is required");

  const needsJudge = set.cases.some((c) => c.expect?.minJudgeScore !== undefined);
  if (needsJudge && !opts.judgeModel) {
    throw new Error("The eval set uses minJudgeScore, but no judge model was given (--judge-model)");
  }
  const judgeCases = set.cases.filter((c) => c.expect?.minJudgeScore !== undefined).length;
  const planned = models.length * set.cases.length + (opts.judgeModel ? models.length * judgeCases : 0);
  const cap = opts.maxCalls ?? MAX_CALLS_PER_RUN;
  if (planned > cap) {
    throw new Error(`The run would make ${planned} model calls; at most ${cap} are allowed. The run was not started`);
  }

  const jobs = models.flatMap((model) => set.cases.map((c) => ({ model, c })));
  const cases = await mapWithConcurrency(jobs, opts.concurrency ?? 4, async ({ model, c }): Promise<CaseResult> => {
    const messages: ChatMessage[] = [];
    if (c.systemPrompt) messages.push({ role: "system", content: c.systemPrompt });
    messages.push({ role: "user", content: c.prompt });
    const start = Date.now();
    try {
      const r = await chat({
        baseUrl: opts.baseUrl,
        apiKey: opts.apiKey,
        model,
        messages,
        timeoutMs: opts.timeoutMs,
        maxTokens: opts.maxTokens,
        fetch: opts.fetch,
      });
      const latencyMs = Date.now() - start;
      const judgeScore = c.expect?.minJudgeScore !== undefined ? await judge(opts, c, r.text) : null;
      const check = evaluate(c.expect, r.text, judgeScore);
      return { caseId: c.id, group: groupOf(c), model, passed: check.passed, failures: check.failures, latencyMs, response: r.text, judgeScore, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const hasExpect = c.expect !== undefined && Object.keys(c.expect).length > 0;
      return {
        caseId: c.id,
        group: groupOf(c),
        model,
        passed: hasExpect ? false : null,
        failures: hasExpect ? [`error: ${message}`] : [],
        latencyMs: Date.now() - start,
        response: "",
        judgeScore: null,
        error: message,
      };
    }
  });

  return { name: set.name, models, judgeModel: opts.judgeModel, cases, perModel: summarize(models, cases) };
}
