import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import { DiagnosticLog, safeFields } from '@/diagnostics/log';
const scope = { userId: 'user-a', installationId: 'ins-a' };
const name = () => `diagnostic-test-${crypto.randomUUID()}`;

describe('bounded private diagnostic journal', () => {
  it('rejects credentials, paths, URLs, raw messages, payloads and noncanonical identifiers', () => {
    const result = safeFields({ requestId: 'req-1', errorCode: 'CREATOR_IDENTITY_MISMATCH', attempts: 2,
      accessToken: 'secret', refreshToken: 'secret', password: 'secret', email: 'someone@example.org',
      lastError: 'Bearer secret', libraryPath: '/Users/person/Private.library', cursor: 'signed-cursor',
      creatorId: 'https://example.org/?token=secret', status: 'error at /Users/private',
      response: { secret: 'secret' }, downloadUrl: 'https://example.org/?signature=secret' });
    expect(result).toEqual({ requestId: 'req-1', errorCode: 'CREATOR_IDENTITY_MISMATCH', attempts: 2 });
  });
  it('survives reopening, caps rows, expires old events and isolates accounts/installations', async () => {
    let now = 1000;
    const database = name();
    const first = new DiagnosticLog(database, () => now, 3, 100);
    first.record('operation.admitted', scope, { requestId: 'old' }); await first.flush();
    now = 1200;
    first.record('operation.admitted', scope, { requestId: 'a' });
    first.record('operation.admitted', { ...scope, userId: 'user-b' }, { requestId: 'b' });
    first.record('operation.admitted', { ...scope, installationId: 'ins-b' }, { requestId: 'c' });
    await first.flush();
    const second = new DiagnosticLog(database, () => now, 3, 100);
    expect((await second.read(scope, 0)).events.map(e => e.fields.requestId)).toEqual(['a']);
    second.record('operation.transition', scope, { requestId: 'd' }); await second.flush();
    expect((await first.read(scope, 0)).events.map(e => e.fields.requestId)).toEqual(['d']);
    now = 1400;
    expect((await second.read(scope, 0)).events).toEqual([]);
  });
  it('bounds buffered observations and reports losses without rejecting execution', async () => {
    const log = new DiagnosticLog(name());
    for (let i = 0; i < 210; i++) log.record('api.started', scope, { requestId: `request-${i}` });
    expect(log.dropped).toBe(10);
    await log.flush();
    expect((await log.read(scope, 0)).events).toHaveLength(200);
  });
  it('does not overwrite concurrent renderer batches', async () => {
    const database = name();
    const a = new DiagnosticLog(database), b = new DiagnosticLog(database);
    a.record('api.started', scope, { requestId: 'a' });
    b.record('api.started', scope, { requestId: 'b' });
    await Promise.all([a.flush(), b.flush()]);
    expect((await a.read(scope, 0)).events.map(e => e.fields.requestId).sort()).toEqual(['a', 'b']);
  });
  it('degrades safely when storage fails', async () => {
    const log = new DiagnosticLog(name());
    const spy = vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw new Error('disk unavailable'); });
    log.record('api.started', scope);
    await expect(log.flush()).resolves.toBeUndefined();
    expect(log.storageFailures).toBe(1);
    expect(log.dropped).toBe(1);
    spy.mockRestore();
  });
});

it("rejects incomplete diagnostic ownership rather than exporting unowned rows", async () => {
  const log = new DiagnosticLog(name());
  log.record("source.started", { userId: "", installationId: "vault" }, { requestId: "private" });
  expect(log.dropped).toBe(1);
  expect((await log.read(scope, 0)).events).toEqual([]);
  await expect(log.read({ userId: "", installationId: "vault" }, 0)).rejects.toThrow("Invalid diagnostic scope");
});
