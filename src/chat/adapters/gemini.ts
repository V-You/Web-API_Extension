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
    throw new Error(result.error ?? `Gemini request failed (${result.status}).`);
  }

  return result.data;
}

export async function runGeminiTurn(input: RunGeminiTurnInput): Promise<GeminiTurnResult> {
  const maxRounds = input.maxRounds ?? 6;
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
    assistantText: "I stopped after reaching the tool-call limit for this turn.",
    toolEvents,
    finishReason: "max_rounds",
  };
}