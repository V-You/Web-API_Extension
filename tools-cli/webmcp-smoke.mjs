#!/usr/bin/env node

const cdpBase = process.env.CDP_URL ?? "http://127.0.0.1:9222";
const pageUrlPart = process.env.WEBMCP_SMOKE_URL ?? "oppwa.com";
const credentialTool = process.env.WEBMCP_SMOKE_CREDENTIAL_TOOL ?? "";
const credentialArgs = process.env.WEBMCP_SMOKE_CREDENTIAL_ARGS ?? "{}";

function fail(message) {
  console.error(`[webmcp-smoke] ${message}`);
  process.exitCode = 1;
}

if (typeof WebSocket === "undefined") {
  fail("This Node runtime does not expose WebSocket. Run with a newer Node or use the snippet in Chrome DevTools.");
  process.exit();
}

const pages = await fetch(`${cdpBase}/json`).then((response) => response.json());
const page = pages.find((entry) => entry.type === "page" && String(entry.url ?? "").includes(pageUrlPart));

if (!page?.webSocketDebuggerUrl) {
  fail(`No CDP page matching ${JSON.stringify(pageUrlPart)} found at ${cdpBase}.`);
  process.exit();
}

let nextId = 1;
const pending = new Map();
const socket = new WebSocket(page.webSocketDebuggerUrl);

function send(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
}

socket.addEventListener("message", (event) => {
  const data = JSON.parse(event.data);
  if (!data.id) return;
  const entry = pending.get(data.id);
  if (!entry) return;
  pending.delete(data.id);
  if (data.error) entry.reject(new Error(data.error.message ?? JSON.stringify(data.error)));
  else entry.resolve(data.result);
});

await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "Runtime evaluation failed");
  }
  return result.result.value;
}

const localRead = await evaluate(`(async () => {
  const testing = navigator.modelContextTesting;
  if (!testing) return { ok: false, error: "navigator.modelContextTesting is unavailable" };
  const tools = await testing.listTools();
  const describeRaw = await testing.executeTool("describe_settings", JSON.stringify({ query: "3ds", limit: 1 }));
  const describe = typeof describeRaw === "string" ? JSON.parse(describeRaw) : describeRaw;
  return {
    ok: true,
    toolCount: tools.length,
    hasDescribeSettings: tools.some((tool) => tool.name === "describe_settings"),
    hasManageSettings: tools.some((tool) => tool.name === "manage_settings"),
    describeReturned: describe.returnedCount ?? null,
  };
})()`);

console.log(JSON.stringify({ page: page.url, localRead }, null, 2));

if (!localRead.ok || !localRead.hasDescribeSettings || !localRead.hasManageSettings) {
  fail("Local WebMCP smoke check failed.");
}

if (credentialTool) {
  const credentialResult = await evaluate(`(async () => {
    const raw = await navigator.modelContextTesting.executeTool(${JSON.stringify(credentialTool)}, ${JSON.stringify(credentialArgs)});
    try { return typeof raw === "string" ? JSON.parse(raw) : raw; }
    catch { return raw; }
  })()`);
  console.log(JSON.stringify({ credentialTool, credentialResult }, null, 2));
}

socket.close();
