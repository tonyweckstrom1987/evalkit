import { readFileSync } from "node:fs";
import { z } from "zod";

const ExpectSchema = z
  .object({
    contains: z.string().min(1).optional(),
    notContains: z.array(z.string().min(1)).optional(),
    regex: z.string().min(1).optional(),
    minJudgeScore: z.number().min(1).max(5).optional(),
  })
  .strict();

const CaseSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  systemPrompt: z.string().optional(),
  tags: z.array(z.string().min(1)).optional(),
  expect: ExpectSchema.optional(),
});

const SetV1Schema = z.object({
  version: z.literal(1),
  name: z.string().optional(),
  cases: z.array(CaseSchema).min(1, "an eval set must contain at least one case"),
});

// Vanha muoto (mcp-model-router): pelkkä taulukko, jossa expectedContains ja valinnainen category.
const LegacyCaseSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  systemPrompt: z.string().optional(),
  expectedContains: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
});
const LegacySchema = z.array(LegacyCaseSchema).min(1, "an eval set must contain at least one case");

export type Expect = z.infer<typeof ExpectSchema>;
export type EvalCase = z.infer<typeof CaseSchema>;
export interface EvalSet {
  version: 1;
  name?: string;
  cases: EvalCase[];
}

function fail(source: string, issues: string[]): never {
  throw new Error(`Eval set '${source}' is invalid:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
}

function formatIssues(err: z.ZodError): string[] {
  return err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
}

/** Jäsentää evalsetin (versio 1 tai vanha taulukkomuoto) ja tarkistaa ristiriidat. */
export function parseEvalSet(raw: unknown, source = "evalset"): EvalSet {
  let set: EvalSet;
  if (Array.isArray(raw)) {
    const r = LegacySchema.safeParse(raw);
    if (!r.success) fail(source, formatIssues(r.error));
    set = {
      version: 1,
      cases: r.data.map((c) => ({
        id: c.id,
        prompt: c.prompt,
        ...(c.systemPrompt !== undefined ? { systemPrompt: c.systemPrompt } : {}),
        ...(c.category !== undefined ? { tags: [c.category] } : {}),
        ...(c.expectedContains !== undefined ? { expect: { contains: c.expectedContains } } : {}),
      })),
    };
  } else {
    const r = SetV1Schema.safeParse(raw);
    if (!r.success) fail(source, formatIssues(r.error));
    set = r.data;
  }

  const problems: string[] = [];
  const seen = new Set<string>();
  for (const c of set.cases) {
    if (seen.has(c.id)) problems.push(`cases: id '${c.id}' appears more than once`);
    seen.add(c.id);
    if (c.expect?.regex !== undefined) {
      try {
        new RegExp(c.expect.regex);
      } catch (e) {
        problems.push(`cases.${c.id}.expect.regex: invalid regular expression (${e instanceof Error ? e.message : String(e)})`);
      }
    }
  }
  if (problems.length) fail(source, problems);
  return set;
}

export function loadEvalSet(path: string): EvalSet {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`Eval set '${path}' cannot be read or is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  return parseEvalSet(raw, path);
}

/** Tehtävätyyppi/ryhmä raportointiin: ensimmäinen tagi, muuten id:n etuliite ('yleinen-01' -> 'yleinen'). */
export function groupOf(c: EvalCase): string {
  return c.tags?.[0] ?? c.id.replace(/-\d+$/, "");
}
