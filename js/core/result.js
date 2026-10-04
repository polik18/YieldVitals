class BenchmarkError extends Error {
  constructor(status, message, details = {}) {
    super(message);
    this.name = "BenchmarkError";
    this.status = status;
    Object.assign(this, details);
  }
}

function createBenchmarkResult(id, status, values = {}) {
  if (
    !["ok", "unsupported", "error", "cancelled", "timeout", "skipped"].includes(
      status,
    )
  ) {
    throw new TypeError(`Invalid benchmark status: ${status}`);
  }
  const value =
    status === "ok" && Number.isFinite(values.value) ? values.value : null;
  return {
    id,
    status,
    value,
    unit: values.unit ?? null,
    method: values.method ?? null,
    samples:
      status === "ok" && Array.isArray(values.samples) ? values.samples : [],
    durationMs: Number.isFinite(values.durationMs) ? values.durationMs : 0,
    error: status === "ok" ? null : (values.error ?? null),
    metadata: values.metadata ?? {},
    ...(values.details && typeof values.details === "object"
      ? values.details
      : {}),
  };
}

function validateBenchmarkResult(result) {
  if (!result || typeof result.id !== "string")
    throw new TypeError("Benchmark result needs an id");
  if (
    !["ok", "unsupported", "error", "cancelled", "timeout", "skipped"].includes(
      result.status,
    )
  ) {
    throw new TypeError(`Invalid benchmark status: ${result.status}`);
  }
  if (result.status === "ok" && !Number.isFinite(result.value)) {
    throw new TypeError("Successful benchmark results need a finite value");
  }
  if (result.status !== "ok" && result.value !== null) {
    throw new TypeError("Only successful benchmark results may have a value");
  }
  return true;
}

function getBenchmarkValue(result) {
  if (result && typeof result === "object" && "status" in result) {
    return result.status === "ok" && Number.isFinite(result.value)
      ? result.value
      : null;
  }
  return Number.isFinite(result) ? result : null;
}

function benchmarkStatusLabel(status) {
  const labels = {
    unsupported: [t("error_no_webgl"), "Unsupported"],
    error: [t("status_error"), "Error"],
    cancelled: [t("error_cancelled"), "Cancelled"],
    timeout: [t("error_timeout"), "Timed out"],
    skipped: [t("status_skipped"), "Skipped"],
  };
  const [localized, fallback] = labels[status] ?? labels.error;
  return localized === status ||
    localized.startsWith("error_") ||
    localized.startsWith("status_")
    ? fallback
    : localized;
}

function getBenchmarkResultValue(raw) {
  if (typeof raw === "number") return { value: raw, samples: [raw] };
  if (raw && typeof raw === "object") {
    const value = Number.isFinite(raw.value)
      ? raw.value
      : Number.isFinite(raw.score)
        ? raw.score
        : null;
    return { ...raw, value };
  }
  return { value: null };
}

class BenchmarkScope {
  constructor(runContext, id) {
    this.runContext = runContext;
    this.id = id;
    this.controller = new AbortController();
    this.signal = this.controller.signal;
    this.workers = new Set();
    this.controllers = new Set();
    this.timers = new Set();
    this.animationFrames = new Set();
    this.cleanups = new Set();
    this.cleanupTasks = [];
    this.timedOut = false;
    this.closed = false;
    if (runContext.signal.aborted) this.abort(runContext.signal.reason);
    else
      runContext.signal.addEventListener(
        "abort",
        () => this.abort(runContext.signal.reason),
        { once: true },
      );
  }

  throwIfAborted() {
    if (this.signal.aborted) {
      throw new BenchmarkError(
        this.timedOut ? "timeout" : "cancelled",
        String(this.signal.reason ?? "Benchmark cancelled"),
      );
    }
  }

  trackWorker(worker) {
    this.workers.add(worker);
    return worker;
  }

  trackController(controller) {
    this.controllers.add(controller);
    if (this.signal.aborted) controller.abort(this.signal.reason);
    return controller;
  }

  trackTimer(timer) {
    this.timers.add(timer);
    return timer;
  }

  trackAnimationFrame(handle) {
    this.animationFrames.add(handle);
    return handle;
  }

