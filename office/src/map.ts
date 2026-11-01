// Office layout in 16 px tiles. Pipeline order: top row left→right, then bottom row left→right.
export const T = 16;
export const COLS = 40;
export const ROWS = 21;

export interface Room {
  id: string;
  label: string;
  x: number; y: number; w: number; h: number;
  floor: "wood" | "wood_dark" | "carpet" | "tile" | "concrete";
  tint: number;
  door: number; // x of the 2-tile door gap on the corridor side
}

// Top rooms y 0..8 (walls on rows 0-1), corridor rows 9-10, bottom rooms y 11..21 (walls rows 11-12).
export const ROOMS: Room[] = [
  { id: "lobby", label: "Lobby", x: 0, y: 0, w: 6, h: 9, floor: "carpet", tint: 0x8a3b3b, door: 2 },
  { id: "product", label: "Product", x: 6, y: 0, w: 7, h: 9, floor: "wood", tint: 0xb07a4a, door: 9 },
  { id: "research", label: "Research", x: 13, y: 0, w: 6, h: 9, floor: "wood_dark", tint: 0x8d5f3a, door: 15 },
  { id: "architecture", label: "Architecture", x: 19, y: 0, w: 8, h: 9, floor: "wood", tint: 0xa7744a, door: 22 },
  { id: "design", label: "Design", x: 27, y: 0, w: 7, h: 9, floor: "wood", tint: 0xb98654, door: 30 },
  { id: "coffee", label: "Coffee", x: 34, y: 0, w: 6, h: 9, floor: "tile", tint: 0x9aa3a8, door: 36 },
  { id: "dev", label: "Dev Floor", x: 0, y: 11, w: 16, h: 10, floor: "wood", tint: 0xa9784c, door: 7 },
  { id: "review", label: "Review", x: 16, y: 11, w: 5, h: 10, floor: "wood_dark", tint: 0x8a5d3b, door: 18 },
  { id: "vault", label: "Vault", x: 21, y: 11, w: 5, h: 10, floor: "concrete", tint: 0x7d7f84, door: 23 },
  { id: "qa", label: "QA Lab", x: 26, y: 11, w: 7, h: 10, floor: "tile", tint: 0xa3b0b3, door: 29 },
  { id: "deploy", label: "Deploy Dock", x: 33, y: 11, w: 7, h: 10, floor: "concrete", tint: 0x6f7378, door: 36 },
];

/** Rooms whose wall icon (painting, QA dial) sits right of centre: their sign is left-aligned so it never runs into it. */
const LEFT_SIGNS = new Set(["design", "qa"]);

/** World-px x of a room sign and whether it is left-aligned (anchor 0) or centred (anchor 0.5). */
export function signSpot(r: Room): { x: number; left: boolean } {
  const left = LEFT_SIGNS.has(r.id);
  return { x: left ? (r.x + 0.5) * 16 : (r.x + r.w / 2) * 16, left };
}

export interface Placement { sprite: string; x: number; y: number; flip?: boolean }

