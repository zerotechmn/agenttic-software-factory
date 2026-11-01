import { test, expect, Page } from "@playwright/test";
const RUNS = [
  { name: "todo", phase: "build", usd: 3.2, budget: 10, active: true },
  { name: "blog", phase: "report", usd: 9, budget: 10, active: false },
];
async function consoleMode(page: Page, log: string[] = [], opts: { assistant?: any; proposals?: any } = {}) {
  page.on("request", (r) => { const u = new URL(r.url()); if (/^\/(events|state|task|say|api)/.test(u.pathname)) log.push(`${r.method()} ${u.pathname}${u.search}`); });
  await page.route("**/api/runs", (r) => r.request().method() === "GET" ? r.fulfill({ json: RUNS }) : r.fallback());
  await page.route("**/state*", (r) => r.fulfill({ json: { run: "x", tasks: [{ id: "T1", title: "A", status: "backlog", attempts: 0 }] } }));
  await page.route("**/events*", (r) => r.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: "" }));
  await page.route("**/api/proposals", (r) => r.fulfill({ json: opts.proposals ?? [] }));
  await page.route("**/task*", (r) => r.fulfill({ status: 200, json: { ok: true } }));
}
async function replay(page: Page) {
  await page.route("**/api/**", (r) => r.fulfill({ status: 404, body: "no" }));
  await page.route("**/state*", (r) => r.abort());
  await page.route("**/events*", (r) => r.abort());
}
const ready = async (page: Page) => { await page.goto("/"); await page.waitForFunction(() => (window as any).__ready === true); await page.waitForTimeout(800); };

