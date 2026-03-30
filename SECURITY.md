# Web API Extension

...

## R&D

- When calling `navigator.modelContext.registerTool()`, utilize the `inputSchema` to strictly type parameters. For the `post-execution` logic, implement a **Client-Side Redactor** that transforms sensitive business metrics into "bins" or "categories" (e.g., instead of "12.4% Chargeback rate," return "Risk Category: Elevated") before the JSON object hits the LLM.
- ...

...

--- 

# WebMCP in general

- **"cross-context leakage"** - LLM correlates backend configuration with frontend business data
**W3C WebMachineLearning Community Group**
- Risk: **"Excessive Agency"** and **"Metadata Correlation"**: LLM sees both the "how" (risk/hierarchy/user config via backend calls/responses) and the "what" (shopper amounts/chargebacks via Dashboard/scraping tasks). It can build a holistic model of a business that neither the frontend nor the backend alone would expose.

Current research:

### 1. The "Encrypted Response" problem: zk-MCP
* **Zero-Knowledge MCP (zk-MCP):** Instead of sending raw data to the LLM provider, the browser (acting as the client) generates a Zero-Knowledge Proof (ZKP). This proof allows the LLM to verify that a certain condition was met (e.g., "The merchant has a chargeback rate below 2%") without ever seeing the raw transaction data.
* **The Summarization Hurdle:** If the LLM needs to summarize the data, it ... needs the data. **"Hybrid Context"** approach: the LLM receives a redacted "summary schema" (metadata about the data) to plan the task, but the actual "sensitive processing" is offloaded to a **local execution environment** or a **Confidential Enclave**.

### 2. WebMCP middleware: The "Gradual Exposure" tool
A formal proposal in the [WebMCP W3C draft (Issue #121)](https://github.com/webmachinelearning/webmcp/issues/121) extends the protocol to include redaction tools.
* **Redaction Middleware:** The proposal includes `pre-execution` and `post-execution` middleware. A website developer could register a middleware that automatically strips PII or business-sensitive identifiers from a tool's response before the result is returned to the LLM provider.
* **Data Classification Tags:** There is a push to include `dataClassification` requirements in the `registerTool` API. This would force developers to label tool outputs (e.g., `public`, `internal`, `highly-sensitive`), allowing the browser to automatically block or encrypt "highly-sensitive" fields unless specific user consent is given via a modal.

### 3. Mitigation approaches: The "Compromises"
Instead of going fully local, three "middle-ground" solutions:

| Approach | How it mitigates exposure | Current tools/research |
| :--- | :--- | :--- |
| **Confidential Computing** | The LLM runs inside a hardware-secured enclave (TEE). The provider cannot "see" the weights or the data. | **Opaque Systems**, **NVIDIA Confidential AI** |
| **Differential Privacy** | Noise is added to business data so the LLM learns trends but cannot extract exact values. | **OpenDP**, **Google DP Library** |
| **Agent Identity & Tokens** | Tools verify the "Identity" of the agent. A "trusted" agent gets full data; an "untrusted" one gets a redacted view. | [W3C WebMCP Proposal 4](https://github.com/webmachinelearning/webmcp/issues/121) |

### 4. Who is solving this?
* **W3C WebMachineLearning Community Group:** The primary architects of [WebMCP](https://developer.chrome.com/blog/webmcp-epp).
* **OWASP GenAI Security Project:** They maintain the [LLM06: Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/) framework, which specifically warns against the type of data correlation discussed above (LLM sees frontend + backend).
* **Academic Research:** Researchers at institutions like **arXiv** are actively publishing on **"Privacy-Preserving Agentic Web"** and **"zk-MCP"** (Zero-Knowledge Model Context Protocol).

