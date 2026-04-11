/**
 * RiRo tree -- parses riro_consolidated_lookup.json into:
 *   1. Forward map: SDK dotted path -> flat RiRo key
 *   2. Reverse map: flat RiRo key -> SDK dotted path
 *   3. Metadata per setting: type, tier, default, BIP path
 *   4. Zod schema per setting (tier A only)
 *   5. Nested tree structure for proxy traversal
 *
 * Key structure (all entries have exactly 6 segments):
 *   ∗/type:entity/module:ctpe/processing:Y/parent:Z/leafNs:leafName
 *
 * SDK path mapping:
 *   - Segments 3-5 (processing, parent, leaf) -> Y.Z.leafName
 *   - Collisions (same Y.Z.leafName from different leafNs): disambiguated
 *     by inserting the leafNs as an additional segment: Y.Z.leafNs.leafName
 */

import { z, type ZodTypeAny } from "zod";
import riroData from "../../base_data/riro_consolidated_lookup.json";

// -- Types ----------------------------------------------------------------

export interface RiroEntry {
  id: number;
  key: string;
  type: string;
  path: string;
  default: string;
}

export type Tier = "A" | "B";

export interface SettingMeta {
  flatKey: string;
  sdkPath: string;
  tier: Tier;
  riroType: string;
  bipPath: string;
  defaultValue: string;
  schema: ZodTypeAny | null;
}

/** Nested tree node for proxy path traversal. */
export interface TreeNode {
  /** Children keyed by segment name. */
  children: Map<string, TreeNode>;
  /** If this node is a leaf, the corresponding setting metadata. */
  setting?: SettingMeta;
}

// -- Parse ----------------------------------------------------------------

const RAW_ENTRIES: RiroEntry[] = (riroData as { entries: RiroEntry[] }).entries;

/** Forward: SDK dotted path -> SettingMeta */
const sdkToMeta = new Map<string, SettingMeta>();

/** Reverse: flat RiRo key -> SettingMeta */
const keyToMeta = new Map<string, SettingMeta>();

/** Root of the nested tree. */
const treeRoot: TreeNode = { children: new Map() };

/**
 * Extract the SDK dotted path from a flat RiRo key.
 *
 * Default: processing_val.parent_val.leaf_val  (3 segments)
 * Collision: processing_val.parent_val.leafNs.leaf_val  (4 segments)
 *
 * We do a two-pass approach: first pass builds the default 3-segment paths,
 * second pass detects collisions and expands to 4 segments.
 */
function buildMaps() {
  // First pass: collect default 3-segment paths and detect collisions
  const defaultPaths = new Map<string, RiroEntry[]>();

  for (const entry of RAW_ENTRIES) {
    const parts = entry.key.split("/");
    if (parts.length !== 6) continue;

    const seg3Val = segValue(parts[3]); // processing:Y  -> Y
    const seg4Val = segValue(parts[4]); // parent:Z      -> Z
    const seg5Val = segValue(parts[5]); // leafNs:leaf   -> leaf

    const path3 = `${seg3Val}.${seg4Val}.${seg5Val}`;
    const existing = defaultPaths.get(path3);
    if (existing) {
      existing.push(entry);
    } else {
      defaultPaths.set(path3, [entry]);
    }
  }

  // Identify which 3-segment paths have collisions (>1 unique flat key)
  const collisionPaths = new Set<string>();
  for (const [path, entries] of defaultPaths) {
    const uniqueKeys = new Set(entries.map((e) => e.key));
    if (uniqueKeys.size > 1) collisionPaths.add(path);
  }

  // Second pass: build final maps
  for (const entry of RAW_ENTRIES) {
    const parts = entry.key.split("/");
    if (parts.length !== 6) continue;

    const seg3Val = segValue(parts[3]);
    const seg4Val = segValue(parts[4]);
    const seg5Ns = segNs(parts[5]);
    const seg5Val = segValue(parts[5]);

    const path3 = `${seg3Val}.${seg4Val}.${seg5Val}`;
    const useExpanded = collisionPaths.has(path3);
    const sdkPath = useExpanded
      ? `${seg3Val}.${seg4Val}.${seg5Ns}.${seg5Val}`
      : path3;

    const tier: Tier = entry.type && entry.path ? "A" : "B";
    const schema = tier === "A" ? riroTypeToZod(entry.type, entry.default) : null;

    const meta: SettingMeta = {
      flatKey: entry.key,
      sdkPath,
      tier,
      riroType: entry.type,
      bipPath: entry.path,
      defaultValue: entry.default,
      schema,
    };

    sdkToMeta.set(sdkPath, meta);
    keyToMeta.set(entry.key, meta);
    insertIntoTree(treeRoot, sdkPath, meta);
  }
}

