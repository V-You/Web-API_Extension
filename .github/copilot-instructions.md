# WEB API EXTENSION

This is a Chrome extension that lets ACI customers operate their SaaS via a combination of API and AI agent, also known as "context binding". It uses WebMCP for in-browser tool publication, UTCP for efficient tool orchestration, and code mode for local script execution. This extension acts as a zero-infrastructure "Virtual SDK" in the browser. By executing logic locally and binding to the active dashboard session, it securely bridges the gap between what the users see and what the AI agents can do.


## base_data specs are source of truth

Specs in base_data/ are the source of truth. This tool is a browser extension. AI agents visit the website this extension is scoped for. The extension exposes tools to the agents, enabling backend calls. The success of this extension completely depends on the accuracy of these backend calls, and the accuracy depends on religiously following the base_data/ specs. The specs are "alpha and omega". If base_data specs conflict with other project requirements, prioritize base_data but document conflict for review.


**Build order:**

1. Tool handlers (the execute functions for each of the 9 tools)
2. WebMCP registration (wire handlers to navigator.modelContext.registerTool)
3. Virtual SDK proxy + type generation from riro_consolidated_lookup.json
4. Code mode sandbox (execute_workflow)
5. Preview/confirm bridge (side panel <-> tool handler coordination)
6. Job runner (pause/resume in service worker)

## Project outline

- Initial PRD = file `md/2026-03-20_PRD_v1.md`
- Further PRD are in `md/`, datestamped

## Project rules

### General project rules

- Accuracy (staying true to base_data specs) is the way to go (over tool count, others)
- Before changing any file, create a backup copy, extension .bak.YYYYMMDD, in bak/
- If any file or logic appears incomplete or absent, check bak/ for recent version to cherry pick (covering events where a file or function was accidently overwritten or prematurely discarded). I nothing suitable is found, escalate the problem to the project lead.
- Skills are located in `.agents/skills/`

### Tool use rules

- Use Context7 MCP server to get latest documentation for libraries and frameworks
- Use chromedevtools MCP server to browser the web (or your built-in web tool) - port 9222 runs an instance where the extension is installed in the user data dir. Session cookies come from .env (copy-paste)
- Use CodeGraphContext - MCP server to get an overview of codebase

### Code and writing style rules

- Do NOT use "Title Case Style", use "Sentence case style" instead
- Do NOT use m-dashes in comments, use n-dashes instead (wrapped in spaces)
- Do NOT use emojis in comments or code
- Use the DRY principle in code and comments - "don't repeat yourself"

### Fixes

- FIRST identify the primary underlying cause of a problem, ensuring it is not a symptom of a deeper issue.
- THEN think about what past change may have caused this problem
- THEN think how a fix for this problem may affect the other features
- DO NOT simply apply a "forward-fix"
- Yes, a "forard-fix" may be needed, but FIRST double check how the root connects to the rest of the code and the features
- We want to avoid rushing from fix to fix and losing sight of the architecture
- We want to rely on accuracy more than on fixes