  addCleanup(cleanup) {
    this.cleanups.add(cleanup);
    return cleanup;
  }

  timeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = this.trackTimer(
        setTimeout(() => {
          this.timedOut = true;
          this.abort(`${label} ${t("error_timeout")} (${ms}ms)`);
          reject(
            new BenchmarkError(
              "timeout",
              `${label} ${t("error_timeout")} (${ms}ms)`,
            ),
          );
        }, ms),
      );
    });
    const cancelled = new Promise((_, reject) => {
      if (this.signal.aborted) {
        reject(
          new BenchmarkError(
            this.timedOut ? "timeout" : "cancelled",
            String(this.signal.reason ?? "Benchmark cancelled"),
          ),
        );
      } else {
        this.signal.addEventListener(
          "abort",
          () => {
            reject(
              new BenchmarkError(
                this.timedOut ? "timeout" : "cancelled",
                String(this.signal.reason ?? "Benchmark cancelled"),
              ),
            );
          },
          { once: true },
        );
      }
    });
    return Promise.race([promise, timeout, cancelled]).finally(() => {
      if (timer !== undefined) {
        clearTimeout(timer);
        this.timers.delete(timer);
      }
    });
  }

  abort(reason = "Benchmark cancelled") {
    if (!this.signal.aborted) this.controller.abort(reason);
    this.workers.forEach((worker) => {
      try {
        worker.terminate();
      } catch {}
    });
    this.controllers.forEach((controller) => {
      try {
        controller.abort(reason);
      } catch {}
    });
    this.animationFrames.forEach((handle) => cancelAnimationFrame(handle));
    this.timers.forEach((timer) => clearTimeout(timer));
    this.cleanups.forEach((cleanup) => {
      try {
        const task = cleanup();
        if (task && typeof task.then === "function") {
          this.cleanupTasks.push(
            Promise.resolve(task).catch((error) =>
              console.warn("Benchmark cleanup failed", error),
            ),
          );
        }
      } catch (error) {
        console.warn("Benchmark cleanup failed", error);
      }
    });
    this.workers.clear();
    this.controllers.clear();
    this.animationFrames.clear();
    this.timers.clear();
    this.cleanups.clear();
  }

  close() {
    if (this.closed) return Promise.allSettled(this.cleanupTasks);
    this.closed = true;
    this.abort("Benchmark scope closed");
    this.runContext.scopes.delete(this);
    return Promise.allSettled(this.cleanupTasks);
  }
}

class RunContext {
  constructor(runId) {
    this.runId = runId;
    this.controller = new AbortController();
    this.signal = this.controller.signal;
    this.scopes = new Set();
    this.cancelled = false;
  }

  begin(id) {
    const scope = new BenchmarkScope(this, id);
    this.scopes.add(scope);
    return scope;
  }

  cancel(reason = "Cancelled by user") {
    this.cancelled = true;
    if (!this.signal.aborted) this.controller.abort(reason);
    this.scopes.forEach((scope) => scope.abort(reason));
  }
}

function createTrackedWorker(url, scope = activeBenchmarkScope) {
  const worker = new Worker(url);
  if (scope) {
    scope.trackWorker(worker);
    scope.addCleanup(() => {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
    });
  }
  return worker;
}

function createTrackedAbortController(scope = activeBenchmarkScope) {
  const controller = new AbortController();
  return scope ? scope.trackController(controller) : controller;
}

function registerRunCleanup(cleanup, scope = activeBenchmarkScope) {
  return scope ? scope.addCleanup(cleanup) : cleanup;
}

function scheduleRunTimeout(callback, delay, scope = activeBenchmarkScope) {
  let timer;
  timer = setTimeout(() => {
    scope?.timers.delete(timer);
    if (!scope?.signal.aborted) callback();
  }, delay);
  return scope ? scope.trackTimer(timer) : timer;
}

function requestRunAnimationFrame(callback, scope = activeBenchmarkScope) {
  let handle;
  handle = requestAnimationFrame((time) => {
    scope?.animationFrames.delete(handle);
    if (!scope?.signal.aborted) callback(time);
  });
  return scope ? scope.trackAnimationFrame(handle) : handle;
}
