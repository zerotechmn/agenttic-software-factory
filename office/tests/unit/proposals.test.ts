// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { nav } from "../../src/api";
import { renderProposalCard } from "../../src/proposals";

const flush = () => new Promise((r) => setTimeout(r, 0));
function mockFetch() {
  const f = vi.fn(async () => new Response(JSON.stringify({ result: "started todo" }), { status: 200 }));
  vi.stubGlobal("fetch", f);
  return f;
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("proposal card", () => {
  it("renders start and resume", () => {
    const a = renderProposalCard({ id: "1", kind: "start", run: "todo", brief: "a todo app", budget: 8 });
    expect(a.querySelector(".chat-proposal-title")!.textContent).toBe("Start run todo ($8)");
    expect(a.querySelector("details")!.textContent).toContain("a todo app");
    const b = renderProposalCard({ id: "2", kind: "resume", run: "x" });
    expect(b.textContent).toContain("Resume x");
    expect(b.querySelector("details")).toBeNull();
  });
  it("confirm start posts, shows result, navigates", async () => {
    const f = mockFetch();
    const assign = vi.spyOn(nav, "assign").mockImplementation(() => {});
    const c = renderProposalCard({ id: "p 1", kind: "start", run: "todo", brief: "b", budget: 8 });
    (c.querySelector(".chat-confirm") as HTMLElement).click();
    await flush();
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/proposals/p%201");
    expect(JSON.parse(init.body as string)).toEqual({ confirm: true });
    expect(c.textContent).toContain("started todo");
    expect(c.querySelector("button")).toBeNull();
    expect(assign).toHaveBeenCalledWith(expect.stringContaining("?run=todo"));
  });
  it("confirm resume does not navigate; dismiss posts false", async () => {
    const f = mockFetch();
    const assign = vi.spyOn(nav, "assign").mockImplementation(() => {});
    const c = renderProposalCard({ id: "2", kind: "resume", run: "x" });
    (c.querySelector(".chat-confirm") as HTMLElement).click();
    await flush();
    expect(assign).not.toHaveBeenCalled();
    const d = renderProposalCard({ id: "3", kind: "resume", run: "x" });
    (d.querySelector(".chat-dismiss") as HTMLElement).click();
    await flush();
    const init = (f.mock.calls[1] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(init.body as string)).toEqual({ confirm: false });
    expect(d.textContent).toContain("started todo");
  });
});
