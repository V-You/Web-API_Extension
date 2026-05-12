import type { ApiCredentials, Environment } from "../lib/types";
import { executeLookupClearingInstitutes } from "./lookup-clearing-institutes";

export interface CardProcessorCandidate {
  id: string;
  ciCode: string;
  name: string;
  requiredFields: string[];
}

export async function listCardProcessors(
  pspId: string | undefined,
  creds: ApiCredentials,
  env: Environment,
): Promise<CardProcessorCandidate[]> {
  const result = await executeLookupClearingInstitutes(
    pspId ? { action: "list_live", pspId } : { action: "search", query: "" },
    creds,
    env,
  );

  return normalizeCardProcessors(result);
}

export function normalizeCardProcessors(result: unknown): CardProcessorCandidate[] {
  const matches = extractProcessorArray(result);
  return matches
    .map((entry) => normalizeProcessor(entry))
    .filter((entry): entry is CardProcessorCandidate => entry !== null);
}

function extractProcessorArray(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  if (!result || typeof result !== "object") return [];

  const source = result as Record<string, unknown>;
  if (Array.isArray(source.matches)) return source.matches;
  if (Array.isArray(source.clearingInstitutes)) return source.clearingInstitutes;
  if (Array.isArray(source.cardProcessors)) return source.cardProcessors;

  const data = source.data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const dataObject = data as Record<string, unknown>;
    if (Array.isArray(dataObject.matches)) return dataObject.matches;
    if (Array.isArray(dataObject.clearingInstitutes)) return dataObject.clearingInstitutes;
    if (Array.isArray(dataObject.cardProcessors)) return dataObject.cardProcessors;
  }

  return [];
}

function normalizeProcessor(entry: unknown): CardProcessorCandidate | null {
  if (!entry || typeof entry !== "object") return null;
  const source = entry as Record<string, unknown>;
  const ciCode = String(source.ciCode ?? source.ci_code ?? source.id ?? source.code ?? source.name ?? "").trim();
  if (!ciCode) return null;
  const name = String(source.name ?? source.displayName ?? source.ciName ?? ciCode).trim() || ciCode;
  const requiredFields = Array.isArray(source.requiredFields)
    ? source.requiredFields.map(String)
    : source.fields && typeof source.fields === "object"
      ? Object.keys(source.fields as Record<string, unknown>)
      : [];

  return {
    id: ciCode,
    ciCode,
    name,
    requiredFields,
  };
}
