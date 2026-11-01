import { Page, expect } from "@playwright/test";
/** Boot in replay mode (no FORGE /state) or live (with a fake /state and /events). */
export async function boot(page: Page, live = false) {
  if (live) {
    await page.route("**/state", (r) => r.fulfill({ json: { run: "x", tasks: [{ id: "T1", title: "A", status: "backlog", attempts: 0 }] } }));
    await page.route("**/events", (r) => r.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: "" }));
  } else {
    await page.route("**/state", (r) => r.abort());
    await page.route("**/events", (r) => r.abort());
  }
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__ready === true);
  await page.waitForTimeout(800);
  await expect(page.locator("#hud .badge")).toHaveText(live ? "LIVE" : "REPLAY");
}
export const O = (page: Page) => page;
export const CORK = { x: 130, y: 650 };
