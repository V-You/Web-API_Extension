export interface ChatToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatToolEvent {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result: unknown;
}