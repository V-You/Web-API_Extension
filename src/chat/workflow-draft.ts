export interface ParsedWorkflowDraft {
  label: string;
  totalCalls: number;
  script: string;
}

export class WorkflowDraftParseError extends Error {
  constructor(message: string, readonly rawText: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkflowDraftParseError";
  }
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const source = fenced?.[1]?.trim() ?? trimmed;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("The model did not return a workflow draft JSON object.");
  }
  return source.slice(start, end + 1);
}

export function parseWorkflowDraft(text: string): ParsedWorkflowDraft {
  let parsed: unknown;
  let jsonText = "";
  try {
    jsonText = extractJson(text);
    parsed = JSON.parse(jsonText);
  } catch (err) {
    if (err instanceof Error && err.message.includes("workflow draft JSON")) throw err;
    const repaired = jsonText ? parseLooseWorkflowDraft(jsonText) : null;
    if (repaired) return repaired;
    throw new WorkflowDraftParseError("The workflow draft was not valid JSON.", text, { cause: err });
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("The workflow draft must be a JSON object.");
  }

  const draft = parsed as Record<string, unknown>;
  const label = typeof draft.label === "string" ? draft.label.trim() : "";
  const script = typeof draft.script === "string" ? draft.script.trim() : "";
  const totalCalls = typeof draft.totalCalls === "number" ? draft.totalCalls : Number(draft.totalCalls);

  if (!label) throw new Error("The workflow draft is missing a label.");
  if (!script) throw new Error("The workflow draft is missing a script.");
  if (!Number.isInteger(totalCalls) || totalCalls < 1) {
    throw new Error("The workflow draft totalCalls estimate must be a positive integer.");
  }

  return { label, script, totalCalls };
}

function parseLooseWorkflowDraft(source: string): ParsedWorkflowDraft | null {
  const label = readLooseScalar(source, "label");
  const totalCallsRaw = readLooseScalar(source, "totalCalls");
  const script = readLooseScript(source);
  const totalCalls = Number(totalCallsRaw);

  if (!label || !script || !Number.isInteger(totalCalls) || totalCalls < 1) return null;
  return { label, script, totalCalls };
}

function readLooseScalar(source: string, key: string): string {
  const match = new RegExp(`"${key}"\\s*:\\s*(?:"([^"]*)"|'([^']*)'|([0-9]+))`, "i").exec(source);
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

function readLooseScript(source: string): string {
  const keyMatch = /"script"\s*:/i.exec(source);
  if (!keyMatch) return "";

  const valueStart = skipWhitespace(source, keyMatch.index + keyMatch[0].length);
  const delimiter = source[valueStart];
  if (delimiter !== '"' && delimiter !== "'" && delimiter !== "`") return "";

  const valueEnd = findLooseStringEnd(source, valueStart, delimiter);
  if (valueEnd <= valueStart) return "";

  return source.slice(valueStart + 1, valueEnd).trim();
}

function skipWhitespace(source: string, index: number): number {
  let next = index;
  while (/\s/.test(source[next] ?? "")) next++;
  return next;
}

function findLooseStringEnd(source: string, valueStart: number, delimiter: string): number {
  for (let index = source.length - 1; index > valueStart; index--) {
    if (source[index] !== delimiter) continue;
    const rest = source.slice(index + 1).trim();
    if (rest === "}" || rest === ",}" || rest.startsWith("}")) return index;
  }
  return -1;
}
