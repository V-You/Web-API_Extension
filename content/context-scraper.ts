import type { EntityType } from "../src/lib/entity-types";

interface ContextCandidate {
  entityId: string;
  entityType: EntityType;
  confidence: number;
  source: "url" | "anchor" | "script" | "form";
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
      };
    }
  } catch {
    return null;
  }

  return null;
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

  if (!entityId || !entityType) {
    return null;
  }

  return {
    entityId,
    entityType,
    confidence: 90,
    source: "form",
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
  return detectFromLocation() ?? detectFromInlineState() ?? detectFromEntityForm() ?? detectFromAnchors();
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

  const signature = `${candidate.entityType}:${candidate.entityId}:${candidate.source}`;
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