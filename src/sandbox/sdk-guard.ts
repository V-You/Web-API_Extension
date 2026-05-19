/**
 * Runtime guard for the SDK facade (PRD 2026-05-18 D14).
 *
 * Wraps the SDK with a Proxy that rejects access to unknown namespaces or
 * methods with a structured `SdkUnknownMemberError`. Suggests the closest
 * known name via Levenshtein distance so authors and the redraft loop get
 * a clear hint instead of "undefined is not a function".
 *
 * Two layers:
 *   1. Top-level: `sdk.<namespace>` -- unknown namespace throws.
 *   2. Per-namespace: `sdk.<namespace>.<method>` -- unknown method throws.
 *
 * Notes:
 *   - The `config` namespace is the Virtual Settings SDK (deep proxy with
 *     a dynamic tree); we pass it through untouched.
 *   - Symbol keys and "then" pass through (so awaits / inspectors / etc.
 *     keep working and the SDK is never accidentally treated as thenable).
 *   - Hidden engine properties ("constructor", "toJSON", etc.) pass through
 *     too. Only string keys that look like author-written method calls are
 *     guarded.
 */

const PASSTHROUGH_KEYS = new Set<string>([
  "then",
  "catch",
  "finally",
  "constructor",
  "toJSON",
  "toString",
  "valueOf",
  "inspect",
  "nodeType",
  "asymmetricMatch",
]);

export class SdkUnknownMemberError extends Error {
  readonly namespace?: string;
  readonly member: string;
  readonly suggestion?: string;
  readonly available: string[];

  constructor(args: {
    namespace?: string;
    member: string;
    available: string[];
    suggestion?: string;
  }) {
    const path = args.namespace ? `sdk.${args.namespace}.${args.member}` : `sdk.${args.member}`;
    const hint = args.suggestion ? ` Did you mean \`${args.suggestion}\`?` : "";
    super(`Unknown SDK member: \`${path}\`.${hint} Known members: ${args.available.join(", ") || "(none)"}.`);
    this.name = "SdkUnknownMemberError";
    this.namespace = args.namespace;
    this.member = args.member;
    this.available = args.available;
    this.suggestion = args.suggestion;
  }
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prevDiag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, prevDiag + cost);
      prevDiag = tmp;
    }
  }
  return prev[b.length];
}

/**
 * Pick the closest match within Levenshtein distance threshold. Returns
 * undefined when no candidate is close enough to be a useful hint.
 */
export function suggestClosest(target: string, candidates: string[]): string | undefined {
  if (!target || candidates.length === 0) return undefined;
  const lowered = target.toLowerCase();
  // Case-insensitive exact match wins.
  const exact = candidates.find((c) => c.toLowerCase() === lowered);
  if (exact) return exact;
  let best: { name: string; distance: number } | undefined;
  for (const c of candidates) {
    const d = levenshtein(lowered, c.toLowerCase());
    if (!best || d < best.distance) best = { name: c, distance: d };
  }
  if (!best) return undefined;
  // Always accept obvious stem matches (e.g. "entity" -> "entities").
  const loweredTarget = target.toLowerCase();
  const loweredBest = best.name.toLowerCase();
  if (loweredBest.startsWith(loweredTarget) || loweredTarget.startsWith(loweredBest)) {
    return best.name;
  }
  // Otherwise allow at most half of the longer length, capped at 4 edits
  // and with a minimum of 2 so single-character swaps in short names work.
  const maxLen = Math.max(target.length, best.name.length);
  const threshold = Math.min(4, Math.max(2, Math.floor(maxLen / 2)));
  return best.distance <= threshold ? best.name : undefined;
}

function ownKeys(obj: object): string[] {
  return Object.keys(obj).filter((k) => !k.startsWith("_"));
}

function wrapNamespace<T extends object>(namespace: string, target: T, skip?: Set<string>): T {
  const keys = ownKeys(target);
  const skipKeys = skip ?? new Set<string>();
  return new Proxy(target, {
    get(t, prop, receiver) {
      if (typeof prop === "symbol") return Reflect.get(t, prop, receiver);
      const key = String(prop);
      if (PASSTHROUGH_KEYS.has(key) || skipKeys.has(key)) return Reflect.get(t, prop, receiver);
      if (Reflect.has(t, prop)) return Reflect.get(t, prop, receiver);
      throw new SdkUnknownMemberError({
        namespace,
        member: key,
        available: keys,
        suggestion: suggestClosest(key, keys),
      });
    },
  });
}

export interface WrapSdkOptions {
  /** Namespaces to pass through untouched (e.g. the Virtual config tree). */
  passthroughNamespaces?: string[];
}

/**
 * Wrap a built SDK facade with the runtime guard.
 *
 * The returned object behaves identically to the input for all valid
 * accesses but throws `SdkUnknownMemberError` for unknown namespaces or
 * methods.
 */
export function wrapSdkWithGuard<T extends object>(sdk: T, options: WrapSdkOptions = {}): T {
  const passthrough = new Set(options.passthroughNamespaces ?? ["config"]);
  const namespaceKeys = ownKeys(sdk);

  // Build wrapped namespaces lazily so we never re-wrap on each property
  // access (which would also break `===` identity checks across calls).
  const wrappedNamespaces = new Map<string, unknown>();

  return new Proxy(sdk, {
    get(t, prop, receiver) {
      if (typeof prop === "symbol") return Reflect.get(t, prop, receiver);
      const key = String(prop);
      if (PASSTHROUGH_KEYS.has(key)) return Reflect.get(t, prop, receiver);

      if (!Reflect.has(t, prop)) {
        throw new SdkUnknownMemberError({
          member: key,
          available: namespaceKeys,
          suggestion: suggestClosest(key, namespaceKeys),
        });
      }

      const value = Reflect.get(t, prop, receiver);
      if (passthrough.has(key) || value === null || typeof value !== "object") return value;

      if (!wrappedNamespaces.has(key)) {
        wrappedNamespaces.set(key, wrapNamespace(key, value as object));
      }
      return wrappedNamespaces.get(key);
    },
  });
}
