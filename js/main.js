function getBenchmarkDefinitions(config, runId) {
  const iterations = Math.max(3, config.iterations || 1);
  return [
    {
      id: "cpu",
      unit: "M/s",
      timeout: config.cpuTime * iterations + 10000,
      run: (scope) =>
        runWithSampling(
          "cpu",
          runCPUMultiCore,
          iterations,
          config.cpuTime,
          runId,
          false,
          scope,
        ),
    },
    {
      id: "string",
      unit: "MiB/s",
      timeout: config.otherTime * iterations * 2 + 5000,
      run: (scope) =>
        runWithSampling(
          "string",
          runStringTest,
          iterations,
          config.otherTime,
          runId,
          false,
          scope,
        ),
    },
    {
      id: "memory",
      uiId: "ram",
      unit: "objects/s",
      timeout: config.memoryTimeoutMs ?? config.otherTime * iterations + 5000,
      run: (scope) =>
        runWithSampling(
          "ram",
          runRAMTest,
          iterations,
          config.otherTime,
          runId,
          false,
          scope,
        ),
    },
    {
      id: "dom",
      unit: "ops/s",
      timeout: config.otherTime * iterations + 5000,
      run: (scope) =>
        runWithSampling(
          "dom",
          runDOMTest,
          iterations,
          config.otherTime,
          runId,
          false,
          scope,
        ),
    },
    {
      id: "canvas2d",
      unit: "draw calls/s",
      timeout: config.otherTime * iterations + 5000,
      run: (scope) =>
        runWithSampling(
          "canvas2d",
          runCanvas2DTest,
          iterations,
          config.otherTime,
          runId,
          false,
          scope,
        ),
    },
    {
      id: "gpu",
      unit: "Pts",
      timeout: config.gpuTimeLimit + 5000,
      run: (scope) =>
        runWithSampling("gpu", runThreeJSTest, 1, config, runId, false, scope),
    },
    {
      id: "crypto",
      unit: "MB/s",
      timeout: config.otherTime * iterations + 5000,
      run: (scope) =>
        runWithSampling(
          "crypto",
          runCryptoTest,
          iterations,
          config.otherTime,
          runId,
          false,
          scope,
        ),
    },
    {
      id: "storage",
      unit: "MB/s",
      timeout: config.storageTimeoutMs ?? config.otherTime + 10000,
      run: (scope) =>
        runWithSampling(
          "storage",
          runStorageTest,
          1,
          config.otherTime,
          runId,
          false,
          scope,
        ),
    },
    {
      id: "network",
      unit: "Mbps",
      timeout: config.networkTimeoutMs ?? 60000,
      run: (scope) =>
        runWithSampling("network", runNetworkTest, 3, 0, runId, true, scope),
    },
  ];
}

function updateBenchmarkResult(definition, result) {
  const uiId = definition.uiId || definition.id;
  const valueEl = document.getElementById(`res-${uiId}`);
  if (result.status === "ok") {
    const shown =
      definition.id === "gpu" ? Math.floor(result.value) : result.value;
    setStatus(uiId, `${shown} ${definition.unit}`, "done");
    valueEl.textContent = `${shown} ${definition.unit}`;
    if (definition.id === "network" && result.dl != null) {
      valueEl.textContent = `D: ${result.dl} | U: ${result.ul ?? "N/A"} Mbps`;
    }
  } else {
    const label = benchmarkStatusLabel(result.status);
    setStatus(uiId, `N/A · ${label}`, "error");
    valueEl.textContent = `N/A · ${label}`;
  }
}

