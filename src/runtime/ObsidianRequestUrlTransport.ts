import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from "obsidian";
import { AgentLensError, classifyHttpError } from "../core/errors";

export interface TransportRequest {
  path: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | undefined;
  body?: unknown;
  accessToken?: string | undefined;
  requestId?: string | undefined;
  idempotencyKey?: string | undefined;
  installationId?: string | undefined;
}

export interface JsonTransport {
  json<T>(request: TransportRequest, validate: (value: unknown) => T): Promise<T>;
}

type RequestUrlFn = (request: RequestUrlParam | string) => Promise<RequestUrlResponse>;

export class ObsidianRequestUrlTransport {
  constructor(
    private readonly baseUrl: string,
    private readonly send: RequestUrlFn = requestUrl,
    private readonly createRequestId: () => string = () => crypto.randomUUID(),
    private readonly clientVersion = "unknown",
    private readonly obsidianVersion = "unknown"
  ) {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
      throw new Error("AgentLens API base URL must use HTTPS.");
    }
  }

  async json<T>(request: TransportRequest, validate: (value: unknown) => T): Promise<T> {
    const response = await this.request(request);
    const responseId = responseRequestId(response);
    let value: unknown;
    try {
      value = response.text ? JSON.parse(response.text) : null;
    } catch (cause) {
      throw new AgentLensError("invalid_response", "AgentLens returned invalid JSON.", false, response.status, { cause }, responseId);
    }

    try {
      return validate(value);
    } catch (cause) {
      throw new AgentLensError("invalid_response", "AgentLens returned an unexpected response shape.", false, response.status, { cause }, responseId);
    }
  }

  async request(request: TransportRequest): Promise<RequestUrlResponse> {
    const requestId = request.requestId ?? this.createRequestId();
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-AgentLens-Client-Type": "obsidian_plugin",
      "X-AgentLens-Client-Version": this.clientVersion,
      "X-AgentLens-Obsidian-Version": this.obsidianVersion,
      "X-Request-ID": requestId
    };
    if (request.body !== undefined) headers["Content-Type"] = "application/json";
    if (request.accessToken) headers.Authorization = `Bearer ${request.accessToken}`;
    if (request.idempotencyKey) headers["Idempotency-Key"] = request.idempotencyKey;
    if (request.installationId) headers["X-AgentLens-Installation-Id"] = request.installationId;

    let response: RequestUrlResponse;
    try {
      const body = request.body === undefined ? {} : { body: JSON.stringify(request.body) };
      response = await this.send({
        url: new URL(request.path.replace(/^\/+/, ""), ensureTrailingSlash(this.baseUrl)).toString(),
        method: request.method ?? "GET",
        headers,
        ...body,
        throw: false
      });
    } catch (cause) {
      const rejectedResponse = rejectedRequestUrlResponse(cause);
      if (rejectedResponse) {
        const details = safeErrorDetails(rejectedResponse.text, rejectedResponse.status);
        throw executionHttpError(rejectedResponse.status, details, details.requestId ?? rejectedResponse.requestId ?? requestId);
      }
      throw new AgentLensError("network_unavailable", "Could not reach AgentLens.", true, undefined, { cause }, requestId);
    }

    if (response.status < 200 || response.status >= 300) {
      const details = safeErrorDetails(response.text, response.status);
      throw executionHttpError(response.status, details, details.requestId ?? responseRequestId(response) ?? requestId);
    }
    return response;
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

interface ErrorDetails { code?: string; message: string; requestId?: string; execution?: AgentLensError["execution"] }

function executionHttpError(status: number, details: ErrorDetails, requestId: string): AgentLensError {
  if (details.code && ["QUOTA_EXCEEDED", "QUOTA_EXHAUSTED", "INSUFFICIENT_QUOTA"].includes(details.code)) {
    return new AgentLensError("quota_exhausted", "Not enough credits to parse this link. Check Billing & Usage to add credits or wait for your quota to reset.", false, status, undefined, requestId, details.execution, details.code);
  }
  const classified = classifyHttpError(status, details.message, requestId);
  return new AgentLensError(classified.code, classified.message, details.execution?.retryable ?? classified.retryable,
    status, undefined, requestId, details.execution, details.code);
}

function safeErrorDetails(text: string, status: number): ErrorDetails {
  try {
    const parsed = JSON.parse(text) as { code?: unknown; message?: unknown; requestId?: unknown; traceId?: unknown; details?: Record<string, unknown>; error?: { code?: unknown; message?: unknown; details?: Record<string, unknown> } };
    const code = typeof parsed.code === "string" ? parsed.code : typeof parsed.error?.code === "string" ? parsed.error.code : undefined;
    const message = typeof parsed.message === "string" ? parsed.message : parsed.error?.message;
    const requestId = typeof parsed.requestId === "string" ? parsed.requestId : typeof parsed.traceId === "string" ? parsed.traceId : undefined;
    const raw = parsed.details ?? parsed.error?.details;
    const execution = raw && typeof raw === "object" ? {
      retryable: typeof raw.retryable === "boolean" ? raw.retryable : undefined,
      retryAt: typeof raw.retryAt === "string" && Number.isFinite(Date.parse(raw.retryAt)) ? raw.retryAt : undefined,
      failureClass: typeof raw.failureClass === "string" ? raw.failureClass : undefined,
      chargedUnits: typeof raw.chargedUnits === "number" ? raw.chargedUnits : undefined
    } : undefined;
    return { ...(code ? { code } : {}),
      message: typeof message === "string" && message.trim() ? message.slice(0, 300) : `AgentLens request failed with HTTP ${status}.`,
      ...(requestId ? { requestId } : {}), execution };
  } catch {
    // Error bodies are untrusted; never surface raw HTML or token-bearing payloads.
  }
  return { message: `AgentLens request failed with HTTP ${status}.` };
}

function responseRequestId(response: RequestUrlResponse): string | undefined {
  const value = response.headers["x-request-id"] ?? response.headers["X-Request-ID"] ?? response.headers["x-trace-id"] ?? response.headers["X-Trace-ID"];
  return typeof value === "string" && value.trim() ? value : undefined;
}

interface RejectedRequestUrlResponse {
  status: number;
  text: string;
  requestId?: string | undefined;
}

function rejectedRequestUrlResponse(cause: unknown): RejectedRequestUrlResponse | undefined {
  if (!cause || typeof cause !== "object") return undefined;
  const candidate = cause as Record<string, unknown>;
  const status = candidate.status;
  if (typeof status !== "number" || !Number.isInteger(status) || status < 100 || status > 599) return undefined;

  const text = typeof candidate.text === "string" ? candidate.text : "";
  const headers = candidate.headers;
  let requestId: string | undefined;
  if (headers && typeof headers === "object") {
    const values = headers as Record<string, unknown>;
    const value = values["x-request-id"] ?? values["X-Request-ID"] ?? values["x-trace-id"] ?? values["X-Trace-ID"];
    if (typeof value === "string" && value.trim()) requestId = value;
  }
  return { status, text, ...(requestId ? { requestId } : {}) };
}
