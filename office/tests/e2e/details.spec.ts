import { test, expect } from "@playwright/test";
import { boot } from "./helpers";

const STATE = {
  run: "x",
  tasks: [{ id: "T1", title: "Todos API with a very long title that must not be cut off in the detail view", status: "merged", attempts: 2, kind: "feature", description: "Build GET/POST /api/todos <img src=x onerror=alert(1)>", lanes: ["src/server/routes/todos.ts"], acceptance: ["POST returns 201"], deps: [], featureIds: ["F1"], feedback: "lint failed on line 3" }],
  prd: { product: "Todo", pitch: "Simple todos", users: ["me"], outOfScope: ["login"], features: [{ id: "F1", title: "Add a todo", priority: "must", story: "As a user I add todos", acceptance: ["Enter adds it"], passes: true, status: "working" }], openQuestions: [{ id: "Q1", question: "Due dates?", assumption: "no due dates" }] },
};

test("replay mode shows an unmissable demo banner", async ({ page }) => {
  await boot(page);
  await expect(page.locator(".notice.demo")).toBeVisible();
});

test("task row opens the full task with its history; product name opens the full PRD and answers go to Product", async ({ page }) => {
  const says: string[] = [];
  await page.route("**/state*", (r) => r.fulfill({ json: STATE }));
  await page.route("**/say*", (r) => { says.push(r.request().postData() ?? ""); return r.fulfill({ status: 202, json: { ok: true } }); });
  const events = [
    { ts: 1, run: "x", phase: "build", kind: "task_status", taskId: "T1", status: "running" },
    { ts: 2, run: "x", phase: "build", kind: "gate", taskId: "T1", status: "fail", text: "lint failed" },
    { ts: 3, run: "x", phase: "build", kind: "review", taskId: "T1", status: "approve" },
  ].map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  await page.route("**/events*", (r) => r.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: events }));
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__ready === true);
  await expect(page.locator("#hud .badge")).toHaveText("LIVE");
  await expect(page.locator(".notice.demo")).toBeHidden();
  await page.locator(".stat.tasks").click();
  await expect(page.locator("#kanban .col[data-col=done] .card", { hasText: "T1" })).toBeVisible();
  await expect(page.locator("#kanban .card", { hasText: "T1" })).toContainText("gate fail");
  await page.locator("#kanban .card", { hasText: "T1" }).click();
  await expect(page.getByRole("heading", { name: /T1 · Todos API with a very long title that must not be cut off in the detail view/ })).toBeVisible();
  const drawer = page.locator("#kanban aside");
  await expect(drawer.getByText("Build GET/POST /api/todos <img src=x onerror=alert(1)>")).toBeVisible();
  await expect(drawer.getByText("src/server/routes/todos.ts")).toBeVisible();
  await expect(drawer.getByText(/gate fail.*lint failed/)).toBeVisible();
  await page.locator("#kanban .tabs [data-tab=handoffs]").click();
  await expect(page.locator("#kanban .feed")).toContainText("lint failed");
  await page.locator("#kanban .tabs [data-tab=timeline]").click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#kanban")).toBeHidden();
  await page.locator("#hud .product").click();
  await expect(page.getByRole("heading", { name: "Todo" })).toBeVisible();
  await expect(page.getByText("As a user I add todos")).toBeVisible();
  await expect(page.getByText("assumed if unanswered: no due dates")).toBeVisible();
  await page.getByLabel("Answer the open questions").fill("Q1: yes");
  await page.getByRole("button", { name: "Send answers to Product" }).click();
  await expect(page.getByText(/sent: Product revises/)).toBeVisible();
  expect(says.some((s) => s.includes('"role":"product"') && s.includes("Q1: yes"))).toBe(true);
});