// -- Helpers --------------------------------------------------------------

function segValue(segment: string): string {
  const idx = segment.indexOf(":");
  return idx >= 0 ? segment.substring(idx + 1) : segment;
}

function segNs(segment: string): string {
  const idx = segment.indexOf(":");
  return idx >= 0 ? segment.substring(0, idx) : segment;
}

function insertIntoTree(root: TreeNode, sdkPath: string, meta: SettingMeta) {
  const parts = sdkPath.split(".");
  let node = root;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    let child = node.children.get(part);
    if (!child) {
      child = { children: new Map() };
      node.children.set(part, child);
    }
    node = child;
  }
  node.setting = meta;
}

/** Convert a RiRo type string to a Zod schema. */
function riroTypeToZod(riroType: string, _defaultValue: string): ZodTypeAny {
  switch (riroType.toLowerCase()) {
    case "boolean":
      return z.boolean();
    case "integer":
    case "number":
      return z.number();
    case "string":
    case "text":
      return z.string();
    case "stringlist":
    case "list":
      return z.array(z.string());
    case "predefined list":
      // If default is present, accept string; could be refined with known values
      return z.string();
    default:
      return z.string();
  }
}

// -- Initialize on import -------------------------------------------------

buildMaps();

// -- Public API -----------------------------------------------------------

/** Total entries parsed. */
export const entryCount = RAW_ENTRIES.length;

/** Tier A count (fully typed). */
export const tierACount = [...sdkToMeta.values()].filter((m) => m.tier === "A").length;

/** Tier B count (weakly typed). */
export const tierBCount = [...sdkToMeta.values()].filter((m) => m.tier === "B").length;

/** Look up setting metadata by SDK path. */
export function getByPath(sdkPath: string): SettingMeta | undefined {
  return sdkToMeta.get(sdkPath);
}

/** Look up setting metadata by flat RiRo key. */
export function getByKey(flatKey: string): SettingMeta | undefined {
  return keyToMeta.get(flatKey);
}

/** Convert an SDK dotted path to its flat RiRo key. Returns undefined if not found. */
export function sdkPathToKey(sdkPath: string): string | undefined {
  return sdkToMeta.get(sdkPath)?.flatKey;
}

/** Convert a flat RiRo key to its SDK dotted path. Returns undefined if not found. */
export function keyToSdkPath(flatKey: string): string | undefined {
  return keyToMeta.get(flatKey)?.sdkPath;
}

/** Get the tree root for proxy traversal. */
export function getTreeRoot(): TreeNode {
  return treeRoot;
}

/** Get all SDK paths (for iteration/search). */
export function allPaths(): string[] {
  return [...sdkToMeta.keys()];
}

/** Get all setting metadata entries. */
export function allSettings(): SettingMeta[] {
  return [...sdkToMeta.values()];
}

/** Coverage report for build-time/debug logging. */
export function coverageReport(): {
  total: number;
  tierA: number;
  tierB: number;
  coveragePercent: number;
} {
  return {
    total: entryCount,
    tierA: tierACount,
    tierB: tierBCount,
    coveragePercent: Math.round((tierACount / entryCount) * 100),
  };
}