async function runOneBenchmark(definition, runContext, runId, baselineId) {
  if (runContext.signal.aborted) {
    return createBenchmarkResult(definition.id, "skipped", {
      error: "Run cancelled before benchmark started",
    });
  }
  const scope = runContext.begin(definition.id);
  const startedAt = performance.now();
  activeBenchmarkScope = scope;
  activeBenchmarkId = definition.id;
  try {
    const raw = await withTimeout(
      definition.run(scope),
      definition.timeout,
      definition.id,
      scope,
    );
    scope.throwIfAborted();
    const measurement = getBenchmarkResultValue(raw);
    if (!Number.isFinite(measurement.value))
      throw new Error(`No valid numeric value returned by ${definition.id}`);
    const sampleValues = measurement.samples ?? [measurement.value];
    const sortedSamples = [...sampleValues]
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const median = sortedSamples.length
      ? sortedSamples[Math.floor(sortedSamples.length / 2)]
      : null;
    const deviations =
      median === null
        ? []
        : sortedSamples
            .map((sample) => Math.abs(sample - median))
            .sort((a, b) => a - b);
    const mad = deviations.length
      ? deviations[Math.floor(deviations.length / 2)]
      : null;
    const mean = sortedSamples.length
      ? sortedSamples.reduce((sum, sample) => sum + sample, 0) /
        sortedSamples.length
      : null;
    const standardDeviation =
      mean === null
        ? null
        : Math.sqrt(
            sortedSamples.reduce(
              (sum, sample) => sum + (sample - mean) ** 2,
              0,
            ) / sortedSamples.length,
          );
    const statistics = {
      sampleCount: sortedSamples.length,
      median,
      mad,
      cvPercent: mean ? (standardDeviation / mean) * 100 : null,
    };
    const result = createBenchmarkResult(definition.id, "ok", {
      value: measurement.value,
      unit: definition.unit,
      method: measurement.method ?? null,
      samples: sampleValues,
      durationMs: measurement.durationMs ?? performance.now() - startedAt,
      details: { ...measurement.details, statistics },
      metadata: { runId, baselineId },
    });
    validateBenchmarkResult(result);
    if (!isCancelledRun(runId)) updateBenchmarkResult(definition, result);
    return result;
  } catch (error) {
    let status = error?.status;
    if (
      !["unsupported", "error", "cancelled", "timeout", "skipped"].includes(
        status,
      )
    ) {
      status = scope.timedOut
        ? "timeout"
        : runContext.signal.aborted || error?.name === "AbortError"
          ? "cancelled"
          : "error";
    }
    const result = createBenchmarkResult(definition.id, status, {
      error: error?.message || String(error),
      durationMs: performance.now() - startedAt,
      metadata: { runId, baselineId },
    });
    if (!isCancelledRun(runId)) updateBenchmarkResult(definition, result);
    return result;
  } finally {
    await scope.close();
    if (activeBenchmarkScope === scope) {
      activeBenchmarkScope = null;
      activeBenchmarkId = null;
    }
  }
}

function cancelCurrentRun() {
  if (!activeRunContext) return;
  const cancelledId = activeBenchmarkId;
  activeRunContext.cancel(t("error_cancelled"));
  currentRunId++;
  if (cancelledId) {
    const uiId = cancelledId === "memory" ? "ram" : cancelledId;
    const label = benchmarkStatusLabel("cancelled");
    setStatus(uiId, `N/A · ${label}`, "error");
    document.getElementById(`res-${uiId}`).textContent = `N/A · ${label}`;
  }
  activeRunContext = null;
  activeBenchmarkScope = null;
  activeBenchmarkId = null;
  setButtonLoading(false);
}
window.cancelCurrentRun = cancelCurrentRun;

initChart();

// 複製報告按鈕綁定
document.getElementById("copyReportBtn").addEventListener("click", async () => {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(reportText);
      showToast(t("toast_copy_success"));
    } catch (err) {
      showToast(t("toast_copy_fail"));
    }
  } else {
    const textArea = document.createElement("textarea");
    textArea.value = reportText;
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand("copy");
      showToast(t("toast_copy_success"));
    } catch (err) {
      showToast(t("toast_copy_fail"));
    }
    document.body.removeChild(textArea);
  }
});

let lastJsonExport = null;
document.getElementById("exportJsonBtn").addEventListener("click", () => {
  if (!lastJsonExport) return;
  const dataStr =
    "data:text/json;charset=utf-8," +
    encodeURIComponent(JSON.stringify(lastJsonExport, null, 2));
  const downloadAnchorNode = document.createElement("a");
  downloadAnchorNode.setAttribute("href", dataStr);
  downloadAnchorNode.setAttribute(
    "download",
    `YieldVitals_Report_${new Date().getTime()}.json`,
  );
  document.body.appendChild(downloadAnchorNode);
  downloadAnchorNode.click();
  downloadAnchorNode.remove();
  showToast(t("toast_json_export"));
});

