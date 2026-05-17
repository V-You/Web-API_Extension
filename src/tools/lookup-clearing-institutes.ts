/**
 * lookup_clearing_institutes tool handler.
 *
 * Modes:
 *   1. search -- fuzzy keyword search against the bundled CI lookup data (195 entries).
 *   2. get_fields -- return the required field mapping for a specific CI code.
 *   3. list_live -- return PSP-scoped live API CIs, optionally filtered by query.
 *
 * The bundled data comes from base_data/ci_ma_lookup.json; the live API
 * endpoint GET /psps/{pspId}/clearingInstitutes is also available for
 * real-time lookups when a pspId is provided.
 */

import { apiRequest } from "../lib/api-client";
import type { ApiCredentials, Environment } from "../lib/types";

// Bundled CI lookup -- loaded once at import time
import ciData from "../../base_data/ci_ma_lookup.json";

interface CiEntry {
  ci_code: string;
  row_number: string;
  fields: Record<string, string>;
}

const CI_ENTRIES: CiEntry[] = (ciData as unknown as { entries: CiEntry[] }).entries;

export interface LookupClearingInstitutesInput {
  action: "search" | "get_fields" | "list_live";
  /** Keyword for search/list_live filtering. */
  query?: string;
  /** Exact CI code for get_fields. */
  ciCode?: string;
  /** PSP ID for list_live (queries the real API). */
  pspId?: string;
}

export async function executeLookupClearingInstitutes(
  input: LookupClearingInstitutesInput,
  creds: ApiCredentials,
  env: Environment
) {
  switch (input.action) {
    case "search":
      if (input.pspId) return listLive(input, creds, env);
      return searchCI(input);
    case "get_fields":
      return getFields(input);
    case "list_live":
      return listLive(input, creds, env);
    default:
      return { error: `Unknown action: ${input.action}` };
  }
}

function searchCI(input: LookupClearingInstitutesInput) {
  const q = input.query?.toLowerCase().trim() ?? "";
  const matches = q
    ? CI_ENTRIES.filter((ci) => ci.ci_code.toLowerCase().includes(q))
    : CI_ENTRIES;

  return {
    query: input.query ?? "",
    matchCount: matches.length,
    source: "bundled",
    note: "Bundled lookup returns CI codes and field mappings only. For API IDs, call this tool with pspId so it can query the live PSP-scoped clearing-institute list.",
    matches: matches.map((ci) => ({
      ciCode: ci.ci_code,
      name: ci.ci_code,
      requiredFields: Object.keys(ci.fields),
    })),
  };
}

function getFields(input: LookupClearingInstitutesInput) {
  if (!input.ciCode) return { error: "ciCode is required for get_fields." };

  const exact = CI_ENTRIES.find(
    (ci) => ci.ci_code.toLowerCase() === input.ciCode!.toLowerCase()
  );

  if (!exact) {
    // Try partial match for suggestions
    const q = input.ciCode.toLowerCase();
    const suggestions = CI_ENTRIES.filter((ci) =>
      ci.ci_code.toLowerCase().includes(q)
    ).slice(0, 5);

    return {
      error: `CI code "${input.ciCode}" not found.`,
      suggestions: suggestions.map((s) => s.ci_code),
    };
  }

  return {
    ciCode: exact.ci_code,
    fields: exact.fields,
    fieldCount: Object.keys(exact.fields).length,
  };
}

async function listLive(
  input: LookupClearingInstitutesInput,
  creds: ApiCredentials,
  env: Environment
) {
  if (!input.pspId) return { error: "pspId is required for list_live." };

  const response = await apiRequest(creds, env, {
    path: `/psps/${input.pspId}/clearingInstitutes`,
  });
  const all = extractClearingInstituteArray(response);
  const query = input.query?.trim() ?? "";
  const matches = filterLiveClearingInstitutes(all, query).map(normalizeLiveClearingInstitute);

  return {
    ok: response.ok,
    status: response.status,
    query,
    pspId: input.pspId,
    source: "live",
    matchCount: matches.length,
    totalAvailable: all.length,
    matches,
    recommended: matches.length === 1 ? matches[0] : undefined,
    clarificationNeeded: matches.length > 1,
    note: matches.length === 1
      ? "Use recommended.id as clearingInstituteId. If no id is present, use recommended.name as clearingInstituteName."
      : "Each live match includes id and name when the API exposes them. clearingInstituteId must be the 32-character API UUID; names/codes belong in clearingInstituteName.",
    data: response.data,
  };
}

function extractClearingInstituteArray(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  if (!result || typeof result !== "object") return [];
  const source = result as Record<string, unknown>;
  if (Array.isArray(source.clearingInstitutes)) return source.clearingInstitutes;
  if (Array.isArray(source.matches)) return source.matches;
  const data = source.data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const dataObject = data as Record<string, unknown>;
    if (Array.isArray(dataObject.clearingInstitutes)) return dataObject.clearingInstitutes;
    if (Array.isArray(dataObject.matches)) return dataObject.matches;
  }
  return [];
}

function filterLiveClearingInstitutes(entries: unknown[], query: string): unknown[] {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return entries.slice(0, 100);
  const scored = entries
    .map((entry) => ({ entry, score: scoreLiveClearingInstitute(entry, normalizedQuery) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);
  return scored.slice(0, 20).map((entry) => entry.entry);
}

function scoreLiveClearingInstitute(entry: unknown, normalizedQuery: string): number {
  if (!entry || typeof entry !== "object") return 0;
  const source = entry as Record<string, unknown>;
  const candidates = [
    source.id,
    source.name,
    source.clearingInstitute,
    source.clearingInstituteName,
    source.clearingInstituteCode,
    source.internationalCode,
    source.ciCode,
    source.ci_code,
  ].map((value) => normalizeText(String(value ?? ""))).filter(Boolean);

  let best = 0;
  for (const candidate of candidates) {
    if (candidate === normalizedQuery) best = Math.max(best, 100);
    else if (candidate.includes(normalizedQuery)) best = Math.max(best, 70);
    else if (normalizedQuery.includes(candidate)) best = Math.max(best, 60);
    else if (wordOverlap(candidate, normalizedQuery)) best = Math.max(best, 40);
  }
  return best;
}

function normalizeLiveClearingInstitute(entry: unknown) {
  const source = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
  const id = stringValue(source.id ?? source.clearingInstituteId);
  const name = stringValue(source.name ?? source.clearingInstitute ?? source.clearingInstituteName ?? source.ciName ?? source.ciCode ?? source.ci_code ?? id);
  const ciCode = stringValue(source.ciCode ?? source.ci_code ?? source.clearingInstituteCode ?? source.internationalCode ?? name ?? id);
  return {
    ...(id ? { id } : {}),
    ...(name ? { name } : {}),
    ...(ciCode ? { ciCode } : {}),
    ...(stringValue(source.internationalCode) ? { internationalCode: stringValue(source.internationalCode) } : {}),
    ...(stringValue(source.country) ? { country: stringValue(source.country) } : {}),
    createFields: {
      ...(id && /^[a-f0-9]{32}$/i.test(id) ? { clearingInstituteId: id } : {}),
      ...(!id || !/^[a-f0-9]{32}$/i.test(id) ? { clearingInstituteName: name ?? ciCode ?? id } : {}),
    },
  };
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function wordOverlap(left: string, right: string): boolean {
  const leftWords = new Set(left.split(" ").filter(Boolean));
  return right.split(" ").some((word) => leftWords.has(word));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
