import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEvalSet, loadEvalSet, groupOf } from "../src/schema.js";

describe("evalset-skeema", () => {
  it("hyväksyy version 1 -muodon", () => {
    const s = parseEvalSet({ version: 1, name: "x", cases: [{ id: "a-01", prompt: "p", tags: ["t"], expect: { contains: "k", notContains: ["z"], regex: "^k", minJudgeScore: 4 } }] });
    expect(s.cases[0].expect?.minJudgeScore).toBe(4);
  });

  it("muuntaa vanhan taulukkomuodon (expectedContains, category)", () => {
    const s = parseEvalSet([
      { id: "yleinen-01", category: "yleinen tieto", prompt: "p", expectedContains: "Helsinki" },
      { id: "kirj-01", prompt: "q", systemPrompt: "s" },
    ]);
    expect(s.version).toBe(1);
    expect(s.cases[0]).toEqual({ id: "yleinen-01", prompt: "p", tags: ["yleinen tieto"], expect: { contains: "Helsinki" } });
    expect(s.cases[1]).toEqual({ id: "kirj-01", prompt: "q", systemPrompt: "s" });
  });

  it("hylkää tyhjän evalsetin", () => {
    expect(() => parseEvalSet({ version: 1, cases: [] })).toThrow(/at least one case/);
    expect(() => parseEvalSet([])).toThrow(/at least one case/);
  });

  it("hylkää kaksoisid:n", () => {
    expect(() => parseEvalSet({ version: 1, cases: [{ id: "a", prompt: "p" }, { id: "a", prompt: "q" }] })).toThrow(/'a' appears more than once/);
  });

  it("hylkää virheellisen regexin ja tuntemattoman expect-kentän", () => {
    expect(() => parseEvalSet({ version: 1, cases: [{ id: "a", prompt: "p", expect: { regex: "(" } }] })).toThrow(/invalid regular expression/);
    expect(() => parseEvalSet({ version: 1, cases: [{ id: "a", prompt: "p", expect: { sisaltaa: "x" } }] })).toThrow();
  });

  it("hylkää minJudgeScore-arvon asteikon ulkopuolelta", () => {
    expect(() => parseEvalSet({ version: 1, cases: [{ id: "a", prompt: "p", expect: { minJudgeScore: 6 } }] })).toThrow();
    expect(() => parseEvalSet({ version: 1, cases: [{ id: "a", prompt: "p", expect: { minJudgeScore: 0 } }] })).toThrow();
  });

  it("hylkää tuntemattoman version", () => {
    expect(() => parseEvalSet({ version: 2, cases: [{ id: "a", prompt: "p" }] })).toThrow();
  });

  it("loadEvalSet antaa selkeän virheen puuttuvasta tiedostosta ja rikkinäisestä JSON:ista", () => {
    const dir = mkdtempSync(join(tmpdir(), "evalkit-"));
    try {
      expect(() => loadEvalSet(join(dir, "ei-ole.json"))).toThrow(/cannot be read/);
      writeFileSync(join(dir, "rikki.json"), "{ ei json");
      expect(() => loadEvalSet(join(dir, "rikki.json"))).toThrow(/cannot be read|is not valid JSON/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loadEvalSet lukee kelvollisen version 1 -tiedoston ja vanhan taulukkomuodon levyltä", () => {
    const dir = mkdtempSync(join(tmpdir(), "evalkit-ok-"));
    try {
      writeFileSync(join(dir, "v1.json"), JSON.stringify({ version: 1, name: "n", cases: [{ id: "a", prompt: "p" }] }));
      writeFileSync(join(dir, "vanha.json"), JSON.stringify([{ id: "b", prompt: "q", expectedContains: "k" }]));
      expect(loadEvalSet(join(dir, "v1.json")).name).toBe("n");
      expect(loadEvalSet(join(dir, "vanha.json")).cases[0].expect).toEqual({ contains: "k" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("virheilmoitus nimeää lähteen ja virheellisen kentän polun", () => {
    expect(() => parseEvalSet({ version: 1, cases: [{ id: "", prompt: "p" }] }, "oma.json")).toThrow(/oma\.json.*cases\.0\.id/s);
    expect(() => parseEvalSet({ version: 1, cases: [{ id: "a" }] }, "oma.json")).toThrow(/cases\.0\.prompt/);
  });

  it("hylkää tyhjät ehtomerkkijonot ja tyhjän notContains-alkion", () => {
    expect(() => parseEvalSet({ version: 1, cases: [{ id: "a", prompt: "p", expect: { contains: "" } }] })).toThrow();
    expect(() => parseEvalSet({ version: 1, cases: [{ id: "a", prompt: "p", expect: { notContains: [""] } }] })).toThrow();
    expect(() => parseEvalSet({ version: 1, cases: [{ id: "a", prompt: "p", expect: { regex: "" } }] })).toThrow();
  });

  it("hylkää kaksoisid:n myös vanhassa taulukkomuodossa ja virheellisen regexin nimeää tapauksen", () => {
    expect(() => parseEvalSet([{ id: "a", prompt: "p" }, { id: "a", prompt: "q" }])).toThrow(/appears more than once/);
    expect(() => parseEvalSet({ version: 1, cases: [{ id: "tapaus-x", prompt: "p", expect: { regex: "[" } }] })).toThrow(/cases\.tapaus-x\.expect\.regex/);
  });

  it("raportoi kaikki ristiriidat kerralla", () => {
    let msg = "";
    try {
      parseEvalSet({ version: 1, cases: [{ id: "a", prompt: "p", expect: { regex: "(" } }, { id: "a", prompt: "q" }] });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/appears more than once/);
    expect(msg).toMatch(/invalid regular expression/);
  });

  it("minJudgeScore: rajat 1 ja 5 sekä desimaali hyväksytään", () => {
    for (const v of [1, 2.5, 5]) expect(parseEvalSet({ version: 1, cases: [{ id: "a", prompt: "p", expect: { minJudgeScore: v } }] }).cases[0].expect?.minJudgeScore).toBe(v);
  });

  it("vanha muoto: tyhjä expectedContains tai category hylätään", () => {
    expect(() => parseEvalSet([{ id: "a", prompt: "p", expectedContains: "" }])).toThrow();
    expect(() => parseEvalSet([{ id: "a", prompt: "p", category: "" }])).toThrow();
  });

  it("groupOf: tagi ensin, muuten id:n etuliite", () => {
    expect(groupOf({ id: "yleinen-01", prompt: "p", tags: ["tieto"] })).toBe("tieto");
    expect(groupOf({ id: "yleinen-01", prompt: "p" })).toBe("yleinen");
    expect(groupOf({ id: "ilman-numeroa", prompt: "p" })).toBe("ilman-numeroa");
  });
});
