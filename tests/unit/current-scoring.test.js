import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

describe("current scoring characterization", () => {
  it("preserves the existing score and radar data order for a fixed fixture", async () => {
    const dom = new JSDOM("<!doctype html><canvas></canvas>", {
      runScripts: "outside-only",
      url: "http://localhost/",
    });
    const { window } = dom;
    window.HTMLCanvasElement.prototype.getContext = () => null;
    const state = await readFile(
      new URL("../../js/core/state.js", import.meta.url),
      "utf8",
    );
    const utils = await readFile(
      new URL("../../js/core/utils.js", import.meta.url),
      "utf8",
    );
    const scoring = await readFile(
      new URL("../../js/core/scoring.js", import.meta.url),
      "utf8",
    );
    const fixture = JSON.parse(
      await readFile(
        new URL("../fixtures/current-score.json", import.meta.url),
        "utf8",
      ),
    );
    window.eval(
      `${state}\nradarChart = { data: { datasets: [{ data: [] }] }, update() {} };\n${utils}\n${scoring}\nwindow.__score = calculateFinalScore(${JSON.stringify(fixture)}); window.__axes = radarChart.data.datasets[0].data;`,
    );
    const { __score: score, __axes: axes } = window;
    expect(score).toBe(62);
    expect(Array.from(axes)).toEqual([67, 50, 67, 67, 80, 33, 50, 86]);
    dom.window.close();
  });
});
