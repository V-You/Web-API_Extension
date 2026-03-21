/** Virtual SDK barrel export. */

export { VirtualSdk, createSdk, type SdkContext, type ConfigGetResult, type ConfigUpdateResult } from "./sdk";
export { flattenSettings, parseValue, type FlattenedSetting, type FlattenResult } from "./proxy";
export {
  getByPath,
  getByKey,
  sdkPathToKey,
  keyToSdkPath,
  allPaths,
  allSettings,
  coverageReport,
  entryCount,
  tierACount,
  tierBCount,
  type SettingMeta,
  type Tier,
  type TreeNode,
} from "./riro-tree";
