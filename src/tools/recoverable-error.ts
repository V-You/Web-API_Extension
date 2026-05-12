export type FailureCategory =
  | "routing_failure"
  | "context_failure"
  | "recovery_failure"
  | "identifier_failure"
  | "schema_failure"
  | "safety_failure"
  | "explanation_failure"
  | "product_capability_failure"
  | "data_source_failure";

export interface RecoverableToolErrorPayload {
  ok: false;
  errorCode: string;
  failureCategory: FailureCategory;
  message: string;
  recoverable: true;
  recovery?: {
    reason: string;
    recommendedTool?: string;
    recommendedArgs?: Record<string, unknown>;
    retryTool?: string;
    retryArgsPatch?: Record<string, unknown>;
    deriveFields?: string[];
  };
}

export class RecoverableToolError extends Error {
  readonly payload: RecoverableToolErrorPayload;

  constructor(payload: RecoverableToolErrorPayload) {
    super(payload.message);
    this.name = "RecoverableToolError";
    this.payload = payload;
  }
}

export function isRecoverableToolError(error: unknown): error is RecoverableToolError {
  return error instanceof RecoverableToolError;
}
