import { describe, it, expect } from "vitest";
import { chat, EmptyResponseError } from "../src/client.js";
import { fakeLlm } from "./helpers.js";

const base = { baseUrl: "http://llm.local/v1/", model: "m", messages: [{ role: "user" as const, content: "hei" }] };

describe("chat", () => {
  it("palauttaa tekstin ja käytön, lähettää Authorization-otsikon ja oletus-max_tokensin", async () => {
    const l = fakeLlm(() => "moi");
    const r = await chat({ ...base, apiKey: "avain", fetch: l.fetch });
    expect(r.text).toBe("moi");
    expect(r.usage?.promptTokens).toBe(3);
    expect(l.calls[0].authorization).toBe("Bearer avain");
    expect(l.calls[0].max_tokens).toBe(1024);
  });
  it("ei lähetä Authorization-otsikkoa ilman avainta", async () => {
    const l = fakeLlm(() => "moi");
    await chat({ ...base, fetch: l.fetch });
    expect(l.calls[0].authorization).toBeNull();
  });
  it("hylkää liian suuren tai virheellisen maxTokensin ennen kutsua", async () => {
    const l = fakeLlm(() => "moi");
    for (const bad of [4097, 0, -1, 1.5, Number.NaN]) {
      await expect(chat({ ...base, maxTokens: bad, fetch: l.fetch })).rejects.toThrow(/maxTokens/);
    }
    expect(l.calls).toHaveLength(0);
    await chat({ ...base, maxTokens: 4096, fetch: l.fetch });
    expect(l.calls).toHaveLength(1);
  });
  it("ei-2xx heittää virheen statuksella", async () => {
    const l = fakeLlm(() => ({ status: 503, body: "alhaalla" }));
    await expect(chat({ ...base, fetch: l.fetch })).rejects.toThrow(/503/);
  });
  it("tyhjä vastaus on EmptyResponseError", async () => {
    const l = fakeLlm(() => ({ empty: true }));
    await expect(chat({ ...base, fetch: l.fetch })).rejects.toBeInstanceOf(EmptyResponseError);
  });
  it("normalisoi osoitteen perään tulevat vinoviivat ja kutsuu /chat/completions", async () => {
    const urls: string[] = [];
    const f = (async (url: unknown) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    }) as typeof fetch;
    await chat({ ...base, baseUrl: "http://llm.local/v1///", fetch: f });
    expect(urls).toEqual(["http://llm.local/v1/chat/completions"]);
  });
  it("palauttaa mallin nimen vastauksesta, tai pyydetyn mallin jos vastaus ei kerro, eikä usagea ilman usage-kenttää", async () => {
    const f = (async () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 })) as typeof fetch;
    const r = await chat({ ...base, model: "pyydetty", fetch: f });
    expect(r.model).toBe("pyydetty");
    expect(r.usage).toBeUndefined();
    const l = fakeLlm(() => "ok");
    expect((await chat({ ...base, model: "pyydetty", fetch: l.fetch })).model).toBe("m");
  });
  it("lähettää mallin, viestit ja annetun max_tokensin pyynnön rungossa", async () => {
    const l = fakeLlm(() => "ok");
    await chat({ ...base, model: "x", maxTokens: 77, fetch: l.fetch });
    expect(l.calls[0].model).toBe("x");
    expect(l.calls[0].messages).toEqual([{ role: "user", content: "hei" }]);
    expect(l.calls[0].max_tokens).toBe(77);
  });
  it("pelkkää tyhjää merkkiä sisältävä, puuttuva tai ei-merkkijonomuotoinen sisältö on EmptyResponseError", async () => {
    for (const body of [{ choices: [{ message: { content: "  \n " } }] }, { choices: [] }, { choices: [{ message: { content: 42 } }] }, {}]) {
      const f = (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
      await expect(chat({ ...base, fetch: f })).rejects.toBeInstanceOf(EmptyResponseError);
    }
  });
  it("virheviesti sisältää mallin ja rungon, joka katkaistaan 300 merkkiin", async () => {
    const l = fakeLlm(() => ({ status: 500, body: "x".repeat(1000) }));
    const err = await chat({ ...base, model: "rikki", fetch: l.fetch }).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/'rikki'/);
    expect((err as Error).message).toContain("x".repeat(300));
    expect((err as Error).message).not.toContain("x".repeat(301));
  });
  it("aikakatkaisu keskeyttää kutsun selkeällä viestillä", async () => {
    const l = fakeLlm(() => ({ delayMs: 500, text: "liian myöhään" }));
    await expect(chat({ ...base, timeoutMs: 20, fetch: l.fetch })).rejects.toThrow(/timed out \(20 ms\)/);
  });
});
