import type { EntityType } from "../src/lib/entity-types";

interface ContextCandidate {
  entityId: string;
  entityType: EntityType;
  confidence: number;
  source: "url" | "anchor";
}

const PATH_RE = /\/(psps|divisions|merchants|channels)\/([^/?#]+)/i;
const TYPE_MAP: Record<string, EntityType> = {
  psps: "psp",
  divisions: "division",
  merchants: "merchant",
  channels: "channel",
};

let lastSignature = "";
let reportTimer: ReturnType<typeof setTimeout> | null = null;

function parseEntityUrl(rawUrl: string, source: ContextCandidate["source"], confidence: number): ContextCandidate | null {
  const match = PATH_RE.exec(rawUrl);
  if (!match) return null;

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
  return detectFromLocation() ?? detectFromAnchors();
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