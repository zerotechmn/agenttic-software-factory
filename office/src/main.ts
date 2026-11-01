import { Dialogue, fetchSceneLines } from "./dialogue";
import { loadFinishSong, playFinishSong } from "./finishSong";
import { Sound } from "./sound";
import { Kanban, type KanbanTask } from "./kanban";
import { renderVault } from "./vaultPanel";
import { RUN_PATHS, withRun } from "./shared/contracts";
import { renderPrd, renderTask, type PrdView, type TaskDetail } from "./detailPanels";
import "@fontsource/press-start-2p";
import "@fontsource/vt323";
import { Application, Container, Graphics } from "pixi.js";
import { Agent, setSpeed } from "./agent";
import { Director, type Command, type ForgeEvent } from "./director";
import { drawOffice } from "./draw";
import { isRunReplay, startFeed } from "./feed";
import { Hud } from "./hud";
import { Labels, pixelText } from "./labels";
import { COLS, FURNITURE, ROOMS, ROWS, SEATS, T, signSpot } from "./map";
import { buildGrid } from "./path";
import { furniture, loadSheets } from "./sprites";
import { Stage, withTimeout } from "./stage";
import { Props } from "./props";
import { AgentPanel } from "./agentPanel";
import { fetchRuns, postSay, postTask } from "./api";
import { AgentLog } from "./agentLog";
import { Visitors, type ClaudeEvent, type VisitorCommand } from "./visitors";
import { ChatPanel } from "./chatPanel";
import { LobbyPanel } from "./lobbyPanel";
import { RunPicker } from "./runPicker";
import { currentRun, LOGGED_KINDS, type ConsoleInfo } from "./shared/contracts";
import { TaskBoard } from "./board";
import { BoardPanel } from "./boardPanel";
import { Camera, type View } from "./camera";
import type { Mode } from "./feed";
import { NoteBook } from "./notes";
import { installHooks } from "./office";
import { roomAt, roomText, Tooltip, type Worker } from "./tooltip";

// where visitors wait (lobby) and work (tile anchors per room)
const VISIT_HOME = [{ x: 2, y: 6 }, { x: 4, y: 6 }, { x: 3, y: 7 }];
const VISIT_ROOM: Record<string, { x: number; y: number }> = {
  research: { x: 16, y: 6 }, dev: { x: 8, y: 18 }, qa: { x: 29, y: 18 }, vault: { x: 23, y: 18 }, architecture: { x: 23, y: 7 }, product: { x: 9, y: 7 },
};
/** Team names for the developer desks (dev:1, dev:2, dev:3). */
const DEV_NAMES = ["Tuvshu", "Anar", "Mada"];
const ROLE_OF: Record<string, string> = { product: "Product", researcher: "Researcher", architect: "Architect", uiux: "UI/UX", reviewer: "Reviewer", final_reviewer: "Final reviewer", integrator: "Integrator", qa: "QA", devops: "DevOps" };

