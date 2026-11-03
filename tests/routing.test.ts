import { expect, it, vi } from 'vitest';
import { routingProvider, redact } from '../src/routing.ts';
const input = { summary: 'test task', eligibleRoles: ['dev'], baselineRole: 'dev' };
it('disabled makes no call', async () => { const fetch = vi.fn(); expect(await routingProvider('disabled', { fetch }).suggest(input)).toBeNull(); expect(fetch).not.toHaveBeenCalled(); });
it('mock is deterministic and simulated', async () => { expect(await routingProvider('mock').suggest(input)).toMatchObject({ source: 'simulated', assignedRole: 'dev', suggestedRole: 'dev', usage: null }); });
it('missing credentials preserves baseline', async () => { expect(await routingProvider('shadow').suggest(input)).toMatchObject({ assignedRole: 'dev', error: 'missing_credentials', source: 'external' }); });
it('redacts credentials', () => expect(redact('token=abc Bearer xyz sk-ant-test')).not.toContain('abc'));
it.each(['dev', 'qa'])('validates role %s', async (choice) => { const fetch = vi.fn(async () => new Response(JSON.stringify({ answers: { owner: { type: 'choice', choice, confidence: 1, probabilities: { [choice]: 1 } } } }))) as unknown as typeof globalThis.fetch; const r = await routingProvider('shadow', { key: 'test', model: 'test', fetch }).suggest(input); expect(r?.assignedRole).toBe('dev'); expect(r?.error).toBe(choice === 'dev' ? null : 'invalid_role_or_distribution'); });
it('bounds hung providers', async () => { const fetch = (() => new Promise(() => { })) as typeof globalThis.fetch; expect((await routingProvider('shadow', { key: 'test', model: 'test', fetch, timeoutMs: 5 }).suggest(input))?.error).toBe('timeout'); });
it('rejects malformed output', async () => { const fetch = (async () => new Response('{}')) as typeof globalThis.fetch; expect((await routingProvider('shadow', { key: 'test', model: 'test', fetch }).suggest(input))?.error).toBe('malformed_response'); });
it('network errors are sanitized', async () => {
    const fetch = vi.fn(async () => { throw new Error('Bearer private-secret'); }) as unknown as typeof globalThis.fetch;
    const result = await routingProvider('shadow', { key: 'private-secret', model: 'test', fetch }).suggest(input);
    expect(result?.error).toBe('provider_failure');
    expect(JSON.stringify(result)).not.toContain('private-secret');
});
it('records only returned usage and redacts outbound summary', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ model: 'test-v1', answers: { owner: { type: 'choice', choice: 'qa', confidence: 1, probabilities: { dev: 0, qa: 1 } } }, usage: { input_tokens: 12, output_tokens: 3 } }))) as unknown as typeof globalThis.fetch;
    const task = { summary: 'token=private-secret', eligibleRoles: ['dev', 'qa'], baselineRole: 'dev' };
    const result = await routingProvider('shadow', { key: 'key', model: 'test', fetch }).suggest(task);
    expect(result).toMatchObject({ source: 'external', assignedRole: 'dev', suggestedRole: 'qa', assignmentChanged: false, usage: { input_tokens: 12, output_tokens: 3 } });
    expect(task.baselineRole).toBe('dev');
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(JSON.stringify(body)).not.toContain('private-secret');
    expect(body.state).toBe('[REDACTED]');
});
it.each([401, 429, 529])('bounds HTTP failure %s', async (status) => {
    const fetch = vi.fn(async () => new Response('sensitive body', { status })) as unknown as typeof globalThis.fetch;
    expect((await routingProvider('shadow', { key: 'key', model: 'test', fetch }).suggest(input))?.error).toBe(`http_${status}`);
    expect(fetch).toHaveBeenCalledTimes(1);
});
it('observer deduplicates and drains without changing input', async () => {
    const { RoutingObserver } = await import('../src/routing.ts');
    const emit = vi.fn();
    const provider = { suggest: vi.fn(routingProvider('mock').suggest) };
    const observer = new RoutingObserver(provider, emit);
    observer.observe('T1', input);
    observer.observe('T1', input);
    await observer.flush();
    expect(provider.suggest).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('T1', expect.objectContaining({ assignedRole: 'dev', assignmentChanged: false }));
});
it('approval fingerprints change when task context changes', async () => {
    const { taskRevision } = await import('../src/routing.ts');
    const task = { title: 'test', description: 'first', lanes: ['src/**'] };
    expect(taskRevision(task)).not.toBe(taskRevision({ ...task, description: 'second' }));
});
it('fails closed on missing and stale task approvals', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { approvedTaskSummary, taskRevision } = await import('../src/routing.ts');
    const dir = mkdtempSync(join(tmpdir(), 'routing-approval-'));
    const task = { id: 'T1', title: 'test', description: 'description', lanes: ['src/**'] };
    try {
        expect(approvedTaskSummary(dir, task)).toBeUndefined();
        mkdirSync(join(dir, '.forge'));
        writeFileSync(join(dir, '.forge', 'routing-approved.json'), JSON.stringify({ T1: { revision: taskRevision(task), summary: 'approved text' } }));
        expect(approvedTaskSummary(dir, task)).toBe('approved text');
        expect(approvedTaskSummary(dir, { ...task, title: 'changed' })).toBeUndefined();
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
it('routing mode: unset is disabled, typos fail fast', async () => {
    const { routingMode } = await import('../src/routing.ts');
    expect(routingMode(undefined)).toBe('disabled');
    expect(routingMode('')).toBe('disabled');
    expect(routingMode('shadow')).toBe('shadow');
    expect(() => routingMode('shadwo')).toThrow(/invalid FORGE_ROUTING_MODE: shadwo/);
});
