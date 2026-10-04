async function runWithSampling(
  name,
  testFn,
  iterations,
  durationPerIter,
  runId,
  isNetwork = false,
  scope = activeBenchmarkScope,
) {
  const samplingStartedAt = performance.now();
  let results = [];
  let fullResults = [];
  for (let i = 0; i < iterations; i++) {
    scope?.throwIfAborted();
    if (isCancelledRun(runId)) throw new Error(t("error_cancelled"));
    let res = await testFn(durationPerIter, runId, scope);
    let val =
      res && typeof res === "object"
        ? Number.isFinite(res.value)
          ? res.value
          : Number.isFinite(res.score)
            ? res.score
            : res
        : res;
    results.push(val);
    fullResults.push(res);
    if (iterations > 1 && i < iterations - 1) {
      await new Promise((r) => setTimeout(r, 100)); // Let CPU breathe
    }
  }

  let finalVal;
  if (iterations === 1) finalVal = results[0];
  else {
    results.sort((a, b) => a - b);
    if (isNetwork) {
      let sum = results.reduce((a, b) => a + b, 0);
      finalVal = sum / iterations;
    } else {
      finalVal = results[Math.floor(iterations / 2)]; // Median
    }
  }

  // UI Update for median
  let unit = "";
  let formattedVal = finalVal;
  if (name === "cpu") {
    unit = "M/s";
    formattedVal = Number(finalVal).toFixed(2);
  }
  if (name === "string") {
    unit = "MiB/s";
    formattedVal = Number(finalVal).toFixed(2);
  }
  if (name === "ram") {
    unit = "objects/s";
    formattedVal = Math.round(finalVal);
  }
  if (name === "dom") {
    unit = "ops/s";
    formattedVal = Math.round(finalVal);
  }
  if (name === "canvas2d") {
    unit = "draw calls/s";
    formattedVal = Math.round(finalVal);
  }
  if (name === "network") {
    // Network returns an object with dl, ul, ping
    // 如果有多個結果，計算中位數
    let resObj = fullResults[0];

    if (iterations > 1) {
      const dls = fullResults.map((r) => r && r.dl).filter((v) => v > 0);
      const uls = fullResults.map((r) => r && r.ul).filter((v) => v > 0);
      const pings = fullResults.map((r) => r && r.ping).filter((v) => v > 0);

      if (dls.length > 0) dls.sort((a, b) => a - b);
      if (uls.length > 0) uls.sort((a, b) => a - b);
      if (pings.length > 0) pings.sort((a, b) => a - b);

      resObj = {
        dl:
          dls.length > 0 ? dls[Math.floor(dls.length / 2)] : fullResults[0].dl,
        ul:
          uls.length > 0 ? uls[Math.floor(uls.length / 2)] : fullResults[0].ul,
        ping:
          pings.length > 0
            ? pings[Math.floor(pings.length / 2)]
            : fullResults[0].ping,
        value:
          dls.length > 0
            ? dls[Math.floor(dls.length / 2)]
            : fullResults[0] && fullResults[0].value,
      };
    }

    if (
      resObj &&
      typeof resObj === "object" &&
      resObj.dl !== null &&
      resObj.dl > 0
    ) {
      const dlStr = resObj.dl != null ? resObj.dl : "N/A";
      const ulStr = resObj.ul != null ? resObj.ul : "N/A";
      const pingStr = resObj.ping != null ? `${resObj.ping} ms` : "N/A";
      setStatus("network", `D: ${dlStr} | U: ${ulStr}`, "done");
      document.getElementById("res-network").innerHTML = `
                        <div class="flex flex-col">
                            <span class="text-lg">${dlStr} <span class="text-[10px] text-slate-500">DL</span> / ${ulStr} <span class="text-[10px] text-slate-500">UL</span></span>
                            <span class="text-xs text-slate-500 mt-1">Ping: ${pingStr}</span>
                        </div>
                    `;
      return {
        value: resObj.value ?? resObj.dl,
        samples: results,
        durationMs: performance.now() - samplingStartedAt,
        details: resObj,
      };
    } else {
      // Connection failed or returned zero — show N/A, don't affect score
      setStatus("network", t("error_network_failed"), "error");
      document.getElementById("res-network").innerHTML =
        `<span class="text-red-400">N/A</span>`;
      throw new BenchmarkError(
        "error",
        resObj?.error || t("error_network_failed"),
      );
    }
  }

  if (
    name !== "gpu" &&
    name !== "storage" &&
    name !== "crypto" &&
    name !== "network"
  ) {
    setStatus(name, `${formattedVal} ${unit}`, "done");
    document.getElementById(`res-${name}`).innerHTML =
      `${formattedVal} <span class="text-xs font-normal text-slate-500">${unit}</span>`;
  } else if (name === "gpu") {
    setStatus("gpu", `${Math.floor(finalVal)} Pts`, "done");
    document.getElementById("res-gpu").innerHTML =
      `${Math.floor(finalVal)} <span class="text-xs font-normal text-slate-500">Pts</span>`;
  } else if (name === "storage") {
    setStatus("storage", `${finalVal} MB/s`, "done");
    document.getElementById("res-storage").innerHTML =
      `${finalVal} <span class="text-xs font-normal text-slate-500">MB/s</span>`;
  } else if (name === "crypto") {
    setStatus("crypto", `${finalVal} MB/s`, "done");
    let resEl = document.getElementById("res-crypto");
    if (finalVal > 10000) {
      resEl.innerHTML = `${finalVal} <span class="text-xs font-normal text-primary/60">MB/s</span>`;
      resEl.classList.replace("text-primary", "text-yellow-400");
      document.getElementById("cryptoWarning").classList.remove("hidden");
    } else {
      resEl.innerHTML = `${finalVal} <span class="text-xs font-normal text-primary/60">MB/s</span>`;
    }
  }

  const firstObject = fullResults.find(
    (sample) => sample && typeof sample === "object",
  );
  return {
    value: finalVal,
    samples: results,
    durationMs: performance.now() - samplingStartedAt,
    method: firstObject?.method ?? null,
    details: {
      ...(firstObject?.details ?? {}),
      ...(firstObject?.warning ? { warning: firstObject.warning } : {}),
    },
  };
}

