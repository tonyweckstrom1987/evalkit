import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/cli.js";
import { fakeLlm } from "./helpers.js";

describe("cli", () => {
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

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "evalkit-cli-"));
    setPath = join(dir, "set.json");
    writeFileSync(setPath, JSON.stringify({ version: 1, cases: [{ id: "a-01", prompt: "p", expect: { contains: "Helsinki" } }, { id: "a-02", prompt: "q", expect: { contains: "Oslo" } }] }));
    out = "";
    err = "";
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("ilman baselinea: kaikki läpi -> 0, yksikin kaatuu -> 1", async () => {
    expect(await main(common(), io(fakeLlm((c) => (c.messages[0].content === "p" ? "Helsinki" : "Oslo"))))).toBe(0);
    expect(await main(common(), io(fakeLlm(() => "Helsinki")))).toBe(1);
    expect(out).toMatch(/Failed cases/);
  });

  it("--update-baseline kirjoittaa baselinen ja palauttaa 0 vaikka tapauksia kaatuisi", async () => {
    const bp = join(dir, "base.json");
    expect(await main([...common(), "--baseline", bp, "--update-baseline"], io(fakeLlm(() => "Helsinki")))).toBe(0);
    expect(JSON.parse(readFileSync(bp, "utf8")).results).toEqual({ "m::a-01": true, "m::a-02": false });
  });

  it("baselinea vasten: regressio -> 1, ei regressiota -> 0", async () => {
    const bp = join(dir, "base.json");
    writeFileSync(bp, JSON.stringify({ version: 1, results: { "m::a-01": true, "m::a-02": true } }));
    expect(await main([...common(), "--baseline", bp], io(fakeLlm(() => "Helsinki")))).toBe(1);
    expect(out).toMatch(/REGRESSION m::a-02/);
    expect(await main([...common(), "--baseline", bp], io(fakeLlm((c) => (c.messages[0].content === "p" ? "Helsinki" : "Oslo"))))).toBe(0);
  });

  it("puuttuva baseline-tiedosto ilman --update-baselinea -> 2 eikä mallikutsuja", async () => {
    const llm = fakeLlm(() => "Helsinki");
    expect(await main([...common(), "--baseline", join(dir, "ei.json")], io(llm))).toBe(2);
    expect(err).toMatch(/--update-baseline/);
    expect(llm.calls).toHaveLength(0);
  });

  it("--max-pass-drop sallii yksittäisen regression rajan sisällä", async () => {
    const bp = join(dir, "base.json");
    writeFileSync(bp, JSON.stringify({ version: 1, results: { "m::a-01": true, "m::a-02": true } }));
    expect(await main([...common(), "--baseline", bp, "--max-pass-drop", "0.5"], io(fakeLlm(() => "Helsinki")))).toBe(0);
    expect(await main([...common(), "--baseline", bp, "--max-pass-drop", "0.4"], io(fakeLlm(() => "Helsinki")))).toBe(1);
  });

  it("käyttövirheet palauttavat 2: ei argumentteja, tuntematon komento, puuttuvat mallit/osoite/evalset", async () => {
    expect(await main([], io())).toBe(2);
    expect(await main(["foo"], io())).toBe(2);
    expect(await main(["run", setPath, "--base-url", "http://x"], io())).toBe(2);
    expect(err).toMatch(/Missing models/);
    expect(await main(["run", setPath, "--models", "m"], io())).toBe(2);
    expect(await main(["run", "--models", "m", "--base-url", "http://x"], io())).toBe(2);
    expect(await main(["run", join(dir, "ei.json"), "--models", "m", "--base-url", "http://x"], io())).toBe(2);
    expect(await main([...common(), "--max-pass-drop", "2"], io())).toBe(2);
    expect(await main([...common(), "--concurrency", "0"], io())).toBe(2);
    expect(await main([...common(), "--update-baseline"], io())).toBe(2);
  });

  it("--help tulostaa ohjeen ja palauttaa 0", async () => {
    expect(await main(["--help"], io())).toBe(0);
    expect(out).toMatch(/Exit codes/);
  });

  it("mallit ja osoite voi antaa ympäristömuuttujilla; API-avain luetaan --api-key-env-muuttujasta", async () => {
    const llm = fakeLlm(() => "Helsinki Oslo");
    const code = await main(["run", setPath, "--api-key-env", "OMA_AVAIN"], io(llm, { EVALKIT_MODELS: "x,y", EVALKIT_BASE_URL: "http://llm.local/v1", OMA_AVAIN: "salainen" }));
    expect(code).toBe(0);
    expect(llm.calls.map((c) => c.model)).toEqual(["x", "x", "y", "y"]);
    expect(llm.calls[0].authorization).toBe("Bearer salainen");
  });

  it("raportti ja virheilmoitukset eivät sisällä API-avainta", async () => {
    const llm = fakeLlm(() => ({ status: 401, body: "väärä avain" }));
    await main(common(), io(llm, { LLM_API_KEY: "sk-ei-saa-nakya" }));
    expect(out + err).not.toContain("sk-ei-saa-nakya");
  });

  it("käyttövirheen ilmoitus ei sisällä API-avainta", async () => {
    // Puuttuva --models laukaisee ylätason virhepolun, vaikka avain on asetettu.
    const code = await main(["run", setPath, "--base-url", "http://llm.local/v1"], io(undefined, { LLM_API_KEY: "sk-ei-saa-nakya" }));
    expect(code).toBe(2);
    expect(err.length).toBeGreaterThan(0);
    expect(out + err).not.toContain("sk-ei-saa-nakya");
  });

  it("--json kirjoittaa koko raportin", async () => {
    const jp = join(dir, "r.json");
    await main([...common(), "--json", jp], io(fakeLlm(() => "Helsinki Oslo")));
    expect(existsSync(jp)).toBe(true);
    expect(JSON.parse(readFileSync(jp, "utf8")).cases).toHaveLength(2);
  });
});

