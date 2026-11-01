import { chromium } from "@playwright/test"; import { createServer } from "node:http"; import { readFileSync } from "node:fs"; import { join } from "node:path";
const dir = process.argv[2]; const srv = createServer((q, s) => { try { s.end(readFileSync(join(dir, decodeURIComponent(q.url.slice(1).split("?")[0])))); } catch { s.statusCode = 404; s.end(); } }).listen(0);
const port = srv.address().port; const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
await p.goto(`http://127.0.0.1:${port}/preview.html`); await p.waitForFunction(() => document.title === "done"); await p.screenshot({ path: join(dir, "preview.png") }); await b.close(); srv.close();
