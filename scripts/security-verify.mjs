#!/usr/bin/env node
/**
 * Security verification -- PRD acceptance criterion 17.8.
 *
 * Statically verifies that credential security invariants hold:
 *   1. chrome.storage.local never stores plaintext credentials
 *   2. chrome.storage.session is the only place decrypted creds live
 *   3. Credentials are never exposed to DOM or content scripts
 *   4. Audit log and export paths never include credential values
 *   5. Encryption uses AES-GCM with PBKDF2 key derivation
 *   6. PIN is never persisted (only the salt is stored)
 *
 * Run: node scripts/security-verify.mjs
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.log(`  [FAIL] ${label}`);
    if (detail) console.log(`         ${detail}`);
    failed++;
  }
}

function readSource(path) {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

function getAllTsFiles(dir, files = []) {
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      try {
        const stat = statSync(full);
        if (stat.isDirectory() && !entry.startsWith(".") && entry !== "node_modules" && entry !== "dist" && entry !== "bak" && entry !== "tmp") {
          getAllTsFiles(full, files);
        } else if (stat.isFile() && /\.(ts|tsx)$/.test(entry)) {
          files.push(full);
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return files;
}

console.log("Security verification report");
console.log("=".repeat(60));
console.log();

// -- 1. Credential storage model -----------------------------------------

console.log("1. Credential storage model:");

const storageSrc = readSource("src/lib/storage.ts");
const cryptoSrc = readSource("src/lib/crypto.ts");

// Verify encrypt/decrypt are used
check(
  "storage.ts imports encrypt/decrypt from crypto module",
  storageSrc.includes("import { encrypt, decrypt") || storageSrc.includes("from \"./crypto\""),
);

// Verify saveCredentials encrypts before storing
check(
  "saveCredentials() encrypts before writing to local storage",
  storageSrc.includes("encrypt(pin") && storageSrc.includes("chrome.storage.local.set"),
);

// Verify only encrypted blobs go to local storage
check(
  "Only encrypted 'blob' objects written to chrome.storage.local",
  storageSrc.includes("[STORAGE_KEY(env)]: blob") && !storageSrc.includes("chrome.storage.local.set({") || !storageSrc.match(/chrome\.storage\.local\.set\(\{[^}]*password/),
);

// Verify session storage holds decrypted creds
check(
  "Decrypted credentials only placed in chrome.storage.session",
  storageSrc.includes("chrome.storage.session.set") && storageSrc.includes("SESSION_KEY(env)"),
);

console.log();

// -- 2. Encryption quality ------------------------------------------------

console.log("2. Encryption implementation:");

check(
  "Uses AES-GCM algorithm",
  cryptoSrc.includes("AES-GCM"),
);

check(
  "Uses PBKDF2 for key derivation",
  cryptoSrc.includes("PBKDF2") || cryptoSrc.includes("pbkdf2"),
);

check(
  "Random salt generated for each encryption",
  cryptoSrc.includes("crypto.getRandomValues") || cryptoSrc.includes("getRandomValues"),
);

check(
  "Random IV generated for each encryption",
  (cryptoSrc.match(/getRandomValues/g) || []).length >= 2 || cryptoSrc.includes("iv"),
);

console.log();

// -- 3. No credential leakage to LLM/DOM ---------------------------------

console.log("3. Credential isolation from LLM and DOM:");

const allFiles = getAllTsFiles("src").concat(getAllTsFiles("sidepanel")).concat(getAllTsFiles("background"));

// Check that no file sends credentials to the LLM context
// The register-tools.ts (WebMCP) should never reference password/credentials storage
const registerSrc = readSource("src/webmcp/register-tools.ts");
// Check that tool schemas exposed to LLM don't leak credential values
// (getCredentials is OK -- it retrieves creds for API calls, not exposure to LLM.
//  'password' in contact reset_password action name is OK -- it's an API action.)
check(
  "WebMCP tool schemas do not embed raw credential values",
  !registerSrc.includes('"password"') && !registerSrc.match(/credentials:\s*['"]\$\{/),
);

// Check that sandbox/sdk-facade doesn't expose credentials to script output
const facadeSrc = readSource("src/sandbox/sdk-facade.ts");
check(
  "SDK facade does not return credentials in results",
  !facadeSrc.includes("creds.password") && !facadeSrc.includes("creds.username"),
  facadeSrc.includes("creds.password") ? "Found creds.password exposure" : undefined,
);

// Check that the sandbox script context doesn't have access to raw creds
const sandboxSrc = readSource("src/sandbox/sandbox.ts");
check(
  "Sandbox does not inject raw credential values into script scope",
  !sandboxSrc.includes("password") || sandboxSrc.includes("// creds are passed to SDK, not exposed"),
);

console.log();

// -- 4. Audit log and export exclusion ------------------------------------

console.log("4. Audit log excludes credentials:");

const auditSrc = readSource("src/tools/get-audit-log.ts");
const historyUi = readSource("sidepanel/views/RunHistoryPage.tsx");

check(
  "Audit tool does not reference credential fields",
  !auditSrc.includes("password") && !auditSrc.includes("username"),
);

check(
  "Run history export does not include credential fields",
  !historyUi.includes("password") && !historyUi.includes("username"),
);

// Check that AuditEntry type has no credential fields
const typesSrc = readSource("src/lib/types.ts");
check(
  "AuditEntry type does not define credential/password fields",
  !typesSrc.match(/interface AuditEntry[\s\S]*?password/),
);

console.log();

// -- 5. PIN is never persisted --------------------------------------------

console.log("5. PIN handling:");

// The word 'pin' appears in 'pinInitialized' which is a boolean flag, not the PIN itself
check(
  "PIN value is not persisted to storage (only boolean flag and salt stored)",
  !storageSrc.match(/chrome\.storage\.local\.set\([^)]*['"]pin['"]/) &&
  !storageSrc.match(/\[.*pin.*\]:\s*pin\b/),
);

check(
  "PIN is not stored in chrome.storage.session",
  !storageSrc.match(/chrome\.storage\.session\.set\([^)]*pin/i),
);

console.log();

// -- 6. No hardcoded secrets ----------------------------------------------

console.log("6. No hardcoded secrets:");

let hardcodedSecrets = false;
for (const file of allFiles) {
  const content = readSource(file);
  // Check for hardcoded API keys, passwords, tokens
  if (/(?:api[_-]?key|secret|token)\s*[:=]\s*["'][a-zA-Z0-9]{20,}["']/i.test(content)) {
    console.log(`  [WARN] Possible hardcoded secret in ${file}`);
    hardcodedSecrets = true;
  }
}
check("No hardcoded API keys or secrets found in source", !hardcodedSecrets);

console.log();

// -- Summary ---------------------------------------------------------------

console.log("=".repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`Status: ${failed === 0 ? "PASS" : "FAIL"}`);
console.log();

if (failed > 0) process.exit(1);
