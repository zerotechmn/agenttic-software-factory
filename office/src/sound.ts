import type { Command } from "./director";

/**
 * Synthesized sound for the office (Web Audio, no audio files): short effects for factory events and an optional
 * quiet chiptune loop. Off by default; browsers only allow audio after a click, which the toggles provide.
 */

type Wave = OscillatorType;
const NOTE = (n: number) => 440 * Math.pow(2, (n - 69) / 12); // MIDI note → Hz

export class Sound {
  private ctx?: AudioContext;
  private master?: GainNode;
  private musicGain?: GainNode;
  sfx = false;
  music = false;
  private last = new Map<string, number>();
  private musicTimer?: ReturnType<typeof setInterval>;
  private nextBar = 0;
  private bar = 0;
  private clips = new Map<string, Promise<AudioBuffer | null>>();
  /** Called whenever the browser locks or unlocks audio, so the toggles can show the real state. */
  onChange?: () => void;

  constructor(private store: Pick<Storage, "getItem" | "setItem"> | null = safeStorage()) {
    this.sfx = this.store?.getItem("forge.sfx") === "1";
    this.music = this.store?.getItem("forge.music") === "1";
  }

  private audio(): AudioContext | undefined {
    if (this.ctx) return this.ctx;
    const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return undefined;
    this.ctx = new AC();
    // however audio gets unlocked (a click anywhere, a toggle, a resume the browser allowed) or locked, tell the toggles
    this.ctx.onstatechange = () => this.onChange?.();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.12;
    this.musicGain.connect(this.master);
    return this.ctx;
  }

  /** Call from a click handler (unlocks audio). */
  setSfx(on: boolean): void {
    this.sfx = on;
    this.store?.setItem("forge.sfx", on ? "1" : "0");
    if (on) { void this.audio()?.resume(); this.tone(880, 0.08, "square", 0.15); }
  }

  setMusic(on: boolean): void {
    this.music = on;
    this.store?.setItem("forge.music", on ? "1" : "0");
    if (on) this.startMusic();
    else this.stopMusic();
  }

  /** True while sound is wanted but the browser still holds it until a click (autoplay policy). */
  locked(): boolean {
    return (this.sfx || this.music) && this.ctx?.state !== "running";
  }

  /**
   * Resume what was on last time, at the first user gesture anywhere (autoplay policy). Clicks on the sound toggles
   * themselves are left to the toggle, so the unlocking click doesn't also switch the sound off.
   */
  resumeOnGesture(): void {
    const go = (ev: Event) => {
      if (!this.sfx && !this.music) return;
      if ((ev.target as Element | null)?.closest?.("[data-a=sfx],[data-a=music]")) return;
      void this.audio()?.resume();
      if (this.music) this.startMusic();
      for (const t of ["pointerdown", "keydown"]) window.removeEventListener(t, go, true);
    };
    for (const t of ["pointerdown", "keydown"]) window.addEventListener(t, go, true);
  }

  /** Fetch and decode a clip ahead of time (cached), so the finish song starts on time. */
  preload(url: string): Promise<AudioBuffer | null> {
    let p = this.clips.get(url);
    if (!p) {
      p = fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((b) => (this.audio() ? this.ctx!.decodeAudioData(b) : null))
        .catch(() => null);
      this.clips.set(url, p);
    }
    return p;
  }

  /**
   * Play `seconds` of a clip from `start` through the unlocked audio context, fading out at the end. Unlike a new
   * <audio> element this needs no fresh click, so it plays when a run finishes hours after the last one. Resolves to
   * a stop function, or null when audio is still locked or the clip can't be decoded.
   */
  async playClip(url: string, start: number, seconds: number): Promise<(() => void) | null> {
    const ctx = this.audio();
    if (!ctx || !this.master) return null;
    if (ctx.state !== "running") await ctx.resume().catch(() => undefined);
    const buf = await this.preload(url);
    if (!buf || ctx.state !== "running") return null;
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    const t = ctx.currentTime;
    const fade = Math.min(2, seconds / 4);
    src.buffer = buf;
    g.gain.setValueAtTime(1.6, t);
    g.gain.setValueAtTime(1.6, t + seconds - fade);
    g.gain.linearRampToValueAtTime(0.0001, t + seconds);
    src.connect(g).connect(this.master);
    src.start(t, Math.min(start, Math.max(0, buf.duration - 1)), seconds);
    return () => { try { src.stop(); } catch { /* already stopped */ } };
  }

