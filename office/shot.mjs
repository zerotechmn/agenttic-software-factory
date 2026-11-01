// Screenshot the built office app: node shot.mjs out.png [waitMs] [width] [height] [query]
import { chromium } from "playwright"; import { createServer } from "node:http"; import { readFileSync, existsSync } from "node:fs"; import { join, extname } from "node:path";
const [out, wait = "1500", w = "1920", h = "1080", q = ""] = process.argv.slice(2);
const dist = new URL("./dist/", import.meta.url).pathname; const pub = new URL("./public/", import.meta.url).pathname;
const types = { ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".html": "text/html", ".woff2": "font/woff2", ".woff": "font/woff", ".json": "application/json", ".jsonl": "text/plain" };
const srv = createServer((req, res) => { let p = decodeURIComponent(req.url.split("?")[0]); if (p === "/") p = "/index.html"; const f = [join(dist, p), join(pub, p)].find(existsSync);
  if (!f) { res.statusCode = 404; return res.end(); } res.setHeader("Content-Type", types[extname(f)] ?? "application/octet-stream"); res.end(readFileSync(f)); }).listen(0);
const port = srv.address().port; const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: +w, height: +h } });
const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
await p.goto(`http://127.0.0.1:${port}/${q}`); await p.waitForFunction(() => window.__ready === true, null, { timeout: 15000 }); await p.waitForTimeout(+wait);
await p.screenshot({ path: out }); console.log("errors:", errs.slice(0, 5)); await b.close(); srv.close();
