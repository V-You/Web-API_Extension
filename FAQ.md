# Frequently Asked Questions

## What does this extension actually do?

It exposes tools in Chrome so an AI agent can operate ACI Web API endpoints through the browser, without a separate MCP server.

The tools are exposed via WebMCP. Other browsers are theoretically supported out of the box, if they support WebMCP.

## Is this replacing the current dashboard?

No. It is an assistant layer for repetitive or complex tasks.

## What is the business benefit for a team?

Faster execution of repetitive operations, fewer manual clicks, and more consistent outcomes for settings, hierarchy checks, and bulk workflows. Also see `examples.md`.

## Is this safe to use in production?

Yes. Safeguards: write operations require explicit confirmation, environment is visible (UAT/Prod), actions are audit logged.

## What happens if the AI suggests the wrong action?

User rejects write confirmation, runs in UAT first, reviews output before applying changes in Prod.

## Do I need to be logged into the ACI dashboard?

No. Tool discovery is bound to the *oppwa.com domain, not bound to being logged in. User *actions* - that are facilitated by the extension's tools - require valid API credentials that are configured in the extension. This means:

- Your BIP/POPP user does *not* have to be logged into the online dashboard.
- You do need a valid *Web API user* (configured in the extension).
- Your LLM/agent needs to call an *oppwa.com page in a supported browser.
- For visual feedback, or if you want your LLM/agent to act on what you see in the browser, your BIP/POPP user should log in.

## Can the LLM see my API credentials?

No. Credentials are used locally by the extension runtime to make API calls. The model receives tool inputs and tool outputs, not storage values or request headers.

## Where are credentials stored?

Encrypted credentials are stored in local extension storage. Decrypted credentials are kept in session storage and cleared on browser restart.

## Can someone extract the API specs from the extension?

Yes. However, it would be easier to use the official Postman collection directly, if the specs are needed. Trade-off is quality, the OpenAPI spec in use by the Web API Extension is enriched and streamlined, and there are auxiliary helpers like recipes or glossary.

## What are tool calls based on, technically?

They are based on the enriched ACI MO API OpenAPI data and related generated mappings/types included in the extension.

## What is the update workflow when specs improve?

Update flow is: enrich specs in development, regenerate/update extension artifacts, release a new extension build, then users update/reinstall.

## Why are tools not showing up in Gemini?

Most common causes are: wrong tab/domain, WebMCP testing flag disabled, stale extension build loaded, or browser/channel capability mismatch.

## Can Gemini and the extension side panel be open at the same time?

No. Chrome only shows one side panel UI at a time. Typical flow is setup in extension panel, then use Gemini panel on the same tab.

## Is production protected from accidental writes?

Yes. Mutating operations require explicit confirmation. Environment state is visible, and production use is intentionally frictioned.

## Does this extension replace the dashboard UI?

No. It is an automation/tooling layer, not a full UI replacement.

## How to report issues?

Include: tool name, action, input used, environment (UAT/Prod), console logs, extension build timestamp, and expected vs actual result.