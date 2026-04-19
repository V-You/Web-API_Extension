# THIS PROJECT

## Available tools

- CodeGraphContext - MCP server to get an overview of codebase
- context7 - MCP server to get up-to-date docs
- chromedevtools - MCP server to inspect websites
- Specs in base_data/ are the source of truth. This tool is a browser extension. Agents contact the website this extension is scoped for, and the extension exposes tools to the agents, enabling backend calls. The success of this extension completely depends on the accuracy of these backend calls, and the accuracy depends on religiously following the base_data/ specs. The specs are "alpha and omega".

## Decisions

- List important decisions we made, add a brief note on rationale:
- Accuracy is the way to go (over tool count, others)
- API QUIRK: Entity DELETE only soft-deletes, option "includeDisabled" added (for power users)
- API QUIRK: Add Contact on Channel level is supported, but not mentioned in spec, no action taken for now (because it's uncommon)
- ...

## Learnings

- List important learnings from debugging or research, plus note on rationale:
- ...

**Build order:**

1. Tool handlers (the execute functions for each of the 9 tools)
2. WebMCP registration (wire handlers to navigator.modelContext.registerTool)
3. Virtual SDK proxy + type generation from riro_consolidated_lookup.json
4. Code mode sandbox (execute_workflow)
5. Preview/confirm bridge (side panel <-> tool handler coordination)
6. Job runner (pause/resume in service worker)

**Details:**

- Initial PRD = file `md/2026-03-20_PRD_v1.md`
- Further PRD files followed, check files in `md/`

# General

- Before changing any file, create a backup copy, extension .bak.YYYYMMDD, in bak/
- If code seems missing anywhere, check bak/ for recent version to cherry pick
- Use PyLance MCP server when needed for Python code
- Use Context7 MCP server to get latest documentation for libraries and frameworks
- Use Chrome DevTools MCP server to browser the web (or your built-in web tool)

# Skills

- Skills are located in `.github/skills/`

# Code style

- Do NOT use title capitalization in comments etc, use sentence case instead
- Do NOT use m-dashes in comments, use n-dashes instead (wrapped in spaces)
- Do NOT use emojis in comments or code - unless asked (monochrome only)
- Use the KISS principle in code and comments - "keep it simple"
- Use the DRY principle in code and comments - "don't repeat yourself"

# Writing style

- Do NOT use title capitalization, use sentence case instead
- Do NOT use m-dashes, use n-dashes instead
- Do NOT use emojis - unless asked (monochrome only)
