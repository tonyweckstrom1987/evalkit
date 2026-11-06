import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compare, toBaseline, readBaseline, writeBaseline } from "../src/baseline.js";
import type { Report, CaseResult } from "../src/run.js";

function row(model: string, caseId: string, passed: boolean | null): CaseResult {
  return { caseId, group: "g", model, passed, failures: passed === false ? [`contains: puuttuu ${caseId}`] : [], latencyMs: 1, response: "", judgeScore: null, error: null };
}
function report(rows: CaseResult[]): Report {
  return { models: [...new Set(rows.map((r) => r.model))], cases: rows, perModel: [] };
}

describe("baseline", () => {
  it("toBaseline tallentaa vain arvioidut tapaukset", () => {
    const b = toBaseline(report([row("m", "a", true), row("m", "b", false), row("m", "c", null)]));
    expect(b.results).toEqual({ "m::a": true, "m::b": false });
  });

  it("tunnistaa regressiot, korjaantuneet, uudet ja puuttuvat", () => {
    const base = { version: 1 as const, results: { "m::a": true, "m::b": false, "m::vanha": true } };
    const c = compare(report([row("m", "a", false), row("m", "b", true), row("m", "uusi", false)]), base);
    expect(c.regressions.map((r) => r.key)).toEqual(["m::a"]);
    expect(c.regressions[0].reason).toMatch(/puuttuu a/);
    expect(c.fixed).toEqual(["m::b"]);
    expect(c.newCases).toEqual(["m::uusi"]);
    expect(c.missing).toEqual(["m::vanha"]);
    expect(c.ok).toBe(false);
  });

  it("ei regressioita -> ok, myös kun aiemmin kaatunut kaatuu edelleen", () => {
    const base = { version: 1 as const, results: { "m::a": true, "m::b": false } };
    expect(compare(report([row("m", "a", true), row("m", "b", false)]), base).ok).toBe(true);
  });

  it("uusi kaatuva tapaus ei kaada porttia (ei ole regressio)", () => {
    const base = { version: 1 as const, results: { "m::a": true } };
    expect(compare(report([row("m", "a", true), row("m", "uusi", false)]), base).ok).toBe(true);
  });

  it("maxPassDrop: yksittäinen regressio sallitaan, jos lasku on rajan sisällä; rajan ylitys kaataa", () => {
    const keys = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`m::c${i}`, true]));
    const base = { version: 1 as const, results: keys };
    const oneFails = report(Array.from({ length: 10 }, (_, i) => row("m", `c${i}`, i !== 0)));
    expect(compare(oneFails, base, 0).ok).toBe(false); // oletus: yksikin regressio kaataa
    expect(compare(oneFails, base, 0.1).ok).toBe(true); // lasku 10 % = raja, sallitaan
    expect(compare(oneFails, base, 0.05).ok).toBe(false); // lasku 10 % > 5 %
    const threeFail = report(Array.from({ length: 10 }, (_, i) => row("m", `c${i}`, i > 2)));
    expect(compare(threeFail, base, 0.1).ok).toBe(false);
  });

  it("passRateDrop lasketaan malleittain", () => {
    const base = { version: 1 as const, results: { "a::x": true, "b::x": true } };
    const c = compare(report([row("a", "x", true), row("b", "x", false)]), base);
    expect(c.passRateDrop).toEqual({ a: 0, b: 1 });
  });

  it("keyOf muodostaa avaimen malli::tapaus", async () => {
    const { keyOf } = await import("../src/baseline.js");
    expect(keyOf("gpt", "a-01")).toBe("gpt::a-01");
  });

  it("tapaukset ilman odotuksia (passed null) ohitetaan vertailussa, eivätkä ne ole uusia tai puuttuvia", () => {
    const base = { version: 1 as const, results: { "m::a": true } };
    const c = compare(report([row("m", "a", true), row("m", "ei-odotuksia", null)]), base);
    expect(c.newCases).toEqual([]);
    expect(c.missing).toEqual([]);
    expect(c.ok).toBe(true);
  });

  it("malli, jota ei ajettu, näkyy puuttuvana eikä kaada porttia", () => {
    const base = { version: 1 as const, results: { "a::x": true, "b::x": true } };
    const c = compare(report([row("a", "x", true)]), base);
    expect(c.missing).toEqual(["b::x"]);
    expect(c.passRateDrop).toEqual({ a: 0 });
    expect(c.ok).toBe(true);
  });

  it("ilman yhteisiä tapauksia passRateDrop on tyhjä ja portti läpäisee myös maxPassDropilla", () => {
    const base = { version: 1 as const, results: { "m::vanha": true } };
    const c = compare(report([row("m", "uusi", false)]), base, 0.1);
    expect(c.passRateDrop).toEqual({});
    expect(c.ok).toBe(true);
  });

  it("maxPassDrop > 0: parantuminen ei kasvata laskua (negatiivinen drop) ja regressio sallitaan, jos toinen tapaus korjaantui", () => {
    const base = { version: 1 as const, results: { "m::a": true, "m::b": false } };
    const c = compare(report([row("m", "a", false), row("m", "b", true)]), base, 0.01);
    expect(c.regressions.map((r) => r.key)).toEqual(["m::a"]);
    expect(c.passRateDrop.m).toBe(0);
    expect(c.ok).toBe(true);
    expect(compare(report([row("m", "a", false), row("m", "b", true)]), base).ok).toBe(false);
  });

  it("regression syy on ensimmäinen virheilmoitus, tai 'failed' jos sitä ei ole", () => {
    const base = { version: 1 as const, results: { "m::a": true } };
    const bare: CaseResult = { ...row("m", "a", false), failures: [] };
    expect(compare(report([bare]), base).regressions[0].reason).toBe("failed");
  });

  it("writeBaseline kirjoittaa version 1, rivinvaihdon loppuun ja luo puuttuvat hakemistot", () => {
    const dir = mkdtempSync(join(tmpdir(), "evalkit-w-"));
    try {
      const p = join(dir, "a", "b", "base.json");
      writeBaseline(p, { version: 1, results: { "m::a": true } });
      const text = readFileSync(p, "utf8");
      expect(text.endsWith("\n")).toBe(true);
      expect(JSON.parse(text)).toEqual({ version: 1, results: { "m::a": true } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("readBaseline hylkää rakenteen, jossa results puuttuu tai on null", () => {
    const dir = mkdtempSync(join(tmpdir(), "evalkit-r-"));
    try {
      writeFileSync(join(dir, "a.json"), JSON.stringify({ version: 1 }));
      writeFileSync(join(dir, "b.json"), JSON.stringify({ version: 1, results: null }));
      writeFileSync(join(dir, "c.json"), "null");
      for (const f of ["a.json", "b.json", "c.json"]) expect(() => readBaseline(join(dir, f))).toThrow(/unsupported format/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("kirjoitus ja luku: avaimet järjestetään, puuttuva tiedosto antaa null, vieras muoto virheen", () => {
    const dir = mkdtempSync(join(tmpdir(), "evalkit-b-"));
    try {
      const p = join(dir, "sub", "b.json");
      expect(readBaseline(p)).toBeNull();
      writeBaseline(p, { version: 1, results: { "z::1": true, "a::1": false } });
      expect(Object.keys(JSON.parse(readFileSync(p, "utf8")).results)).toEqual(["a::1", "z::1"]);
      expect(readBaseline(p)?.results["a::1"]).toBe(false);
      writeFileSync(join(dir, "x.json"), JSON.stringify({ version: 9 }));
      expect(() => readBaseline(join(dir, "x.json"))).toThrow(/unsupported format/);
      writeFileSync(join(dir, "y.json"), "{ ei json");
      expect(() => readBaseline(join(dir, "y.json"))).toThrow(/is not valid JSON/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
