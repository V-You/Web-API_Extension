# 2026-05-26

## Model/tool harness

Currently, there is only a monolithic system prompt. The negative effect is, that the model is not laser focused on this specific API and this specific SaaS platform. The API data is excellent, the aux data is excellent (Glossary, settings, recipes), and the architecture is great (lacking performance tweaks, but the 2 worlds, the choke point, the telemetry pipeline etc are sound). The missing puzzle piece is a model harness.

### Immediate fixes (delete when done)

A. **Include *completion* markers in tool responses:**

```json
{
  "success": true,
  "result": { /* transaction details */ },
  "taskComplete": true,  // Signal to Chat agent
  "reason": "Test transaction sent successfully"
}
```

---

### Harness as structural problem

**Current situation:**

- Monolithic system prompt in discovery-playbook.ts (200+ lines)
- Reactive patches added as misfires occur (whack-a-mole)
- No: measurement loop, eval suite, regression detection
- Heuristics scattered across prompt, no organizing principle

**Instead: Create conceptual framework:**

#### 1. Tiered guidance architecture

Split giant prompt into:
- **Identity & constraints** (who the model is, what it must never do)
- **Decision framework** (choose tools, when read vs write, when escalate)
- **Domain rules** (BIP-specific quirks, RiRo paths, entity hierarchy)
- **Recipes** (proven playbooks for common tasks)
- **Recovery patterns** (what to do when X fails)

Goal: Evolve each tier independently. Test in isolation.

#### 2. Decision tree for tool selection

**Decision tree gap** example `byName` vs. `byId` path (either nominally supported). The model has multiple tools but no explicit decision logic for *which* to use when. Define:
```
- Have an ID? → Use ID-based tool. Never use name-based lookup.
- Name only? → First list children of current context to find ID.
- Name only AND no parent context? → Use byName, warn about case-sensitivity.
```

Current *playbooks* do this, essentially. But they are written as prose, instead of enforceable decision logic.

#### 3. Evaluation harness

Improve only what we can measure (take prompt edits from "guess" to predictable iterations):

- **Golden test set:** 30-50 representative prompts with expected tool-call sequences ("Delete testMerchant02" → expect: `listChildren` then `delete_entity` by ID).
- **Replay system:** Run them against the chat agent, compare actual tool calls to expected tool calls.
- **Regression alerts:** New prompt change reduces test pass rate → flag for review

#### 4. Feedback loop: Telemetry → prompt

Turns the gateway from observability into a **prompt improvement engine**. Process based on gateway telemetry (every tool call):

- Periodically review telemetry for high-call-count tasks ("test transaction looped 30 times")
- Classify misfires: wrong tool, wrong params, infinite loop, false completion claim
- Each misfire, either:
    - fix in decision tree
    - add to recipes
    - add to recovery patterns
    - ...


#### 5. Recipe-first execution to precent free-form drift

Currently the model composes tool calls freely. Only *then* it is constrained by hints. 

- Flip this to: **pre-defined recipe templates** for known tasks (test transaction, delete entity, attach contact). The model fills them in. 
- Current `chat_discovery_playbook.json` and `config-test-recipes.ts` are underused. Expand them into: **"recipe library" with invocation rules**. This will reduce free-form drift.
- *Only* when no recipe matches: Free composition.


#### 6. Per-*task* budget and stop conditions 

Budgets for each task class (instead of global stop rule):

- `delete_entity`: max 3 tool calls (locate + confirm + delete)
- `send_test_transaction`: max 5 tool calls (token query/create, test, token cleanup)
- `create_merchant_account`: max 7 tool calls
- ...

When budget is hit, model must report and stop. This catches infinite loops without suppressing legit exploration.




---
---
---
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