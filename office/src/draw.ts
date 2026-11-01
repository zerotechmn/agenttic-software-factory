import { Container, Graphics } from "pixi.js";
import { COLS, ROOMS, ROWS, T, type Room } from "./map";

const shade = (c: number, k: number) => {
  const r = Math.min(255, Math.max(0, Math.round(((c >> 16) & 255) * k)));
  const g = Math.min(255, Math.max(0, Math.round(((c >> 8) & 255) * k)));
  const b = Math.min(255, Math.max(0, Math.round((c & 255) * k)));
  return (r << 16) | (g << 8) | b;
};

function floor(g: Graphics, room: Room, x0: number, y0: number, w: number, h: number) {
  const base = room.tint;
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const px = (x0 + tx) * T, py = (y0 + ty) * T;
      if (room.floor === "wood" || room.floor === "wood_dark") {
        // 4 planks per tile, staggered seams, subtle per-plank tone
        for (let p = 0; p < 4; p++) {
          const tone = 0.92 + (((tx * 7 + (ty * 4 + p) * 13) % 5) * 0.035);
          g.rect(px, py + p * 4, T, 4).fill(shade(base, room.floor === "wood_dark" ? tone * 0.8 : tone));
          g.rect(px, py + p * 4 + 3, T, 1).fill(shade(base, 0.62));
          const seam = ((tx + ty * 2 + p) % 3) * 5 + 3;
          if ((tx + p + ty) % 2 === 0) g.rect(px + seam, py + p * 4, 1, 3).fill(shade(base, 0.7));
        }
      } else if (room.floor === "carpet") {
        g.rect(px, py, T, T).fill(base);
        for (let i = 0; i < 6; i++) g.rect(px + ((i * 5 + ty * 3) % 15), py + ((i * 7 + tx * 5) % 15), 1, 1).fill(shade(base, 1.25));
      } else if (room.floor === "tile") {
        g.rect(px, py, T, T).fill(shade(base, (tx + ty) % 2 ? 1.04 : 0.96));
        g.rect(px, py, T, 1).fill(shade(base, 0.8));
        g.rect(px, py, 1, T).fill(shade(base, 0.8));
      } else {
        g.rect(px, py, T, T).fill(shade(base, 0.95 + ((tx * 3 + ty * 5) % 4) * 0.02));
        if ((tx * 5 + ty * 3) % 7 === 0) g.rect(px + 5, py + 9, 2, 1).fill(shade(base, 0.8));
      }
    }
  }
}

function wallBand(g: Graphics, x0: number, y0: number, w: number, doorX?: number) {
  // 2-tile wall face: dark cap, warm plaster with panel lines, baseboard.
  for (let tx = 0; tx < w; tx++) {
    const gx = x0 + tx;
    if (doorX !== undefined && (gx === doorX || gx === doorX + 1)) continue;
    const px = gx * T, py = y0 * T;
    g.rect(px, py, T, 4).fill(0x3b2618);
    g.rect(px, py + 4, T, 24).fill(0xd8c4a0);
    g.rect(px, py + 4, T, 2).fill(0xe8d8b8);
    if (tx % 2 === 0) g.rect(px, py + 8, 1, 18).fill(0xc2ab84);
    g.rect(px, py + 26, T, 6).fill(0x6e4429);
    g.rect(px, py + 26, T, 1).fill(0x8d5a37);
  }
}

export function drawOffice(): Container {
  const layer = new Container();
  const g = new Graphics();
  // corridor
  floor(g, { id: "c", label: "", x: 0, y: 9, w: COLS, h: 2, floor: "tile", tint: 0xc9b996, door: 0 }, 0, 9, COLS, 2);
  for (const r of ROOMS) {
    const top = r.y < 9;
    if (top) {
      wallBand(g, r.x, 0, r.w);
      floor(g, r, r.x, 2, r.w, r.h - 2);
      // low wall to the corridor with a door gap
      for (let tx = 0; tx < r.w; tx++) {
        const gx = r.x + tx;
        if (gx === r.door || gx === r.door + 1) continue;
        g.rect(gx * T, 9 * T - 4, T, 4).fill(0x6e4429);
        g.rect(gx * T, 9 * T - 4, T, 1).fill(0x8d5a37);
      }
    } else {
      wallBand(g, r.x, 11, r.w, r.door);
      // doorway floor through the wall band
      floor(g, { ...r, floor: "tile", tint: 0xc9b996 }, r.door, 11, 2, 2);
      floor(g, r, r.x, 13, r.w, ROWS - 13);
    }
    // side walls between rooms
    if (r.x > 0) g.rect(r.x * T - 2, (top ? 0 : 11) * T, 4, (top ? 9 : ROWS - 11) * T).fill(0x3b2618);
  }
  // outer frame
  g.rect(0, 0, COLS * T, 2).fill(0x24170f);
  g.rect(0, ROWS * T - 2, COLS * T, 2).fill(0x24170f);
  layer.addChild(g);
  return layer;
}
