import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

describe("P03 deterministic and bounded workload foundations", () => {
  it("uses a reproducible CPU kernel and avoids randomness in the timed worker", async () => {
    const code = await source("../../js/benchmarks/cpu.js");
    const context = vm.createContext({});
    vm.runInContext(code, context);
    const checksums = vm.runInContext(
      "[computeCpuKernel(12345), computeCpuKernel(12345), computeCpuKernel(98765)]",
      context,
    );
    expect(checksums[0]).toBe(checksums[1]);
    expect(checksums[0]).not.toBe(checksums[2]);
    expect(code).not.toContain("Math.random");
    expect(code).toContain('type: "ready"');
    expect(code).toContain("workerCount = Math.max(1, Math.min(cores, 8))");
  });

  it("measures fixed JSON parsing and regexp workloads as separate rates", async () => {
    const code = await source("../../js/benchmarks/dom.js");
    const context = vm.createContext({});
    const workerSource = vm.runInContext(`${code}\nstringWorkerCode`, context);
    expect(workerSource).toContain("json-regex-fixture-v1");
    expect(workerSource).toContain("parseMiBPerSec");
    expect(workerSource).toContain("fieldsPerSec");
    expect(workerSource).toContain("parseElapsedMs");
    expect(workerSource).toContain("regexElapsedMs");
  });

  it("bounds allocation batches and reports allocation rather than physical RAM bandwidth", async () => {
    const code = await source("../../js/benchmarks/memory.js");
    const context = vm.createContext({});
    const workerSource = vm.runInContext(`${code}\nramWorkerCode`, context);
    expect(code).toContain("bounded-object-allocation-v1");
    expect(workerSource).toContain("length: 256");
    expect(workerSource).toContain("batchSize: 256");
    expect(workerSource).not.toContain("new Array(10000)");
  });

  it("uses a fixed DOM tree and reports forced-layout method and checksum", async () => {
    const code = await source("../../js/benchmarks/dom.js");
    expect(code).toContain('"dom-fixed-tree-forced-layout-v1"');
    expect(code).toContain('method: "dom-forced-layout-v1"');
    expect(code).toContain("box.replaceChildren(...nodes)");
    expect(code).toContain("node.offsetWidth + node.offsetHeight");
    expect(code).not.toContain("box.innerHTML = `<div style=");
  });

  it("uses a fixed OffscreenCanvas workload with warmup and pixel checksum", async () => {
    const code = await source("../../js/benchmarks/gpu.js");
    expect(code).toContain("fixed-canvas-arcs-v2");
    expect(code).toContain("canvas2d-offscreen-draw-v2");
    expect(code).toContain("new OffscreenCanvas(canvasWidth, canvasHeight)");
    expect(code).toContain("ctx.getImageData(0, 0, canvasWidth, canvasHeight)");
    expect(code).toContain("devicePixelRatio: 1");
    expect(code).not.toContain("method: 'Fallback'");
  });

  it("fixes WebGL resolution while exposing its still-adaptive measurement method", async () => {
    const code = await source("../../js/benchmarks/gpu.js");
    expect(code).toContain("const renderWidth = 640");
    expect(code).toContain("const renderHeight = 480");
    expect(code).toContain('"webgl-adaptive-shadow-v1"');
    expect(code).toContain('"webgl-adaptive-no-shadow-v1"');
    expect(code).toContain('measurement: "adaptive-vsync-capacity-proxy"');
    expect(code).toContain("for (let i = 0; i < p1Max; i++)");
  });
});
