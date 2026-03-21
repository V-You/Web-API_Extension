/**
 * lookup_clearing_institutes tool handler.
 *
 * Two modes:
 *   1. search -- fuzzy keyword search against the bundled CI lookup data (195 entries).
 *   2. get_fields -- return the required field mapping for a specific CI code.
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

const CI_ENTRIES: CiEntry[] = (ciData as { entries: CiEntry[] }).entries;

export interface LookupClearingInstitutesInput {
  action: "search" | "get_fields" | "list_live";
  /** Keyword for search (matched against ci_code). */
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
  if (!input.query) return { error: "query is required for search." };

  const q = input.query.toLowerCase();
  const matches = CI_ENTRIES.filter((ci) =>
    ci.ci_code.toLowerCase().includes(q)
  );

  return {
    query: input.query,
    matchCount: matches.length,
    matches: matches.map((ci) => ({
      ciCode: ci.ci_code,
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

  return apiRequest(creds, env, {
    path: `/psps/${input.pspId}/clearingInstitutes`,
  });
}
