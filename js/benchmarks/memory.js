const ramWorkerCode =
  `
  self.onmessage = function(event) {
    if (event.data.type === "prepare") {
      for (let batch = 0; batch < 8; batch++) {
        const warmup = Array.from({ length: 128 }, (_, id) => ({ id, payload: "warmup".repeat(8) }));
        warmup.length;
      }
      self.postMessage({ type: "ready" });
      return;
    }
    if (event.data.type !== "start") return;
    setTimeout(() => {
      const started = performance.now();
      let allocatedObjects = 0;
      let checksum = 0;
      while (performance.now() - started < event.data.duration) {
        const batch = Array.from({ length: 256 }, (_, index) => ({
          id: (allocatedObjects + index) >>> 0,
          payload: ` +
  "`record-${allocatedObjects + index}-allocation-workload`" +
  `,
        }));
        for (const record of batch) {
          checksum = (checksum + record.id + record.payload.length) >>> 0;
        }
        allocatedObjects += batch.length;
      }
      self.postMessage({ allocatedObjects, checksum, elapsedMs: performance.now() - started, batchSize: 256 });
    }, Math.max(0, event.data.startAt - performance.now()));
  };
`;

async function runRAMTest(duration, runId, scope = activeBenchmarkScope) {
  setStatus("ram", t("status_running_ram"), "running");
  const blob = new Blob([ramWorkerCode], { type: "application/javascript" });
  const workerUrl = URL.createObjectURL(blob);
  registerRunCleanup(() => URL.revokeObjectURL(workerUrl), scope);

  return new Promise((resolve, reject) => {
    const worker = createTrackedWorker(workerUrl, scope);
    worker.onmessage = (event) => {
      if (event.data.type === "ready") {
        worker.postMessage({
          type: "start",
          duration,
          startAt: performance.now() + 50,
        });
        return;
      }
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
      if (isCancelledRun(runId)) return reject(new Error(t("error_cancelled")));
      const throughput = Math.round(
        event.data.allocatedObjects / (event.data.elapsedMs / 1000),
      );
      setStatus("ram", `${throughput} objects/s`, "done");
      document.getElementById("res-ram").innerHTML =
        `${throughput} <span class="text-xs font-normal text-slate-500">objects/s</span>`;
      resolve({
        value: throughput,
        method: "js-object-allocation-v1",
        samples: [throughput],
        durationMs: event.data.elapsedMs,
        details: {
          workloadVersion: "bounded-object-allocation-v1",
          allocatedObjects: event.data.allocatedObjects,
          batchSize: event.data.batchSize,
          checksum: event.data.checksum,
        },
      });
    };
    worker.onerror = (err) => {
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
      reject(err);
    };
    worker.postMessage({ type: "prepare" });
  });
}

// Canvas 2D 繪圖測試 — OffscreenCanvas Worker (不受 rAF 60fps 天花板限制)
