import { describe, it, expect, vi, beforeEach } from "vitest";
import { Sound } from "../../src/sound";

const started: number[] = [];
class FakeNode { connect(n: unknown) { return n; } }
class FakeParam { value = 0; setValueAtTime() {} linearRampToValueAtTime() {} exponentialRampToValueAtTime() {} }
class FakeCtx {
  currentTime = 0; sampleRate = 8000; destination = new FakeNode(); state = "running";
  resume() { return Promise.resolve(); }
  createGain() { return Object.assign(new FakeNode(), { gain: new FakeParam() }); }
  createOscillator() { return Object.assign(new FakeNode(), { type: "", frequency: new FakeParam(), start: (t: number) => started.push(t), stop() {} }); }
  createBiquadFilter() { return Object.assign(new FakeNode(), { type: "", frequency: new FakeParam() }); }
  createBuffer(_c: number, n: number) { return { getChannelData: () => new Float32Array(n) }; }
  createBufferSource() { return Object.assign(new FakeNode(), { buffer: null, start: () => started.push(-1) }); }
}

describe("office sound", () => {
  beforeEach(() => { started.length = 0; vi.stubGlobal("AudioContext", FakeCtx); });
  const store = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };

  it("is silent until SFX is switched on, then plays event sounds (spaced out per kind)", () => {
    const s = new Sound(store());
    s.play({ type: "merged", count: 1 });
    expect(started).toHaveLength(0);
    s.setSfx(true);
    started.length = 0;
    s.play({ type: "merged", count: 1 });
    expect(started.length).toBe(3);
    s.play({ type: "merged", count: 2 });
    expect(started.length).toBe(3);
    s.play({ type: "stamp", agent: "reviewer", ok: false });
    expect(started.length).toBe(4);
  });

  it("remembers the toggles", () => {
    const st = store();
    const a = new Sound(st);
    a.setSfx(true);
    a.setMusic(false);
    const b = new Sound(st);
    expect([b.sfx, b.music]).toEqual([true, false]);
  });
});

describe("beer sound", () => {
  it("plays hiss, pop, fizz and three gulps", () => {
    started.length = 0;
    vi.stubGlobal("AudioContext", FakeCtx);
    const s = new Sound({ getItem: () => null, setItem: () => {} });
    s.setSfx(true);
    started.length = 0;
    s.play({ type: "sfx", name: "beer" });
    expect(started.length).toBe(7);
  });
});
