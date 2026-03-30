# 2026-03-20

## The Web API Extension: Reality Check

It's a fascinating experiment in client-side automation, but it tries to solve backend problems with frontend tools, inheriting the worst traits of both.

| Problem | Comment / Refute | Envisioned Solution |
| --- | --- | --- |
| **The "Browser-as-a-Server" Trap**<br>*(Architecture: Service Worker Job Runner)* | Running mission-critical, long batch mutations inside Chrome. Browsers are ruthless execution environments that throttle background scripts and sleep tabs to save RAM. Pretending a browser side-panel is a durable backend queue is a cute delusion. If a user hits `Ctrl+W`, the "enterprise-grade" job is severed. | Move long-running jobs to a proper decoupled backend queue. If forced to stay client-side, implement aggressive, sub-second state checkpointing via IndexedDB and clear UX warnings enforcing the user to keep the tab awake. |
| **"Code Mode" Roulette**<br>*(Architecture: `AsyncFunction` Sandbox)* | The sandbox strips TypeScript and blindly executes LLM logic via `AsyncFunction` with **no compiler-grade or lint-grade quality gates**. Wrapping hallucinated LLM logic in a flimsy sandbox with live credentials is terrifying. A "Confirm All" button for bulk tasks just turns human fatigue into an automated disaster machine. | Implement a strict AST-based linter/validator *before* execution. Require dry-runs that generate a clear, side-by-side **State Diff Preview** (showing exactly what data will change) rather than relying on a naive human confirmation loop. |
| **The Manual Context Burden**<br>*(Architecture: `riro_consolidated_lookup.json`)* | The extension relies on a massive, hardcoded JSON file of 1,225 settings just so the LLM knows what to do. Worse, over half (\~627) are explicitly documented as "weakly typed." Vendors can barely maintain OpenAPI specs; relying on a brittle client-side JSON mapping guarantees it breaks the second an undocumented API quirk changes. | Abandon hardcoded client-side mappings. Move towards **Dynamic Schema Discovery** where the extension queries the live API for its current schema, or use a centralized, versioned schema registry maintained by the vendor. |
| **State & Consistency Nightmares**<br>*(Architecture: Local API Client & Quirks)* | The extension's docs admit the SaaS API has up to **3 minutes of eventual consistency** and relies on a client-side 9 req/s token bucket. Automating bulk UI operations when the API takes 3 minutes to reflect truth means the LLM is constantly hallucinating based on stale state. | Implement mandatory, robust polling/verification steps within the SDK facade. The agent must not be allowed to proceed to Step B until Step A's state mutation is explicitly verified by a fresh read. |
| **Privacy Theater**<br>*(Architecture: Unredacted Context Binding)* | Context binding stares at the active tab to grab session data, yet **Version 1 explicitly lacks data redaction**. Calling this "High Privacy" is rich when you are funneling raw, unredacted API payloads (potentially full of PII) directly to whatever LLM the user hooked up. | Accelerate the deferred **Data Redaction engine** and "Summary-only mode" to v1. PII and commercial data must be structurally stripped at the extension boundary *before* it is ever passed through the WebMCP bridge to the LLM. |
| **Protocol Ghost Town**<br>*(Architecture: WebMCP Dependency)* | It is architected entirely around WebMCP, which currently requires hacky DevTools wrappers just to function in standard IDEs (like Antigravity). It’s a sleek, zero-infra train built for a railway system that hasn’t laid its tracks yet. | Build fallback HTTP/WebSocket adapters immediately (like the deferred Desktop-agent bridge) so it can integrate with current agent ecosystems (Cursor, standard MCP clients) instead of waiting for a Chrome spec to mature. |
| "Zero" infrastructure scalability | ... pretend SDK. Real revolutionary way to say "decentralizing the compute right into my already memory-hungry browser side panel with 9 tools simultaneously" | Compute *should* be decentralized. Or: ... |
| Setup experience | So simple ... as long as you don't count configuring credentials and remembering a groundbreaking, super-secure 6-digit PIN | PINs are just placeholders for now. Or: ... |
| "Killer feature Context Binding" | What a totally-not-terrifying description for 'detect active BIP tab for context binding' permission. Because when I think 'minimizing data exposure', I definitely think about an extension staring at my active tab. | Yes but the user will expose the content anyway. Better to make it precise. User will cause DOM scraping and snapshotting - ultra-slow and prone to misclicks or endless looping. |
| Built-in domain context | ... after I manually spend ages editing endless JSON files for glossaries, setting families, and mapping metadata? What a fantastic automation shortcut – nothing says modern SaaS automation like manual context building. | Manual context is a necessary evil. Someone has to hone the data, ideally the vendor. Tools can help (see ReadMe.io MCP). |
|     |     |     |

