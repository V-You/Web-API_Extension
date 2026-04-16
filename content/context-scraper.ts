import type { EntityType } from "../src/lib/entity-types";

interface ContextCandidate {
  entityId: string;
  entityType: EntityType;
  confidence: number;
  source: "url" | "anchor" | "script" | "form";
  entityName?: string;
  section?: string;
}

const PATH_RE = /\/(psps|divisions|merchants|channels)\/([^/?#]+)/i;
const EDIT_PATH_RE = /\/edit(psp|division|merchant|channel)(?:[a-z]+)?\.prc$/i;
const QUERY_KEY_TYPES: Record<string, EntityType> = {
  pspid: "psp",
  divisionid: "division",
  merchantid: "merchant",
  channelid: "channel",
};
const TYPE_MAP: Record<string, EntityType> = {
  psps: "psp",
  divisions: "division",
  merchants: "merchant",
  channels: "channel",
};

let lastSignature = "";
let reportTimer: ReturnType<typeof setTimeout> | null = null;

const SECTION_PATTERNS: Array<{ section: string; patterns: RegExp[] }> = [
  { section: "attachedMerchantAccounts", patterns: [/attachedmerchantaccounts/i, /attachedmerchantaccount/i] },
  { section: "ownedMerchantAccounts", patterns: [/ownedmerchantaccounts/i, /ownedmerchantaccount/i] },
  { section: "merchantAccounts", patterns: [/merchantaccounts/i, /merchantaccount/i] },
  { section: "attachedContacts", patterns: [/attachedcontacts/i, /attachedcontact/i] },
  { section: "ownedContacts", patterns: [/ownedcontacts/i, /ownedcontact/i] },
  { section: "contacts", patterns: [/contacts/i, /contact/i] },
  { section: "settings", patterns: [/\/setting(?:s)?\b/i, /settings/i] },
];

export function detectSectionFromUrl(rawUrl: string): string | undefined {
  let haystack = rawUrl;

  try {
    const url = new URL(rawUrl, location.href);
    haystack = `${url.pathname} ${url.search}`;
  } catch {
    // rawUrl may already be a relative or malformed fragment - fall back to the raw string.
  }

  for (const entry of SECTION_PATTERNS) {
    if (entry.patterns.some((pattern) => pattern.test(haystack))) {
      return entry.section;
    }
  }

  return undefined;
}

export function normalizeDetectedName(rawName: string | null | undefined): string | undefined {
  const trimmed = rawName?.replace(/\s+/g, " ").trim();
  if (!trimmed) return undefined;
  if (trimmed.length < 3) return undefined;
  if (/^[a-f0-9]{32}$/i.test(trimmed)) return undefined;
  if (/^(web api extension|oppwa|merchant onboarding api)$/i.test(trimmed)) return undefined;
  return trimmed;
}

function normalizeEntityType(rawType: string | null): EntityType | null {
  if (!rawType) return null;

  const normalized = rawType.toLowerCase();
  if (normalized in TYPE_MAP) {
    return TYPE_MAP[normalized as keyof typeof TYPE_MAP];
  }

  if (normalized === "psp" || normalized === "division" || normalized === "merchant" || normalized === "channel") {
    return normalized;
  }

  return null;
}

function normalizeEditEntityType(rawType: string | null): EntityType | null {
  if (!rawType) return null;

  const normalized = rawType.toLowerCase();
  if (normalized === "psp" || normalized === "division" || normalized === "merchant" || normalized === "channel") {
    return normalized;
  }

  return null;
}

function parseEntityUrl(rawUrl: string, source: ContextCandidate["source"], confidence: number): ContextCandidate | null {
  const section = detectSectionFromUrl(rawUrl);
  const match = PATH_RE.exec(rawUrl);
  if (match) {
    const [, plural, entityId] = match;
    const entityType = TYPE_MAP[plural.toLowerCase()];
    if (!entityType || !entityId) return null;

    return {
      entityId,
      entityType,
      confidence,
      source,
      ...(section ? { section } : {}),
    };
  }

  try {
    const url = new URL(rawUrl, location.href);
    const editMatch = EDIT_PATH_RE.exec(url.pathname);
    const typedId = url.searchParams.get("id");
    const typedEntityType = normalizeEditEntityType(editMatch?.[1] ?? null);
    if (typedId && typedEntityType) {
      return {
        entityId: typedId,
        entityType: typedEntityType,
        confidence,
        source,
        ...(section ? { section } : {}),
      };
    }

    const params = Array.from(url.searchParams.entries()).map(([key, value]) => [key.toLowerCase(), value] as const);

    for (const [key, value] of params) {
      const entityType = QUERY_KEY_TYPES[key];
      if (entityType && value) {
        return {
          entityId: value,
          entityType,
          confidence: Math.max(40, confidence - 10),
          source,
          ...(section ? { section } : {}),
        };
      }
    }

    const entityId = params.find(([key]) => key === "entityid")?.[1] ?? null;
    const entityType = normalizeEntityType(params.find(([key]) => key === "entitytype")?.[1] ?? null);
    if (entityId && entityType) {
      return {
        entityId,
        entityType,
        confidence: Math.max(35, confidence - 15),
        source,
        ...(section ? { section } : {}),
      };
    }
  } catch {
    return null;
  }

  return null;
}

function detectEntityName(): string | undefined {
  const candidates = [
    document.querySelector<HTMLInputElement>('input[name="name"], input#name')?.value,
    document.querySelector<HTMLElement>("h1")?.textContent,
    document.querySelector<HTMLElement>("h2")?.textContent,
    document.querySelector<HTMLElement>("[data-entity-name]")?.textContent,
    document.querySelector<HTMLElement>(".headline, .title")?.textContent,
    document.title,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeDetectedName(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

function enrichCandidate(candidate: ContextCandidate): ContextCandidate {
  const entityName = detectEntityName();
  const section = candidate.section ?? detectSectionFromUrl(location.href);

  return {
    ...candidate,
    ...(entityName ? { entityName } : {}),
    ...(section ? { section } : {}),
  };
}

function detectFromInlineState(): ContextCandidate | null {
  const scriptText = Array.from(document.scripts)
    .map((script) => script.textContent ?? "")
    .join("\n");

  const entityId = /\bentityId\s*=\s*"([^"]+)"/i.exec(scriptText)?.[1]
    ?? /\bselectedEntityId\s*[:=]\s*'([^']+)'/i.exec(scriptText)?.[1]
    ?? /\bselectedEntityId\s*=\s*"([^"]+)"/i.exec(scriptText)?.[1]
    ?? /\bentityId=([^&"']+)/i.exec(scriptText)?.[1]
    ?? null;
  const entityType = normalizeEntityType(
    /\bentityType\s*=\s*"([^"]+)"/i.exec(scriptText)?.[1]
      ?? /\bkind\s*[:=]\s*'([^']+)'/i.exec(scriptText)?.[1]
      ?? null,
  );

  if (!entityId || !entityType) {
    return null;
  }

  return {
    entityId,
    entityType,
    confidence: 95,
    source: "script",
  };
}