test("S3 run picker + param passthrough", async ({ page }) => {
  const log: string[] = [];
  await consoleMode(page, log);
  await ready(page);
  const pick = page.getByTestId("run-picker");
  await expect(pick).toBeVisible();
  await pick.click();
  const opts = page.getByRole("option");
  await expect(opts).toHaveCount(2);
  await expect(opts.nth(0)).toContainText("$3.20/$10");
  await expect(opts.nth(1)).toContainText("$9.00/$10");
  await expect(page.getByTestId("run-dot")).toHaveCount(1);
  await opts.nth(1).click();
  await page.waitForURL(/\?run=blog/);
  await page.waitForFunction(() => (window as any).__ready === true);
  await page.waitForTimeout(800);
  expect(log.some((l) => l.includes("/events?run=blog"))).toBe(true);
  expect(log.some((l) => l.includes("/state?run=blog"))).toBe(true);
  await page.evaluate(() => (window as any).__office.openBoard());
  await page.getByPlaceholder("Title").fill("hello");
  await page.getByRole("button", { name: "Add to backlog" }).click();
  await expect.poll(() => log.some((l) => l.startsWith("POST /task?run=blog"))).toBe(true);
});
test("S3 replay: no picker, no error", async ({ page }) => {
  const errs: string[] = []; page.on("pageerror", (e) => errs.push(e.message));
  await replay(page); await ready(page);
  await expect(page.getByTestId("run-picker")).toHaveCount(0);
  expect(errs).toEqual([]);
});
test("S4 lobby new job", async ({ page }) => {
  const log: string[] = [];
  await consoleMode(page, log);
  let body: any = null; let n = 0;
  await page.route("**/api/runs", (r) => {
    if (r.request().method() !== "POST") return r.fallback();
    n++; if (n === 1) return r.fulfill({ status: 400, json: { error: "brief required" } });
    body = r.request().postDataJSON(); return r.fulfill({ status: 201, json: { name: "todo" } });
  });
  await ready(page);
  await page.getByRole("button", { name: "+ New job" }).click();
  const p = page.getByTestId("lobby-panel");
  await expect(p).toBeVisible();
  await expect(p.getByLabel("Budget")).toHaveValue("10");
  await expect(p.getByRole("button", { name: "Resume" })).toBeVisible();
  await expect(p.getByRole("button", { name: "Stop" })).toBeVisible();
  await p.getByRole("button", { name: "START" }).click();
  await expect(page.getByTestId("lobby-error")).toContainText("brief required");
  await expect(p).toBeVisible();
  await p.getByLabel("Brief").fill("Build a todo app");
  await p.getByLabel("Budget").fill("8");
  await p.getByRole("button", { name: "START" }).click();
  await page.waitForURL(/\?run=todo/);
  expect(body.brief).toBe("Build a todo app"); expect(body.budget).toBe(8);
  await page.waitForFunction(() => (window as any).__ready === true);
  await page.route("**/api/runs/todo/*", (r) => r.fulfill({ status: 202, json: { ok: true } }));
  await page.waitForTimeout(1000);
  await page.mouse.click(130, 250); // lobby
  await page.waitForTimeout(500);
  if (!(await page.getByTestId("lobby-panel").isVisible())) await page.evaluate(() => (window as any).__office.openLobby());
  await page.getByRole("button", { name: "Resume" }).click();
  await expect.poll(() => log.includes("POST /api/runs/todo/resume")).toBe(true);
  await page.getByRole("button", { name: "Stop" }).click();
  await expect.poll(() => log.includes("POST /api/runs/todo/stop")).toBe(true);
  await expect(page.getByTestId("lobby-panel")).toContainText("202");
});
test("S4 lobby click opens panel (reception area)", async ({ page }) => {
  await replay(page); await ready(page);
  await page.mouse.click(130, 250);
  await expect(page.getByTestId("lobby-panel")).toBeVisible();
});
test("S4 replay lobby demo", async ({ page }) => {
  await replay(page); await ready(page);
  await page.evaluate(() => (window as any).__office.openLobby());
  const p = page.getByTestId("lobby-panel");
  await expect(p).toContainText("demo mode: start the console with");
  for (const n of ["START", "Resume", "Stop"]) await expect(p.getByRole("button", { name: n })).toBeDisabled();
});
test("S5 chat round trip + XSS + persist", async ({ page }) => {
  const log: string[] = []; let posted: any = null;
  await consoleMode(page, log);
  await page.route("**/api/assistant", async (r) => {
    posted = r.request().postDataJSON(); await new Promise((s) => setTimeout(s, 1500));
    r.fulfill({ json: { reply: "**Done**\n\n- one\n- two\n\n`x`\n\n<img src=x onerror=window.__pwned=1>", usd: 0.07 } });
  });
  await ready(page);
  await page.getByRole("button", { name: "Ask FORGE" }).click();
  const c = page.getByTestId("chat-panel");
  await expect(c).toBeVisible();
  const ta = c.locator("textarea");
  await ta.type("status?"); await ta.press("Shift+Enter"); await ta.type("now");
  expect(posted).toBeNull();
  await ta.press("Enter");
  await expect(c.locator(".msg-operator")).toContainText("status?");
  await expect(c).toContainText(/thinking(…|\.\.\.)/);
  await expect(ta).toBeDisabled();
  await expect(c.locator(".msg-assistant strong")).toHaveText("Done");
  expect(posted.message).toBe("status?\nnow");
  await expect(c.locator(".msg-assistant li")).toHaveCount(2);
  await expect(c.locator(".msg-assistant code")).toHaveText("x");
  await expect(c).toContainText("<img src=x onerror=");
  await expect(c.locator("img")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
  await expect(c).toContainText("$0.07");
  await expect(ta).toBeEnabled(); await expect(ta).toBeFocused();
  await ta.fill("   "); await ta.press("Enter");
  await expect(c.locator(".msg-operator")).toHaveCount(1);
  // layout: operator right of assistant
  const [a, o] = await Promise.all([c.locator(".msg-assistant").boundingBox(), c.locator(".msg-operator").boundingBox()]);
  expect(o!.x + o!.width).toBeGreaterThan(a!.x + a!.width - 1);
  await page.reload(); await page.waitForFunction(() => (window as any).__ready === true);
  await page.evaluate(() => (window as any).__office.openChat());
  await expect(page.getByTestId("chat-panel").locator(".msg-operator")).toHaveCount(1);
  await expect(page.getByTestId("chat-panel").locator(".msg-assistant")).toHaveCount(1);
});
test("F8 chat clear + escape + autoscroll", async ({ page }) => {
  await consoleMode(page);
  await page.route("**/api/assistant", (r) => r.fulfill({ json: { reply: "ok\n\n" + "line\n\n".repeat(30), usd: 0.01 } }));
  await ready(page);
  await page.evaluate(() => (window as any).__office.openChat());
  const c = page.getByTestId("chat-panel"); const ta = c.locator("textarea");
  for (const m of ["a", "b"]) { await ta.fill(m); await ta.press("Enter"); await expect(c.locator(".msg-assistant")).toHaveCount(m === "a" ? 1 : 2); }
  const d = await c.locator(".msg-operator").first().evaluate((el) => { let p: HTMLElement | null = el as HTMLElement; while (p && p.scrollHeight <= p.clientHeight + 2) p = p.parentElement; return p ? p.scrollHeight - p.clientHeight - p.scrollTop : -99; });
  expect(Math.abs(d)).toBeLessThanOrEqual(2);
  await c.getByRole("button", { name: "Clear" }).click();
  await expect(c.locator(".msg-operator")).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter((k) => /chat/i.test(k)).map((k) => sessionStorage[k]))).toEqual(expect.not.arrayContaining(["x"]));
  await page.keyboard.press("Escape").catch(() => {});
  await ta.focus(); await ta.press("Escape");
  await expect(c).toBeHidden();
});
test("S6 proposals", async ({ page }) => {
  const props = [{ id: "p1", kind: "start", run: "todo", brief: "Build todo", budget: 8 }, { id: "p2", kind: "resume", run: "x" }];
  const posts: any = {};
  await consoleMode(page, [], { proposals: props });
  await page.route("**/api/proposals/*", (r) => { const id = r.request().url().split("/").pop()!; posts[id] = r.request().postDataJSON(); r.fulfill({ json: { result: id === "p2" ? "dismissed" : "started todo" } }); });
  await ready(page);
  await page.evaluate(() => (window as any).__office.openChat());
  const cards = page.getByTestId("proposal-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText("Start run todo ($8)");
  await expect(cards.nth(1)).toContainText("Resume x");
  await expect(cards.nth(0).locator("details")).not.toHaveAttribute("open", /.*/);
  await cards.nth(0).locator("summary").click();
  await expect(cards.nth(0)).toContainText("Build todo");
  await cards.nth(1).getByRole("button", { name: "Dismiss" }).click();
  await expect(cards.nth(1)).toContainText("dismissed");
  expect(posts.p2).toEqual({ confirm: false });
  await cards.nth(0).getByRole("button", { name: "Confirm" }).click();
  await expect(cards.nth(0)).toContainText("started todo");
  expect(posts.p1).toEqual({ confirm: true });
  await page.waitForURL(/\?run=todo/);
});
test("S5 replay chat disabled + S7 sweep", async ({ page }) => {
  const errs: string[] = []; page.on("pageerror", (e) => errs.push(e.message)); page.on("console", (m) => m.type() === "error" && !/404|ERR_FAILED|Failed to load/.test(m.text()) && errs.push(m.text()));
  await replay(page); await ready(page);
  await page.getByRole("button", { name: "Ask FORGE" }).click();
  const c = page.getByTestId("chat-panel");
  await expect(c).toContainText("forge console");
  await expect(c.locator("textarea")).toBeDisabled(); await expect(c.getByRole("button", { name: "Send" })).toBeDisabled();
  await page.getByRole("button", { name: "+ New job" }).click();
  await expect(page.getByTestId("lobby-panel")).toBeVisible();
  await page.evaluate(() => (window as any).__office.openBoard());
  await expect(page.getByRole("heading", { name: "Task board" })).toBeVisible();
  const keys = await page.evaluate(() => Object.keys((window as any).__office));
  for (const k of ["tasks", "agents", "zoom", "openBoard", "openAgent", "room", "openChat", "openLobby", "agentLog"]) expect(keys).toContain(k);
  expect(await page.evaluate(() => (window as any).__office.agentLog("nope"))).toEqual([]);
  expect(errs).toEqual([]);
});
test("S1/S2 agent panel live + detail (replay)", async ({ page }) => {
  await replay(page); await ready(page);
  await page.evaluate(() => (window as any).__office.openAgent("dev:1"));
  // speed up replay
  await page.getByRole("button", { name: "10×" }).click().catch(() => {});
  const list = page.getByTestId("activity-list");
  await expect(list.locator("li").first()).toBeVisible({ timeout: 40000 });
  const ta = page.locator("textarea").last();
  await ta.click(); await ta.fill("draft msg");
  const first0 = list.locator("li").first(); const key = (await first0.innerText()).split("\n")[0].slice(2);
  const first = list.locator("li", { hasText: key }).first();
  await first.click();
  await expect(first).toHaveAttribute("aria-expanded", "true");
  await expect(first.getByTestId("event-detail")).toContainText("Time");
  await expect(first.getByTestId("event-detail")).toContainText("Task");
  await ta.click();
  const n0 = await list.locator("li").count();
  const txt = await first.innerText();
  await expect.poll(async () => list.locator("li").count(), { timeout: 60000 }).toBeGreaterThan(n0);
  await expect(ta).toHaveValue("draft msg"); await expect(ta).toBeFocused();
  await expect(first).toHaveAttribute("aria-expanded", "true");
  expect(await page.locator("#hud .panel, #hud [data-panel]").count()).toBeLessThanOrEqual(1);
  const log = await page.evaluate(() => (window as any).__office.agentLog("dev:1"));
  expect(log.length).toBeLessThanOrEqual(50); expect(log.filter((e: any) => e.kind === "tool").every((e: any) => "data" in e)).toBe(true);
  await first.locator("span").first().click();
  await expect(first.getByTestId("event-detail")).toHaveCount(0);
});
