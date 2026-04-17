/**
 * Test-only environment loader for opt-in live tests against UAT.
 *
 * Live tests are gated behind `npm run test:live`, which sets
 * `WEBAPI_TEST_LIVE=1` and runs vitest with `*.live.test.ts`.
 *
 * `.env` format (all lines optional):
 *   BASE_URL=https://eu-test.oppwa.com/bip/webapi/v1
 *   CREDENTIALS=email@example.com:password
 *
 * Never commit `.env`. Never log credential values. This loader scrubs
 * credentials before returning any public-facing string.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import type { ApiCredentials } from "./types";

export interface LiveTestEnv {
  credentials: ApiCredentials;
  /** True if the environment is populated and live tests should run. */
  enabled: boolean;
  /** Reason when `enabled === false`. */
  skipReason?: string;
  /** Optional scoped fixtures (set via `.env` or `process.env`). */
  smokeDivisionId?: string;
  smokePspId?: string;
  smokePspName?: string;
}

function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function loadDotEnv(): Record<string, string> {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(__dirname, "../../.env"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return parseDotEnv(readFileSync(p, "utf8"));
      } catch {
        // fall through
      }
    }
  }
  return {};
}

/**
 * Load live-test credentials from `.env` or `process.env`.
 *
 * Returns `{ enabled: false, skipReason }` when the env is incomplete so
 * tests can call `it.skipIf(!env.enabled)` without failing CI.
 */
export function loadLiveTestEnv(): LiveTestEnv {
  const file = loadDotEnv();
  const merged = { ...file, ...process.env } as Record<string, string>;

  const baseUrl = (merged.BASE_URL ?? "").replace(/\/+$/, "");
  const credsLine = merged.CREDENTIALS ?? "";
  const colon = credsLine.indexOf(":");

  if (!baseUrl) {
    return emptyEnv("BASE_URL missing");
  }
  if (colon <= 0) {
    return emptyEnv("CREDENTIALS missing or not in email:password form");
  }

  const username = credsLine.slice(0, colon);
  const password = credsLine.slice(colon + 1);
  if (!username || !password) {
    return emptyEnv("CREDENTIALS username or password empty");
  }

  return {
    enabled: true,
    credentials: { baseUrl, username, password },
    smokeDivisionId: merged.SMOKE_DIVISION_ID || undefined,
    smokePspId: merged.SMOKE_PSP_ID || undefined,
    smokePspName: merged.SMOKE_PSP_NAME || undefined,
  };
}

function emptyEnv(reason: string): LiveTestEnv {
  return {
    enabled: false,
    skipReason: reason,
    credentials: { baseUrl: "", username: "", password: "" },
  };
}

/** Mask a credentials-bearing string before printing. */
export function scrubSecrets(text: string, creds: ApiCredentials): string {
  let out = text;
  if (creds.password) out = out.split(creds.password).join("***");
  if (creds.username) out = out.split(creds.username).join("***");
  return out;
}