function detectFromEntityForm(): ContextCandidate | null {
  const entityId = (document.querySelector<HTMLInputElement>('input[name="id"], input#id')?.value ?? "").trim();
  const entityType = normalizeEntityType(
    (document.querySelector<HTMLInputElement>('input[name="kind"], input#kind')?.value ?? null),
  );
  const entityName = normalizeDetectedName(
    document.querySelector<HTMLInputElement>('input[name="name"], input#name')?.value,
  );

  if (!entityId || !entityType) {
    return null;
  }

  return {
    entityId,
    entityType,
    confidence: 90,
    source: "form",
    ...(entityName ? { entityName } : {}),
    ...(detectSectionFromUrl(location.href) ? { section: detectSectionFromUrl(location.href) } : {}),
  };
}

function detectFromLocation(): ContextCandidate | null {
  return parseEntityUrl(location.href, "url", 100);
}

function detectFromAnchors(): ContextCandidate | null {
  const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"));
  for (const anchor of anchors) {
    const href = anchor.getAttribute("href");
    if (!href) continue;

    const candidate = parseEntityUrl(href, "anchor", /print/i.test(anchor.textContent ?? "") ? 80 : 60);
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function detectContext(): ContextCandidate | null {
  const candidate = detectFromLocation() ?? detectFromInlineState() ?? detectFromEntityForm() ?? detectFromAnchors();
  return candidate ? enrichCandidate(candidate) : null;
}

function scheduleReport() {
  if (reportTimer) clearTimeout(reportTimer);
  reportTimer = setTimeout(() => {
    void reportContext();
  }, 250);
}

async function reportContext() {
  const candidate = detectContext();
  if (!candidate) {
    if (!lastSignature) return;
    lastSignature = "";
    try {
      await chrome.runtime.sendMessage({
        type: "chat:context-clear",
      });
    } catch {
      // The extension context may be unavailable during reloads.
    }
    return;
  }

  const signature = `${candidate.entityType}:${candidate.entityId}:${candidate.source}:${candidate.section ?? ""}:${candidate.entityName ?? ""}`;
  if (signature === lastSignature) return;

  lastSignature = signature;

  try {
    await chrome.runtime.sendMessage({
      type: "chat:context-update",
      payload: candidate,
    });
  } catch {
    // The extension context may be unavailable during reloads.
  }
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  window.addEventListener("load", scheduleReport);
  window.addEventListener("pageshow", scheduleReport);
  document.addEventListener("click", () => {
    scheduleReport();
  }, true);

  const observer = new MutationObserver(() => {
    scheduleReport();
  });

  if (document.documentElement) {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  scheduleReport();
}