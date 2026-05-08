import { redactSecrets } from "./redact";
import type { Environment } from "./types";

const TRANSACTION_ENDPOINTS: Record<Environment, string> = {
  uat: "https://eu-test.oppwa.com/v1/payments",
  prod: "https://eu-prod.oppwa.com/v1/payments",
};

export interface TransactionRequestSummary {
  endpoint: string;
  method: "POST";
  body: Record<string, string>;
  authorization: string;
}

export interface TransactionResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
  request: TransactionRequestSummary;
}

export function parseTransactionBody(bodyText: string): Record<string, string> {
  const params = new URLSearchParams();
  for (const rawLine of bodyText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    params.set(line.slice(0, index).trim(), line.slice(index + 1).trim());
  }
  return Object.fromEntries(params.entries());
}

export async function sendExampleTransaction<T = unknown>(
  env: Environment,
  token: string,
  bodyText: string,
): Promise<TransactionResult<T>> {
  const bodyFields = parseTransactionBody(bodyText);
  if (Object.keys(bodyFields).length === 0) {
    throw new Error("Transaction body must contain key=value form fields.");
  }

  const endpoint = TRANSACTION_ENDPOINTS[env];
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(bodyFields).toString(),
  });

  const contentType = res.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json")
    ? await res.json() as T
    : await res.text() as T;

  return {
    ok: res.ok,
    status: res.status,
    data: redactSecrets(data),
    request: redactSecrets({
      endpoint,
      method: "POST" as const,
      body: bodyFields,
      authorization: `Bearer ${token}`,
    }),
  };
}