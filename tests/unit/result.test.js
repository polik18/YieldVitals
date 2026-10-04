import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

describe("benchmark result contract and cleanup", () => {
  it("does not allow non-success states to carry scores", async () => {
    const source = await readFile(
      new URL("../../js/core/result.js", import.meta.url),
      "utf8",
    );
    const dom = new JSDOM("<!doctype html>", {
      runScripts: "outside-only",
      url: "http://localhost/",
    });
    dom.window.eval(`
      let activeBenchmarkScope = null;
      const t = (key) => key;
      ${source}
      window.api = { createBenchmarkResult, validateBenchmarkResult, RunContext };
    `);
    const { api } = dom.window;
    const unsupported = api.createBenchmarkResult("gpu", "unsupported", {
      value: 0,
      error: "WebGL disabled",
    });
    expect(unsupported.value).toBeNull();
    expect(unsupported.samples).toEqual([]);
    expect(api.validateBenchmarkResult(unsupported)).toBe(true);
    expect(() =>
      api.validateBenchmarkResult({ ...unsupported, value: 0 }),
    ).toThrow("Only successful benchmark results may have a value");
    dom.window.close();
  });

  it("terminates registered workers and clears registered timers on cancellation", async () => {
    const source = await readFile(
      new URL("../../js/core/result.js", import.meta.url),
      "utf8",
    );
    const dom = new JSDOM("<!doctype html>", {
      runScripts: "outside-only",
      url: "http://localhost/",
    });
    dom.window.eval(`
      let activeBenchmarkScope = null;
      const t = (key) => key;
      ${source}
      window.api = { RunContext };
    `);
    const scope = new dom.window.api.RunContext(1).begin("cpu");
    let terminated = 0;
    let cancelledFrames = 0;
    let cleanupCalls = 0;
    dom.window.cancelAnimationFrame = () => cancelledFrames++;
    const timer = dom.window.setTimeout(() => {}, 30000);
    const controller = new dom.window.AbortController();
    scope.trackWorker({ terminate: () => terminated++ });
    scope.trackController(controller);
    scope.trackTimer(timer);
    scope.trackAnimationFrame(42);
    scope.addCleanup(() => cleanupCalls++);
    const pending = scope.timeout(new Promise(() => {}), 30000, "CPU");
    scope.runContext.cancel("test cancel");
    await expect(pending).rejects.toMatchObject({ status: "cancelled" });
    await scope.close();
    expect(scope.signal.aborted).toBe(true);
    expect(terminated).toBe(1);
    expect(controller.signal.aborted).toBe(true);
    expect(cancelledFrames).toBe(1);
    expect(cleanupCalls).toBe(1);
    expect(scope.workers.size).toBe(0);
    expect(scope.controllers.size).toBe(0);
    expect(scope.animationFrames.size).toBe(0);
    expect(scope.timers.size).toBe(0);
    dom.window.close();
  });
});
