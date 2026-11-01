import { COLS, FURNITURE, ROOMS, ROWS } from "./map";
import atlas from "./atlas.json";

export interface Cell { x: number; y: number }
export interface Grid { walkable(x: number, y: number): boolean; canStep(a: Cell, b: Cell): boolean }

const NON_BLOCKING = /^(rug_|runner_|painting|map_frame|board|mirror|chandelier|lamp)/;
const CORRIDOR = (y: number) => y === 9 || y === 10;

/** The floor cell a role stands on: the row just behind its desk. */
export function seatCell(seat: { x: number; y: number }): Cell {
  return { x: Math.floor(seat.x), y: Math.ceil(seat.y) - 1 };
}

function region(x: number, y: number): string | null {
  if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return null;
  if (CORRIDOR(y)) return "corridor";
  for (const r of ROOMS) {
    if (x < r.x || x >= r.x + r.w) continue;
    if (r.y < 9 && y >= 2 && y <= 8) return r.id;
    if (r.y >= 11) {
      if (y >= 13) return r.id;
      if ((y === 11 || y === 12) && (x === r.door || x === r.door + 1)) return r.id; // doorway through the wall band
    }
  }
  return null;
}

export function buildGrid(): Grid {
  const blocked = new Set<string>();
  for (const f of FURNITURE) {
    if (NON_BLOCKING.test(f.sprite) || f.y % 1 !== 0) continue;
    const def = (atlas.furniture as Record<string, { tiles: unknown[]; w?: number }>)[f.sprite];
    const w = def.w ?? def.tiles.length;
    const h = Math.ceil(def.tiles.length / w);
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) blocked.add(`${f.x + dx},${f.y + dy}`);
  }
  const walkable = (x: number, y: number) => region(x, y) !== null && !blocked.has(`${x},${y}`);
  const isDoor = (r: (typeof ROOMS)[number], x: number) => x === r.door || x === r.door + 1;
  const canStep = (a: Cell, b: Cell) => {
    if (!walkable(a.x, a.y) || !walkable(b.x, b.y)) return false;
    const ra = region(a.x, a.y)!, rb = region(b.x, b.y)!;
    if (ra === rb) return true;
    const [room, other] = ra === "corridor" ? [rb, a] : rb === "corridor" ? [ra, b] : [null, null];
    if (!room || !other) return false; // never through a side wall
    const r = ROOMS.find((q) => q.id === room)!;
    const roomCell = ra === "corridor" ? b : a;
    // top rooms open at row 8 → 9, bottom rooms at row 11 → 10, only through their door
    return isDoor(r, roomCell.x) && a.x === b.x && ((r.y < 9 && roomCell.y === 8) || (r.y >= 11 && roomCell.y === 11));
  };
  return { walkable, canStep };
}

/** 4-directional A* on tiles. Returns the full path including start and goal, or null. */
export function findPath(grid: Grid, start: Cell, goal: Cell): Cell[] | null {
  const key = (c: Cell) => `${c.x},${c.y}`;
  const h = (c: Cell) => Math.abs(c.x - goal.x) + Math.abs(c.y - goal.y);
  const open = new Map<string, { c: Cell; g: number; f: number }>([[key(start), { c: start, g: 0, f: h(start) }]]);
  const came = new Map<string, Cell>();
  const best = new Map<string, number>([[key(start), 0]]);
  while (open.size) {
    let cur!: { c: Cell; g: number; f: number };
    for (const n of open.values()) if (!cur || n.f < cur.f) cur = n;
    open.delete(key(cur.c));
    if (cur.c.x === goal.x && cur.c.y === goal.y) {
      const path = [cur.c];
      let k = key(cur.c);
      while (came.has(k)) {
        const p = came.get(k)!;
        path.unshift(p);
        k = key(p);
      }
      return path;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = { x: cur.c.x + dx, y: cur.c.y + dy };
      if (!grid.canStep(cur.c, n)) continue;
      const g = cur.g + 1;
      if (g >= (best.get(key(n)) ?? Infinity)) continue;
      best.set(key(n), g);
      came.set(key(n), cur.c);
      open.set(key(n), { c: n, g, f: g + h(n) });
    }
  }
  return null;
}
