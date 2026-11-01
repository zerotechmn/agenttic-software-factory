// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { nav } from "../../src/api";
import { RunPicker } from "../../src/runPicker";
import type { RunSummary } from "../../src/shared/contracts";

const runs: RunSummary[] = [
  { name: "todo", run: "r1", phase: "build", usd: 3.2, budget: 10, product: "p", startedAt: 2, active: true },
  { name: "my blog", run: "r2", phase: "done", usd: 7.1, budget: 10, product: "p", startedAt: 1, active: false },
];

afterEach(() => vi.restoreAllMocks());

describe("RunPicker", () => {
  it("hides slot when runs is null", () => {
    const slot = document.createElement("div");
    new RunPicker().render(slot, null, null);
    expect(slot.style.display).toBe("none");
    expect(slot.children.length).toBe(0);
  });

  it("renders options, dot only on active, current selected", () => {
    const slot = document.createElement("div");
    document.body.appendChild(slot);
    new RunPicker().render(slot, runs, "todo");
    const opts = slot.querySelectorAll("[role=option]");
    expect(opts.length).toBe(2);
    expect(opts[0].textContent).toContain("todo");
    expect(opts[0].textContent).toContain("build");
    expect(opts[0].textContent).toContain("$3.20/$10");
    expect(opts[0].getAttribute("aria-selected")).toBe("true");
    expect(opts[1].getAttribute("aria-selected")).toBe("false");
    expect(slot.querySelectorAll("[data-testid=run-dot]").length).toBe(1);
    expect(opts[0].querySelector("[data-testid=run-dot]")).not.toBeNull();
  });

  it("navigates on choose with encoded name; Escape closes", () => {
    const spy = vi.spyOn(nav, "assign").mockImplementation(() => {});
    const slot = document.createElement("div");
    document.body.appendChild(slot);
    new RunPicker().render(slot, runs, "todo");
    const btn = slot.querySelector<HTMLElement>("[data-testid=run-picker]")!;
    const list = slot.querySelector<HTMLElement>("[role=listbox]")!;
    expect(list.hidden).toBe(true);
    btn.click();
    expect(list.hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(list.hidden).toBe(true);
    btn.click();
    slot.querySelectorAll<HTMLElement>("[role=option]")[1].click();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("?run=my%20blog"));
  });
});
