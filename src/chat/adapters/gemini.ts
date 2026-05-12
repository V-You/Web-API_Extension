import type { ChatToolDeclaration, ChatToolEvent } from "../llm-adapter";
import { sendToSw } from "../sw-client";

export interface GeminiPart {
  text?: string;
  functionCall?: {
    id?: string;
    name: string;
    args: Record<string, unknown>;
  };
  functionResponse?: {
    id: string;
    name: string;
    response: {
      response: unknown;
    };
  };
}

export interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

export interface GeminiTurnResult {
  history: GeminiContent[];
  assistantText: string;
  toolEvents: ChatToolEvent[];
  finishReason: "text" | "max_rounds";
}

interface GeminiCandidate {
  content?: GeminiContent;
}

interface GeminiGenerateResponse {
  candidates?: GeminiCandidate[];
}

interface GeminiGenerateResult {
  ok: boolean;
  status: number;
  data?: GeminiGenerateResponse;
  error?: string;
}

interface RunGeminiTurnInput {
  apiKey: string;
  model: string;
  history: GeminiContent[];
  userText: string;
  systemPrompt: string;
  tools: ChatToolDeclaration[];
  maxRounds?: number;
  executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

interface GeminiErrorPayload {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

function buildRequestBody(contents: GeminiContent[], tools: ChatToolDeclaration[]) {
  return {
    contents,
    tools: [
      {
        functionDeclarations: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        })),
      },
    ],
  };
}

function extractText(parts: GeminiPart[]): string {
  return parts
    .map((part) => part.text ?? "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractFunctionCalls(parts: GeminiPart[]) {
  return parts
    .map((part) => part.functionCall)
    .filter((call): call is NonNullable<GeminiPart["functionCall"]> => Boolean(call));
}

function formatGeminiError(result: GeminiGenerateResult): string {
  let payload: GeminiErrorPayload | null = null;

  if (result.error) {
    try {
      payload = JSON.parse(result.error) as GeminiErrorPayload;
    } catch {
      payload = null;
    }
  }

  const code = payload?.error?.code ?? result.status;
  const status = payload?.error?.status ?? "";
  const message = payload?.error?.message ?? result.error ?? "Gemini request failed.";

  if (code === 503 || status === "UNAVAILABLE") {
    return "Gemini is temporarily unavailable due to high demand. Please try again in a moment.";
  }

  if (code === 400 || status === "INVALID_ARGUMENT") {
    return `Gemini rejected the request payload: ${message}`;
  }

  return `Gemini request failed (${code}): ${message}`;
}

async function generateContent(
  apiKey: string,
  model: string,
  body: Record<string, unknown>,
): Promise<GeminiGenerateResponse> {
  const result = await sendToSw<GeminiGenerateResult>({
    type: "chat:gemini-generate",
    payload: { apiKey, model, body },
  });

  if (!result.ok || !result.data) {
    throw new Error(formatGeminiError(result));
  }

  return result.data;
}

export async function runGeminiTurn(input: RunGeminiTurnInput): Promise<GeminiTurnResult> {
  const maxRounds = input.maxRounds ?? 12;
  const toolEvents: ChatToolEvent[] = [];
  let history = [
    ...input.history,
    {
      role: "user" as const,
      parts: [
        {
          text: `${input.systemPrompt}\n\n${input.userText}`,
        },
      ],
    },
  ];

  for (let round = 0; round < maxRounds; round++) {
    const response = await generateContent(
      input.apiKey,
      input.model,
      buildRequestBody(history, input.tools),
    );

    const candidate = response.candidates?.[0]?.content;
    if (!candidate) {
      throw new Error("Gemini returned no candidate content.");
    }

    history = [...history, candidate];

    const functionCalls = extractFunctionCalls(candidate.parts ?? []);
    if (functionCalls.length === 0) {
      return {
        history,
        assistantText: extractText(candidate.parts ?? []) || "No text response returned.",
        toolEvents,
        finishReason: "text",
      };
    }

    const functionResponses: GeminiPart[] = [];
    for (const call of functionCalls) {
      const callId = call.id ?? crypto.randomUUID();
      const result = await input.executeTool(call.name, call.args ?? {});
      toolEvents.push({
        id: callId,
        name: call.name,
        args: call.args ?? {},
        result,
      });
      functionResponses.push({
        functionResponse: {
          id: callId,
          name: call.name,
          response: {
            response: result,
          },
        },
      });
    }

    history = [
      ...history,
      {
        role: "user",
        parts: functionResponses,
      },
    ];
  }

  return {
    history,
    assistantText: "I stopped after reaching the tool-call limit for this turn. For multi-step write or test workflows, use Draft Job or ask me to run the workflow as a background Job so the work continues outside the chat tool loop.",
    toolEvents,
    finishReason: "max_rounds",
  };
}