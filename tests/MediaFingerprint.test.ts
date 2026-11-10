// @vitest-environment node
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { fingerprintBytes } from "@/vault/MediaFingerprint";

it.each([false, true])("fingerprints exact bytes across ArrayBuffer contexts (foreign: %s)", async foreign => {
  const values = [0, 1, 254, 255];
  const bytes = foreign
    ? runInNewContext("new Uint8Array([0, 1, 254, 255]).buffer") as ArrayBuffer
    : new Uint8Array(values).buffer;
  expect(bytes instanceof ArrayBuffer).toBe(!foreign);
  expect(await fingerprintBytes(bytes)).toEqual({
    sizeBytes: values.length,
    sha256: createHash("sha256").update(new Uint8Array(values)).digest("hex")
  });
});
