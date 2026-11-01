import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventBus } from "../src/events.ts";

describe("EventBus", () => {
  it("appends one JSON line per event and notifies subscribers", () => {
    const file = join(mkdtempSync(join(tmpdir(), "forge-ev-")), "events.jsonl");
    const bus = new EventBus(file, "r1");
    const seen: string[] = [];
    bus.subscribe((e) => seen.push(e.kind));
    bus.emit({ phase: "intake", kind: "phase_start" });
    bus.emit({ phase: "intake", kind: "phase_end" });
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).run).toBe("r1");
    expect(seen).toEqual(["phase_start", "phase_end"]);
  });

  it("readAll skips a corrupt trailing line", () => {
    const file = join(mkdtempSync(join(tmpdir(), "forge-ev-")), "events.jsonl");
    const bus = new EventBus(file, "r1");
    bus.emit({ phase: "intake", kind: "a" });
    appendFileSync(file, '{"ts":1,"kind":');
    expect(EventBus.readAll(file).map((e) => e.kind)).toEqual(["a"]);
  });
});
