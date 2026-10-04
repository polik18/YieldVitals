import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:4173") return route.continue();
    if (
      url.hostname === "cdn.jsdelivr.net" &&
      url.pathname.includes("chart.js")
    ) {
      return route.fulfill({
        contentType: "application/javascript",
        body: "window.Chart = class { constructor(_ctx, config) { this.data = config.data; } update() {} destroy() {} };",
      });
    }
    if (
      url.hostname === "cdnjs.cloudflare.com" &&
      url.pathname.includes("three")
    ) {
      return route.fulfill({
        contentType: "application/javascript",
        body: "window.THREE = {};",
      });
    }
    if (url.hostname === "cdn.tailwindcss.com") {
      return route.fulfill({
        contentType: "application/javascript",
        body: 'document.head.insertAdjacentHTML("beforeend", "<style>.hidden{display:none}</style>");',
      });
    }
    return route.abort();
  });
});

async function configureQuickRun(page, failure = null) {
  await page.goto("/");
  await page.evaluate((failureMode) => {
    const productionGpuRunner = window.runThreeJSTest;
    MODE_SETTINGS.quick = {
      ...MODE_SETTINGS.quick,
      iterations: 1,
      cpuTime: 1,
      otherTime: 1,
      gpuTimeLimit: 1,
      ...(failureMode === "gpu-cancel" ? { gpuMax: 1 } : {}),
      ...(failureMode === "storage-timeout" ? { storageTimeoutMs: 80 } : {}),
    };
    window.__terminatedWorkers = 0;
    window.runCPUMultiCore = async () => ({
      value: 900,
      method: "cpu-deterministic-int32-v1",
    });
    window.runStringTest = async () => ({
      value: 20,
      method: "json-parse-regex-v1",
    });
    window.runRAMTest = async () => ({
      value: 700,
      method: "js-object-allocation-v1",
    });
    window.runDOMTest = async () => ({
      value: 1000,
      method: "dom-forced-layout-v1",
    });
    window.runCanvas2DTest = async () => ({
      value: 15000,
      method: "canvas2d-offscreen-draw-v2",
    });
    window.runThreeJSTest = async () => ({
      value: 750,
      method: "webgl-adaptive-shadow-v1",
    });
    window.runCryptoTest = async () => 3000;
    window.runStorageTest = async () => ({ value: 3000, method: "OPFS" });
    window.runNetworkTest = async () => ({
      value: 9000,
      dl: 9000,
      ul: 1000,
      ping: 10,
    });

    if (failureMode === "string-error") {
      window.runStringTest = async () => {
        throw new Error("injected string failure");
      };
    }
    if (failureMode === "gpu-unsupported") {
      window.runThreeJSTest = productionGpuRunner;
      window.supportsWebGL = () => false;
    }
    if (failureMode === "storage-timeout") {
      window.runStorageTest = async () => {
        activeBenchmarkScope.addCleanup(() => {
          window.__storageCleanup = (window.__storageCleanup || 0) + 1;
        });
        activeBenchmarkScope.trackWorker({
          terminate: () => window.__terminatedWorkers++,
        });
        return new Promise(() => {});
      };
    }
    if (failureMode === "cpu-pending") {
      window.runCPUMultiCore = async () => {
        activeBenchmarkScope.trackWorker({
          terminate: () => window.__terminatedWorkers++,
        });
        return new Promise(() => {});
      };
    }
    if (failureMode === "network-pending") {
      window.runNetworkTest = async () => {
        const controller = createTrackedAbortController();
        window.__networkSignal = controller.signal;
        return new Promise((resolve, reject) => {
          controller.signal.addEventListener(
            "abort",
            () => {
              window.__networkAborted = controller.signal.aborted;
              reject(new DOMException("aborted", "AbortError"));
            },
            { once: true },
          );
        });
      };
    }
    if (failureMode === "gpu-cancel") {
      window.runThreeJSTest = productionGpuRunner;
      window.supportsWebGL = () => true;
      const vector = () => ({ x: 0, y: 0, z: 0, set() {}, setScalar() {} });
      class Scene {
        constructor() {
          this.children = [];
        }
        add(object) {
          this.children.push(object);
        }
        remove(object) {
          this.children = this.children.filter((item) => item !== object);
        }
      }
      class Disposable {
        dispose() {}
      }
      class Light extends Disposable {
        constructor() {
          super();
          this.position = vector();
          this.shadow = { mapSize: {} };
        }
      }
      class InstancedMesh extends Disposable {
        constructor() {
          super();
          this.rotation = vector();
        }
        setMatrixAt() {}
      }
      class DummyObject {
        constructor() {
          this.position = vector();
          this.rotation = vector();
          this.scale = vector();
          this.matrix = {};
        }
        updateMatrix() {}
      }
      class Camera {
        constructor() {
          this.position = vector();
        }
        lookAt() {}
      }
      class Renderer {
        constructor() {
          this.domElement = document.createElement("canvas");
          this.shadowMap = {};
          window.__rendererNode = this.domElement;
        }
        setSize() {}
        setPixelRatio() {}
        render() {
          window.__gpuFrameCount = (window.__gpuFrameCount || 0) + 1;
        }
        dispose() {
          window.__rendererDisposed = (window.__rendererDisposed || 0) + 1;
        }
      }
      class Mesh extends Disposable {
        constructor() {
          super();
          this.rotation = vector();
          this.position = vector();
        }
      }
      class Color {
        setHSL() {}
      }
      window.THREE = {
        WebGLRenderer: Renderer,
        PerspectiveCamera: Camera,
        Scene,
        FogExp2: class {},
        AmbientLight: Light,
        DirectionalLight: Light,
        PointLight: Light,
        IcosahedronGeometry: Disposable,
        MeshPhongMaterial: Disposable,
        InstancedMesh,
        Object3D: DummyObject,
        ShaderMaterial: Disposable,
        PlaneGeometry: Disposable,
        MeshStandardMaterial: Disposable,
        TorusKnotGeometry: Disposable,
        Mesh,
        Vector2: class {},
        Color,
        PCFSoftShadowMap: 1,
      };
    }
  }, failure);
}

