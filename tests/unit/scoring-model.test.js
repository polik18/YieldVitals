import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const config = JSON.parse(
  await readFile(
    new URL("../../config/baselines-v2.json", import.meta.url),
    "utf8",
  ),
);
const source = await readFile(
  new URL("../../js/core/scoring-model.js", import.meta.url),
  "utf8",
);
const context = vm.createContext({});
vm.runInContext(source, context);
const model = context.createScoringModel(config);

function makeRun(valueAt, methodOverrides = {}) {
  return Object.fromEntries(
    Object.entries(config.axes).map(([axisId, axis]) => {
      const method =
        methodOverrides[axisId] ?? (axisId === "storage" ? "OPFS" : null);
      const anchors = axis.methods?.[method] ?? axis.anchorPoints;
      return [
        axisId,
        {
          status: "ok",
          value: valueAt(axisId, anchors),
          method,
          metadata: { baselineId: config.baselineId },
        },
      ];
    }),
  );
}

describe("versioned pure scoring model", () => {
  it("has valid weights and makes every axis and the composite reach 100", () => {
    const weights = Object.values(config.axes).map((axis) => axis.weight);
    expect(weights.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1);
    const result = model.scoreRun(
      makeRun((_id, anchors) => anchors.at(-1).value),
    );
    expect(result.axisScores).toEqual(
      Object.fromEntries(model.axisIds.map((id) => [id, 100])),
    );
    expect(result.overallScore).toBe(100);
  });

  it("can produce a composite score of 95 and preserves tier boundaries", () => {
    const runAtScore = (score) =>
      model.scoreRun(
        makeRun((_id, anchors) => {
          const upperIndex = anchors.findIndex(
            (anchor) => anchor.score >= score,
          );
          if (upperIndex === 0) return anchors[0].value;
          const lower = anchors[upperIndex - 1];
          const upper = anchors[upperIndex];
          return (
            lower.value +
            ((score - lower.score) / (upper.score - lower.score)) *
              (upper.value - lower.value)
          );
        }),
      );
    expect(runAtScore(95).overallScore).toBe(95);
    expect(runAtScore(0).diagnostics.fitness.webBrowsing).toBe(
      "fitness_smooth",
    );
    expect(runAtScore(30).diagnostics.fitness.webBrowsing).toBe(
      "fitness_very_smooth",
    );
    expect(runAtScore(60).diagnostics.fitness.web3D).toBe("fitness_good");
    expect(runAtScore(85).diagnostics.fitness.web3D).toBe(
      "fitness_very_smooth",
    );
  });

  it.each([null, undefined, Number.NaN, Infinity, -1])(
    "rejects invalid core metric value %s",
    (value) => {
      const run = makeRun((_id, anchors) => anchors.at(-1).value);
      run.cpu.value = value;
      const result = model.scoreRun(run);
      expect(result.overallScore).toBeNull();
      expect(result.rejectedMetrics).toContainEqual({
        metricId: "cpu",
        reason: "invalid-value",
      });
    },
  );

  it("requires every core axis and rejects baseline or method mismatches", () => {
    const run = makeRun((_id, anchors) => anchors.at(-1).value, {
      storage: "OPFS",
      canvas2d: "OffscreenCanvas",
    });
    delete run.gpu;
    expect(model.scoreRun(run).overallScore).toBeNull();
    run.gpu = {
      status: "ok",
      value: 1000,
      method: null,
      metadata: { baselineId: "old-baseline" },
    };
    expect(model.scoreRun(run).rejectedMetrics).toContainEqual({
      metricId: "gpu",
      reason: "baseline-mismatch",
    });
    run.gpu.metadata.baselineId = config.baselineId;
    run.canvas2d.method = "Fallback";
    expect(model.scoreRun(run).rejectedMetrics).toContainEqual({
      metricId: "canvas2d",
      reason: "method-mismatch",
    });
  });

  it("scores OPFS and IndexedDB against distinct anchors and excludes network diagnostics", () => {
    const opfs = model.normalizeMetric("storage", 1500, "OPFS");
    const indexedDb = model.normalizeMetric("storage", 150, "IndexedDB");
    expect(opfs.score).toBe(50);
    expect(indexedDb.score).toBe(50);
    expect(model.normalizeMetric("storage", 150, "OPFS").score).not.toBe(50);
    const run = makeRun((_id, anchors) => anchors.at(-1).value, {
      storage: "IndexedDB",
      canvas2d: "OffscreenCanvas",
    });
    run.network = { status: "ok", value: 1e12, method: "internet" };
    expect(model.scoreRun(run).overallScore).toBe(100);
  });
});
