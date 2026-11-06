import { describe, it, expect } from "vitest";
import { parseEvalSet, groupOf } from "../src/schema.js";

describe("evalset-skeema: lisatestit", () => {
  it("ei-objekti ja puuttuva version-kentta hylataan; oletuslahde on 'evalset'", () => {
    expect(() => parseEvalSet(null)).toThrow(/Eval set 'evalset' is invalid/);
    expect(() => parseEvalSet("teksti")).toThrow(/Eval set 'evalset' is invalid/);
    expect(() => parseEvalSet(42)).toThrow(/Eval set/);
    expect(() => parseEvalSet({ cases: [{ id: "a", prompt: "p" }] })).toThrow(/version/);
  });

  it("virheilmoituksen muoto: otsikko ja luettelorivit '  - polku: viesti'", () => {
    expect(() => parseEvalSet({ version: 1, cases: [{ id: "a", prompt: "" }] }, "oma.json")).toThrow(/^Eval set 'oma\.json' is invalid:\n {2}- cases\.0\.prompt: /);
  });

  it("tyhja prompt, tyhja tagi ja minJudgeScore rajojen ulkopuolelta (0.99, 5.01) hylataan", () => {
    expect(() => parseEvalSet({ version: 1, cases: [{ id: "a", prompt: "" }] })).toThrow();
    expect(() => parseEvalSet({ version: 1, cases: [{ id: "a", prompt: "p", tags: [""] }] })).toThrow();
    for (const v of [0.99, 5.01]) {
      expect(() => parseEvalSet({ version: 1, cases: [{ id: "a", prompt: "p", expect: { minJudgeScore: v } }] })).toThrow();
    }
  });

  it("tyhja systemPrompt ja tyhja tags-taulukko hyvaksytaan; tuntemattomat tapauskentat poistetaan", () => {
    const s = parseEvalSet({ version: 1, cases: [{ id: "a", prompt: "p", systemPrompt: "", tags: [], ylimaarainen: "x" }] });
    expect(s.cases[0]).toEqual({ id: "a", prompt: "p", systemPrompt: "", tags: [] });
    expect(s.cases[0]).not.toHaveProperty("ylimaarainen");
  });

  it("vanha muoto: systemPrompt sailyy ja category ilman expectedContainsia antaa vain tagin", () => {
    const s = parseEvalSet([{ id: "a", prompt: "p", systemPrompt: "ohje", category: "k" }]);
    expect(s.cases[0]).toEqual({ id: "a", prompt: "p", systemPrompt: "ohje", tags: ["k"] });
    expect(s.cases[0].expect).toBeUndefined();
  });

  it("nimi sailyy v1-muodossa ja puuttuu vanhassa muodossa", () => {
    expect(parseEvalSet({ version: 1, name: "n", cases: [{ id: "a", prompt: "p" }] }).name).toBe("n");
    expect(parseEvalSet([{ id: "a", prompt: "p" }]).name).toBeUndefined();
  });

  it("kelvollinen regex hyvaksytaan", () => {
    expect(parseEvalSet({ version: 1, cases: [{ id: "a", prompt: "p", expect: { regex: "^\\d+$" } }] }).cases[0].expect?.regex).toBe("^\\d+$");
  });

  it("groupOf: tyhja tags-taulukko putoaa id:n etuliitteeseen ja vain viimeinen numeropaate poistetaan", () => {
    expect(groupOf({ id: "yleinen-02", prompt: "p", tags: [] })).toBe("yleinen");
    expect(groupOf({ id: "a-01-02", prompt: "p" })).toBe("a-01");
    expect(groupOf({ id: "abc-1x", prompt: "p" })).toBe("abc-1x");
  });
});