// Furniture by atlas name, in absolute tile coords (y measured from the map top).
export const FURNITURE: Placement[] = [
  // lobby
  { sprite: "rug_orange", x: 1, y: 4 }, { sprite: "desk_wide", x: 2, y: 3 },   { sprite: "plant", x: 0, y: 2 }, { sprite: "plant", x: 5, y: 2 }, { sprite: "bench", x: 1, y: 7 }, { sprite: "painting", x: 4.6, y: 0.6 },
  // product
  { sprite: "desk", x: 8, y: 4 }, { sprite: "plant_small", x: 12, y: 2 }, { sprite: "lamp", x: 6, y: 2 },
  { sprite: "rug_green", x: 9, y: 7 }, { sprite: "cabinet", x: 11, y: 2 },
  // research
  { sprite: "bookshelf", x: 13, y: 2 }, { sprite: "bookshelf", x: 16, y: 2 }, { sprite: "round_table", x: 15, y: 5 },   { sprite: "candelabra", x: 18, y: 2 }, { sprite: "plant_small", x: 13, y: 7 },
  // architecture
  { sprite: "meeting_table", x: 21, y: 5 }, { sprite: "chair_back", x: 22, y: 6 }, { sprite: "chair_back", x: 23, y: 6 },
  { sprite: "plant", x: 19, y: 7 },
  // design
  { sprite: "desk", x: 29, y: 4 }, { sprite: "rug_green", x: 28, y: 7 }, { sprite: "plant", x: 33, y: 2 }, { sprite: "painting", x: 32.8, y: 0.6 },
  // coffee
  { sprite: "counter_sink", x: 34, y: 2 }, { sprite: "counter_bottles", x: 35, y: 2 }, { sprite: "stove", x: 36, y: 2 }, { sprite: "counter", x: 37, y: 2 },
  { sprite: "round_table", x: 36, y: 5 }, { sprite: "chair_side", x: 35, y: 5 }, { sprite: "plant_small", x: 39, y: 7 },
  // dev floor: 3 pods
  { sprite: "desk_wide", x: 2, y: 15 },   { sprite: "desk_wide", x: 7, y: 15 },   { sprite: "desk_wide", x: 12, y: 15 },   { sprite: "runner_orange", x: 5, y: 18 }, { sprite: "plant", x: 0, y: 13 }, { sprite: "plant", x: 15, y: 13 }, { sprite: "cabinet", x: 10, y: 13 },
  { sprite: "rug_green", x: 9, y: 18 }, { sprite: "plant_small", x: 6, y: 13 }, { sprite: "bookshelf", x: 13, y: 13 },
  // review
  { sprite: "desk", x: 18, y: 15 }, { sprite: "desk", x: 19, y: 18 }, { sprite: "plant_small", x: 16, y: 19 },
  // vault
  { sprite: "filing_cabinet", x: 21, y: 13 }, { sprite: "filing_cabinet", x: 22, y: 13 }, { sprite: "filing_cabinet", x: 25, y: 13 }, { sprite: "filing_cabinet", x: 25, y: 14 },
  { sprite: "chandelier", x: 23, y: 16 }, { sprite: "rug_orange", x: 22, y: 18 },
  // qa lab
  { sprite: "counter", x: 27, y: 15 }, { sprite: "counter", x: 28, y: 15 }, { sprite: "counter", x: 29, y: 15 },   { sprite: "plant_small", x: 32, y: 19 }, { sprite: "counter_bottles", x: 31, y: 15 }, { sprite: "rug_green", x: 27, y: 18 },
  // deploy
  { sprite: "server_rack", x: 34, y: 13 }, { sprite: "server_rack", x: 38, y: 13 }, { sprite: "server_rack", x: 39, y: 13 },
  { sprite: "desk", x: 36, y: 17 }, { sprite: "plant", x: 39, y: 19 },
];

/** Where each role works: tile coords of the feet (x may be fractional). Seated workers stand just behind their desk. */
export const SEATS: Record<string, { x: number; y: number; room: string }> = {
  product: { x: 8.5, y: 4, room: "product" },
  researcher: { x: 15.5, y: 5, room: "research" },
  architect: { x: 22.5, y: 5, room: "architecture" },
  uiux: { x: 29.5, y: 4, room: "design" },
  "dev:1": { x: 3, y: 15, room: "dev" },
  "dev:2": { x: 8, y: 15, room: "dev" },
  "dev:3": { x: 13, y: 15, room: "dev" },
  reviewer: { x: 18.5, y: 15, room: "review" },
  final_reviewer: { x: 19.5, y: 18, room: "review" },
  integrator: { x: 22.5, y: 16.6, room: "vault" },
  qa: { x: 28.5, y: 15, room: "qa" },
  devops: { x: 36.5, y: 17, room: "deploy" },
};
