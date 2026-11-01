import { Assets, Container, Rectangle, Sprite, Texture, type TextureSource } from "pixi.js";
import atlas from "./atlas.json";

type Tile = [number, number];
interface FurnitureDef { sheet: "indoor" | "chars"; tiles: Tile[]; w?: number }
interface CharacterDef { name: string; body: Tile; pants: Tile; shirt: Tile; hair: Tile }

const sources: Partial<Record<"indoor" | "chars", TextureSource>> = {};
const cache = new Map<string, Texture>();

export async function loadSheets(): Promise<void> {
  for (const [key, file] of [["indoor", "assets/indoor.png"], ["chars", "assets/chars.png"]] as const) {
    const tex = await Assets.load<Texture>(file);
    tex.source.scaleMode = "nearest";
    sources[key] = tex.source;
  }
}

export function tile(sheet: "indoor" | "chars", [c, r]: Tile): Texture {
  const key = `${sheet}:${c},${r}`;
  let t = cache.get(key);
  if (!t) {
    t = new Texture({ source: sources[sheet]!, frame: new Rectangle(c * 17, r * 17, 16, 16) });
    cache.set(key, t);
  }
  return t;
}

/** A furniture piece (possibly multi-tile) as one container, origin top-left, in world pixels. */
export function furniture(name: string): Container {
  const def = (atlas.furniture as unknown as Record<string, FurnitureDef>)[name];
  if (!def) throw new Error(`unknown furniture ${name}`);
  const w = def.w ?? def.tiles.length;
  const c = new Container();
  def.tiles.forEach((t, i) => {
    const s = new Sprite(tile(def.sheet, t));
    s.position.set((i % w) * 16, Math.floor(i / w) * 16);
    c.addChild(s);
  });
  return c;
}

export const CHARACTERS = atlas.characters as unknown as Record<string, CharacterDef>;

/** Layered character sprite (body → pants → shirt → hair), 16×16, origin at the feet center. */
export function character(role: string): Container {
  const def = CHARACTERS[role] ?? CHARACTERS.dev;
  const c = new Container();
  for (const layer of ["body", "pants", "shirt", "hair"] as const) {
    const s = new Sprite(tile("chars", def[layer]));
    s.anchor.set(0.5, 1);
    c.addChild(s);
  }
  return c;
}
