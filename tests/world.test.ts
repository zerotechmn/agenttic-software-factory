import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.ts';
import { startConsole } from '../src/console/server.ts';
import { newState, saveState } from '../src/state.ts';
import { FACTORY_ROOT } from '../src/config.ts';
describe('world hosting', () => {
  it('serves the built realm and assets from both server modes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'forge-world-'));
    saveState(dir, newState('world-test'));
    const servers = [await startServer(dir, null, 0), await startConsole({ root: dir, port: 0, spawn: () => {} })];
    try {
      for (const server of servers) {
        const response = await fetch(`${server.url}/world/`);
        if (!existsSync(join(FACTORY_ROOT, 'world/dist/index.html'))) {
          expect(response.status).toBe(404);
          expect(await response.text()).toContain('world:build');
          continue;
        }
        expect(response.status).toBe(200);
        const html = await response.text();
        expect(html).toContain('FORGE World');
        const script = html.match(/src="(\/world\/assets\/[^\"]+\.js)"/)!;
        expect(script).not.toBeNull();
        expect((await fetch(`${server.url}${script[1]}`)).headers.get('content-type')).toBe('text/javascript');
        const image = await fetch(`${server.url}/world/forge/map.webp`);
        expect(image.status).toBe(200);
        expect(image.headers.get('content-type')).toBe('image/webp');
        expect((await fetch(`${server.url}/world/missing.js`)).status).toBe(404);
      }
    } finally { await Promise.all(servers.map(server => server.close())); }
  });
});
