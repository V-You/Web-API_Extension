# THIS PROJECT

Build order:

1. Tool handlers (the execute functions for each of the 9 tools)
2. WebMCP registration (wire handlers to navigator.modelContext.registerTool)
3. Virtual SDK proxy + type generation from riro_consolidated_lookup.json
4. Code mode sandbox (execute_workflow)
5. Preview/confirm bridge (side panel <-> tool handler coordination)
6. Job runner (pause/resume in service worker)

Details:

- PRD = file `md/2026-03-20_PRD_v1.md`
- If in doubt, ask or scan other files in md/ (PRD drew from those files)

# General

- Before changing any file, create a backup copy, extension .bak.YYYYMMDD, in bak/
- If code seems missing anywhere, look in bak/ for most recent version and cherry pick from there
- Use PyLance MCP server when needed for Python code
- Use Context7 MCP server to get the latest documentation for libraries and frameworks
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
