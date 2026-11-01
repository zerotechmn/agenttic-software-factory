import { describe, it, expect, vi } from "vitest";
import { Container } from "pixi.js";
import { Director, type Command } from "../src/director";
import { Stage } from "../src/stage";
import { buildGrid, seatCell } from "../src/path";
import { SEATS } from "../src/map";

vi.mock("../src/agent", () => ({ SPEED: 1 }));
vi.mock("../src/labels", () => {
  const text = () => ({ anchor: { set() {} }, text: "" });
  return { bodyText: text, pixelText: text, bubble: text, Labels: class {} };
});

const ev = (o: Record<string, unknown>) => ({ ts: 0, run: "r", phase: "qa", kind: "note", ...o });

function fakeAgent(key: string) {
  const view = new Container();
  const a = {
    key,
    name: key,
    view,
    cell: seatCell(SEATS[key]),
    carry: undefined as Container | undefined,
    carriedWhileWalking: undefined as Container | undefined,
    walks: [] as { x: number; y: number }[],
    walkTo(to: { x: number; y: number }, cb?: () => void) {
      a.walks.push(to);
      a.carriedWhileWalking ??= a.carry;
      cb?.();
    },
    goHome(cb?: () => void) { cb?.(); },
    setWorking() {},
    head: () => ({ x: 0, y: 0 }),
  };
  return a;
}

describe("QA carries the bug to the dev pod", () => {
  it("director emits a bug handoff from qa to the pod for FIX/IT tasks", () => {
    for (const taskId of ["FIX1-1", "IT1-2"]) {
      const cmds = new Director().handle(ev({ kind: "agent_start", role: "dev", taskId }));
      expect(cmds).toContainEqual({ type: "handoff", from: "qa", to: "dev:1", item: "bug", label: taskId });
    }
  });

  it("stage walks Quinn to the pod carrying a bug item", async () => {
    const agents = new Map([["qa", fakeAgent("qa")], ["dev:1", fakeAgent("dev:1")]]);
    const stage = new Stage(agents as never, buildGrid(), new Container(), new Container(), { add: () => new Container(), remove() {} } as never, () => {}, {} as never, new Container());
    const cmds: Command[] = new Director().handle(ev({ kind: "agent_start", role: "dev", taskId: "FIX1-1" }));
    for (const c of cmds) stage.exec(c);
    await new Promise((r) => setTimeout(r, 10));
    const qa = agents.get("qa")!;
    expect(qa.walks.length).toBeGreaterThan(0);
    expect(qa.carriedWhileWalking).toBeDefined();
    expect(agents.get("dev:1")!.walks).toHaveLength(0);
  });
});
