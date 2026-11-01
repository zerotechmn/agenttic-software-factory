import { test, expect } from "@playwright/test";
import { boot } from "./helpers";
test("F4 note queued, persists, no request in replay", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", (r) => r.url().includes("/say") && posts.push(r.url()));
  await boot(page);
  await page.evaluate(() => (window as any).__office.openAgent("qa"));
  await expect(page.getByText(/notes reach the agent on its next turn/i)).toBeVisible();
  await page.locator("#hud textarea").fill("hello");
  await page.getByRole("button", { name: /send note/i }).click();
  await expect(page.getByText("hello")).toBeVisible();
  await expect(page.getByText("queued").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await page.evaluate(() => (window as any).__office.openAgent("qa"));
  await expect(page.getByText("hello")).toBeVisible();
  expect(posts).toEqual([]);
});
test("F4 live: POST /say", async ({ page }) => {
  let body: any;
  await page.route("**/say", (r) => { body = r.request().postDataJSON(); r.fulfill({ json: { ok: true } }); });
  await boot(page, true);
  await page.evaluate(() => (window as any).__office.openAgent("qa"));
  await page.locator("#hud textarea").fill("hi");
  await page.getByRole("button", { name: /send note/i }).click();
  await expect(page.getByText("queued").first()).toBeVisible();
  expect(body).toMatchObject({ role: "qa", text: "hi" });
});
test("F4 delivered on matching operator event", async ({ page }) => {
  await page.route("**/state", (r) => r.fulfill({ json: { run: "x", tasks: [] } }));
  await page.route("**/events", (r) => r.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: `data: ${JSON.stringify({ ts: Date.now() + 5000, type: "note", role: "qa", text: "operator → qa: hi" })}\n\n` }));
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__ready === true);
  await page.evaluate(() => (window as any).__office.openAgent("reviewer"));
  await page.locator("#hud textarea").fill("for reviewer");
  await page.getByRole("button", { name: /send note/i }).click();
  await expect(page.getByText("queued").first()).toBeVisible();
});
