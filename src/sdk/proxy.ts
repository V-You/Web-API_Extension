/**
 * Settings proxy -- flattens nested typed objects to flat RiRo key-value pairs.
 *
 * Used by the virtual SDK to convert:
 *   { risk: { avsCheck: { active: true } } }
 * into:
 *   [{ key: "∗/type:entity/.../avsCheck:active", value: "true" }]
 *
 * Also validates values against Zod schemas (tier A) before emitting.
 */

import {
  getTreeRoot,
  type TreeNode,
  type SettingMeta,
  getByPath,
} from "./riro-tree";

export interface FlattenedSetting {
  flatKey: string;
  sdkPath: string;
  value: string;
}

export interface FlattenResult {
  ok: boolean;
  settings: FlattenedSetting[];
  errors: string[];
}

/**
 * Walk a nested object and flatten to RiRo key-value pairs.
 * Validates tier A values against their Zod schemas.
 */
export function flattenSettings(
  obj: Record<string, unknown>
): FlattenResult {
  const settings: FlattenedSetting[] = [];
  const errors: string[] = [];

  walkObject(obj, getTreeRoot(), [], settings, errors);

  return { ok: errors.length === 0, settings, errors };
}

function walkObject(
  obj: Record<string, unknown>,
  node: TreeNode,
  pathParts: string[],
  out: FlattenedSetting[],
  errors: string[]
) {
  for (const [key, value] of Object.entries(obj)) {
    const child = node.children.get(key);
    const currentPath = [...pathParts, key];
    const sdkPath = currentPath.join(".");

    if (!child) {
      errors.push(`Unknown setting path: ${sdkPath}`);
      continue;
    }

    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      child.children.size > 0
    ) {
      // Intermediate node -- recurse
      walkObject(
        value as Record<string, unknown>,
        child,
        currentPath,
        out,
        errors
      );
    } else if (child.setting) {
      // Leaf node -- validate and emit
      const meta = child.setting;
      const stringValue = valueToString(value);

      if (meta.tier === "A" && meta.schema) {
        const parsed = meta.schema.safeParse(value);
        if (!parsed.success) {
          const issues = parsed.error.issues.map((i) => i.message).join("; ");
          errors.push(`Validation failed for ${sdkPath}: ${issues}`);
          continue;
        }
      }

      out.push({
        flatKey: meta.flatKey,
        sdkPath,
        value: stringValue,
      });
    } else {
      errors.push(
        `${sdkPath} is not a leaf setting and has no further children matching the provided value.`
      );
    }
  }
}

/** Convert a JS value to the string form expected by the API. */
function valueToString(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.join(",");
  return String(value ?? "");
}

/**
 * Unflatten: convert a flat key + string value back to typed JS value
 * using the setting's Zod schema.
 */
export function parseValue(sdkPath: string, rawValue: string): unknown {
  const meta = getByPath(sdkPath);
  if (!meta) return rawValue;

  switch (meta.riroType.toLowerCase()) {
    case "boolean":
      return rawValue === "true";
    case "integer":
    case "number":
      return Number(rawValue);
    case "stringlist":
    case "list":
      return rawValue ? rawValue.split(",") : [];
    default:
      return rawValue;
  }
}