## Recommendations for the most glaring security and state-management issues

If the goal is to keep the "zero-infrastructure, browser-native" dream alive, we need to treat the browser like the hostile, ephemeral execution environment it actually is:

### 1. Secure the "Code Mode" Sandbox

Executing LLM-generated code via an `AsyncFunction` constructor with live credentials is the most glaring risk. You need to restrict what the agent can actually execute.

- **AST Static Analysis:** Before any LLM script hits the sandbox, parse it using a lightweight AST (Abstract Syntax Tree) parser (like Acorn). Reject the script immediately if it contains dynamic imports, prototype pollution attempts, or infinite `while(true)` loops.
- **State Diff Previews (Dry Runs):** The "Confirm All" button is dangerous. Instead, the sandbox should enforce a *mandatory dry-run* that generates a visual **State Diff**. The UI should explicitly show: *"This script will DELETE 45 contacts and MODIFY 2 settings. Here is the list..."* Let the user approve the *outcome*, not the raw code.
- **Strict Polling / Verification:** To combat the 3-minute API eventual consistency, the `sdk-facade` must enforce verification. If the script calls `delete()`, the SDK should automatically poll until a `get()` returns a 404 before letting the script proceed.

### 2. Fortify the Job Runner (Combating Browser Throttling)

Browsers aggressively throttle background scripts and sleep tabs to save memory. A standard Service Worker will die mid-execution during a long batch job.

- **Aggressive IndexedDB Checkpointing:** `chrome.storage.local` is fine, but for high-frequency state updates in batch jobs, switch to `IndexedDB`. Save the exact index of the loop, the success/fail state of the last API call, and the remaining payload every single iteration.
- **Keep-Alive Mechanisms:** If a job is running, inject a persistent, lightweight iframe or play a silent audio track in the active tab to prevent Chrome from sleeping it.
- **UX Guardrails:** Implement a `beforeunload` event listener. If a user tries to close the dashboard tab or the side-panel while a mutation job is running, throw a loud browser warning: *"Batch job in progress. Closing this tab will suspend the operation."*

### 3. Implement the Data Redaction Engine (Privacy v1.0)

You cannot claim "minimized data exposure" if the extension is raw-piping active tab context and API payloads to an external LLM.

- **Local PII Scrubber:** Introduce a fast, client-side regex/heuristic pass *before* data hits the WebMCP bridge. Automatically mask emails, standard credit card patterns, and authorization tokens (e.g., converting `john.doe@email.com` to `[REDACTED_EMAIL]`).
- **Summary-Only Bridge:** Force the LLM to work in a "summary state" by default. Instead of sending the full JSON array of 500 merchants to the LLM to figure out what to do, the extension should summarize it: *"Found 500 merchants. 45 are missing X field."* Only send the full row if the LLM explicitly requests it by ID.

### 4. Solve the Protocol Ghost Town (The IDE Bridge)

WebMCP is a great concept, but waiting for standard IDEs (Cursor, VSCode, Windsurf) to natively support Chrome extension endpoints will stall adoption.

- **Native Messaging Host Bridge:** Build a tiny, open-source companion CLI (Node or Go). The extension talks to this CLI via **Chrome Native Messaging**. The CLI then exposes a standard `stdio` or `SSE` MCP server to the user's IDE. This instantly makes the browser extension compatible with *every existing MCP client on the market today* without hacky DevTools wrappers.

### 5. Deprecate the Hardcoded Mapping File

Relying on a manual `riro_consolidated_lookup.json` with 1,225 entries is a maintenance time-bomb.

- **Dynamic Schema Hydration:** If the SaaS vendor has an OpenAPI spec, the extension should fetch it on initialization, cache it locally, and build its `Zod` validation schemas dynamically. If the API changes, the user just clicks "Refresh Schema" in the side panel.
