import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/cli.js";
import { fakeLlm } from "./helpers.js";

describe("cli: lisatestit", () => {
  let dir: string;
  let setPath: string;
  let out: string;
  let err: string;

  const io = (llm?: ReturnType<typeof fakeLlm>, env: Record<string, string> = {}) => ({
    env,
    stdout: (s: string) => void (out += s),
    stderr: (s: string) => void (err += s),
    fetch: llm?.fetch,
  });
  const common = () => ["run", setPath, "--models", "m", "--base-url", "http://llm.local/v1"];
  const writeJson = (name: string, data: unknown) => {
    const p = join(dir, name);
    writeFileSync(p, JSON.stringify(data));
    return p;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "evalkit-cli2-"));
    setPath = writeJson("set.json", {
      version: 1,
      name: "Demo",
      cases: [
        { id: "a-01", prompt: "p", expect: { contains: "Helsinki" } },
        { id: "a-02", prompt: "q", expect: { contains: "Oslo" } },
      ],
    });
    out = "";
    err = "";
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  describe("argumenttien jasennys", () => {
    it("valinta ilman arvoa tai arvona toinen valinta -> 2 ja virheilmoitus nimeaa valinnan", async () => {
      expect(await main(["run", setPath, "--models"], io())).toBe(2);
      expect(err).toMatch(/Option --models needs a value/);
      err = "";
      expect(await main(["run", setPath, "--models", "--base-url", "http://x"], io())).toBe(2);
      expect(err).toMatch(/Option --models needs a value/);
    });

    it("tuntematon komento ja puuttuva komento nimetaan virheessa", async () => {
      expect(await main(["foo"], io())).toBe(2);
      expect(err).toMatch(/Unknown command 'foo'/);
      err = "";
      expect(await main(["--models", "m"], io())).toBe(2);
      expect(err).toMatch(/Missing command/);
    });

    it("ilman argumentteja ohje tulostetaan stdoutiin ja koodi on 2; --help muiden argumenttien kanssa -> 0 ilman ajoa", async () => {
      expect(await main([], io())).toBe(2);
      expect(out).toMatch(/Usage/);
      expect(err).toBe("");
      out = "";
      const llm = fakeLlm(() => "Helsinki");
      expect(await main(["run", "--help"], io(llm))).toBe(0);
      expect(out).toMatch(/Usage/);
      expect(llm.calls).toHaveLength(0);
    });

    it("kokonaislukuvalinnat hylkaavat ei-numeron, desimaalin, nollan ja negatiivisen eika mallikutsuja tehda", async () => {
      for (const [flag, value] of [
        ["--timeout-ms", "abc"],
        ["--timeout-ms", "0"],
        ["--max-tokens", "1.5"],
        ["--concurrency", "-1"],
      ]) {
        const llm = fakeLlm(() => "Helsinki Oslo");
        err = "";
        expect(await main([...common(), flag, value], io(llm))).toBe(2);
        expect(err).toMatch(new RegExp(`${flag} must be a positive integer`));
        expect(llm.calls).toHaveLength(0);
      }
    });

    it("--max-pass-drop hylkaa ei-numeron, negatiivisen ja yli yhden", async () => {
      for (const v of ["abc", "-0.1", "1.0001"]) {
        err = "";
        expect(await main([...common(), "--max-pass-drop", v], io(fakeLlm(() => "Helsinki")))).toBe(2);
        expect(err).toMatch(/--max-pass-drop must be a number between 0 and 1/);
      }
    });

    it("mallilista, jossa on vain tyhjia alkioita -> 2", async () => {
      expect(await main(["run", setPath, "--models", " , ", "--base-url", "http://llm.local/v1"], io(fakeLlm(() => "x")))).toBe(2);
      expect(err).toMatch(/At least one model is required/);
    });
  });

  describe("kutsuun valitettavat arvot", () => {
    it("--max-tokens valitetaan mallikutsuun", async () => {
      const llm = fakeLlm(() => "Helsinki Oslo");
      expect(await main([...common(), "--max-tokens", "7"], io(llm))).toBe(0);
      expect(llm.calls[0].max_tokens).toBe(7);
    });

    it("liian suuri --max-tokens ei ole kayttovirhe vaan kaataa tapaukset (1) ilman verkkokutsuja", async () => {
      const llm = fakeLlm(() => "Helsinki Oslo");
      expect(await main([...common(), "--max-tokens", "5000"], io(llm))).toBe(1);
      expect(llm.calls).toHaveLength(0);
      expect(out).toMatch(/errors 2/);
      expect(out).toMatch(/maxTokens/);
    });

    it("oletuksena avainta ei lahteta; LLM_API_KEY luetaan ymparistosta", async () => {
      const ilman = fakeLlm(() => "Helsinki Oslo");
      await main(common(), io(ilman, {}));
      expect(ilman.calls[0].authorization).toBeNull();
      const kanssa = fakeLlm(() => "Helsinki Oslo");
      await main(common(), io(kanssa, { LLM_API_KEY: "k" }));
      expect(kanssa.calls[0].authorization).toBe("Bearer k");
    });

    it("--judge-model valitetaan: ilman sita minJudgeScore -> 2, sen kanssa tuomarikutsu tehdaan", async () => {
      const judgeSet = writeJson("judge.json", { version: 1, cases: [{ id: "j-01", prompt: "p", expect: { minJudgeScore: 4 } }] });
      const args = ["run", judgeSet, "--models", "m", "--base-url", "http://llm.local/v1"];
      expect(await main(args, io(fakeLlm(() => "vastaus")))).toBe(2);
      expect(err).toMatch(/no judge model was given/);

      const llm = fakeLlm((c) => (c.model === "j" ? "5" : "vastaus"));
      expect(await main([...args, "--judge-model", "j"], io(llm))).toBe(0);
      expect(llm.calls.map((c) => c.model)).toEqual(["m", "j"]);
    });
  });

  describe("raporttien teksti", () => {
    it("tulostaa nimen, mallin läpäisyn ja epäonnistuneen tapauksen syyn", async () => {
      expect(await main(common(), io(fakeLlm(() => "Helsinki")))).toBe(1);
      expect(out).toContain("Evalkit: Demo");
      expect(out).toContain("m: passed 1/2 (50 %), errors 0");
      expect(out).toContain("Failed cases:");
      expect(out).toContain("- m / a-02: contains: response does not contain 'Oslo'");
    });

    it("tapaukset ilman odotuksia: tuloste 'nothing to evaluate' ja koodi 0", async () => {
      const p = writeJson("ei-odotuksia.json", { version: 1, cases: [{ id: "x", prompt: "p" }] });
      expect(await main(["run", p, "--models", "m", "--base-url", "http://llm.local/v1"], io(fakeLlm(() => "mita vain")))).toBe(0);
      expect(out).toContain("Evalkit\n");
      expect(out).toContain("m: nothing to evaluate, errors 0");
      expect(out).not.toContain("passed nothing");
      expect(out).not.toContain("Failed cases");
    });

    it("--json kirjoitetaan myos kun portti kaatuu ja tiedosto paattyy rivinvaihtoon", async () => {
      const jp = join(dir, "r.json");
      expect(await main([...common(), "--json", jp], io(fakeLlm(() => "Helsinki")))).toBe(1);
      expect(existsSync(jp)).toBe(true);
      const text = readFileSync(jp, "utf8");
      expect(text.endsWith("\n")).toBe(true);
      const report = JSON.parse(text);
      expect(report.name).toBe("Demo");
      expect(report.perModel[0].passRate).toBe(0.5);
    });
  });

  describe("baseline-vertailun teksti ja portti", () => {
    it("regressio: yhteenveto, REGRESSION-rivi ja läpäisyprosentin lasku", async () => {
      const bp = writeJson("base.json", { version: 1, results: { "m::a-01": true, "m::a-02": true } });
      expect(await main([...common(), "--baseline", bp], io(fakeLlm(() => "Helsinki")))).toBe(1);
      expect(out).toContain("Comparison to baseline:");
      expect(out).toContain("regressions: 1, fixed: 0, new: 0, missing: 0");
      expect(out).toContain("REGRESSION m::a-02: contains: response does not contain 'Oslo'");
      expect(out).toContain("m: pass rate dropped by 50 percentage points");
    });

    it("parantuminen: korjaantuneet, tuloste 'pass rate rose' ja koodi 0", async () => {
      const bp = writeJson("base.json", { version: 1, results: { "m::a-01": false, "m::a-02": false } });
      expect(await main([...common(), "--baseline", bp], io(fakeLlm(() => "Helsinki Oslo")))).toBe(0);
      expect(out).toContain("fixed: 2");
      expect(out).toContain("m: pass rate rose by 100 percentage points");
    });

    it("uudet ja puuttuvat tapaukset raportoidaan, eika muuttumaton prosentti tulosta riviä", async () => {
      const bp = writeJson("base.json", { version: 1, results: { "m::a-01": true, "m::vanha": true } });
      expect(await main([...common(), "--baseline", bp], io(fakeLlm(() => "Helsinki Oslo")))).toBe(0);
      expect(out).toContain("regressions: 0, fixed: 0, new: 1, missing: 1");
      expect(out).not.toContain("pass rate");
    });

    it("--max-pass-drop rajat: 0 kaatuu regressiosta, 1 sallii minka tahansa laskun", async () => {
      const bp = writeJson("base.json", { version: 1, results: { "m::a-01": true, "m::a-02": true } });
      expect(await main([...common(), "--baseline", bp, "--max-pass-drop", "0"], io(fakeLlm(() => "Helsinki")))).toBe(1);
      expect(await main([...common(), "--baseline", bp, "--max-pass-drop", "1"], io(fakeLlm(() => "Helsinki")))).toBe(0);
    });

    it("--update-baseline korvaa vanhan baselinen (vanhat avaimet poistuvat), ei vertaa ja ilmoittaa polun", async () => {
      const bp = writeJson("base.json", { version: 1, results: { "m::a-01": true, "m::a-02": true, "m::vanha": true } });
      expect(await main([...common(), "--baseline", bp, "--update-baseline"], io(fakeLlm(() => "Helsinki")))).toBe(0);
      expect(JSON.parse(readFileSync(bp, "utf8")).results).toEqual({ "m::a-01": true, "m::a-02": false });
      expect(out).toMatch(/Baseline updated: .*base\.json/);
      expect(out).not.toContain("Comparison to baseline");
    });

    it("rikkinainen baseline-tiedosto -> 2 eika mallikutsuja", async () => {
      const bp = join(dir, "rikki.json");
      writeFileSync(bp, "{ ei json");
      const llm = fakeLlm(() => "Helsinki");
      expect(await main([...common(), "--baseline", bp], io(llm))).toBe(2);
      expect(err).toMatch(/is not valid JSON/);
      expect(llm.calls).toHaveLength(0);
    });
  });
});
