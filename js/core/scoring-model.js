// Pure scoring functions. Browser/UI adapters are kept in scoring.js.
function createScoringModel(configuration) {
  const axisIds = Object.keys(configuration.axes);

  function normalizeMetric(axisId, value, method = null) {
    const axis = configuration.axes[axisId];
    if (!axis || typeof value !== "number" || !Number.isFinite(value))
      return { score: null, reason: "invalid-value" };
    if (value < 0) return { score: null, reason: "invalid-value" };
    if (value < axis.validRange.min || value > axis.validRange.max)
      return { score: null, reason: "out-of-range" };
    if (method === "Fallback" || method === "IndexedDB") {
      if (axisId === "canvas2d")
        return { score: null, reason: "method-mismatch" };
    }
    if (axisId === "storage" && !axis.methodCompatibility.includes(method))
      return { score: null, reason: "method-mismatch" };
    if (
      axisId !== "storage" &&
      method &&
      !axis.methodCompatibility.includes(method)
    )
      return { score: null, reason: "method-mismatch" };
    const anchors = axis.methods?.[method] ?? axis.anchorPoints;
    if (!anchors) return { score: null, reason: "method-mismatch" };
    for (let index = 1; index < anchors.length; index++) {
      if (anchors[index].value <= anchors[index - 1].value)
        return { score: null, reason: "invalid-baseline" };
    }
    if (value <= anchors[0].value)
      return { score: anchors[0].score, reason: null };
    for (let index = 1; index < anchors.length; index++) {
      const upper = anchors[index];
      const lower = anchors[index - 1];
      if (value <= upper.value) {
        const ratio = (value - lower.value) / (upper.value - lower.value);
        return {
          score: Math.round(lower.score + ratio * (upper.score - lower.score)),
          reason: null,
        };
      }
    }
    return { score: 100, reason: null };
  }

  function scoreRun(results) {
    const axisScores = {};
    const rejectedMetrics = [];
    for (const axisId of axisIds) {
      const result = results?.[axisId];
      let reason = null;
      if (!result || result.status !== "ok") reason = "missing-core-result";
      else if (result.metadata?.baselineId !== configuration.baselineId)
        reason = "baseline-mismatch";
      const normalized = reason
        ? { score: null, reason }
        : normalizeMetric(axisId, result.value, result.method);
      axisScores[axisId] = normalized.score;
      if (normalized.reason)
        rejectedMetrics.push({ metricId: axisId, reason: normalized.reason });
    }
    const requiredMissing = axisIds.some(
      (axisId) => axisScores[axisId] === null,
    );
    const weightTotal = axisIds.reduce(
      (sum, axisId) => sum + configuration.axes[axisId].weight,
      0,
    );
    const weighted = requiredMissing
      ? null
      : Math.round(
          axisIds.reduce(
            (sum, axisId) =>
              sum + axisScores[axisId] * configuration.axes[axisId].weight,
            0,
          ),
        );
    return {
      scoreVersion: configuration.scoreVersion,
      baselineId: configuration.baselineId,
      calibrated: configuration.calibrated,
      axisScores,
      rejectedMetrics,
      weightTotal,
      overallScore: weighted,
      diagnostics:
        weighted === null ? null : getScoreDiagnostics(weighted, axisScores),
    };
  }

  return Object.freeze({ axisIds, normalizeMetric, scoreRun });
}

function getScoreDiagnostics(overallScore, axisScores) {
  const fitness =
    overallScore < 30
      ? {
          webBrowsing: "fitness_smooth",
          multiTab: "fitness_stutter",
          web3D: "fitness_not_rec",
          heavyWebApps: "fitness_struggle",
        }
      : overallScore < 60
        ? {
            webBrowsing: "fitness_very_smooth",
            multiTab: "fitness_smooth",
            web3D: "fitness_good",
            heavyWebApps: "fitness_power",
          }
        : overallScore < 85
          ? {
              webBrowsing: "fitness_very_smooth",
              multiTab: "fitness_very_smooth",
              web3D: "fitness_good",
              heavyWebApps: "fitness_smooth",
            }
          : {
              webBrowsing: "fitness_very_smooth",
              multiTab: "fitness_very_smooth",
              web3D: "fitness_very_smooth",
              heavyWebApps: "fitness_very_smooth",
            };
  const diagnosticAxes = ["cpu", "gpu", "dom", "memory", "storage"]
    .filter((axisId) => axisScores[axisId] !== null)
    .sort((left, right) => axisScores[left] - axisScores[right]);
  const weakestLink =
    diagnosticAxes.length && axisScores[diagnosticAxes[0]] < 60
      ? { metricId: diagnosticAxes[0], score: axisScores[diagnosticAxes[0]] }
      : null;
  return { fitness, weakestLink };
}

globalThis.createScoringModel = createScoringModel;
if (typeof document !== "undefined" && typeof fetch === "function") {
  const SCORING_MODEL_READY = fetch(
    new URL("../../config/baselines-v2.json", document.currentScript.src),
  )
    .then((response) => {
      if (!response.ok)
        throw new Error("Unable to load versioned scoring baselines");
      return response.json();
    })
    .then(createScoringModel);
  globalThis.SCORING_MODEL_READY = SCORING_MODEL_READY;
}
