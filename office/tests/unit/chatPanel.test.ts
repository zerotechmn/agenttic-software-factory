// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "../../src/chatPanel";
import { CHAT_STORAGE_KEY, DEMO_CHAT } from "../../src/shared/contracts";
import type { ConsoleInfo } from "../../src/shared/contracts";

const flush = () => new Promise((r) => setTimeout(r, 0));
const on: ConsoleInfo = { console: true, runs: [], current: null };
let assistant: (() => Response) | Promise<Response>;
let asked: unknown[];

beforeEach(() => {
  asked = [];
  assistant = () => new Response(JSON.stringify({ reply: "**hi** x", usd: 0.07 }), { status: 200 });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/assistant")) {
      asked.push(JSON.parse(init!.body as string));
      return typeof assistant === "function" ? assistant() : assistant;
    }
    return new Response("[]", { status: 200 });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ""; });

function mount(storage: Storage | null = null, info = on) {
  const body = document.createElement("div");
  document.body.appendChild(body);
  new ChatPanel(() => info, storage).render(body);
  const ta = body.querySelector("textarea")!;
  const send = [...body.querySelectorAll("button")].find((b) => b.textContent === "Send")!;
  return { body, ta, send };
}
const key = (ta: HTMLTextAreaElement, shiftKey = false) =>
  ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey, bubbles: true, cancelable: true }));

describe("ChatPanel", () => {
  it("Enter sends, shows reply with cost; whitespace and Shift+Enter do not send", async () => {
    const { body, ta } = mount();
    ta.value = "  "; key(ta); await flush();
    ta.value = "hello"; key(ta, true); await flush();
    expect(asked).toEqual([]);
    key(ta); await flush(); await flush();
    expect(asked).toEqual([{ message: "hello" }]);
    expect(body.querySelector(".msg-operator")!.textContent).toBe("hello");
    const a = body.querySelector(".msg-assistant")!;
    expect(a.querySelector("strong")!.textContent).toBe("hi");
    expect(a.textContent).toContain("$0.07");
    expect(ta.disabled).toBe(false);
  });
  it("disables inputs and shows thinking while pending", async () => {
    let release!: (r: Response) => void;
    assistant = new Promise<Response>((r) => { release = r; });
    const { body, ta, send } = mount();
    ta.value = "q"; key(ta); await flush();
    expect(ta.disabled).toBe(true);
    expect(send.disabled).toBe(true);
    expect((body.querySelector(".chat-thinking") as HTMLElement).hidden).toBe(false);
    release(new Response(JSON.stringify({ reply: "ok", usd: 0 }), { status: 200 }));
    await flush(); await flush();
    expect(ta.disabled).toBe(false);
    expect((body.querySelector(".chat-thinking") as HTMLElement).hidden).toBe(true);
  });
  it("HTTP error gives error bubble and re-enables", async () => {
    assistant = () => new Response("{}", { status: 500 });
    const { body, ta, send } = mount();
    ta.value = "q"; send.click(); await flush(); await flush();
    expect(body.querySelector(".msg-error")!.textContent).toContain("Couldn't reach FORGE");
    expect(ta.disabled).toBe(false);
  });
  it("restores history, survives throwing storage, and Clear empties", async () => {
    const data = new Map<string, string>();
    const st = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) } as unknown as Storage;
    const first = mount(st);
    first.ta.value = "hello"; key(first.ta); await flush(); await flush();
    expect(JSON.parse(data.get(CHAT_STORAGE_KEY)!)).toHaveLength(2);
    const second = mount(st);
    expect(second.body.querySelectorAll(".chat-msg")).toHaveLength(2);
    (second.body.querySelector(".chat-clear") as HTMLElement).click();
    expect(second.body.querySelectorAll(".chat-msg")).toHaveLength(0);
    expect(data.has(CHAT_STORAGE_KEY)).toBe(false);

    const thrower = () => { throw new Error("x"); };
    const bad = { getItem: thrower, setItem: thrower, removeItem: thrower } as unknown as Storage;
    const t = mount(bad);
    t.ta.value = "yo"; key(t.ta); await flush(); await flush();
    expect(t.body.querySelector(".msg-assistant")).not.toBeNull();
  });
  it("demo mode disables input and makes no fetches", () => {
    const { body, ta, send } = mount(null, { console: false, runs: [], current: null });
    expect(ta.disabled && send.disabled).toBe(true);
    expect(body.textContent).toContain(DEMO_CHAT);
    expect(fetch).not.toHaveBeenCalled();
  });
});
