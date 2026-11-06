import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Report } from "./run.js";

export interface Baseline {
  version: 1;
  /** Avain `malli::tapausId` -> läpäisikö tapaus hyväksytyssä ajossa. */
  results: Record<string, boolean>;
}

export const keyOf = (model: string, caseId: string): string => `${model}::${caseId}`;

export function toBaseline(report: Report): Baseline {
  const results: Record<string, boolean> = {};
  for (const c of report.cases) {
    if (c.passed !== null) results[keyOf(c.model, c.caseId)] = c.passed;
  }
  return { version: 1, results };
}

export function readBaseline(path: string): Baseline | null {
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`Baseline '${path}' is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  const b = parsed as Partial<Baseline>;
  if (b?.version !== 1 || typeof b.results !== "object" || b.results === null) {
    throw new Error(`Baseline '${path}' has an unsupported format (expected version 1)`);
  }
  return b as Baseline;
}

export function writeBaseline(path: string, baseline: Baseline): void {
  const sorted: Record<string, boolean> = {};
  for (const k of Object.keys(baseline.results).sort()) sorted[k] = baseline.results[k];
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ version: 1, results: sorted }, null, 2) + "\n", "utf8");
}

export interface Comparison {
  /** Aiemmin läpäissyt tapaus ei läpäise nyt. */
  regressions: Array<{ key: string; reason: string }>;
  /** Aiemmin kaatunut tapaus läpäisee nyt. */
  fixed: string[];
  /** Tapaus ei ole baselinessa (ei gatea ajoa). */
  newCases: string[];
  /** Baselinessa mutta ei tässä ajossa (tapaus poistettu tai mallia ei ajettu). */
  missing: string[];
  /** Malli -> läpäisyprosentin lasku yhteisillä tapauksilla (0..1, positiivinen = huonontunut). */
  passRateDrop: Record<string, number>;
  ok: boolean;
}

/**
 * maxPassDrop = 0 (oletus): yksikin regressio kaataa portin.
 * maxPassDrop > 0: yksittäiset regressiot sallitaan (esim. epävakaa malli),
 * kunhan minkään mallin läpäisyprosentti ei laske yli rajan.
 */
export function compare(report: Report, baseline: Baseline, maxPassDrop = 0): Comparison {
  const regressions: Comparison["regressions"] = [];
  const fixed: string[] = [];
  const newCases: string[] = [];
  const seen = new Set<string>();
  const common: Record<string, { base: number; cur: number; n: number }> = {};

  for (const c of report.cases) {
    if (c.passed === null) continue;
    const key = keyOf(c.model, c.caseId);
    seen.add(key);
    const base = baseline.results[key];
    if (base === undefined) {
      newCases.push(key);
      continue;
    }
    const agg = (common[c.model] ??= { base: 0, cur: 0, n: 0 });
    agg.n++;
    agg.base += base ? 1 : 0;
    agg.cur += c.passed ? 1 : 0;
    if (base && !c.passed) regressions.push({ key, reason: c.failures[0] ?? "failed" });
    if (!base && c.passed) fixed.push(key);
  }

  const missing = Object.keys(baseline.results).filter((k) => !seen.has(k));
  const passRateDrop: Record<string, number> = {};
  for (const [model, a] of Object.entries(common)) passRateDrop[model] = (a.base - a.cur) / a.n;

  const gated = maxPassDrop > 0 ? Object.values(passRateDrop).some((d) => d > maxPassDrop) : regressions.length > 0;
  return { regressions, fixed, newCases, missing, passRateDrop, ok: !gated };
}