function calculateReliability(results, isCancelled, errorOccurred) {
  let score = t("rel_high");
  let reason = t("rel_reason_high");
  let colorClass = "bg-primary";

  if (isCancelled) {
    return {
      score: t("rel_none"),
      reason: t("rel_reason_cancelled"),
      colorClass: "bg-slate-600",
    };
  }

  if (errorOccurred) {
    const required = [
      "cpu",
      "string",
      "crypto",
      "memory",
      "storage",
      "dom",
      "gpu",
      "canvas2d",
    ];
    if (required.some((id) => getBenchmarkValue(results[id]) === null)) {
      score = t("rel_low");
      reason = t("rel_reason_core_err");
      colorClass = "bg-red-500";
    } else {
      score = t("rel_med");
      reason = t("rel_reason_sub_err");
      colorClass = "bg-yellow-500";
    }
  } else if (
    results.crypto &&
    typeof results.crypto === "object" &&
    results.crypto.warning
  ) {
    score = t("rel_med");
    reason = t("rel_reason_crypto_warn");
    colorClass = "bg-yellow-500";
  }

  return { score, reason, colorClass };
}

function calculateFinalScore(results) {
  const required = [
    "cpu",
    "string",
    "crypto",
    "memory",
    "storage",
    "dom",
    "gpu",
    "canvas2d",
  ];
  const values = Object.fromEntries(
    required.map((id) => [id, getBenchmarkValue(results[id])]),
  );
  const valCrypto = values.crypto;
  const valGPU = values.gpu;
  const valStorage = values.storage;

  // 8 項獨立正規化
  const normCPU =
    values.cpu === null
      ? null
      : normalize(values.cpu, LEGACY_BENCHMARK_BASELINE.cpu);
  const normString =
    values.string === null
      ? null
      : normalize(values.string, LEGACY_BENCHMARK_BASELINE.string);
  const normMemory =
    values.memory === null
      ? null
      : normalize(values.memory, LEGACY_BENCHMARK_BASELINE.memory); // Fixed RAM key to memory
  const normDOM =
    values.dom === null
      ? null
      : normalize(values.dom, LEGACY_BENCHMARK_BASELINE.dom);
  const normCanvas2D =
    values.canvas2d === null
      ? null
      : normalize(values.canvas2d, LEGACY_BENCHMARK_BASELINE.canvas2d);
  const normGPU =
    valGPU === null ? null : normalize(valGPU, LEGACY_BENCHMARK_BASELINE.gpu);
  const normCrypto =
    valCrypto === null
      ? null
      : normalize(valCrypto, LEGACY_BENCHMARK_BASELINE.crypto);
  const normStorage =
    valStorage === null
      ? null
      : normalize(valStorage, LEGACY_BENCHMARK_BASELINE.storage);
  if (radarChart) {
    // 8 axes (Network excluded from radar — shown separately as info)
    radarChart.data.datasets[0].data = [
      normCPU,
      normString,
      normCrypto,
      normMemory,
      normStorage,
      normDOM,
      normGPU,
      normCanvas2D,
    ];
    radarChart.update();
  }

  if (required.some((id) => values[id] === null)) return null;

  // 7 項硬體加權計分 (Network 不計分)
  return Math.round(
    normCPU * 0.25 +
      normGPU * 0.2 +
      normCanvas2D * 0.1 +
      normDOM * 0.1 +
      normStorage * 0.1 +
      normMemory * 0.1 +
      normString * 0.1 +
      normCrypto * 0.05,
  );
}

function localizeScoreDiagnostics(diagnostics) {
  const fitness = Object.fromEntries(
    Object.entries(diagnostics.fitness).map(([key, translationKey]) => [
      key,
      t(translationKey),
    ]),
  );
  const metricNames = {
    cpu: "cpu_calc",
    gpu: "gpu_webgl",
    dom: "dom_layout",
    memory: "ram_gc",
    storage: "storage_io",
  };
  const adviceKeys = {
    cpu: ["advice_mobile_cpu", "advice_diy_cpu"],
    gpu: ["advice_mobile_gpu", "advice_diy_gpu"],
    dom: ["advice_dom_mobile", "advice_dom_pc"],
    memory: ["advice_mobile_ram", "advice_diy_ram"],
    storage: ["advice_mobile_storage", "advice_diy_storage"],
  };
  const mobile =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent,
    );
  const weakestLink = diagnostics.weakestLink;
  return {
    fitness,
    weakestLink: weakestLink
      ? {
          norm: weakestLink.score,
          name: t(metricNames[weakestLink.metricId]),
          advice: t(adviceKeys[weakestLink.metricId][mobile ? 0 : 1]),
        }
      : null,
  };
}
