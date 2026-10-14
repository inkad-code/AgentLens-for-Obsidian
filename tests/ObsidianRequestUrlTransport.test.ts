import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RequestUrlParam, RequestUrlResponse } from "obsidian";
import { ObsidianRequestUrlTransport } from "@/runtime/ObsidianRequestUrlTransport";

function response(status: number, text: string): RequestUrlResponse {
  return { status, text, json: null, headers: {}, arrayBuffer: new ArrayBuffer(0) };
}

describe("ObsidianRequestUrlTransport", () => {
  const send = vi.fn<(request: string | RequestUrlParam) => Promise<RequestUrlResponse>>();

  beforeEach(() => send.mockReset());

  it.each([undefined, "", "   "])("preserves reconciliation metadata when the server message is %s", async (message) => {
    send.mockResolvedValue(response(409, JSON.stringify({
      error: { code: "EXECUTION_RECONCILIATION_REQUIRED", message, details: {
        retryable: false, failureClass: "reconciliation_required", chargedUnits: 0
      } }, requestId: "request-reconcile"
    })));
    const transport = new ObsidianRequestUrlTransport("https://api.agentlens.example", send);
    await expect(transport.request({ path: "/fetch" })).rejects.toMatchObject({
      code: "unknown", serverCode: "EXECUTION_RECONCILIATION_REQUIRED",
      requestId: "request-reconcile", retryable: false,
      message: "AgentLens request failed with HTTP 409.",
      execution: { failureClass: "reconciliation_required", chargedUnits: 0 }
    });
  });

  it("honors terminal execution failures even on HTTP 503 and preserves retry timing", async () => {
    const transport = new ObsidianRequestUrlTransport("https://api.agentlens.example", send);
    send.mockResolvedValue(response(503, JSON.stringify({error: {message: "Failed", details: {
      retryable: false, failureClass: "unrecoverable", chargedUnits: 0
    }}})));
    await expect(transport.request({path: "/fetch"})).rejects.toMatchObject({retryable: false, execution: {chargedUnits: 0}});
    send.mockResolvedValue(response(503, JSON.stringify({error: {message: "Wait", details: {
      retryable: true, retryAt: "2026-09-18T10:00:00Z", failureClass: "delayed"
    }}})));
    await expect(transport.request({path: "/fetch"})).rejects.toMatchObject({retryable: true,
      execution: {retryAt: "2026-09-18T10:00:00Z", failureClass: "delayed"}});
  });

  it("adds Obsidian identity, request and idempotency headers", async () => {
    send.mockResolvedValue(response(200, '{"ok":true}'));
    const transport = new ObsidianRequestUrlTransport(
      "https://api.agentlens.example/v1",
      send,
      () => "request-1",
      "0.1.0",
      "1.13.7"
    );

    await expect(transport.json({
      path: "content/fetch",
      method: "POST",
      body: { url: "https://example.com/post" },
      accessToken: "access-secret",
      idempotencyKey: "idem-1"
    }, (value) => value as { ok: boolean })).resolves.toEqual({ ok: true });

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://api.agentlens.example/v1/content/fetch",
      headers: expect.objectContaining({
        "X-AgentLens-Client-Type": "obsidian_plugin",
        "X-AgentLens-Client-Version": "0.1.0",
        "X-AgentLens-Obsidian-Version": "1.13.7",
        "X-Request-ID": "request-1",
        "Idempotency-Key": "idem-1",
        Authorization: "Bearer access-secret"
      })
    }));
  });

  it("classifies retryable server failures without exposing raw HTML", async () => {
    send.mockResolvedValue(response(503, "<html>upstream internals</html>"));
    const transport = new ObsidianRequestUrlTransport("https://api.agentlens.example", send);

    await expect(transport.request({ path: "/health" })).rejects.toMatchObject({
      code: "provider_unavailable",
      retryable: true,
      status: 503,
      message: "AgentLens request failed with HTTP 503."
    });
  });

  it("fails closed when response validation rejects a DTO", async () => {
    send.mockResolvedValue(response(200, '{"unexpected":true}'));
    const transport = new ObsidianRequestUrlTransport("https://api.agentlens.example", send);

    await expect(transport.json({ path: "/account" }, () => {
      throw new Error("missing account id");
    })).rejects.toMatchObject({ code: "invalid_response", retryable: false });
  });

  it("surfaces the bounded backend envelope message without exposing the whole payload", async () => {
    send.mockResolvedValue(response(409, JSON.stringify({
      success: false,
      error: { code: "STALE_LEASE", message: "This scheduler lease is no longer active." },
      requestId: "request-1",
      privateDetails: "must-not-surface"
    })));
    const transport = new ObsidianRequestUrlTransport("https://api.agentlens.example", send);

    await expect(transport.request({ path: "/scheduler" })).rejects.toMatchObject({
      message: "This scheduler lease is no longer active.",
      serverCode: "STALE_LEASE",
      status: 409,
      requestId: "request-1"
    });
  });

  it("keeps the client request id on network failures for a diagnostic retry", async () => {
    const reject = async (): Promise<RequestUrlResponse> => { throw new Error("offline"); };
    const transport = new ObsidianRequestUrlTransport("https://api.agentlens.example", reject, () => "request-network-1");

    try {
      await transport.request({ path: "/content/fetch" });
      throw new Error("request unexpectedly succeeded");
    } catch (error) {
      const diagnostic = error as { code?: string; retryable?: boolean; requestId?: string };
      expect(diagnostic.code).toBe("network_unavailable");
      expect(diagnostic.retryable).toBe(true);
      expect(diagnostic.requestId).toBe("request-network-1");
    }
  });

  it("classifies a rejected requestUrl HTTP response instead of reporting an offline network", async () => {
    const reject = async (): Promise<RequestUrlResponse> => {
      throw {
        status: 504,
        text: JSON.stringify({
          success: false,
          error: { code: "UPSTREAM_TIMEOUT", message: "The upstream provider timed out." },
          requestId: "request-server-504"
        }),
        headers: { "x-request-id": "request-header-504" },
        json: null,
        arrayBuffer: new ArrayBuffer(0)
      } satisfies RequestUrlResponse;
    };
    const transport = new ObsidianRequestUrlTransport(
      "https://api.agentlens.example",
      reject,
      () => "request-client-504"
    );

    await expect(transport.request({ path: "/content/fetch" })).rejects.toMatchObject({
      code: "provider_unavailable",
      retryable: true,
      status: 504,
      message: "The upstream provider timed out.",
      serverCode: "UPSTREAM_TIMEOUT",
      requestId: "request-server-504"
    });
  });

  it("uses a generic bounded message and response header id for rejected non-JSON HTTP bodies", async () => {
    const reject = async (): Promise<RequestUrlResponse> => {
      throw {
        status: 502,
        text: "<html>private proxy details</html>",
        headers: { "X-Trace-ID": "trace-server-502" }
      };
    };
    const transport = new ObsidianRequestUrlTransport("https://api.agentlens.example", reject);

    await expect(transport.request({ path: "/content/fetch" })).rejects.toMatchObject({
      code: "provider_unavailable",
      retryable: true,
      status: 502,
      message: "AgentLens request failed with HTTP 502.",
      requestId: "trace-server-502"
    });
  });
});

it("shows the quota reason even when the execution envelope has a generic terminal message", async () => {
  const send = vi.fn(async () => response(429, JSON.stringify({ success: false, error: {
    code: "QUOTA_EXCEEDED", message: "This execution cannot retry automatically.",
    details: { failureClass: "unrecoverable", retryable: false, chargedUnits: 0 }
  } })));
  const transport = new ObsidianRequestUrlTransport("https://api.example", send);
  await expect(transport.request({ path: "/fetch" })).rejects.toMatchObject({
    code: "quota_exhausted", serverCode: "QUOTA_EXCEEDED", retryable: false, message: expect.stringContaining("Not enough credits")
  });
});
