const stringWorkerCode =
  `
  self.onmessage = function(event) {
    if (event.data.type === "prepare") {
      const records = Array.from({ length: 256 }, (_, id) => ({
        id,
        name: ` +
  "`record-${String(id).padStart(4, '0')}`" +
  `,
        value: id * 17 + 3,
      }));
      const payload = JSON.stringify({ fixtureVersion: "json-regex-fixture-v1", records });
      const byteLength = new TextEncoder().encode(payload).byteLength;
      JSON.parse(payload);
      const expectedFieldsPerDocument = payload.match(/"(?:id|name|value)":/g).length;
      self.postMessage({ type: "ready", payload, byteLength, recordCount: records.length, expectedFieldsPerDocument });
      return;
    }
    if (event.data.type !== "start") return;
    const { payload, byteLength, recordCount, expectedFieldsPerDocument } = event.data;
    const parseStarted = performance.now();
    let documents = 0;
    let parseChecksum = 0;
    while (performance.now() - parseStarted < event.data.duration) {
      const parsed = JSON.parse(payload);
      parseChecksum = (parseChecksum + parsed.records[0].id + parsed.records.at(-1).value) >>> 0;
      documents++;
    }
    const parseElapsedMs = performance.now() - parseStarted;
    const regex = /"(?:id|name|value)":/g;
    const regexStarted = performance.now();
    let matchedFields = 0;
    let regexChecksum = 0;
    let measuredFieldsPerDocument = 0;
    while (performance.now() - regexStarted < event.data.duration) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(payload)) !== null) {
        matchedFields++;
        regexChecksum = (regexChecksum + match[0].length) >>> 0;
      }
      if (measuredFieldsPerDocument === 0) measuredFieldsPerDocument = matchedFields;
    }
    const regexElapsedMs = performance.now() - regexStarted;
    self.postMessage({
      byteLength,
      recordCount,
      documents,
      parseElapsedMs,
      parseMiBPerSec: (documents * byteLength / (parseElapsedMs / 1000)) / (1024 * 1024),
      parseChecksum,
      fieldsPerSec: matchedFields / (regexElapsedMs / 1000),
      regexElapsedMs,
      regexChecksum,
      expectedFieldsPerDocument,
      measuredFieldsPerDocument,
    });
  };
`;

async function runStringTest(duration, runId, scope = activeBenchmarkScope) {
  setStatus("string", t("status_running_string"), "running");
  const blob = new Blob([stringWorkerCode], { type: "application/javascript" });
  const workerUrl = URL.createObjectURL(blob);
  registerRunCleanup(() => URL.revokeObjectURL(workerUrl), scope);

  return new Promise((resolve, reject) => {
    const worker = createTrackedWorker(workerUrl, scope);
    worker.onmessage = (event) => {
      if (event.data.type === "ready") {
        worker.postMessage({ ...event.data, type: "start", duration });
        return;
      }
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
      if (isCancelledRun(runId)) return reject(new Error(t("error_cancelled")));
      const result = event.data;
      if (
        result.expectedFieldsPerDocument !== 768 ||
        result.measuredFieldsPerDocument !== result.expectedFieldsPerDocument ||
        result.documents < 1
      )
        return reject(new Error("String benchmark fixture checksum mismatch"));
      const throughput = Number(result.parseMiBPerSec.toFixed(2));
      setStatus("string", `${throughput} MiB/s`, "done");
      document.getElementById("res-string").innerHTML =
        `${throughput} <span class="text-xs font-normal text-slate-500">MiB/s</span>`;
      resolve({
        value: throughput,
        method: "json-parse-regex-v1",
        samples: [throughput],
        durationMs: result.parseElapsedMs + result.regexElapsedMs,
        details: {
          workloadVersion: "json-regex-fixture-v1",
          payloadBytes: result.byteLength,
          documentCount: result.documents,
          documentsPerSecond: result.documents / (result.parseElapsedMs / 1000),
          regexFieldsPerSecond: result.fieldsPerSec,
          parseChecksum: result.parseChecksum,
          regexChecksum: result.regexChecksum,
          parseElapsedMs: result.parseElapsedMs,
          regexElapsedMs: result.regexElapsedMs,
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

// 3. RAM 記憶體 GC 測試 (升級為 Worker)
async function runDOMTest(duration, runId, scope = activeBenchmarkScope) {
  setStatus("dom", t("status_running_dom"), "running");
  const box = document.getElementById("domSandbox");
  const start = performance.now();
  let ops = 0;

  return new Promise((resolve, reject) => {
    function step() {
      if (isCancelledRun(runId)) {
        box.innerHTML = "";
        return reject(new Error(t("error_cancelled")));
      }
      // 每個 task slice 執行 4ms 的 DOM 重繪，再 yield 給瀏覽器
      const sliceEnd = performance.now() + 4;
      while (performance.now() < sliceEnd) {
        box.innerHTML = `<div style="padding:${ops % 10}px;margin:${ops % 5}px"><span>${ops}</span></div>`;
        box.offsetHeight; // Force synchronous reflow
        ops++;
      }

      if (performance.now() - start < duration) {
        scheduleRunTimeout(step, 0, scope); // Yield, then continue
      } else {
        box.innerHTML = "";
        const durationSec = (performance.now() - start) / 1000;
        const score = Math.round(ops / durationSec);
        setStatus("dom", `${score} ops/s`, "done");
        document.getElementById("res-dom").innerHTML =
          `${score} <span class="text-xs font-normal text-slate-500">ops/s</span>`;
        resolve(score);
      }
    }
    scheduleRunTimeout(step, 0, scope);
  });
}

// 5. Three.js GPU 動態壓力探測
