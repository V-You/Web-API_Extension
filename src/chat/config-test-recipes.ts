import recipesData from "../../base_data/config_test_recipes.json";
import familyProfilesData from "../../src_data/settings_family_profiles.json";
import { getByKey } from "../sdk/riro-tree";

export type ConfigTestRecipeScope = "transaction_testing";
export type ConfigTestRecipePhaseType = "burst" | "wait" | "variantMatrix";

interface SettingsFamilyProfile {
  shortcode: string;
  aliases?: string[];
  label?: string;
}

interface SettingsFamilyProfilesFile {
  families: SettingsFamilyProfile[];
}

export interface ConfigTestRecipePhase {
  type: ConfigTestRecipePhaseType;
  count?: number;
  msFromSetting?: string;
  minimumMs?: number;
}

export interface ConfigTestRecipeExpectedSignal {
  transactionIndex?: number;
  verdict: string;
  resultCodePatterns?: string[];
  requiresLiveCalibration?: boolean;
}

export interface ConfigTestRecipe {
  id: string;
  version: number;
  archetype: string;
  label: string;
  scope: ConfigTestRecipeScope;
  enabled: boolean;
  experimental: boolean;
  fixtureIds: string[];
  matcher: {
    triggerTerms: string[];
    settingFamilies: string[];
    settingKeys: string[];
    requiresTestIntent: boolean;
  };
  appliesTo?: {
    environments?: string[];
    regions?: string[];
    tenantTypes?: string[];
  };
  constants: string[];
  variables: string[];
  transactionPlan: {
    helper: string;
    count: number;
    phases: ConfigTestRecipePhase[];
  };
  expectedSignals: ConfigTestRecipeExpectedSignal[];
  inconclusiveIf: string[];
  rendering?: {
    summary?: string;
  };
}

interface ConfigTestRecipesFile {
  schemaVersion: number;
  recipes: ConfigTestRecipe[];
}

export interface ConfigTestRecipeMatchInput {
  prompt: string;
  env?: string;
  settingKeys?: string[];
  settingFamilies?: string[];
  recentActions?: Array<{ settings?: Record<string, unknown>; tool?: string }>;
  knownIds?: Record<string, string>;
  allowExperimental?: boolean;
}

export interface MatchedConfigTestRecipe {
  recipe: ConfigTestRecipe;
  matchedSignals: string[];
}

export interface TestingIntentResult {
  recipeId: string;
  recipeVersion: number;
  archetype: string;
  fixtureIds?: string[];
  matchedSignals: string[];
  constants: Record<string, unknown>;
  variables: Record<string, unknown>;
  expectedSignals: ConfigTestRecipeExpectedSignal[];
  observedSignals: Array<{
    transactionIndex?: number;
    ok: boolean;
    resultCode?: string;
    resultDescription?: string;
    details?: Record<string, unknown>;
  }>;
  verdict: "verified" | "failed" | "inconclusive";
  reason: string;
  classifierVersion: number;
}

const RECIPES_FILE = recipesData as ConfigTestRecipesFile;
const FAMILY_PROFILES = familyProfilesData as SettingsFamilyProfilesFile;
const TEST_INTENT_PATTERN = /\b(test|verify|prove|check whether|check if|see if|send\s+\d*\s*transactions?|send\s+test\s+transactions?)\b/i;
const GENERIC_TRANSACTION_PATTERN = /\bsend\s+(?:one\s+|1\s+)?(?:test\s+)?transaction\b/i;

export function getConfigTestRecipes(options: { allowExperimental?: boolean } = {}): ConfigTestRecipe[] {
  return RECIPES_FILE.recipes.filter((recipe) => {
    if (!recipe.enabled) return false;
    if (recipe.experimental && options.allowExperimental !== true && recipe.fixtureIds.length === 0) return false;
    return true;
  });
}

export function matchConfigTestRecipes(input: ConfigTestRecipeMatchInput): MatchedConfigTestRecipe[] {
  const prompt = normalize(input.prompt);
  if (!hasTestingIntent(prompt)) return [];

  const settingKeys = new Set([
    ...normalizeList(input.settingKeys),
    ...(input.recentActions?.flatMap((action) => Object.keys(action.settings ?? {})) ?? []),
  ].map(normalize));
  const requestedFamilies = new Set(normalizeList(input.settingFamilies));
  const recipes = getConfigTestRecipes({ allowExperimental: input.allowExperimental });

  const matches = recipes
    .map((recipe) => scoreRecipe(recipe, prompt, settingKeys, requestedFamilies, input.env))
    .filter((match): match is MatchedConfigTestRecipe & { score: number } => match !== null)
    .sort((left, right) => right.score - left.score);

  if (matches.length === 0) return [];
  const primary = matches[0];
  const secondary = matches.find((match) => match.recipe.archetype.startsWith("routing") && primary.recipe.archetype.startsWith("verification"));
  return secondary ? [primary, secondary] : [primary];
}

export function renderConfigTestRecipePrompt(matches: MatchedConfigTestRecipe[]): string | null {
  if (matches.length === 0) return null;
  const blocks = matches.map(({ recipe, matchedSignals }) => {
    const phaseSummary = recipe.transactionPlan.phases.map(renderPhase).join("; ");
    const expected = recipe.expectedSignals.map(renderExpectedSignal).join("; ");
    const calibration = recipe.expectedSignals.some((signal) => signal.requiresLiveCalibration)
      ? " Some expected result-code patterns require live calibration; report inconclusive when the observable signal is unknown."
      : "";
    return [
      `Transaction testing intent detected: ${recipe.label}.`,
      `Use recipe ${recipe.id} v${recipe.version}.`,
      `Matched signals: ${matchedSignals.join(", ")}.`,
      `Constants: ${recipe.constants.join(", ")}.`,
      `Variables: ${recipe.variables.join(", ")}.`,
      `Plan: ${phaseSummary}.`,
      `Expected: ${expected}.${calibration}`,
      `If any of these occur, report the test as inconclusive: ${recipe.inconclusiveIf.join("; ")}.`,
      recipe.rendering?.summary ? `Recipe note: ${recipe.rendering.summary}` : null,
      "Push a final results entry with testingIntent containing recipeId, recipeVersion, archetype, matchedSignals, expectedSignals, observedSignals, verdict, reason, and classifierVersion.",
    ].filter(Boolean).join("\n");
  });
  return ["Transaction testing recipe context:", ...blocks].join("\n\n");
}

