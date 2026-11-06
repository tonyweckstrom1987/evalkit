import type { Expect } from "./schema.js";

export interface CheckResult {
  /** null = tapauksella ei ole odotuksia (ei arvioitu). */
  passed: boolean | null;
  failures: string[];
}

/** Arvioi vastauksen ehtoja vasten. Kaikkien annettujen ehtojen pitää täyttyä. */
export function evaluate(expect: Expect | undefined, text: string, judgeScore: number | null): CheckResult {
  if (!expect || Object.keys(expect).length === 0) return { passed: null, failures: [] };
  const failures: string[] = [];
  const lower = text.toLowerCase();

  if (expect.contains !== undefined && !lower.includes(expect.contains.toLowerCase())) {
    failures.push(`contains: response does not contain '${expect.contains}'`);
  }
  for (const s of expect.notContains ?? []) {
    if (lower.includes(s.toLowerCase())) failures.push(`notContains: response contains forbidden '${s}'`);
  }
  if (expect.regex !== undefined && !new RegExp(expect.regex).test(text)) {
    failures.push(`regex: response does not match /${expect.regex}/`);
  }
  if (expect.minJudgeScore !== undefined) {
    if (judgeScore === null) failures.push("minJudgeScore: no judge score received");
    else if (judgeScore < expect.minJudgeScore) failures.push(`minJudgeScore: ${judgeScore} < ${expect.minJudgeScore}`);
  }
  return { passed: failures.length === 0, failures };
}
