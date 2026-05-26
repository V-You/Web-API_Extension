/**
 * Lightweight gateway telemetry context.
 *
 * This bridges existing tool handlers to apiRequest() without changing every
 * handler signature. Explicit apiRequest opts still win. The context is only
 * used around a governed tool/job execution and is cleared in finally blocks.
 */

export interface GatewayTelemetryContext {
  parentCorrelationId?: string;
}

let currentContext: GatewayTelemetryContext | null = null;

export function getGatewayTelemetryContext(): GatewayTelemetryContext | null {
  return currentContext;
}

export async function runWithGatewayTelemetryContext<T>(
  context: GatewayTelemetryContext | null,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = currentContext;
  currentContext = context;
  try {
    return await fn();
  } finally {
    currentContext = previous;
  }
}
