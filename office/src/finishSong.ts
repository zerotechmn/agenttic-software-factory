/**
 * The run's victory lap (public/finish.json: { audio?, youtube?, start, seconds, title }). When a run finishes:
 * - if `audio` exists next to the office (your own file, e.g. finish.mp3), it plays from `start` for `seconds`, offline,
 *   through the office's already-unlocked Web Audio context (a new <audio> element would need a fresh click);
 * - otherwise a corner card offers the YouTube video at that moment in a new tab (music videos refuse embedded playback).
 * Only with SFX on; the card closes itself.
 */
export interface FinishSong { audio?: string; youtube?: string; start: number; seconds: number; title?: string }
interface ClipPlayer { playClip(url: string, start: number, seconds: number): Promise<(() => void) | null> }

let loaded: Promise<FinishSong | null> | undefined;

/** The song's settings (checked once per page). */
export function loadFinishSong(): Promise<FinishSong | null> {
  return (loaded ??= readFinishSong());
}

async function readFinishSong(): Promise<FinishSong | null> {
  try {
    const r = await fetch("finish.json");
    if (!r.ok) return null;
    const s = (await r.json()) as FinishSong;
    if (s.audio && !/^[\w.-]+\.(mp3|m4a|ogg|wav)$/.test(s.audio)) s.audio = undefined;
    if (s.youtube && !/^[A-Za-z0-9_-]{6,20}$/.test(s.youtube)) s.youtube = undefined;
    // only a real audio file counts (some servers answer any path with the app page)
    if (s.audio && !(await fetch(s.audio, { method: "HEAD" }).then((x) => x.ok && /^audio\//.test(x.headers.get("content-type") ?? "")).catch(() => false))) s.audio = undefined;
    return s.audio || s.youtube ? s : null;
  } catch {
    return null;
  }
}

export function playFinishSong(song: FinishSong, player?: ClipPlayer): () => void {
  document.getElementById("finish-song")?.remove();
  const box = document.createElement("div");
  box.id = "finish-song";
  box.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:60;width:340px;background:#1f1a14;color:#fff;border:3px solid #000;box-shadow:4px 4px 0 #f5c542;font-family:'Press Start 2P';font-size:10px";
  const bar = document.createElement("div");
  bar.style.cssText = "display:flex;justify-content:space-between;align-items:center;background:#f5c542;color:#000;padding:6px";
  const label = document.createElement("span");
  label.textContent = `RUN DONE · ${song.title ?? "victory lap"}`;
  const x = document.createElement("button");
  x.textContent = "✕";
  x.setAttribute("aria-label", "Close the finish song");
  x.style.cssText = "border:2px solid #000;background:#fff;cursor:pointer;font:inherit";
  bar.append(label, x);
  const body = document.createElement("div");
  body.style.cssText = "padding:12px;display:flex;flex-direction:column;gap:8px;align-items:flex-start";
  box.append(bar, body);
  let audio: HTMLAudioElement | undefined;
  let stopClip: (() => void) | null = null;
  let closed = false;
  if (song.audio) {
    const src = song.audio;
    const note = document.createElement("span");
    note.textContent = "♪ now playing";
    body.append(note);
    // fallback: a plain <audio> element, which the browser may hold until a click
    const viaElement = () => {
      if (closed) return;
      audio = new Audio(src);
      audio.volume = 0.8;
      audio.addEventListener("loadedmetadata", () => { if (audio) audio.currentTime = song.start; }, { once: true });
      void audio.play().catch(() => { note.textContent = "click anywhere to play ♪"; window.addEventListener("pointerdown", () => void audio?.play(), { once: true }); });
    };
    if (player) void player.playClip(src, song.start, song.seconds).then((stop) => { if (closed) stop?.(); else if (stop) stopClip = stop; else viaElement(); }, viaElement);
    else viaElement();
  }
  if (song.youtube && !song.audio) {
    const a = document.createElement("a");
    a.href = `https://www.youtube.com/watch?v=${song.youtube}&t=${song.start}s`;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "▶ Play on YouTube";
    a.style.cssText = "background:#f5c542;color:#000;border:3px solid #000;padding:8px;text-decoration:none";
    body.append(a);
  }
  document.body.append(box);
  const close = () => { closed = true; clearTimeout(timer); audio?.pause(); stopClip?.(); box.remove(); };
  const timer = setTimeout(close, (song.seconds + (song.audio ? 1 : 15)) * 1000);
  x.addEventListener("click", close);
  return close;
}
