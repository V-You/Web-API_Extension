const pendingSdkCalls = new Map();
const abortedJobs = new Set();

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function post(message) {
  window.parent.postMessage(message, "*");
}

function requestSdk(jobId, path, args) {
  if (abortedJobs.has(jobId)) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }

  const requestId = crypto.randomUUID();
  post({ type: "sandbox_sdk_call", jobId, requestId, path, args });

  return new Promise((resolve, reject) => {
    pendingSdkCalls.set(requestId, { resolve, reject, path });
  });
}

function normalizeSdkResult(path, result) {
  if (path.join(".") !== "contacts.list") return result;
  const items = Array.isArray(result)
    ? result
    : result && typeof result === "object" && Array.isArray(result.items)
      ? result.items
      : [];
  Object.defineProperty(items, "items", {
    value: items,
    enumerable: false,
    configurable: true,
  });
  return items;
}

function createSdkProxy(jobId, path = []) {
  return new Proxy(() => undefined, {
    get(_target, prop) {
      if (prop === "then") return undefined;
      if (typeof prop !== "string") return undefined;
      return createSdkProxy(jobId, [...path, prop]);
    },
    apply(_target, _thisArg, args) {
      return requestSdk(jobId, path, args);
    },
  });
}

function createConsole(logs) {
  const push = (level, args) => {
    logs.push({ level, args, timestamp: new Date().toISOString() });
  };
  return {
    log: (...args) => push("log", args),
    warn: (...args) => push("warn", args),
    error: (...args) => push("error", args),
  };
}

function sleep(jobId, ms) {
  return new Promise((resolve, reject) => {
    if (abortedJobs.has(jobId)) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const timer = setTimeout(resolve, ms);
    const interval = setInterval(() => {
      if (!abortedJobs.has(jobId)) return;
      clearTimeout(timer);
      clearInterval(interval);
      reject(new DOMException("Aborted", "AbortError"));
    }, 100);
  });
}

async function executeSandboxRequest(message) {
  const requestId = String(message.requestId ?? "");
  const jobId = String(message.jobId ?? "");
  const jsCode = String(message.jsCode ?? "");
  const context = message.context ?? null;
  const logs = [];
  const results = [];
  let totalCalls = 0;
  let completedCalls = 0;

  try {
    abortedJobs.delete(jobId);
    const sdk = createSdkProxy(jobId);
    const consoleProxy = createConsole(logs);
    const progress = (completed, total, checkpoint) => {
      completedCalls = completed;
      totalCalls = total;
      post({ type: "sandbox_progress", jobId, completedCalls, totalCalls, checkpoint });
    };
    const signal = {
      get aborted() { return abortedJobs.has(jobId); },
      setTotalCalls(total) {
        totalCalls = total;
        post({ type: "sandbox_progress", jobId, completedCalls, totalCalls });
      },
      throwIfAborted() {
        if (abortedJobs.has(jobId)) throw new DOMException("Aborted", "AbortError");
      },
    };

    const fn = new AsyncFunction(
      "sdk", "console", "sleep", "results", "context", "signal", "progress",
      jsCode,
    );

    const returnValue = await fn(
      sdk,
      consoleProxy,
      (ms) => sleep(jobId, ms),
      results,
      context,
      signal,
      progress,
    );

    post({
      type: "sandbox_result",
      requestId,
      result: { returnValue, results, logs, completedCalls, totalCalls },
    });
  } catch (err) {
    post({
      type: "sandbox_error",
      requestId,
      error: err instanceof Error ? err.message : String(err),
      result: { results, logs, completedCalls, totalCalls },
    });
  } finally {
    abortedJobs.delete(jobId);
  }
}

post({ type: "sandbox_ready" });

window.addEventListener("message", (event) => {
  const data = event.data;
  if (data?.type === "sandbox_ping") {
    post({ type: "sandbox_pong" });
    return;
  }

  if (data?.type === "sandbox_execute") {
    void executeSandboxRequest(data);
    return;
  }

  if (data?.type === "sandbox_abort" && data.jobId) {
    abortedJobs.add(data.jobId);
    return;
  }

  if (data?.type === "sandbox_sdk_result" || data?.type === "sandbox_sdk_error") {
    const requestId = String(data.requestId ?? "");
    const entry = pendingSdkCalls.get(requestId);
    if (!entry) return;
    pendingSdkCalls.delete(requestId);
    if (data.type === "sandbox_sdk_error") entry.reject(new Error(String(data.error ?? "SDK call failed.")));
    else entry.resolve(normalizeSdkResult(entry.path, data.result));
  }
});