test("page loads with all external dependencies intercepted", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#startBtn")).toBeVisible();
  expect(await page.evaluate(() => Boolean(window.Chart && window.THREE))).toBe(
    true,
  );
});

test("real CPU, string, and bounded-allocation workers report auditable samples", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    MODE_SETTINGS.quick = {
      ...MODE_SETTINGS.quick,
      iterations: 3,
      cpuTime: 20,
      otherTime: 20,
      gpuTimeLimit: 20,
    };
    window.runRAMTest = async () => ({
      value: 700,
      method: "js-object-allocation-v1",
    });
    window.runDOMTest = async () => ({
      value: 1000,
      method: "dom-forced-layout-v1",
    });
    window.runCanvas2DTest = async () => ({
      value: 15000,
      method: "canvas2d-offscreen-draw-v2",
    });
    window.runThreeJSTest = async () => ({
      value: 750,
      method: "webgl-adaptive-shadow-v1",
    });
    window.runCryptoTest = async () => 3000;
    window.runStorageTest = async () => ({ value: 3000, method: "OPFS" });
    window.runNetworkTest = async () => ({ value: 10, dl: 10, ul: 5, ping: 1 });
  });
  await page.locator("#startBtn").click();
  await expect(page.locator("#exportJsonBtn")).not.toHaveClass(/hidden/, {
    timeout: 15000,
  });
  const results = await page.evaluate(() => lastJsonExport.results);
  expect(results.cpu).toMatchObject({
    status: "ok",
    method: "cpu-deterministic-int32-v1",
    workloadVersion: "cpu-int32-hash-v1",
    statistics: { sampleCount: 3 },
  });
  expect(results.cpu.checksum).toEqual(expect.any(Number));
  expect(results.cpu.samples).toHaveLength(3);
  expect(results.string).toMatchObject({
    status: "ok",
    method: "json-parse-regex-v1",
    workloadVersion: "json-regex-fixture-v1",
    statistics: { sampleCount: 3 },
  });
  expect(results.string.payloadBytes).toBeGreaterThan(0);
  expect(results.string.regexFieldsPerSecond).toBeGreaterThan(0);
});

test("real bounded-allocation worker reports its batch limit and sample statistics", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    MODE_SETTINGS.quick = {
      ...MODE_SETTINGS.quick,
      iterations: 3,
      cpuTime: 5,
      otherTime: 10,
      gpuTimeLimit: 5,
      memoryTimeoutMs: 15000,
    };
    window.runCPUMultiCore = async () => ({
      value: 900,
      method: "cpu-deterministic-int32-v1",
    });
    window.runStringTest = async () => ({
      value: 20,
      method: "json-parse-regex-v1",
    });
    window.runDOMTest = async () => ({
      value: 1000,
      method: "dom-forced-layout-v1",
    });
    window.runCanvas2DTest = async () => ({
      value: 15000,
      method: "canvas2d-offscreen-draw-v2",
    });
    window.runThreeJSTest = async () => ({
      value: 750,
      method: "webgl-adaptive-shadow-v1",
    });
    window.runCryptoTest = async () => 3000;
    window.runStorageTest = async () => ({ value: 3000, method: "OPFS" });
    window.runNetworkTest = async () => ({ value: 10, dl: 10, ul: 5, ping: 1 });
  });
  await page.locator("#startBtn").click();
  await expect(page.locator("#exportJsonBtn")).not.toHaveClass(/hidden/, {
    timeout: 15000,
  });
  const result = await page.evaluate(() => lastJsonExport.results.memory);
  expect(result).toMatchObject({
    status: "ok",
    method: "js-object-allocation-v1",
    workloadVersion: "bounded-object-allocation-v1",
    statistics: { sampleCount: 3 },
  });
  expect(result.batchSize).toBe(256);
  expect(result.allocatedObjects).toBeGreaterThan(0);
});