// 主執行流 (具有完整錯誤保護與取消保護)
document
  .getElementById("startBtn")
  .addEventListener("click", async function () {
    // Wait up to 3s for deferred scripts to load
    let waited = 0;
    while ((!window.Chart || !window.THREE) && waited < 3000) {
      await new Promise((r) => setTimeout(r, 100));
      waited += 100;
    }
    const depError = checkDependencies();
    if (depError) return showFatalError(depError);

    const modeValue = document.querySelector(
      'input[name="testMode"]:checked',
    ).value;
    const config = MODE_SETTINGS[modeValue];
    let myRunId = null;

    try {
      const scoringModel = await SCORING_MODEL_READY;
      currentRunId++; // Start a new run
      myRunId = currentRunId;
      const runContext = new RunContext(myRunId);
      activeRunContext = runContext;
      resetUI();
      document.getElementById("exportJsonBtn").classList.add("hidden");
      setButtonLoading(true);

      const results = {};
      const definitions = getBenchmarkDefinitions(config, myRunId);
      for (const definition of definitions) {
        results[definition.id] = await runOneBenchmark(
          definition,
          runContext,
          myRunId,
          scoringModel.baselineId,
        );
        if (runContext.signal.aborted) break;
      }
      for (const definition of definitions) {
        if (!results[definition.id]) {
          results[definition.id] = createBenchmarkResult(
            definition.id,
            "skipped",
            { error: "Run cancelled" },
          );
        }
      }
      const errorOccurred = Object.values(results).some(
        (result) => result.status !== "ok",
      );

      // 結算與渲染 (包含被中途腰斬但已有部分分數的狀態)
      if (!isCancelledRun(myRunId)) {
        const scoreResult = scoringModel.scoreRun(results);
        const finalScore = scoreResult.overallScore;
        if (radarChart) {
          radarChart.data.datasets[0].data = scoringModel.axisIds.map(
            (axisId) => scoreResult.axisScores[axisId],
          );
          radarChart.update();
        }
        const diag = scoreResult.diagnostics
          ? localizeScoreDiagnostics(scoreResult.diagnostics)
          : null;
        renderResult(finalScore, diag);

        // 渲染可信度
        const rel = calculateReliability(results, false, errorOccurred);
        const relBox = document.getElementById("reliabilityBox");
        const relBadge = document.getElementById("reliabilityBadge");
        const relReason = document.getElementById("reliabilityReason");

        relBox.classList.remove("hidden");
        relBadge.textContent = rel.score;
        relBadge.className = `px-2 py-0.5 rounded text-xs font-bold text-white ${rel.colorClass}`;
        relReason.textContent = rel.reason;

        // 產生報告文字並顯示複製按鈕
        reportText = generateReportText(
          results,
          finalScore,
          rel,
          t(config.labelKey),
          diag,
        );
        document.getElementById("copyReportBtn").classList.remove("hidden");

        // 準備 JSON 匯出資料
        lastJsonExport = {
          timestamp: new Date().toISOString(),
          mode: t(config.labelKey),
          score: finalScore,
          scoreVersion: scoreResult.scoreVersion,
          baselineId: scoreResult.baselineId,
          calibrated: scoreResult.calibrated,
          axisScores: scoreResult.axisScores,
          rejectedMetrics: scoreResult.rejectedMetrics,
          reliability: rel,
          results: results,
          environment: {
            userAgent: navigator.userAgent,
            cores: cores,
            resolution: `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}x`,
          },
        };
        document.getElementById("exportJsonBtn").classList.remove("hidden");
      }

      if (activeRunContext === runContext) activeRunContext = null;
    } catch (fatalErr) {
      showError(t("error_fatal") + " " + fatalErr.message);
    } finally {
      if (!myRunId || !isCancelledRun(myRunId)) setButtonLoading(false);
    }
  });

window.updateDynamicElements = function () {
  if (typeof radarChart !== "undefined" && radarChart) {
    radarChart.data.labels = t("radar_labels");
    radarChart.update();
  }

  const selectedMode = document.querySelector('input[name="testMode"]:checked');
  if (selectedMode) {
    const evt = new Event("change");
    selectedMode.dispatchEvent(evt);
  }

  const envInfo = document.getElementById("envInfo");
  if (envInfo && typeof getDeviceSpecs === "function") {
    const specs = getDeviceSpecs();
    envInfo.innerHTML = `
            <div class="grid grid-cols-2 gap-3 mb-3">
                <div class="bg-slate-800/50 p-2.5 rounded-lg border border-slate-700/50 flex flex-col justify-center items-center text-center hover:bg-slate-800/80 transition-colors">
                    <span class="text-[10px] text-slate-500 mb-0.5 uppercase tracking-wider">${t("env_os")}</span>
                    <span class="text-xs font-bold text-slate-200">${escapeHtml(specs.platform)}</span>
                </div>
                <div class="bg-slate-800/50 p-2.5 rounded-lg border border-slate-700/50 flex flex-col justify-center items-center text-center hover:bg-slate-800/80 transition-colors">
                    <span class="text-[10px] text-slate-500 mb-0.5 uppercase tracking-wider">${t("env_mem_cores")}</span>
                    <span class="text-xs font-bold text-slate-200">${escapeHtml(specs.memory)} / ${specs.cores}C</span>
                </div>
                <div class="bg-slate-800/50 p-2.5 rounded-lg border border-slate-700/50 flex flex-col justify-center items-center text-center col-span-2 hover:bg-slate-800/80 transition-colors">
                    <span class="text-[10px] text-slate-500 mb-0.5 uppercase tracking-wider">${t("env_gpu")}</span>
                    <span class="text-xs font-bold text-primary truncate w-full px-2" title="${escapeHtml(specs.gpuRenderer)}">${escapeHtml(specs.gpuRenderer)}</span>
                </div>
            </div>
            <div class="flex justify-between items-center text-[10px] text-slate-600 border-t border-slate-800 pt-3">
                <span>Res: ${specs.resolution} @ ${specs.pixelRatio}x</span>
                <span class="truncate w-1/2 text-right" title="${escapeHtml(specs.userAgent)}">${escapeHtml(specs.userAgent)}</span>
            </div>
        `;
  }
};

// (duplicate updateDynamicElements removed)
