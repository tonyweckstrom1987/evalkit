import { describe, it, expect } from "vitest";
import { runEval } from "../src/run.js";
import { parseEvalSet } from "../src/schema.js";
import { fakeLlm } from "./helpers.js";

const baseUrl = "http://llm.local/v1";
const set = (cases: unknown[]) => parseEvalSet({ version: 1, cases });

describe("runEval: lisatestit", () => {
  it("tuomarin kehote sisaltaa tehtavananto, odotetun sisallon, mallin vastauksen ja ohjeen", async () => {
    const l = fakeLlm((c) => (c.model === "t" ? "4" : "Helsinki on pääkaupunki"));
    await runEval({
      set: set([{ id: "a", prompt: "kysymys", expect: { contains: "Helsinki", minJudgeScore: 3 } }]),
      models: ["m"],
      baseUrl,
      fetch: l.fetch,
      judgeModel: "t",
    });
    const judgeCall = l.calls[1];
    expect(judgeCall.model).toBe("t");
    expect(judgeCall.messages[0].role).toBe("system");
    expect(judgeCall.messages[0].content).toContain("Olet tiukka arvioija");
    expect(judgeCall.messages[1]).toEqual({
      role: "user",
      content:
        "Tehtävänanto:\nkysymys\n\nOdotettu sisältö: Helsinki\n\nMallin vastaus:\nHelsinki on pääkaupunki\n\nAnna laatuarvio asteikolla 1-5 (pelkkä numero, ei muuta tekstiä).",
    });
  });

  it("tuomarin kehotteessa ei ole 'Odotettu sisältö' -riviä, jos contains puuttuu", async () => {
    const l = fakeLlm((c) => (c.model === "t" ? "4" : "vastaus"));
    await runEval({ set: set([{ id: "a", prompt: "p", expect: { minJudgeScore: 3 } }]), models: ["m"], baseUrl, fetch: l.fetch, judgeModel: "t" });
    expect(l.calls[1].messages[1].content).not.toContain("Odotettu sisältö");
  });

  it("tuomaripiste: ensimmainen luku 1-5 poimitaan tekstista; muu kuin 1-5 antaa null", async () => {
    const score = async (reply: string) => {
      const l = fakeLlm((c) => (c.model === "t" ? reply : "vastaus"));
      const r = await runEval({ set: set([{ id: "a", prompt: "p", expect: { minJudgeScore: 1 } }]), models: ["m"], baseUrl, fetch: l.fetch, judgeModel: "t" });
      return r.cases[0].judgeScore;
    };
    expect(await score("Pisteet: 4/5")).toBe(4);
    expect(await score("0")).toBeNull();
    expect(await score("6")).toBeNull();
    expect(await score("7")).toBeNull();
  });

  it("tuomarin aikakatkaisu ei kaada ajoa: piste on null ja minJudgeScore-tapaus kaatuu", async () => {
    const l = fakeLlm((c) => (c.model === "t" ? { delayMs: 500, text: "5" } : "vastaus"));
    const r = await runEval({ set: set([{ id: "a", prompt: "p", expect: { minJudgeScore: 4 } }]), models: ["m"], baseUrl, fetch: l.fetch, judgeModel: "t", timeoutMs: 50 });
    expect(r.cases[0].judgeScore).toBeNull();
    expect(r.cases[0].passed).toBe(false);
    expect(r.cases[0].error).toBeNull();
  });

  it("kutsuraja laskee tuomarikutsut mallien yli: 2 mallia * (2 tapausta + 1 tuomarikutsu) = 6", async () => {
    const cases = [
      { id: "a", prompt: "p", expect: { minJudgeScore: 3 } },
      { id: "b", prompt: "q" },
    ];
    const ok = fakeLlm((c) => (c.model === "t" ? "4" : "ok"));
    await runEval({ set: set(cases), models: ["m1", "m2"], baseUrl, fetch: ok.fetch, judgeModel: "t", maxCalls: 6 });
    expect(ok.calls).toHaveLength(6);

    const never = fakeLlm(() => "ok");
    await expect(runEval({ set: set(cases), models: ["m1", "m2"], baseUrl, fetch: never.fetch, judgeModel: "t", maxCalls: 5 })).rejects.toThrow(/6 model calls; at most 5/);
    expect(never.calls).toHaveLength(0);
  });

  it("tyhja systemPrompt ei lahde viestina", async () => {
    const l = fakeLlm(() => "ok");
    await runEval({ set: set([{ id: "a", prompt: "p", systemPrompt: "" }]), models: ["m"], baseUrl, fetch: l.fetch });
    expect(l.calls[0].messages).toEqual([{ role: "user", content: "p" }]);
  });

  it("fetchin heittama ei-Error-arvo muutetaan merkkijonoksi virheeseen", async () => {
    const f = (async () => {
      throw "boom";
    }) as unknown as typeof fetch;
    const r = await runEval({ set: set([{ id: "a", prompt: "p", expect: { contains: "x" } }]), models: ["m"], baseUrl, fetch: f });
    expect(r.cases[0].error).toBe("boom");
    expect(r.cases[0].passed).toBe(false);
    expect(r.cases[0].failures).toEqual(["error: boom"]);
    expect(r.cases[0].judgeScore).toBeNull();
  });

  it("odotuksettoman tapauksen virhe lasketaan errors-laskuriin mutta ei arvioitaviin", async () => {
    const l = fakeLlm(() => ({ status: 500, body: "x" }));
    const r = await runEval({ set: set([{ id: "a", prompt: "p" }]), models: ["m"], baseUrl, fetch: l.fetch });
    expect(r.perModel[0]).toEqual({ model: "m", total: 1, evaluated: 0, passed: 0, errors: 1, passRate: null });
    expect(r.cases[0].failures).toEqual([]);
  });

  it("malli, jonka kaikki odotukselliset tapaukset kaatuvat virheeseen, saa passRaten 0 (ei null)", async () => {
    const l = fakeLlm(() => ({ status: 500, body: "x" }));
    const r = await runEval({ set: set([{ id: "a", prompt: "p", expect: { contains: "x" } }, { id: "b", prompt: "q", expect: { contains: "y" } }]), models: ["m"], baseUrl, fetch: l.fetch });
    expect(r.perModel[0]).toMatchObject({ evaluated: 2, passed: 0, errors: 2, passRate: 0 });
  });

  it("concurrency 0 tai negatiivinen kaytetaan arvona 1 ja kaikki tapaukset ajetaan", async () => {
    for (const concurrency of [0, -5]) {
      let active = 0;
      let peak = 0;
      const f = (async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
      }) as typeof fetch;
      const cases = Array.from({ length: 3 }, (_, i) => ({ id: `c-${i}`, prompt: "p" }));
      const r = await runEval({ set: set(cases), models: ["m"], baseUrl, fetch: f, concurrency });
      expect(peak).toBe(1);
      expect(r.cases).toHaveLength(3);
    }
  });

  it("timeoutMs valitetaan mallikutsuun: hidas vastaus on virhe selkealla viestilla", async () => {
    const l = fakeLlm(() => ({ delayMs: 500, text: "myohaan" }));
    const r = await runEval({ set: set([{ id: "a", prompt: "p", expect: { contains: "x" } }]), models: ["m"], baseUrl, fetch: l.fetch, timeoutMs: 20 });
    expect(r.cases[0].error).toMatch(/timed out \(20 ms\)/);
    expect(r.cases[0].passed).toBe(false);
  });

  it("latencyMs mittaa kutsun keston ja vastaus tallennetaan raporttiin", async () => {
    const l = fakeLlm(() => ({ delayMs: 40, text: "hidas vastaus" }));
    const r = await runEval({ set: set([{ id: "a", prompt: "p" }]), models: ["m"], baseUrl, fetch: l.fetch });
    expect(r.cases[0].latencyMs).toBeGreaterThanOrEqual(30);
    expect(r.cases[0].response).toBe("hidas vastaus");
    expect(r.cases[0].error).toBeNull();
  });

  it("ilman tuomarimallia raportin judgeModel on undefined", async () => {
    const l = fakeLlm(() => "ok");
    const r = await runEval({ set: set([{ id: "a", prompt: "p" }]), models: ["m"], baseUrl, fetch: l.fetch });
    expect(r.judgeModel).toBeUndefined();
    expect(r.name).toBeUndefined();
  });
});
