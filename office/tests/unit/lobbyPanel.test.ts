// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LobbyPanel } from "../../src/lobbyPanel";
import { nav } from "../../src/api";
import { DEMO_LOBBY } from "../../src/shared/contracts";

const flush = () => new Promise((r) => setTimeout(r, 0));
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

let body: HTMLElement;
let fetchMock: ReturnType<typeof vi.fn>;
function mount(consoleMode = true, current: string | null = "x") {
  body = document.createElement("div");
  document.body.appendChild(body);
  new LobbyPanel(() => ({ console: consoleMode, runs: [], current })).render(body);
}
const q = <T extends Element>(s: string) => body.querySelector(s) as T;
const btn = (t: string) => [...body.querySelectorAll("button")].find((b) => b.textContent === t) as HTMLButtonElement;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("LobbyPanel", () => {
  it("starts a run and navigates", async () => {
    fetchMock.mockResolvedValue(json(201, { name: "todo" }));
    const assign = vi.spyOn(nav, "assign").mockImplementation(() => {});
    mount();
    q<HTMLTextAreaElement>("textarea").value = "Build a todo app";
    q<HTMLInputElement>("#lobby-budget").value = "8";
    btn("START").click();
    await flush();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/runs");
    expect(JSON.parse(init.body)).toEqual({ brief: "Build a todo app", budget: 8 });
    expect(assign).toHaveBeenCalledWith(expect.stringContaining("?run=todo"));
  });

  it("shows server error and keeps fields", async () => {
    fetchMock.mockResolvedValue(json(400, { error: "brief required" }));
    mount();
    q<HTMLInputElement>("#lobby-name").value = "keep";
    btn("START").click();
    await flush();
    expect(q("[data-testid=lobby-error]").textContent).toBe("brief required");
    expect(q<HTMLInputElement>("#lobby-name").value).toBe("keep");
    expect(btn("START").disabled).toBe(false);
  });

  it("rejects non-positive budget without fetching", async () => {
    mount();
    q<HTMLInputElement>("#lobby-budget").value = "0";
    btn("START").click();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(q("[data-testid=lobby-error]").textContent).toContain("positive");
  });

  it("resume and stop post and show status", async () => {
    fetchMock.mockResolvedValue(json(202, {}));
    mount();
    btn("Resume").click();
    await flush();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/runs/x/resume");
    expect(body.textContent).toContain("202: resume requested");
    btn("Stop").click();
    await flush();
    expect(fetchMock.mock.calls[1][0]).toBe("/api/runs/x/stop");
    expect(body.textContent).toContain("202: stop requested");
  });

  it("demo mode shows notice and disables buttons", () => {
    mount(false, null);
    expect(q("[data-testid=lobby-panel]").textContent).toContain(DEMO_LOBBY);
    for (const t of ["START", "Resume", "Stop"]) expect(btn(t).disabled).toBe(true);
  });
});