test("quick mode runs to completion and reveals JSON export", async ({
  page,
}) => {
  await configureQuickRun(page);
  await page.locator("#startBtn").click();
  await expect(page.locator("#exportJsonBtn")).not.toHaveClass(/hidden/, {
    timeout: 15000,
  });
  const report = await page.evaluate(() => lastJsonExport);
  expect(report).toMatchObject({
    scoreVersion: "2.0.0-beta.3",
    baselineId: "yieldvitals-v2-provisional-p03-dom-canvas-2026-10",
    calibrated: false,
  });
  expect(report.results.cpu.metadata.baselineId).toBe(report.baselineId);
  expect(report.results.cpu.statistics.sampleCount).toBe(3);
  expect(report.results.cpu.samples).toHaveLength(3);
  expect(report.axisScores).toHaveProperty("canvas2d");
  expect(report.rejectedMetrics).toEqual([]);
});

test("one benchmark failure is isolated and later benchmarks still run", async ({
  page,
}) => {
  await configureQuickRun(page, "string-error");
  await page.locator("#startBtn").click();
  await expect(page.locator("#exportJsonBtn")).not.toHaveClass(/hidden/);
  await expect(page.locator("#res-string")).toContainText("N/A");
  await expect(page.locator("#res-ram")).toContainText("700");
  await expect(page.locator("#res-network")).toContainText("9000");
  const results = await page.evaluate(() => lastJsonExport.results);
  expect(results.string).toMatchObject({ status: "error", value: null });
  expect(results.memory).toMatchObject({ status: "ok", value: 700 });
});

test("unsupported GPU is N/A and prevents a misleading overall score", async ({
  page,
}) => {
  await configureQuickRun(page, "gpu-unsupported");
  await page.locator("#startBtn").click();
  await expect(page.locator("#exportJsonBtn")).not.toHaveClass(/hidden/);
  await expect(page.locator("#res-gpu")).toContainText("N/A");
  const report = await page.evaluate(() => lastJsonExport);
  expect(report.results.gpu).toMatchObject({
    status: "unsupported",
    value: null,
  });
  expect(report.score).toBeNull();
});

test("timed-out storage is cleaned up and network still executes", async ({
  page,
}) => {
  await configureQuickRun(page, "storage-timeout");
  await page.locator("#startBtn").click();
  await expect(page.locator("#exportJsonBtn")).not.toHaveClass(/hidden/);
  await expect(page.locator("#res-storage")).toContainText("N/A");
  await expect(page.locator("#res-network")).toContainText("9000");
  expect(await page.evaluate(() => window.__terminatedWorkers)).toBe(1);
  expect(await page.evaluate(() => window.__storageCleanup)).toBe(1);
  const results = await page.evaluate(() => lastJsonExport.results);
  expect(results.storage).toMatchObject({ status: "timeout", value: null });
  expect(results.network).toMatchObject({ status: "ok", value: 9000 });
});

test("cancelling terminates active resources and permits an immediate clean run", async ({
  page,
}) => {
  await configureQuickRun(page, "cpu-pending");
  await page.locator("#startBtn").click();
  await expect(page.locator("#cancelBtn")).not.toHaveClass(/hidden/);
  await page.locator("#cancelBtn").click();
  await expect(page.locator("#startBtn")).toBeEnabled();
  expect(await page.evaluate(() => window.__terminatedWorkers)).toBe(1);
  await page.evaluate(() => {
    window.runCPUMultiCore = async () => 900;
  });
  await page.locator("#startBtn").click();
  await expect(page.locator("#exportJsonBtn")).not.toHaveClass(/hidden/);
  const results = await page.evaluate(() => lastJsonExport.results);
  expect(results.cpu).toMatchObject({ status: "ok", value: 900 });
});

test("cancelling network aborts its active request controller", async ({
  page,
}) => {
  await configureQuickRun(page, "network-pending");
  await page.locator("#startBtn").click();
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__networkSignal)))
    .toBe(true);
  const started = Date.now();
  await page.locator("#cancelBtn").click();
  await expect(page.locator("#startBtn")).toBeEnabled();
  expect(await page.evaluate(() => window.__networkAborted)).toBe(true);
  expect(Date.now() - started).toBeLessThan(250);
});

test("cancelling GPU work disposes its renderer and removes its canvas", async ({
  page,
}) => {
  await configureQuickRun(page, "gpu-cancel");
  await page.locator("#startBtn").click();
  await expect
    .poll(() => page.evaluate(() => (window.__gpuFrameCount || 0) > 0))
    .toBe(true);
  await page.locator("#cancelBtn").click();
  expect(await page.evaluate(() => window.__rendererDisposed)).toBe(1);
  expect(await page.evaluate(() => window.__rendererNode?.isConnected)).toBe(
    false,
  );
  await expect(page.locator("#threeContainer")).toHaveClass(/hidden/);
});
