# 2026-05-26

## Model/tool harness:

**Include *completion* markers in tool responses:**

```json
{
  "success": true,
  "result": { /* transaction details */ },
  "taskComplete": true,  // Signal to Chat agent
  "reason": "Test transaction sent successfully"
}
```

# 2026-03-22

## Missing items:

? Glossary runtime integration: not implemented.
- Recipes runtime integration: not implemented at all.
+ OpenAPI enrichment lifecycle: PRD describes enriched OpenAPI as in progress
- Namespace/synonym strategy finalization: see 2026-03-20_PRD_v1.md:446.
? detailed progress trace / live log streaming
- undo / rollback
- diff view for setting changes
- prod operation blocking / approval workflow
- support diagnostics export
- desktop-agent bridge
- other browsers
- configurable data redaction
- summary-only mode
- profile switching
- data lake? (might not be needed)