test("vault lists the run's documents, shows one and offers a download", async ({ page }) => {
  await page.route("**/state*", (r) => r.fulfill({ json: { run: "x", tasks: [] } }));
  await page.route("**/events*", (r) => r.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: "" }));
  await page.route("**/docs*", (r) => r.fulfill({ json: [
    { path: "docs/RUN_REPORT.md", title: "Run report", group: "Report", bytes: 2048 },
    { path: "docs/prd.md", title: "PRD", group: "Product", bytes: 900 },
  ] }));
  await page.route("**/doc?*", (r) => r.fulfill({ status: 200, contentType: "text/plain", body: "# Run report: Todo\n<script>alert(1)</script>" }));
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__ready === true);
  await page.getByRole("button", { name: "Docs" }).click();
  await expect(page.getByRole("heading", { name: "Vault (2)" })).toBeVisible();
  await expect(page.getByLabel("Download PRD")).toHaveAttribute("href", /\/doc\?path=docs%2Fprd\.md&download=1/);
  await page.getByText("Run report").click();
  await expect(page.locator(".vault-doc")).toContainText("<script>alert(1)</script>");
  await page.getByText("← vault").click();
  await expect(page.getByRole("heading", { name: "Vault (2)" })).toBeVisible();
});

test("▶ Replay plays a recorded run from its event log, not the demo", async ({ page }) => {
  const log = [
    { ts: 1000, run: "yoga", phase: "build", kind: "phase_start" },
    { ts: 2000, run: "yoga", phase: "build", kind: "task_status", taskId: "T1", status: "running" },
    { ts: 3000, run: "yoga", phase: "build", kind: "task_status", taskId: "T1", status: "merged" },
  ].map((e) => JSON.stringify(e)).join("\n");
  const asked: string[] = [];
  await page.route("**/events*", (r) => r.abort());
  await page.route("**/state*", (r) => r.fulfill({ json: { run: "yoga", tasks: [{ id: "T1", title: "Book a class", status: "merged", attempts: 1 }], prd: { product: "Calm Yoga" } } }));
  await page.route("**/doc?*", (r) => { asked.push(decodeURIComponent(r.request().url())); return r.fulfill({ status: 200, contentType: "text/plain", body: log }); });
  await page.route("**/sample-run.jsonl", (r) => r.abort());
  await page.goto("/?run=yoga&replay=1");
  await page.waitForFunction(() => (window as any).__ready === true);
  await expect(page.locator("#hud .badge")).toHaveText("REPLAY");
  await expect(page.locator(".notice.demo")).toContainText("REPLAY · yoga from its recorded log");
  await expect(page.getByRole("button", { name: "● Live" })).toBeVisible();
  expect(asked.some((u) => u.includes("events.jsonl") && u.includes("run=yoga"))).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).__office.tasks()[0]?.status), { timeout: 15000 }).toBe("merged");
});

test("when a run finishes with SFX on, the finish song card appears and closes", async ({ page }) => {
  const log = [
    { ts: 1000, run: "yoga", phase: "report", kind: "phase_start" },
    { ts: 2000, run: "yoga", phase: "done", kind: "run_done", usd: 4.4 },
  ].map((e) => JSON.stringify(e)).join("\n");
  await page.route("**/events*", (r) => r.abort());
  await page.route("**/state*", (r) => r.fulfill({ json: { run: "yoga", tasks: [] } }));
  await page.route("**/doc?*", (r) => r.fulfill({ status: 200, contentType: "text/plain", body: log }));
  await page.route("**/finish.mp3", (r) => r.fulfill({ status: 404, body: "" }));
  await page.route("https://www.youtube-nocookie.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<p>video</p>" }));
  await page.addInitScript(() => localStorage.setItem("forge.sfx", "1"));
  await page.goto("/?run=yoga&replay=1");
  await page.waitForFunction(() => (window as any).__ready === true);
  // no finish.mp3 (forced 404 here): the card offers the video at the chorus in a new tab
  await expect(page.getByRole("link", { name: "▶ Play on YouTube" })).toHaveAttribute("href", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=43s", { timeout: 15000 });
  await page.getByLabel("Close the finish song").click();
  await expect(page.locator("#finish-song")).toHaveCount(0);
});

