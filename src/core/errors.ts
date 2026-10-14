export type AgentLensErrorCode =
  | "auth_required"
  | "forbidden"
  | "quota_exhausted"
  | "rate_limited"
  | "invalid_response"
  | "network_unavailable"
  | "provider_unavailable"
  | "vault_conflict"
  | "vault_write_failed"
  | "unknown";

export class AgentLensError extends Error {
  constructor(
    readonly code: AgentLensErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly status?: number | undefined,
    options?: ErrorOptions,
    readonly requestId?: string | undefined,
    readonly execution?: { retryAt?: string | undefined; failureClass?: string | undefined; retryable?: boolean | undefined; chargedUnits?: number | undefined } | undefined,
    readonly serverCode?: string | undefined
  ) {
    super(message, options);
    this.name = "AgentLensError";
  }
}

export function classifyHttpError(status: number, message: string, requestId?: string): AgentLensError {
  if (status === 401) return new AgentLensError("auth_required", message, false, status, undefined, requestId);
  if (status === 403) return new AgentLensError("forbidden", message, false, status, undefined, requestId);
  if (status === 402 || status === 429) {
    return new AgentLensError(status === 402 ? "quota_exhausted" : "rate_limited", message, status === 429, status, undefined, requestId);
  }
  if (status >= 500) return new AgentLensError("provider_unavailable", message, true, status, undefined, requestId);
  return new AgentLensError("unknown", message, false, status, undefined, requestId);
}