async function boot() {
  await withTimeout<unknown>(Promise.all([document.fonts.load('16px "Press Start 2P"'), document.fonts.load('22px "VT323"')]), 4000, undefined);
  const app = new Application();
  // Render at the display's real density: crisp sprites AND crisp text on Retina screens.
  await app.init({ resizeTo: window, background: "#120d0a", antialias: false, roundPixels: true, resolution: window.devicePixelRatio || 1, autoDensity: true });
  document.body.appendChild(app.canvas);
  await loadSheets();

  const world = new Container();
  const labels = new Labels();
  app.stage.addChild(world, labels.layer);
  world.addChild(drawOffice());

  const props = new Container();
  props.sortableChildren = true;
  world.addChild(props);
  for (const f of FURNITURE) {
    const c = furniture(f.sprite);
    c.position.set(Math.round(f.x * T), Math.round(f.y * T));
    c.zIndex = c.y + c.height;
    props.addChild(c);
  }
  const monitors = new Map<string, Graphics>();
  for (const [key, seat] of Object.entries(SEATS)) {
    if (key === "integrator" || key === "architect" || key === "researcher") continue;
    const m = new Graphics();
    m.rect(0, 0, 9, 7).fill(0x2b2d33).rect(1, 1, 7, 5).fill(0x3d4048).rect(3, 7, 3, 2).fill(0x2b2d33).rect(6, 2, 1, 1).fill(0x4ade80);
    m.position.set(Math.round(seat.x * T) - 4, Math.round(seat.y * T) - 5);
    m.zIndex = seat.y * T + 17;
    props.addChild(m);
    monitors.set(key, m);
  }
  // room signs: crisp pixel font in screen space (size follows the integer world scale)
  const roomSigns: { style: { fontSize: number } }[] = [];
  for (const r of ROOMS) {
    const s = pixelText(r.label.toUpperCase(), 24, 0x3b2618);
    const spot = signSpot(r);
    s.anchor.set(spot.left ? 0 : 0.5, 0);
    roomSigns.push(s);
    labels.add(s, () => ({ x: spot.x, y: (r.y < 9 ? 0 : 11) * T + 10 }), { x0: r.x * T, x1: (r.x + r.w) * T });
  }

  const set = new Props();
  world.addChildAt(set.layer, 1);
  const fx = new Container();
  world.addChild(fx);
  const grid = buildGrid();
  const agents = new Map<string, Agent>();
  const agentLog = new AgentLog();
  for (const [key, seat] of Object.entries(SEATS)) {
    const a = new Agent(key, key.startsWith("dev:") ? "dev" : key, seat, grid, fx, key.startsWith("dev:") ? (DEV_NAMES[Number(key.slice(4)) - 1] ?? `Dev ${key.slice(4)}`) : undefined);
    agents.set(key, a);
    props.addChild(a.view);
  }

  const hud = new Hud();
  let director = new Director();
  // the stage reports some moments back (HUD updates, and sound effects timed to an animation)
  const stage = new Stage(agents, grid, props, fx, labels, (c) => (c.type === "sfx" ? sound.play(c) : hud.handle(c)), set, world);
  const models = new Map<string, string>();
  const tasks = new Map<string, string>();

  let mode: Mode = "replay";
  const board = new TaskBoard();
  const notes = new NoteBook();
  const taskEvents = new Map<string, ForgeEvent[]>();
  const fetchState = async (): Promise<Record<string, unknown> | null> => {
    try {
      const r = await fetch(mode === "live" || isRunReplay() ? withRun(RUN_PATHS.state) : "sample-state.json");
      return r.ok ? ((await r.json()) as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const openTask = async (id: string) => {
    const body = hud.showPanel("task");
    body.textContent = "loading…";
    const st = await fetchState();
    const t = ((st?.tasks as TaskDetail[] | undefined) ?? []).find((x) => x.id === id) ?? { id, title: board.tasks().find((x) => x.id === id)?.title ?? id, status: "?" };
    if (hud.panelKind() === "task") renderTask(body, t, taskEvents.get(id) ?? [], () => openBoard());
  };
  const openPrd = async () => {
    const body = hud.showPanel("prd");
    body.textContent = "loading…";
    const st = await fetchState();
    const closed = ((st?.done as string[] | undefined) ?? []).includes("product");
    if (hud.panelKind() === "prd")
      renderPrd(body, (st?.prd as PrdView | null) ?? null, mode === "live", (text) => (closed ? postTask({ title: `Client answer: ${text}`.slice(0, 120), description: text }) : postSay("product", text)), closed);
  };
  const boardPanel = new BoardPanel(board, () => mode, postTask, (id) => void openTask(id));
  const agentPanel = new AgentPanel(notes, () => mode, postSay);
  const tooltip = new Tooltip();
  let consoleInfo: ConsoleInfo = { console: false, runs: [], current: null };
  const lobbyPanel = new LobbyPanel(() => consoleInfo);
  const chatPanel = new ChatPanel(() => consoleInfo, window.sessionStorage);
  const runPicker = new RunPicker();
  runPicker.render(hud.runSlot(), null, null);
  // not awaited: the console probe must not delay __ready
  void fetchRuns().then((runs) => {
    consoleInfo = runs ? { console: true, runs, current: currentRun(runs) } : { console: false, runs: [], current: null };
    runPicker.render(hud.runSlot(), runs, consoleInfo.current);
    // a lobby opened before the probe finished still shows demo mode: redraw it in console mode
    if (runs && hud.panelKind() === "lobby") openLobby();
    if (runs) startVisitors();
  });

  const camera = new Camera(app.canvas, () => app.screen, (v: View) => {
    for (const r of roomSigns) r.style.fontSize = 8 * v.scale;
    world.scale.set(v.scale);
    world.position.set(v.x, v.y);
    labels.scale = v.scale;
    labels.viewWidth = app.screen.width;
    labels.origin = { x: v.x, y: v.y };
  });

  const openBoardList = () => boardPanel.render(hud.showPanel("board"));
  const allEvents: ForgeEvent[] = [];
  const kanban = new Kanban(() => allEvents, async () => {
    const st = await fetchState();
    const full = (st?.tasks as KanbanTask[] | undefined) ?? [];
    return full.length ? full : board.tasks().map((t) => ({ ...t, status: t.status as string }));
  }, () => mode === "live" || isRunReplay(), () => { kanban.close(); openBoardList(); }, (e) => {
    const key = e.role === "dev" ? (e.taskId ? director.deskOf(e.taskId) : undefined) : e.role;
    const a = key ? agents.get(key) : undefined;
    return a && key ? { key, name: a.name } : undefined;
  });
  let kanbanTimer: ReturnType<typeof setTimeout> | undefined;
  const openBoard = () => { hud.closePanel(); void kanban.open("board"); };
  let questionsPending = false;
  const openAgent = (key: string) => {
    // while Product waits in the lobby with questions, clicking it opens the PRD and its answer box
    if (key === "product" && questionsPending) { void openPrd(); return; }
    const a = agents.get(key);
    if (!a) return;
    const role = key.startsWith("dev:") ? "dev" : key.startsWith("claude:") ? "claude" : key;
    if (role === "claude") {
      agentPanel.render(hud.showPanel(`agent:${key}`), { key, role, title: `${a.name} · ${visitorProject.get(key) ?? "session"}`, meta: "interactive Claude Code session (view only)", events: agentLog.get(key) });
      return;
    }
    agentPanel.render(hud.showPanel(`agent:${key}`), { key, role, title: `${a.name} · ${ROLE_OF[role] ?? "Developer"}`, meta: `${models.get(key) ?? "idle"}${tasks.get(key) ? ` · ${tasks.get(key)}` : ""}`, events: agentLog.get(key) });
  };
  const openLobby = () => lobbyPanel.render(hud.showPanel("lobby"));
  const openChat = () => chatPanel.render(hud.showPanel("chat"));
  hud.onNewJob = openLobby;
  hud.onProduct = () => void openPrd();
  hud.onBoard = () => openBoard();
  const openVault = () => { void renderVault(hud.showPanel("vault"), mode === "live" || isRunReplay(), () => hud.panelKind() === "vault"); };
  hud.onVault = openVault;
  hud.onAsk = openChat;

  // click a character → its live log + "leave a note"; click the cork board → the task board
  // a character's tap fires before the canvas click: the lobby (room) click must not replace its panel
  let lastAgentTap = -Infinity;
  const clickable = (a: Agent) => {
    a.view.eventMode = "static";
    a.view.cursor = "pointer";
    a.view.on("pointertap", () => { if (!camera.wasDrag()) { lastAgentTap = performance.now(); openAgent(a.key); } });
  };
  for (const a of agents.values()) clickable(a);

  // Interactive Claude Code sessions (console mode): visitors that walk to the room matching their work.
  const visitors = new Visitors();
  const visitorProject = new Map<string, string>();
  const nearestFree = (anchor: { x: number; y: number }, avoid: Set<string>) => {
    for (let r = 0; r < 6; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const p = { x: anchor.x + dx, y: anchor.y + dy };
          if (grid.walkable(p.x, p.y) && !avoid.has(`${p.x},${p.y}`)) return p;
        }
    return anchor;
  };
  const visitorSpots = new Map<string, string>(); // key → "x,y" it walks to, so two visitors never share a tile
  const runVisitor = (c: VisitorCommand, live: boolean) => {
    // visitors are always live: the FORGE history catch-up may have left the stage in instant mode
    const wasInstant = stage.instant;
    stage.instant = false;
    try { runVisitorNow(c, live); } finally { stage.instant = wasInstant; }
  };
  const runVisitorNow = (c: VisitorCommand, live: boolean) => {
    if (c.type === "spawn") {
      const n = Number(c.key.split(":")[1]);
      const home = nearestFree(VISIT_HOME[(n - 1) % VISIT_HOME.length], new Set());
      const a = new Agent(c.key, "claude", { x: home.x + 0.5, y: home.y }, grid, fx, n === 1 ? "Claude" : `Claude ${n}`);
      a.errand = true; // visitors keep up with a live session: always the brisk errand pace
      stage.addAgent(a);
      clickable(a);
      visitorProject.set(c.key, c.project);
    } else if (c.type === "leave") {
      if (hud.panelKind() === `agent:${c.key}`) hud.closePanel?.();
      stage.removeAgent(c.key);
      agentLog.clear(c.key);
      visitorSpots.delete(c.key);
      visitorProject.delete(c.key);
    } else if (c.type === "go") {
      // latest target wins: walkTo re-paths from where the visitor stands (no queue behind older walks)
      const a = agents.get(c.key);
      if (!a) return;
      if (c.room === "lobby") { visitorSpots.delete(c.key); a.goHome(); return; }
      const taken = new Set([...visitorSpots].filter(([k]) => k !== c.key).map(([, v]) => v));
      const to = nearestFree(VISIT_ROOM[c.room] ?? VISIT_ROOM.dev, taken);
      visitorSpots.set(c.key, `${to.x},${to.y}`);
      a.walkTo(to);
    } else if (live) stage.exec({ type: "bubble", agent: c.key, text: c.text.slice(0, 60) });
  };
  const startVisitors = () => {
    const connected = Date.now();
    const es = new EventSource("/api/claude-events");
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as ClaudeEvent;
      const live = e.ts >= connected - 1500;
      for (const c of visitors.handle(e, e.ts)) runVisitor(c, live);
      const key = visitors.keyFor(e.session);
      if (!key || e.kind === "start") return;
      const fe: ForgeEvent = { ts: e.ts, run: "claude", phase: e.project, kind: e.kind === "tool" ? "tool" : e.kind === "stop" ? "agent_done" : "say", role: "claude", text: e.kind === "tool" ? `${e.tool} ${e.text}`.trim() : e.kind === "stop" ? "done · waiting for you" : e.text, data: { tool: e.tool } };
      agentLog.push(key, fe);
      agentPanel.prepend(key, fe);
    };
    setInterval(() => { for (const c of visitors.tick(Date.now())) runVisitor(c, true); }, 15_000);
  };
  set.board.eventMode = "static";
  set.board.cursor = "pointer";
  set.board.on("pointertap", () => { if (!camera.wasDrag()) openBoard(); });

  const workers = (roomId: string): Worker[] =>
    Object.entries(SEATS).filter(([, s]) => s.room === roomId).map(([key]) => ({ name: agents.get(key)!.name, working: agents.get(key)!.mode === "working", on: tasks.get(key) || undefined }));
  const roomByName = (name: string) => ROOMS.find((r) => r.label.toLowerCase() === name.toLowerCase());
  app.canvas.addEventListener("pointermove", (ev) => {
    const w = camera.toWorld(ev.offsetX, ev.offsetY);
    const r = camera.dragging() ? undefined : roomAt(w.x, w.y);
    if (r) tooltip.show(roomText(r, workers(r.id)), ev.clientX, ev.clientY);
    else tooltip.hide();
  });
  app.canvas.addEventListener("click", (ev) => {
    if (camera.wasDrag() || performance.now() - lastAgentTap < 400) return;
    const w = camera.toWorld(ev.offsetX, ev.offsetY);
    const room = roomAt(w.x, w.y)?.id;
    if (room === "lobby") openLobby();
    else if (room === "vault") openVault();
  });
  app.canvas.addEventListener("pointerleave", () => tooltip.hide());

  installHooks({
    tasks: () => board.tasks(),
    agents: () => [...agents.values()].map((a) => ({ key: a.key, mode: a.mode, x: a.view.x, y: a.view.y, tag: stage.tags.get(a.key) })),
    zoom: () => camera.zoom(),
    openBoard: openBoardList,
    beer: (key = "product") => { stage.instant = false; stage.exec({ type: "beerOut", agent: key }); setTimeout(() => stage.exec({ type: "beerReturn", agent: key, work: false }), 2500); },
    openKanban: (tab?: "board" | "handoffs" | "timeline") => void kanban.open(tab),
    openAgent,
    openChat,
    openLobby,
    agentLog: (key) => agentLog.get(key),
    screenOf: (key) => { const a = agents.get(key); if (!a) return null; const p = a.view.getGlobalPosition(); return { x: p.x, y: p.y }; },
    room: (name) => { const r = roomByName(name); return r ? roomText(r, workers(r.id)) : ""; },
  });

  // run clock for ambient life: last event ts, advanced by wall time × replay speed between events
  let runTs = 0, runWall = performance.now(), speed = 1;
  const runNow = () => runTs + (performance.now() - runWall) * speed;
  const sound = new Sound();
  const dialogue = new Dialogue(fetchSceneLines);
  // remembered as on, but the browser keeps audio locked until a click: show that, so a click turns it on (not off)
  const showAudio = () => {
    hud.setAudio("sfx", sound.sfx && sound.locked() ? "locked" : sound.sfx);
    hud.setAudio("music", sound.music && sound.locked() ? "locked" : sound.music);
  };
  showAudio();
  sound.onChange = showAudio;
  hud.onSfx = (on) => { sound.setSfx(on); setTimeout(showAudio, 300); };
  hud.onMusic = (on) => { sound.setMusic(on); setTimeout(showAudio, 300); };
  sound.resumeOnGesture();
  // decode the finish song early, so it starts the moment the run ends
  if (sound.sfx) void loadFinishSong().then((song) => { if (song?.audio) void sound.preload(song.audio); });
  const run = (c: Command) => {
    if (!stage.instant) sound.play(c);
    if (c.type === "dialogue") {
      // scenes only for what happens now (live or replay), never for history loaded at page open
      if (!stage.instant) dialogue.play({ key: c.key, moment: c.moment, facts: c.facts, speakers: c.speakers.map((k) => ({ key: k, name: agents.get(k)?.name ?? k })) });
      return;
    }
    // the run just finished, live or in a replay: victory lap (only with SFX on, never for history loaded at page open)
    if (c.type === "celebrate" && !stage.instant && sound.sfx) void loadFinishSong().then((song) => song && playFinishSong(song, sound));
    if (c.type === "noteDelivered") {
      if (notes.deliver(c.role) && hud.panelKind()?.startsWith("agent:")) agentPanel.refresh();
      return;
    }
    stage.exec(c);
  };

  const onEvent = (e: ForgeEvent, history = false) => {
    hud.clock(e.ts);
    runTs = e.ts; runWall = performance.now();
    if (e.taskId) { const l = taskEvents.get(e.taskId) ?? []; l.push(e); taskEvents.set(e.taskId, l); }
    allEvents.push(e);
    if (e.kind === "clarify") questionsPending = e.status === "asked";
    else if (e.kind === "phase_start" && e.phase !== "product") questionsPending = false;
    if (kanban.isOpen() && !history && (e.kind === "task_status" || e.kind === "gate" || e.kind === "review")) { clearTimeout(kanbanTimer); kanbanTimer = setTimeout(() => void kanban.refresh(), 600); }
    if (board.apply(e)) { hud.setTotal(board.tasks().length); if (hud.panelKind() === "board") boardPanel.refresh(); }
    stage.instant = history;
    const who = director.agentFor(e);
    if (who) {
      if (e.model) models.set(who, e.model);
      if (e.kind === "agent_start") tasks.set(who, e.taskId ?? "");
      // StructuredOutput is the agent filing its report: internal, like in the director
      const internal = e.kind === "tool" && /^StructuredOutput\b/.test(e.text ?? "");
      if ((LOGGED_KINDS as readonly string[]).includes(e.kind) && !internal) { agentLog.push(who, e); agentPanel.prepend(who, e); }
    }
    if (e.kind === "agent_done" && e.status === "ok") {
      const l = (e.text ?? "").match(/"product"\s*:\s*"([^"]+)"/);
      if (l) hud.product(l[1]);
    }
    for (const c of director.handle(e)) run(c);
  };
  // not awaited: a slow /state or sample fetch must not delay __ready (beyond a short wait for the board below)
  let seeded!: () => void;
  const boardSeeded = new Promise<void>((r) => (seeded = r));
  const feedP = startFeed(onEvent, (m, state) => {
    mode = m;
    const s = state as { prd?: { product?: string }; budgetUsd?: number } | null;
    hud.setMode(m, s?.prd?.product);
    // the board is seeded from /state (live) or the recorded final state (replay)
    if (m === "live") { board.load(state); hud.setTotal(board.tasks().length); seeded(); }
    else void fetch(isRunReplay() ? withRun(RUN_PATHS.state) : "sample-state.json").then((r) => r.json()).then((st) => { board.load(st); if (hud.panelKind() === "board") boardPanel.refresh(); }).catch(() => undefined).finally(seeded);
    if (s?.budgetUsd) hud.budget = s.budgetUsd;
  }, () => {
    director = new Director();
    hud.reset();
  }, (ok, why) => hud.setConnection(ok, why));
  hud.onSpeed = (s) => { setSpeed(s); speed = s; void feedP.then((f) => f.setSpeed(s)); };
  hud.onRestart = () => void feedP.then((f) => f.restart());
  window.addEventListener("keydown", (k) => {
    const el = document.activeElement;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || k.ctrlKey || k.metaKey || k.altKey) return;
    if (k.key === "1" || k.key === "4") hud.setSpeedUi(Number(k.key));
    if (k.key === "0") hud.setSpeedUi(10);
    if (k.key.toLowerCase() === "r") void feedP.then((f) => f.restart());
  });

  let lifeBeat = 0;
  app.ticker.add((t) => {
    for (const a of agents.values()) a.update(t.deltaMS);
    set.update(t.deltaMS, agents.get("architect")?.mode === "working");
    // monitors glow and flicker while their worker is busy
    for (const [key, m] of monitors) {
      const busy = agents.get(key)?.mode === "working";
      m.tint = busy ? (Math.floor(performance.now() / 120) % 3 === 0 ? 0xbff6ff : 0x8fe9ff) : 0xffffff;
    }
    stage.update();
    if (Math.floor(performance.now() / 500) !== lifeBeat) { lifeBeat = Math.floor(performance.now() / 500); for (const c of director.tick(runNow())) run(c); }
    labels.sync();
  });

  camera.fit();
  window.addEventListener("resize", () => camera.fit());
  // tasks() must be populated when __ready flips (it raced the sample-state fetch under load)
  await withTimeout(boardSeeded, 2500, undefined);
  (window as unknown as { __ready: boolean }).__ready = true;
}

boot();
