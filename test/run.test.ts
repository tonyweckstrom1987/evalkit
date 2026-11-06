import { describe, it, expect } from "vitest";
import { runEval } from "../src/run.js";
import { parseEvalSet } from "../src/schema.js";
import { fakeLlm } from "./helpers.js";

const baseUrl = "http://llm.local/v1";
const set = (cases: unknown[]) => parseEvalSet({ version: 1, cases });

describe("runEval", () => {
  it("ajaa jokaisen mallin jokaisella tapauksella ja laskee läpäisyn", async () => {
    const l = fakeLlm((c) => (c.model === "hyva" ? "Helsinki" : "Oslo"));
    const r = await runEval({ set: set([{ id: "a-01", prompt: "p", expect: { contains: "Helsinki" } }]), models: ["hyva", "huono"], baseUrl, fetch: l.fetch });
    expect(r.perModel.find((m) => m.model === "hyva")?.passRate).toBe(1);
    expect(r.perModel.find((m) => m.model === "huono")?.passRate).toBe(0);
    expect(l.calls).toHaveLength(2);
  });

  it("lähettää systemPromptin ensin ja promptin käyttäjäviestinä", async () => {
    const l = fakeLlm(() => "ok");
    await runEval({ set: set([{ id: "a", prompt: "kysymys", systemPrompt: "ohje" }]), models: ["m"], baseUrl, fetch: l.fetch });
    expect(l.calls[0].messages).toEqual([{ role: "system", content: "ohje" }, { role: "user", content: "kysymys" }]);
  });

  it("yksi virhe ei keskeytä muita; virhe odotuksellisella tapauksella = ei läpäissyt", async () => {
    const l = fakeLlm((c) => (c.model === "rikki" ? { status: 500, body: "x" } : "Helsinki"));
    const r = await runEval({ set: set([{ id: "a", prompt: "p", expect: { contains: "Helsinki" } }]), models: ["rikki", "ok"], baseUrl, fetch: l.fetch });
    const rikki = r.cases.find((c) => c.model === "rikki")!;
    expect(rikki.error).toMatch(/500/);
    expect(rikki.passed).toBe(false);
    expect(r.cases.find((c) => c.model === "ok")?.passed).toBe(true);
    expect(r.perModel.find((m) => m.model === "rikki")?.errors).toBe(1);
  });

  it("virhe tapauksella ilman odotuksia ei tee siitä arvioitua (passed null)", async () => {
    const l = fakeLlm(() => ({ status: 500, body: "x" }));
    const r = await runEval({ set: set([{ id: "a", prompt: "p" }]), models: ["m"], baseUrl, fetch: l.fetch });
    expect(r.cases[0].passed).toBeNull();
    expect(r.perModel[0].passRate).toBeNull();
  });

  it("säilyttää tulosten järjestyksen (malli ulompana) vaikka kutsut valmistuisivat eri järjestyksessä", async () => {
    const l = fakeLlm((_c, n) => ({ delayMs: n === 0 ? 60 : 1, text: "ok" }));
    const r = await runEval({ set: set([{ id: "a", prompt: "1" }, { id: "b", prompt: "2" }]), models: ["m1", "m2"], baseUrl, fetch: l.fetch, concurrency: 4 });
    expect(r.cases.map((c) => `${c.model}/${c.caseId}`)).toEqual(["m1/a", "m1/b", "m2/a", "m2/b"]);
  });

  it("rajoittaa samanaikaiset kutsut concurrency-arvoon", async () => {
    let active = 0;
    let peak = 0;
    const f = (async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 15));
      active--;
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    }) as typeof fetch;
    const cases = Array.from({ length: 8 }, (_, i) => ({ id: `c-${i}`, prompt: "p" }));
    await runEval({ set: set(cases), models: ["m"], baseUrl, fetch: f, concurrency: 2 });
    expect(peak).toBe(2);
  });

  it("kutsuraja: täsmälleen raja sallitaan, ylitys hylätään ennen yhtäkään kutsua", async () => {
    const cases = Array.from({ length: 10 }, (_, i) => ({ id: `c-${i}`, prompt: "p" }));
    const ok = fakeLlm(() => "ok");
    await runEval({ set: set(cases), models: ["m"], baseUrl, fetch: ok.fetch, maxCalls: 10 });
    expect(ok.calls).toHaveLength(10);

    const never = fakeLlm(() => "ok");
    await expect(runEval({ set: set(cases), models: ["m"], baseUrl, fetch: never.fetch, maxCalls: 9 })).rejects.toThrow(/at most 9/);
    expect(never.calls).toHaveLength(0);
  });

  it("oletuskatto on 200 kutsua", async () => {
    const cases = Array.from({ length: 101 }, (_, i) => ({ id: `c-${i}`, prompt: "p" }));
    const never = fakeLlm(() => "ok");
    await expect(runEval({ set: set(cases), models: ["a", "b"], baseUrl, fetch: never.fetch })).rejects.toThrow(/202 model calls/);
    expect(never.calls).toHaveLength(0);
  });

  it("minJudgeScore ilman tuomarimallia hylätään (viesti 'no judge model was given') ennen kutsuja", async () => {
    const never = fakeLlm(() => "ok");
    await expect(runEval({ set: set([{ id: "a", prompt: "p", expect: { minJudgeScore: 4 } }]), models: ["m"], baseUrl, fetch: never.fetch })).rejects.toThrow(/no judge model was given/);
    expect(never.calls).toHaveLength(0);
  });

  it("tuomari: pisteet luetaan, tuomarikutsut lasketaan kutsurajaan ja raja arvioidaan", async () => {
    const l = fakeLlm((c) => (c.model === "tuomari" ? "Arvio: 5" : "vastaus"));
    const r = await runEval({
      set: set([{ id: "a", prompt: "p", expect: { minJudgeScore: 4 } }]),
      models: ["m"],
      baseUrl,
      fetch: l.fetch,
      judgeModel: "tuomari",
    });
    expect(r.cases[0].judgeScore).toBe(5);
    expect(r.cases[0].passed).toBe(true);
    expect(l.calls).toHaveLength(2);

    const never = fakeLlm(() => "ok");
    await expect(
      runEval({ set: set([{ id: "a", prompt: "p", expect: { minJudgeScore: 4 } }, { id: "b", prompt: "p", expect: { minJudgeScore: 4 } }]), models: ["m"], baseUrl, fetch: never.fetch, judgeModel: "t", maxCalls: 3 }),
    ).rejects.toThrow(/4 model calls/);
  });

  it("hylkää tyhjän mallilistan ennen kutsuja", async () => {
    const never = fakeLlm(() => "ok");
    await expect(runEval({ set: set([{ id: "a", prompt: "p" }]), models: [], baseUrl, fetch: never.fetch })).rejects.toThrow(/At least one model is required/);
    expect(never.calls).toHaveLength(0);
  });

  it("raportti sisältää nimen, mallit, tuomarimallin, ryhmän ja yhteenvedon laskurit", async () => {
    const l = fakeLlm((c) => (c.model === "t" ? "4.5" : "Helsinki"));
    const r = await runEval({
      set: parseEvalSet({ version: 1, name: "nimi", cases: [{ id: "yleinen-01", prompt: "p", expect: { contains: "Helsinki" } }, { id: "b", prompt: "q", tags: ["ryhma"] }] }),
      models: ["m"],
      baseUrl,
      fetch: l.fetch,
      judgeModel: "t",
    });
    expect(r.name).toBe("nimi");
    expect(r.models).toEqual(["m"]);
    expect(r.judgeModel).toBe("t");
    expect(r.cases.map((c) => c.group)).toEqual(["yleinen", "ryhma"]);
    expect(r.perModel[0]).toEqual({ model: "m", total: 2, evaluated: 1, passed: 1, errors: 0, passRate: 1 });
    expect(l.calls).toHaveLength(2); // tuomaria ei kutsuta tapauksille ilman minJudgeScorea
  });

  it("tuomaripiste luetaan desimaalina ja tulkitsematon vastaus antaa null", async () => {
    const dec = fakeLlm((c) => (c.model === "t" ? "3.5" : "vastaus"));
    const r1 = await runEval({ set: set([{ id: "a", prompt: "p", expect: { minJudgeScore: 3 } }]), models: ["m"], baseUrl, fetch: dec.fetch, judgeModel: "t" });
    expect(r1.cases[0].judgeScore).toBe(3.5);
    const junk = fakeLlm((c) => (c.model === "t" ? "ei numeroa" : "vastaus"));
    const r2 = await runEval({ set: set([{ id: "a", prompt: "p", expect: { minJudgeScore: 3 } }]), models: ["m"], baseUrl, fetch: junk.fetch, judgeModel: "t" });
    expect(r2.cases[0].judgeScore).toBeNull();
    expect(r2.cases[0].passed).toBe(false);
  });

  it("välittää apiKeyn, maxTokensin ja tuomarille 16 tokenin rajan", async () => {
    const l = fakeLlm((c) => (c.model === "t" ? "5" : "vastaus"));
    await runEval({ set: set([{ id: "a", prompt: "p", expect: { minJudgeScore: 4 } }]), models: ["m"], baseUrl, fetch: l.fetch, judgeModel: "t", apiKey: "avain", maxTokens: 200 });
    expect(l.calls[0].max_tokens).toBe(200);
    expect(l.calls[0].authorization).toBe("Bearer avain");
    expect(l.calls[1].max_tokens).toBe(16);
    expect(l.calls[1].authorization).toBe("Bearer avain");
  });

  it("virheellinen maxTokens kaataa jokaisen tapauksen virheeksi eikä tee verkkokutsuja", async () => {
    const never = fakeLlm(() => "ok");
    const r = await runEval({ set: set([{ id: "a", prompt: "p", expect: { contains: "x" } }]), models: ["m"], baseUrl, fetch: never.fetch, maxTokens: 99999 });
    expect(never.calls).toHaveLength(0);
    expect(r.cases[0].passed).toBe(false);
    expect(r.cases[0].failures[0]).toMatch(/^error: .*maxTokens/);
    expect(r.cases[0].response).toBe("");
  });

  it("tuomarin virhe ei kaada ajoa: piste puuttuu ja minJudgeScore-tapaus kaatuu", async () => {
    const l = fakeLlm((c) => (c.model === "tuomari" ? { status: 500, body: "x" } : "vastaus"));
    const r = await runEval({ set: set([{ id: "a", prompt: "p", expect: { minJudgeScore: 4 } }]), models: ["m"], baseUrl, fetch: l.fetch, judgeModel: "tuomari" });
    expect(r.cases[0].judgeScore).toBeNull();
    expect(r.cases[0].passed).toBe(false);
  });
});
