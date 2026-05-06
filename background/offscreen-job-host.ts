const OFFSCREEN_DOCUMENT_PATH = "offscreen/offscreen.html";

let creatingOffscreenDocument: Promise<void> | null = null;

async function hasOffscreenDocument(): Promise<boolean> {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  const contexts = await (chrome.runtime.getContexts({
    documentUrls: [offscreenUrl],
  }) as unknown as Promise<unknown[]>);
  return contexts.length > 0;
}

export async function ensureOffscreenJobHost(): Promise<void> {
  if (await hasOffscreenDocument()) return;

  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ["IFRAME_SCRIPTING"],
      justification: "Host the hidden sandbox iframe used for reviewed workflow jobs.",
    }).finally(() => {
      creatingOffscreenDocument = null;
    });
  }

  await creatingOffscreenDocument;
}

export async function pingOffscreenJobHost(): Promise<boolean> {
  await ensureOffscreenJobHost();
  const response = await chrome.runtime.sendMessage({ type: "offscreen_ping" });
  return Boolean(response && typeof response === "object" && (response as { ok?: boolean }).ok);
}

export interface OffscreenJobExecuteInput {
  jobId: string;
  jsCode: string;
  context: unknown;
  timeoutMs: number;
}

export interface OffscreenJobExecuteResult {
  returnValue: unknown;
  results: unknown[];
  logs: unknown[];
  completedCalls: number;
  totalCalls: number;
}

export async function executeJobInOffscreen(input: OffscreenJobExecuteInput): Promise<OffscreenJobExecuteResult> {
  await ensureOffscreenJobHost();
  const response = await chrome.runtime.sendMessage({
    type: "offscreen_job_execute",
    jobId: input.jobId,
    jsCode: input.jsCode,
    context: input.context,
    timeoutMs: input.timeoutMs,
  });

  if (!response || typeof response !== "object") {
    throw new Error("Offscreen job host returned an invalid response.");
  }

  const result = response as { ok?: boolean; error?: string; result?: OffscreenJobExecuteResult };
  if (!result.ok) {
    throw new Error(result.error ?? "Offscreen job execution failed.");
  }
  if (!result.result) {
    throw new Error("Offscreen job host returned no result.");
  }

  return result.result;
}

export async function abortOffscreenJob(jobId: string): Promise<void> {
  if (!(await hasOffscreenDocument())) return;
  await chrome.runtime.sendMessage({ type: "offscreen_job_abort", jobId });
}