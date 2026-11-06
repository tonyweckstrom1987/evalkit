import { describe, it, expect } from "vitest";
import { chat } from "../src/client.js";
import { fakeLlm } from "./helpers.js";

const base = { baseUrl: "http://llm.local/v1", model: "m", messages: [{ role: "user" as const, content: "hei" }] };
const okBody = (extra: object = {}) => JSON.stringify({ choices: [{ message: { content: "ok" } }], ...extra });

describe("chat: lisatestit", () => {
  it("lahettaa POST-pyynnon JSON-otsikolla, rungolla ja AbortSignalilla, jota ei keskeyteta onnistuneessa kutsussa", async () => {
    let captured: RequestInit | undefined;
    const f = (async (_url: unknown, init?: RequestInit) => {
      captured = init;
      return new Response(okBody(), { status: 200 });
    }) as typeof fetch;
    await chat({ ...base, fetch: f });
    expect(captured?.method).toBe("POST");
    expect((captured?.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(JSON.parse(String(captured?.body))).toEqual({ model: "m", messages: base.messages, max_tokens: 1024 });
    expect(captured?.signal).toBeInstanceOf(AbortSignal);
    expect(captured?.signal?.aborted).toBe(false);
  });

  it("maxTokens 1 (alaraja) hyvaksytaan", async () => {
    const l = fakeLlm(() => "ok");
    await chat({ ...base, maxTokens: 1, fetch: l.fetch });
    expect(l.calls[0].max_tokens).toBe(1);
  });

  it("osittainen usage: puuttuva kentta jaa undefinediksi", async () => {
    const f = (async () => new Response(okBody({ usage: { prompt_tokens: 5 } }), { status: 200 })) as typeof fetch;
    const r = await chat({ ...base, fetch: f });
    expect(r.usage?.promptTokens).toBe(5);
    expect(r.usage?.completionTokens).toBeUndefined();
  });

  it("virhevastauksen rungon lukeminen epaonnistuu -> viesti syntyy silti tyhjalla rungolla", async () => {
    const res = {
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      text: async () => {
        throw new Error("luku epaonnistui");
      },
    } as unknown as Response;
    const f = (async () => res) as typeof fetch;
    await expect(chat({ ...base, fetch: f })).rejects.toThrow(/'m' failed \(502 Bad Gateway\): $/);
  });

  it("verkkovirhe valitetaan sellaisenaan (ei aikakatkaisuviestia)", async () => {
    const f = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const err = await chat({ ...base, fetch: f }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect((err as Error).message).toBe("fetch failed");
  });

  it("ei-Error-arvo valitetaan sellaisenaan", async () => {
    const f = (async () => {
      throw "verkko";
    }) as unknown as typeof fetch;
    await expect(chat({ ...base, fetch: f })).rejects.toBe("verkko");
  });

  it("AbortError-nimisen virheen viesti kayttaa oletusaikakatkaisua 60000 ms", async () => {
    const f = (async () => {
      throw Object.assign(new Error("keskeytetty"), { name: "AbortError" });
    }) as typeof fetch;
    await expect(chat({ ...base, fetch: f })).rejects.toThrow(/timed out \(60000 ms\)/);
  });

  it("200-vastaus, jonka runko ei ole JSONia, hylataan", async () => {
    const f = (async () => new Response("ei json", { status: 200 })) as typeof fetch;
    await expect(chat({ ...base, fetch: f })).rejects.toThrow();
  });
});
