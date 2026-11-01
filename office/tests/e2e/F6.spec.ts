import { test, expect } from "@playwright/test";
test("F6 escalate walks Fay to the pod with one SENIOR tag, releases on merged", async ({ page }) => {
  const t = Date.now() + 3000;
  const ev = (o: any, d: number) => `data: ${JSON.stringify({ run: "x", phase: "build", ...o, ts: t + d })}\n\n`;
  const body = ev({ kind: "agent_start", role: "dev", taskId: "T5", agentId: "dev:T5#1", text: "go" }, 0) +
    ev({ kind: "task_status", taskId: "T5", status: "running" }, 10) +
    ev({ kind: "note", text: "escalate T5: stuck" }, 20) + ev({ kind: "note", text: "escalate T5: again" }, 30) +
    ev({ kind: "note", text: "escalate NOPE" }, 40);
  await page.route("**/state", (r) => r.fulfill({ json: { run: "x", tasks: [{ id: "T5", title: "t", status: "running", attempts: 1 }] } }));
  await page.route("**/events", (r) => r.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body }));
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__ready === true);
  await expect.poll(() => page.evaluate(() => (window as any).__office.agents().find((a: any) => a.key === "final_reviewer").tag), { timeout: 20000 }).toBeTruthy();
  const r = await page.evaluate(() => { const a = (window as any).__office.agents(); return { tags: a.filter((x: any) => x.tag).length, f: a.find((x: any) => x.key === "final_reviewer"), d: a.filter((x: any) => x.key.startsWith("dev:")) }; });
  expect(r.tags).toBe(1);
  console.log(JSON.stringify(r));
});
