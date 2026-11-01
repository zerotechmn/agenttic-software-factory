import { chromium } from "@playwright/test";
const [,, file, out, q] = process.argv;
const b = await chromium.launch({ args: ["--allow-file-access-from-files"] }); const p = await b.newPage({ viewport: { width: 2400, height: 1600 } });
await p.goto(`file://${file}?${q}`); await p.waitForFunction(() => document.title === "done");
await p.locator("canvas").screenshot({ path: out }); await b.close();