  private tone(freq: number, dur: number, wave: Wave = "square", vol = 0.2, at = 0, slideTo?: number, out?: AudioNode): void {
    const ctx = this.audio();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = wave;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out ?? this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** Bottle cap hiss and pop, fizz, then three gulps. */
  private beer(): void {
    this.noise(0.22, 0.12, 0, 4000, "highpass");
    this.tone(700, 0.07, "sine", 0.25, 0.2, 140);
    this.noise(1.4, 0.035, 0.28, 6500, "highpass");
    for (let i = 0; i < 3; i++) this.tone(190, 0.13, "sine", 0.3, 1.0 + i * 0.38, 110);
    this.noise(0.12, 0.05, 2.25, 900, "lowpass");
  }

  private noise(dur: number, vol = 0.08, at = 0, freq = 1800, kind: BiquadFilterType = "bandpass"): void {
    const ctx = this.audio();
    if (!ctx || !this.master) return;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    src.buffer = buf;
    f.type = kind;
    f.frequency.value = freq;
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master);
    src.start(ctx.currentTime + at);
  }

  /** The sound for an office command, if any. Same-kind sounds are spaced out so busy moments don't turn into noise. */
  play(c: Command): void {
    if (!this.sfx) return;
    // a context the browser suspended (tab switch, device change) comes back on its own once the page was clicked
    if (this.ctx && this.ctx.state !== "running") void this.ctx.resume();
    const key = c.type === "stamp" ? `stamp${c.ok}` : c.type;
    const now = performance.now();
    if (now - (this.last.get(key) ?? -Infinity) < 250) return;
    this.last.set(key, now);
    switch (c.type) {
      case "merged": [72, 76, 79].forEach((n, i) => this.tone(NOTE(n), 0.18, "square", 0.12, i * 0.07)); break;
      case "stamp": if (c.ok) this.tone(NOTE(84), 0.06, "square", 0.1); else this.tone(150, 0.35, "sawtooth", 0.12, 0, 90); break;
      case "throw": this.tone(220, 0.25, "triangle", 0.12, 0, 110); break;
      case "alert": if (c.mood === "bad") { this.tone(110, 0.3, "square", 0.12); this.tone(98, 0.3, "square", 0.1, 0.12); } break;
      case "handoff": this.noise(0.18, 0.06); break;
      case "qa": [76, 81, 88].forEach((n, i) => this.tone(NOTE(n), 0.25, "triangle", 0.14, i * 0.09)); break;
      case "deployed": if (c.ok) [60, 64, 67, 72].forEach((n, i) => this.tone(NOTE(n), 0.22, "square", 0.12, i * 0.08)); break;
      case "ruling": this.tone(NOTE(91), 0.4, "sine", 0.1); break;
      case "celebrate": [72, 76, 79, 84, 79, 84].forEach((n, i) => this.tone(NOTE(n), i === 5 ? 0.6 : 0.14, "square", 0.13, i * 0.11)); break;
      case "phase": this.tone(NOTE(79), 0.12, "triangle", 0.08); this.tone(NOTE(84), 0.16, "triangle", 0.08, 0.08); break;
      case "sfx": if (c.name === "beer") this.beer(); break;
      default: break;
    }
  }

  // ---- music: a slow I–vi–IV–V loop with a soft pad, bass and arpeggio, scheduled one bar ahead ----
  private static readonly CHORDS = [[60, 64, 67, 71], [57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 67]];
  private static readonly BAR = 2.4; // seconds (100 bpm, 4/4)

  private startMusic(): void {
    const ctx = this.audio();
    if (!ctx || this.musicTimer) return;
    void ctx.resume();
    this.nextBar = ctx.currentTime + 0.1;
    const schedule = () => {
      while (this.nextBar < ctx.currentTime + Sound.BAR * 1.5) {
        this.playBar(this.nextBar - ctx.currentTime, Sound.CHORDS[this.bar % 4]);
        this.nextBar += Sound.BAR;
        this.bar++;
      }
    };
    schedule();
    this.musicTimer = setInterval(schedule, 400);
  }

  private stopMusic(): void {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = undefined;
  }

  private playBar(at: number, chord: number[]): void {
    const out = this.musicGain;
    const B = Sound.BAR;
    for (const n of chord) this.tone(NOTE(n), B * 0.95, "triangle", 0.18, at, undefined, out);
    this.tone(NOTE(chord[0] - 24), B * 0.45, "sine", 0.35, at, undefined, out);
    this.tone(NOTE(chord[0] - 24), B * 0.45, "sine", 0.3, at + B / 2, undefined, out);
    const arp = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[3] + 12, chord[2] + 12, chord[1] + 12, chord[2] + 12, chord[3] + 12];
    arp.forEach((n, i) => this.tone(NOTE(n), 0.22, "square", 0.05, at + (i * B) / 8, undefined, out));
  }
}

function safeStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
