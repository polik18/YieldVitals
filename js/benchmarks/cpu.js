function computeCpuKernel(seed, rounds = 1024) {
  let value = seed >>> 0;
  let checksum = 0;
  for (let index = 0; index < rounds; index++) {
    value = (Math.imul(value ^ (value >>> 15), 1 | value) + 0x6d2b79f5) >>> 0;
    checksum = (checksum + (value ^ (value >>> 16))) >>> 0;
  }
  return checksum;
}

const cpuWorkerCode = `
  ${computeCpuKernel.toString()}
  self.onmessage = function(event) {
    if (event.data.type === "prepare") {
      for (let index = 0; index < 32; index++) computeCpuKernel(index + 1);
      self.postMessage({ type: "ready" });
      return;
    }
    if (event.data.type !== "start") return;
    const startAt = event.data.startAt;
    setTimeout(() => {
      const started = performance.now();
      let operations = 0;
      let checksum = 0;
      while (performance.now() - started < event.data.duration) {
        checksum ^= computeCpuKernel((event.data.seed + operations) >>> 0);
        operations += 1024;
      }
      self.postMessage({ operations, checksum, elapsedMs: performance.now() - started });
    }, Math.max(0, startAt - performance.now()));
  };
`;

async function runCPUMultiCore(duration, runId, scope = activeBenchmarkScope) {
  setStatus("cpu", t("status_running_cpu"), "running");
  const blob = new Blob([cpuWorkerCode], { type: "application/javascript" });
  const workerUrl = URL.createObjectURL(blob);
  registerRunCleanup(() => URL.revokeObjectURL(workerUrl), scope);
  const workerCount = Math.max(1, Math.min(cores, 8));
  const allWorkers = Array.from({ length: workerCount }, () =>
    createTrackedWorker(workerUrl, scope),
  );
  const samplingStartedAt = performance.now();
  try {
    await Promise.all(
      allWorkers.map(
        (worker) =>
          new Promise((resolve, reject) => {
            worker.onmessage = (event) => {
              if (event.data.type === "ready") resolve();
            };
            worker.onerror = reject;
            worker.postMessage({ type: "prepare" });
          }),
      ),
    );
    const sharedStartAt = performance.now() + 50;
    const samples = await Promise.all(
      allWorkers.map(
        (worker, index) =>
          new Promise((resolve, reject) => {
            worker.onmessage = (event) => resolve(event.data);
            worker.onerror = reject;
            worker.postMessage({
              type: "start",
              duration,
              startAt: sharedStartAt,
              seed: 0x51f15e + index * 0x9e3779b9,
            });
          }),
      ),
    );
    const actualElapsedMs = performance.now() - sharedStartAt;
    const operations = samples.reduce(
      (total, sample) => total + sample.operations,
      0,
    );
    const throughput = Number(
      (operations / (actualElapsedMs / 1000) / 1e6).toFixed(2),
    );
    const checksum =
      samples.reduce((total, sample) => total ^ sample.checksum, 0) >>> 0;
    allWorkers.forEach((worker) => worker.terminate());
    URL.revokeObjectURL(workerUrl);
    if (isCancelledRun(runId)) throw new Error(t("error_cancelled"));
    setStatus("cpu", `${throughput} M/s`, "done");
    document.getElementById("res-cpu").innerHTML =
      `${throughput} <span class="text-xs font-normal text-slate-500">M/s</span>`;
    return {
      value: throughput,
      method: "cpu-deterministic-int32-v1",
      samples: [throughput],
      durationMs: performance.now() - samplingStartedAt,
      details: {
        workloadVersion: "cpu-int32-hash-v1",
        workerCount,
        checksum,
        workerElapsedMs: samples.map((sample) => sample.elapsedMs),
      },
    };
  } catch (error) {
    allWorkers.forEach((worker) => worker.terminate());
    URL.revokeObjectURL(workerUrl);
    throw error;
  }
}

// 2. 字串解析測試 (升級為 Worker)