describe("cli: --cassette", () => {
  let dir: string;
  let setPath: string;
  let cassette: string;
  let out: string;
  let err: string;
  const io = (llm: ReturnType<typeof fakeLlm> | undefined, env: Record<string, string> = {}) => ({
    env,
    stdout: (s: string) => void (out += s),
    stderr: (s: string) => void (err += s),
    fetch: llm?.fetch,
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "evalkit-cas-"));
    setPath = join(dir, "set.json");
    cassette = join(dir, "c", "yleinen.json");
    writeFileSync(setPath, JSON.stringify({ version: 1, cases: [{ id: "a-01", prompt: "p", expect: { contains: "Helsinki" } }] }));
    out = "";
    err = "";
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const args = (...extra: string[]) => ["run", setPath, "--models", "m", "--base-url", "http://llm.local/v1", "--cassette", cassette, ...extra];

  it("record tallentaa vastaukset, replay toistaa ne ilman yhtään verkkokutsua ja ilman avainta tiedostossa", async () => {
    const rec = fakeLlm(() => "Helsinki");
    expect(await main(args("--cassette-mode", "record"), io(rec, { LLM_API_KEY: "sk-ei-tiedostoon" }))).toBe(0);
    expect(rec.calls).toHaveLength(1);
    expect(readFileSync(cassette, "utf8")).not.toContain("sk-ei-tiedostoon");

    const never = fakeLlm(() => "EI SAA KUTSUA");
    expect(await main(args(), io(never))).toBe(0); // oletustila replay
    expect(never.calls).toHaveLength(0);
  });

  it("replay ilman tallennetta ei kutsu verkkoa ja kaataa tapauksen selkeällä viestillä", async () => {
    const never = fakeLlm(() => "Helsinki");
    expect(await main(args(), io(never))).toBe(1);
    expect(never.calls).toHaveLength(0);
    expect(out).toMatch(/Run once with --cassette-mode record/);
    expect(out).not.toContain("LLM_CASSETTE_MODE");
  });

  it("LLM_CASSETTE_MODE ei vaikuta evalkitin kautta: tallenteen puuttuessa neuvo on --cassette-mode record", async () => {
    // llm-cassette reads LLM_CASSETTE_MODE from process.env when no mode is passed.
    vi.stubEnv("LLM_CASSETTE_MODE", "record");
    const never = fakeLlm(() => "Helsinki");
    try {
      expect(await main(args(), io(never))).toBe(1);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(never.calls).toHaveLength(0);
    expect(out).toMatch(/--cassette-mode record/);
  });

  it("tuntematon --cassette-mode ja --cassette-mode ilman --cassettea -> 2", async () => {
    expect(await main(args("--cassette-mode", "joku"), io(undefined))).toBe(2);
    expect(err).toMatch(/--cassette-mode must be replay, record or auto \(got 'joku'\)/);
    expect(await main(["run", setPath, "--models", "m", "--base-url", "http://x", "--cassette-mode", "record"], io(undefined))).toBe(2);
  });
});

describe("cli: validate", () => {
  let dir: string;
  let out: string;
  let err: string;
  const io = () => ({ env: {}, stdout: (s: string) => void (out += s), stderr: (s: string) => void (err += s) });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "evalkit-val-"));
    out = "";
    err = "";
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const write = (name: string, data: unknown) => {
    const p = join(dir, name);
    writeFileSync(p, typeof data === "string" ? data : JSON.stringify(data));
    return p;
  };

  it("kelvolliset tiedostot (versio 1 ja vanha muoto) -> 0 ja tapausmäärä", async () => {
    const a = write("a.json", { version: 1, cases: [{ id: "x", prompt: "p" }] });
    const b = write("b.json", [{ id: "y", prompt: "p", expectedContains: "k" }, { id: "z", prompt: "q" }]);
    expect(await main(["validate", a, b], io())).toBe(0);
    expect(out).toMatch(/OK .*a\.json: 1 case/);
    expect(out).toMatch(/OK .*b\.json: 2 cases/);
  });

  it("yksikin virheellinen tiedosto -> 2, kaikki tiedostot käydään silti läpi", async () => {
    const good = write("good.json", { version: 1, cases: [{ id: "x", prompt: "p" }] });
    const dup = write("dup.json", { version: 1, cases: [{ id: "a", prompt: "p" }, { id: "a", prompt: "q" }] });
    const broken = write("broken.json", "{ ei json");
    expect(await main(["validate", dup, good, broken], io())).toBe(2);
    expect(out).toMatch(/OK .*good\.json/);
    expect(err).toMatch(/appears more than once/);
    expect(err).toMatch(/cannot be read|is not valid JSON/);
  });

  it("puuttuva tiedosto -> 2; ilman tiedostoja -> 2", async () => {
    expect(await main(["validate", join(dir, "ei-ole.json")], io())).toBe(2);
    expect(await main(["validate"], io())).toBe(2);
    expect(err).toMatch(/at least one eval set file/);
  });

  it("validate ei kutsu verkkoa (ei fetch-injektiota, ei mallivalintoja tarvita)", async () => {
    const a = write("a.json", { version: 1, cases: [{ id: "x", prompt: "p", expect: { regex: "^a" } }] });
    expect(await main(["validate", a], io())).toBe(0);
  });
});
