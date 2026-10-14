import { describe, expect, it } from "vitest";
import { SecretTokenStore } from "@/runtime/SecretTokenStore";

describe("SecretTokenStore", () => {
  it("stores only a secret reference and can revoke it", () => {
    const values = new Map<string, string>();
    const store = new SecretTokenStore({
      getSecret: (id) => values.get(id) ?? null,
      setSecret: (id, value) => { values.set(id, value); }
    });

    const id = store.setRefreshToken("Install/ABC", "refresh-secret");
    expect(id).toBe("agentlens-refresh-install-abc");
    expect(store.getRefreshToken(id)).toBe("refresh-secret");
    store.clearRefreshToken(id);
    expect(store.getRefreshToken(id)).toBeNull();
    expect(values.get(id)).toBe("agentlens-revoked");
  });

  it("clears through a non-blank overwrite accepted by Obsidian SecretStorage", () => {
    const values = new Map<string, string>();
    const store = new SecretTokenStore({
      getSecret: (id) => values.get(id) ?? null,
      setSecret: (id, value) => {
        if (!value) throw new Error("must not be blank");
        values.set(id, value);
      }
    });

    const id = store.setRefreshToken("install-1", "refresh-secret");
    expect(() => store.clearRefreshToken(id)).not.toThrow();
    expect(store.getRefreshToken(id)).toBeNull();
  });
});
