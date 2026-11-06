import { describe, it, expect } from "vitest";
import { main } from "../src/cli.js";

// Pitaa docs/demo.md:n esimerkin todenmukaisena: ennen -> regressio (1), jalkeen -> lapi (0).
describe("docs/demo.md", () => {
  const aja = async (cassette: string) => {
    let out = "";
    const code = await main(
      ["run", "examples/yleinen-fi.json", "--models", "demo", "--base-url", "https://litellm.example/v1",
        "--baseline", "examples/demo/baseline.json", "--cassette", `examples/demo/${cassette}.cassette.json`],
      { env: {}, stdout: (s: string) => void (out += s), stderr: () => {} },
    );
    return { code, out };
  };

  it("ennen: lasku-01 on regressio ja ajo kaatuu", async () => {
    const r = await aja("ennen");
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/REGRESSION demo::lasku-01/);
  });

  it("jalkeen: kaikki lapi ja ajo menee lapi", async () => {
    const r = await aja("jalkeen");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/passed 3\/3/);
  });
});