export function validateConfigTestRecipes(recipes: ConfigTestRecipe[] = RECIPES_FILE.recipes): string[] {
  const errors: string[] = [];
  if (RECIPES_FILE.schemaVersion !== 1) errors.push(`Unsupported config test recipe schemaVersion: ${RECIPES_FILE.schemaVersion}`);
  const ids = new Set<string>();
  for (const recipe of recipes) {
    if (!/^[-a-z]+(?:-[a-z]+)*\.[-a-z]+(?:-[a-z]+)*$/.test(recipe.id)) errors.push(`Invalid recipe id: ${recipe.id}`);
    if (ids.has(recipe.id)) errors.push(`Duplicate recipe id: ${recipe.id}`);
    ids.add(recipe.id);
    if (recipe.enabled && recipe.experimental && recipe.fixtureIds.length === 0) errors.push(`Experimental recipe ${recipe.id} needs a fixture before default loading.`);
    for (const phase of recipe.transactionPlan.phases) {
      if (!["burst", "wait", "variantMatrix"].includes(phase.type)) errors.push(`Recipe ${recipe.id} has unsupported phase type: ${phase.type}`);
    }
    for (const family of recipe.matcher.settingFamilies) {
      if (!familyLookup().has(normalize(family))) errors.push(`Recipe ${recipe.id} references unknown setting family: ${family}`);
    }
    for (const key of recipe.matcher.settingKeys) {
      if (!getByKey(key)) errors.push(`Recipe ${recipe.id} references unknown setting key: ${key}`);
    }
  }
  return errors;
}

function scoreRecipe(
  recipe: ConfigTestRecipe,
  prompt: string,
  settingKeys: Set<string>,
  requestedFamilies: Set<string>,
  env?: string,
): (MatchedConfigTestRecipe & { score: number }) | null {
  if (recipe.appliesTo?.environments?.length && env && !recipe.appliesTo.environments.map(normalize).includes(normalize(env))) return null;

  const matchedSignals: string[] = [];
  let score = 0;

  for (const key of recipe.matcher.settingKeys) {
    if (settingKeys.has(normalize(key)) || prompt.includes(normalize(key))) {
      score += 100;
      matchedSignals.push(`setting:${key}`);
    }
  }

  for (const family of recipe.matcher.settingFamilies) {
    const aliases = familyAliases(family);
    if (requestedFamilies.has(normalize(family)) || aliases.some((alias) => prompt.includes(alias))) {
      score += 60;
      matchedSignals.push(`family:${family}`);
    }
  }

  for (const term of recipe.matcher.triggerTerms) {
    if (prompt.includes(normalize(term))) {
      score += 30;
      matchedSignals.push(`term:${term}`);
    }
  }

  if (recipe.matcher.requiresTestIntent && !hasTestingIntent(prompt)) return null;
  if (score === 0) return null;
  if (score <= 30 && GENERIC_TRANSACTION_PATTERN.test(prompt)) return null;
  return { recipe, matchedSignals: [...new Set(matchedSignals)], score };
}

function hasTestingIntent(prompt: string): boolean {
  return TEST_INTENT_PATTERN.test(prompt);
}

function renderPhase(phase: ConfigTestRecipePhase): string {
  if (phase.type === "burst") return `send ${phase.count ?? 1} transaction(s) immediately`;
  if (phase.type === "wait") return `wait at least ${phase.minimumMs ?? 0} ms${phase.msFromSetting ? ` (${phase.msFromSetting})` : ""}`;
  return "run the configured variant matrix";
}

function renderExpectedSignal(signal: ConfigTestRecipeExpectedSignal): string {
  const target = signal.transactionIndex ? `transaction ${signal.transactionIndex}` : "matching transaction";
  const codes = signal.resultCodePatterns?.length ? ` result codes ${signal.resultCodePatterns.join(" or ")}` : "";
  const calibration = signal.requiresLiveCalibration ? " (requires live calibration)" : "";
  return `${target} ${signal.verdict}${codes}${calibration}`;
}

function normalizeList(values: string[] | undefined): string[] {
  return values?.map(normalize).filter(Boolean) ?? [];
}

function normalize(value: string): string {
  return value.toLowerCase().trim();
}

let cachedFamilyLookup: Map<string, string[]> | null = null;
function familyLookup(): Map<string, string[]> {
  if (cachedFamilyLookup) return cachedFamilyLookup;
  const lookup = new Map<string, string[]>();
  for (const family of FAMILY_PROFILES.families) {
    const aliases = [family.shortcode, family.label, ...family.aliases ?? []]
      .filter((value): value is string => Boolean(value))
      .map(normalize);
    lookup.set(normalize(family.shortcode), aliases);
    for (const alias of aliases) lookup.set(alias, aliases);
  }
  cachedFamilyLookup = lookup;
  return lookup;
}

function familyAliases(family: string): string[] {
  return familyLookup().get(normalize(family)) ?? [normalize(family)];
}
