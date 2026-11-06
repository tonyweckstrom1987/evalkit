import { describe, it, expect } from "vitest";
import { evaluate } from "../src/checks.js";

describe("evaluate", () => {
  it("ei odotuksia -> passed null", () => {
    expect(evaluate(undefined, "x", null)).toEqual({ passed: null, failures: [] });
    expect(evaluate({}, "x", null).passed).toBeNull();
  });
  it("contains on kirjainkoosta riippumaton", () => {
    expect(evaluate({ contains: "helsinki" }, "Pääkaupunki on HELSINKI.", null).passed).toBe(true);
    expect(evaluate({ contains: "Tukholma" }, "Helsinki", null).passed).toBe(false);
  });
  it("notContains kaataa kielletystä sanasta", () => {
    const r = evaluate({ notContains: ["en tiedä"] }, "Hmm, En Tiedä.", null);
    expect(r.passed).toBe(false);
    expect(r.failures[0]).toMatch(/notContains/);
  });
  it("regex", () => {
    expect(evaluate({ regex: "^\\d+$" }, "42", null).passed).toBe(true);
    expect(evaluate({ regex: "^\\d+$" }, "42 kpl", null).passed).toBe(false);
  });
  it("minJudgeScore: raja täsmälleen läpäisee, alle kaataa, puuttuva piste kaataa", () => {
    expect(evaluate({ minJudgeScore: 4 }, "x", 4).passed).toBe(true);
    expect(evaluate({ minJudgeScore: 4 }, "x", 3.9).passed).toBe(false);
    expect(evaluate({ minJudgeScore: 4 }, "x", null).passed).toBe(false);
  });
  it("kaikkien ehtojen pitää täyttyä ja jokainen epäonnistuminen raportoidaan", () => {
    const r = evaluate({ contains: "a", notContains: ["b"], regex: "^z" }, "b", null);
    expect(r.passed).toBe(false);
    expect(r.failures).toHaveLength(3);
  });
  it("onnistunut arviointi palauttaa tyhjän failures-listan", () => {
    expect(evaluate({ contains: "a", notContains: ["z"], regex: "^a", minJudgeScore: 3 }, "abc", 4)).toEqual({ passed: true, failures: [] });
  });
  it("contains-ehdon kirjainkoko ei vaikuta myöskään ehdon puolella ja virheviesti nimeää ehdon", () => {
    expect(evaluate({ contains: "HELSINKI" }, "helsinki", null).passed).toBe(true);
    expect(evaluate({ contains: "Tukholma" }, "Helsinki", null).failures).toEqual(["contains: response does not contain 'Tukholma'"]);
  });
  it("notContains raportoi jokaisen kielletyn sanan erikseen ja vertaa kirjainkoosta riippumatta", () => {
    const r = evaluate({ notContains: ["EN TIEDÄ", "ehkä", "ok"] }, "En tiedä, ehkä.", null);
    expect(r.passed).toBe(false);
    expect(r.failures).toHaveLength(2);
    expect(r.failures[0]).toMatch(/'EN TIEDÄ'/);
    expect(r.failures[1]).toMatch(/'ehkä'/);
  });
  it("notContains tyhjällä listalla ja tyhjällä vastauksella läpäisee", () => {
    expect(evaluate({ notContains: [] }, "mitä vain", null).passed).toBe(true);
    expect(evaluate({ notContains: ["x"] }, "", null).passed).toBe(true);
  });
  it("regex on kirjainkokoriippuvainen (tekstiä ei muunneta pieniksi) ja virheviesti sisältää lausekkeen", () => {
    expect(evaluate({ regex: "^abc" }, "ABC", null).passed).toBe(false);
    expect(evaluate({ regex: "^abc" }, "abc", null).passed).toBe(true);
    expect(evaluate({ regex: "^z" }, "b", null).failures).toEqual(["regex: response does not match /^z/"]);
  });
  it("minJudgeScore: virheviestit erottavat puuttuvan pisteen ja liian matalan pisteen", () => {
    expect(evaluate({ minJudgeScore: 4 }, "x", null).failures).toEqual(["minJudgeScore: no judge score received"]);
    expect(evaluate({ minJudgeScore: 4 }, "x", 3.5).failures).toEqual(["minJudgeScore: 3.5 < 4"]);
  });
  it("tuomaripiste ei vaikuta tulokseen, jos minJudgeScore-ehtoa ei ole", () => {
    expect(evaluate({ contains: "a" }, "a", 1).passed).toBe(true);
    expect(evaluate({ contains: "a" }, "a", null).passed).toBe(true);
  });
});
