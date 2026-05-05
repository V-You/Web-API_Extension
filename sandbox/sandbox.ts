const pendingSdkCalls = new Map<string, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }>();
const abortedJobs = new Set<string>();

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>;

function post(message: Record<string, unknown>) {
  window.parent.postMessage(message, "*");
}

function requestSdk(jobId: string, path: string[], args: unknown[]): Promise<unknown> {
  if (abortedJobs.has(jobId)) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }

  const requestId = crypto.randomUUID();
  post({ type: "sandbox_sdk_call", jobId, requestId, path, args });

  return new Promise((resolve, reject) => {
    pendingSdkCalls.set(requestId, { resolve, reject });
  });
}

function createSdkProxy(jobId: string, path: string[] = []): unknown {
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

function createConsole(logs: unknown[]) {
  const push = (level: "log" | "warn" | "error", args: unknown[]) => {
    logs.push({ level, args, timestamp: new Date().toISOString() });
  };
  return {
    log: (...args: unknown[]) => push("log", args),
    warn: (...args: unknown[]) => push("warn", args),
    error: (...args: unknown[]) => push("error", args),
  };
}

function sleep(jobId: string, ms: number): Promise<void> {
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

async function executeSandboxRequest(message: Record<string, unknown>) {
  const requestId = String(message.requestId ?? "");
  const jobId = String(message.jobId ?? "");
  const jsCode = String(message.jsCode ?? "");
  const context = message.context ?? null;
  const logs: unknown[] = [];
  const results: unknown[] = [];
  let totalCalls = 0;
  let completedCalls = 0;

  try {
    abortedJobs.delete(jobId);
    const sdk = createSdkProxy(jobId);
    const consoleProxy = createConsole(logs);
    const progress = (completed: number, total: number, checkpoint?: unknown) => {
      completedCalls = completed;
      totalCalls = total;
      post({ type: "sandbox_progress", jobId, completedCalls, totalCalls, checkpoint });
    };
    const signal = {
      get aborted() { return abortedJobs.has(jobId); },
      setTotalCalls(total: number) {
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
      (ms: number) => sleep(jobId, ms),
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
  const data = event.data as (Record<string, unknown> & { type?: string; requestId?: string; jobId?: string }) | undefined;
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
    else entry.resolve(data.result);
  }
});