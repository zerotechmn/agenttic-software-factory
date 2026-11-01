import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askAssistant, answerProposal, fetchProposals, fetchRuns, nav, postSay, postTask, runAction, startRun, switchRun } from "../../src/api";

const reply = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let fetchMock: any;
const setSearch = (s: string) => history.replaceState(null, "", `/${s}`);

beforeEach(() => { fetchMock = vi.fn(async () => reply(200, {})); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); setSearch(""); });

describe("run pass-through", () => {
  it("carries ?run= on /say and /task", async () => {
    setSearch("?run=todo");
    await postSay("qa", "hi");
    await postTask({ title: "t", description: "d" });
    expect(fetchMock.mock.calls.map((c: unknown[]) => c[0])).toEqual(["/say?run=todo", "/task?run=todo"]);
  });
  it("keeps the name encoded", async () => {
    setSearch("?run=my%20run");
    await postSay("qa", "hi");
    expect(fetchMock.mock.calls[0][0]).toBe("/say?run=my%20run");
  });
  it("adds nothing without ?run=", async () => {
    await postSay("qa", "hi");
    expect(fetchMock.mock.calls[0][0]).toBe("/say");
  });
  it("console APIs never carry ?run=", async () => {
    setSearch("?run=todo");
    await fetchRuns(); await startRun({ brief: "b", budget: 1 }); await runAction("x", "stop");
    await askAssistant("q"); await fetchProposals(); await answerProposal("p", true);
    for (const c of fetchMock.mock.calls) expect(String(c[0])).not.toContain("run=");
  });
  it("feed.ts reads /state and /events through withRun", async () => {
    setSearch("?run=todo");
    const urls: string[] = [];
    vi.stubGlobal("EventSource", class { constructor(u: string) { urls.push(u); } });
    fetchMock.mockImplementation(async (u: string) => { urls.push(u); return reply(200, { run: "todo" }); });
    const { startFeed } = await import("../../src/feed");
    await startFeed(() => {}, () => {}, () => {});
    expect(urls).toEqual(["/state?run=todo", "/events?run=todo"]);
  });
});

describe("console calls", () => {
  it("runAction POSTs the encoded path", async () => {
    fetchMock.mockResolvedValue(reply(202, {}));
    const r = await runAction("x", "stop");
    expect(fetchMock).toHaveBeenCalledWith("/api/runs/x/stop", expect.objectContaining({ method: "POST" }));
    expect(r).toMatchObject({ ok: true, status: 202 });
  });
  it("startRun omits a blank name", async () => {
    fetchMock.mockResolvedValue(reply(201, { name: "n" }));
    await startRun({ name: "  ", brief: "b", budget: 5 });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ brief: "b", budget: 5 });
  });
  it("maps a 400 {error}", async () => {
    fetchMock.mockResolvedValue(reply(400, { error: "brief required" }));
    expect(await startRun({ brief: "", budget: 5 })).toEqual({ ok: false, status: 400, error: "brief required" });
  });
  it("falls back to HTTP <status>, then network error, never throwing", async () => {
    fetchMock.mockResolvedValue(reply(500));
    expect(await askAssistant("q")).toEqual({ ok: false, status: 500, error: "HTTP 500" });
    fetchMock.mockRejectedValue(new Error("down"));
    expect(await askAssistant("q")).toEqual({ ok: false, status: 0, error: "network error" });
    expect(await postTask({ title: "t", description: "d" })).toBe(false);
    expect(await fetchProposals()).toEqual([]);
  });
  it("fetchRuns: 404, non-array and rejection → null; array → rows", async () => {
    fetchMock.mockResolvedValueOnce(reply(404));
    expect(await fetchRuns()).toBeNull();
    fetchMock.mockResolvedValueOnce(reply(200, { a: 1 }));
    expect(await fetchRuns()).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error("x"));
    expect(await fetchRuns()).toBeNull();
    fetchMock.mockResolvedValueOnce(reply(200, [{ name: "a" }]));
    expect(await fetchRuns()).toEqual([{ name: "a" }]);
  });
  it("switchRun navigates via nav.assign", () => {
    const spy = vi.spyOn(nav, "assign").mockImplementation(() => {});
    switchRun("a b");
    expect(spy).toHaveBeenCalledWith("/?run=a%20b");
  });
});
