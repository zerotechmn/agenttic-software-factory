import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadState, saveState, newState } from "../src/state.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "forge-state-"));

describe("state", () => {
  it("round-trips through save and load", () => {
    const dir = tmp();
    const s = newState("run-1");
    s.phase = "build";
    s.tasks.push({ id: "t1", title: "x", description: "", deps: [], lanes: ["src/a.ts"], acceptance: [], kind: "feature", status: "merged", attempts: 1, escalations: 0, featureIds: ["F1"] });
    saveState(dir, s);
    expect(loadState(dir)).toEqual(s);
  });

  it("returns null when no state exists", () => {
    expect(loadState(tmp())).toBeNull();
  });

  it("ignores a leftover tmp file from a crashed write and keeps the last good state", () => {
    const dir = tmp();
    const s = newState("run-2");
    saveState(dir, s);
    mkdirSync(join(dir, ".forge"), { recursive: true });
    writeFileSync(join(dir, ".forge", "state.json.tmp"), "{ half-writ");
    expect(loadState(dir)?.run).toBe("run-2");
  });
});

import { retryParked } from "../src/state.ts";
describe("retryParked", () => {
  it("returns parked tasks to the backlog and reopens build and later phases", () => {
    const s = newState("r");
    s.done = ["intake", "product", "design", "contract_gate", "build", "qa"];
    s.tasks.push({ id: "t1", title: "x", description: "", deps: [], lanes: ["a"], acceptance: [], kind: "feature", status: "parked", attempts: 4, escalations: 0, escalated: true, lastSignature: "s", featureIds: [] });
    expect(retryParked(s)).toBe(1);
    expect(s.tasks[0]).toMatchObject({ status: "backlog", attempts: 0, escalated: false });
    expect(s.tasks[0].lastSignature).toBeUndefined();
    expect(s.done).toEqual(["intake", "product", "design", "contract_gate"]);
  });
});
