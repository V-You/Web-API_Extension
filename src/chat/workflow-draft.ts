export interface ParsedWorkflowDraft {
  label: string;
  totalCalls: number;
  script: string;
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
  try {
    parsed = JSON.parse(extractJson(text));
  } catch (err) {
    if (err instanceof Error && err.message.includes("workflow draft JSON")) throw err;
    throw new Error("The workflow draft was not valid JSON.", { cause: err });
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
