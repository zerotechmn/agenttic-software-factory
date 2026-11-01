---
name: pixi-v8-pixel-games
description: "Use when building a crisp 2D pixel-art browser game or scene with PixiJS v8 in plain TypeScript (no React): integer scaling, nearest-neighbour textures, roundPixels, jitter-free character animation, Kenney CC0 sprite sheets sliced into Texture frames, zIndex/y-sort depth for top-down scenes, speech bubbles with pixel fonts, ParticleContainer effects, pixi-filters v6, click-to-move with pointer events, and a pixel-snapped camera. Triggers on: pixel art, pixelated, blurry sprites, sprite jitter, shimmering, integer scale, nearest, roundPixels, Kenney, tilesheet, spritesheet slicing, top-down office, y-sort, depth sort, speech bubble, pixel font, click to move, A* walking characters."
---

# PixiJS v8 pixel-art games

Companion to the official `pixijs` skill set (installed alongside as `pixijs`, `pixijs-application`,
`pixijs-assets`, `pixijs-scene-*`, `pixijs-ticker`, `pixijs-events`, `pixijs-filters`,
`pixijs-migration-v8`, ...). Those cover the general API; this one covers the pixel-art
workflow they leave out. For algorithms load the engine-neutral skills `game-ai` (A*),
`camera-systems` (follow/deadzone) and `game-feel` (juice).

Facts checked against pixi.js 8.22.0 and pixi-filters 6.1.5 (npm, 2026-10-18). If a call below
fails, WebFetch `https://pixijs.download/release/docs/llms.txt`. It indexes every API page as
`<name>.html.md`.

## 1. The pixel-perfect contract

Every rule below serves one invariant: **one art pixel = an integer number of device pixels,
and every sprite's top-left lands on that grid.** Break it and you get blur, shimmer, or
"swimming" outlines.

1. Textures sample with `scaleMode: 'nearest'` (never `'linear'`).
2. The world is scaled by an integer factor (in device pixels), never 1.5x.
3. Positions you *render* are whole world pixels (logic may be float, render is rounded).
4. Sprites never get fractional scale, rotation, or half-pixel anchors.
5. The camera offset is a whole world pixel, too.

## 2. Application setup

```ts
import { Application, Container, TextureSource } from 'pixi.js';

// Must run BEFORE any Assets.load so every new TextureSource defaults to nearest.
TextureSource.defaultOptions.scaleMode = 'nearest';

const VIEW_W = 320;   // virtual resolution in art pixels (e.g. 20x11.25 tiles of 16px)
const VIEW_H = 180;

const app = new Application();
(async () => {                         // IIFE: top-level await breaks Vite <=6.0.6 prod builds
  await app.init({
    resizeTo: window,
    background: '#1b1b2a',
    antialias: false,                  // no MSAA smearing on Graphics edges
    roundPixels: true,                 // renderer-wide x/y rounding (default false)
    resolution: window.devicePixelRatio,
    autoDensity: true,                 // CSS size stays window size; backing store is DPR-scaled
  });
  app.canvas.style.imageRendering = 'pixelated';  // in case the browser rescales the canvas
  document.body.appendChild(app.canvas);
  boot();
})();
```

- `new Application()` takes no options in v8; everything goes to `await app.init()`. Use
  `app.canvas` (not `app.view`).
- `roundPixels` exists on `ApplicationOptions`/renderer and per object (`sprite.roundPixels`,
  `new Graphics({ roundPixels })`, `new ParticleContainer({ roundPixels })`).
- `TextureSource.defaultOptions` is documented as "override these to add your own defaults".
  For a single asset, pass `data: { scaleMode: 'nearest' }` instead. Changing it on an
  existing texture also works: `texture.source.scaleMode = 'nearest'`.

### Integer scaling (computed in device pixels)

```ts
const world = new Container({ label: 'world' });      // camera moves this
const ui = new Container({ label: 'ui' });            // screen-space overlay, also pixel-scaled
app.stage.addChild(world, ui);

let pxScale = 1; // device pixels per art pixel (integer)
function relayout() {
  const dpr = app.renderer.resolution;
  const devW = app.screen.width * dpr, devH = app.screen.height * dpr;
  pxScale = Math.max(1, Math.floor(Math.min(devW / VIEW_W, devH / VIEW_H)));
  const s = pxScale / dpr;            // CSS-space scale whose device-space value is integer
  world.scale.set(s);
  ui.scale.set(s);
  // Letterbox: centre the virtual viewport on whole device pixels.
  const offX = Math.floor((devW - VIEW_W * pxScale) / 2) / dpr;
  const offY = Math.floor((devH - VIEW_H * pxScale) / 2) / dpr;
  world.position.set(offX, offY);     // letterbox only; camera scroll uses world.pivot (section 9)
  ui.position.set(offX, offY);
}
app.renderer.on('resize', relayout);
relayout();
```

To grow the visible world on big screens instead of letterboxing, keep `pxScale` and set
`VIEW_W = Math.floor(devW / pxScale)` on resize.

## 3. Loading Kenney CC0 sheets

Kenney packs ship as single PNGs, grid tilesheets (often both a "packed" version and one with
1 px spacing; check the pack's readme for tile size, margin and spacing), and sometimes an XML
atlas. PixiJS loads TexturePacker-style JSON natively. For other formats, slice the sheet yourself.

### Slice a grid sheet into frames (`new Texture({ source, frame })`)

```ts
import { Assets, Rectangle, Texture } from 'pixi.js';

const sheet = await Assets.load<Texture>({
  alias: 'office', src: 'assets/kenney/roguelike-indoor.png',
  data: { scaleMode: 'nearest' },
});

function gridFrames(base: Texture, tile: number, spacing = 0, margin = 0): Texture[][] {
  const cols = Math.floor((base.width - 2 * margin + spacing) / (tile + spacing));
  const rows = Math.floor((base.height - 2 * margin + spacing) / (tile + spacing));
  const out: Texture[][] = [];
  for (let r = 0; r < rows; r++) {
    out[r] = [];
    for (let c = 0; c < cols; c++) {
      out[r][c] = new Texture({
        source: base.source,           // share ONE TextureSource => one GPU upload, batches
        frame: new Rectangle(margin + c * (tile + spacing), margin + r * (tile + spacing), tile, tile),
      });
    }
  }
  return out;
}
const tiles = gridFrames(sheet, 16, 1);
```

- A `Texture` is a view (frame/trim/UVs) on a shared `TextureSource`. Keeping all frames on one
  source is what lets thousands of tiles batch into a few draw calls.
- If you mutate `texture.frame` later, create it with `dynamic: true` (or call
  `texture.update()` and then `sprite.onViewUpdate()`). Sprites no longer auto-detect UV changes.
- Edge bleeding (neighbour pixels showing at tile seams) means a packed sheet plus sub-pixel
  positions. Fix the positions (section 4) or use the spaced sheet.

### Better for animation: generate Spritesheet JSON once

```ts
import { Spritesheet, AnimatedSprite } from 'pixi.js';

const data = {
  frames: {} as Record<string, { frame: { x: number; y: number; w: number; h: number } }>,
  animations: { walkDown: ['w0', 'w1', 'w2', 'w3'] },
  meta: { image: 'chars.png', size: { w: sheet.width, h: sheet.height }, scale: '1' },
};
[0, 1, 2, 3].forEach((i) => (data.frames[`w${i}`] = { frame: { x: i * 16, y: 0, w: 16, h: 24 } }));
const ss = new Spritesheet({ texture: sheet, data, cachePrefix: 'chars_' });
await ss.parse();
const walker = new AnimatedSprite({ textures: ss.animations.walkDown, animationSpeed: 0.15 });
```

For a JSON atlas on disk: `Assets.load({ src: 'atlas.json', data: { textureOptions: { scaleMode: 'nearest' } } })`
returns a `Spritesheet` with `.textures` and `.animations`. To use a Kenney XML atlas
(`<SubTexture name x y width height>`), parse it with `DOMParser` and fill `frames` as above.

## 4. Jitter-free motion and animation

Sub-pixel jitter comes from three sources: float positions, float camera offsets, and smooth
(sinusoidal) offsets that land between pixels. Separate **simulation state** from
**render state**:

```ts
class Walker {
  x = 0; y = 0;                        // float logic position in world px (feet point)
  readonly view = new Container();     // what you render
  update(dtMs: number) { /* move this.x/this.y along the path at px/s * dtMs/1000 */ }
  sync() {
    this.view.position.set(Math.round(this.x), Math.round(this.y)); // snap at render time
    this.view.zIndex = Math.round(this.y);                           // y-sort (section 5)
  }
}
```

- **Step-based bobbing, never `sin()` straight into y.** Use a 0/1 px step tied to the walk cycle:
  `body.y = (frameIndex % 2 === 0) ? 0 : -1;`. Or quantize: `Math.round(Math.sin(t) * 1)`.
  Do the same for breathing and idle sway: integer offsets on a timer.
- **Anchors must land on whole pixels.** `anchor 0.5` on a 15 px-wide sprite puts the origin at
  7.5 px. Use even widths, or set an integer `pivot`/offset (e.g. `sprite.position.set(-8, -24)`
  inside the character container, so the container origin is the feet).
- **No fractional scale or rotation on art.** Flip with `scale.x = -1` (integer). Do squash/stretch
  as extra frames, not as scale tweens.
- **Animate on time, not on frames.** Either `AnimatedSprite.animationSpeed` (a multiplier on
  the ticker, ~frames per tick at 60 fps), or your own `deltaMS` accumulator:

```ts
import { UPDATE_PRIORITY } from 'pixi.js';

const FRAME_MS = 120;
let acc = 0, frame = 0;
app.ticker.add((ticker) => {            // v8: callback receives the Ticker, NOT a delta number
  acc += ticker.deltaMS;                // real ms (speed-scaled, capped by minFPS)
  while (acc >= FRAME_MS) { acc -= FRAME_MS; frame = (frame + 1) % 4; }
  walker.texture = walkFrames[frame];
});
// Simulation before render: app.render() is registered at UPDATE_PRIORITY.LOW.
app.ticker.add((t) => sim.step(t.deltaMS), undefined, UPDATE_PRIORITY.HIGH);
```

- `deltaTime` is dimensionless (about 1.0 at 60 fps). `deltaMS` is milliseconds. Use `deltaMS`
  for px/second movement. For deterministic pathing, run a fixed 1/60 s step from an accumulator.
- **Diagonal shimmer.** At non-integer speeds, x and y round on different frames, so the sprite
  "stairs". Either move at integer px per step, or round both axes from the same float position
  once per render (as above). Don't accumulate rounded values back into logic.

## 5. Depth sorting a top-down office (`sortableChildren` / `zIndex`)

```ts
const floor = new Container({ isRenderGroup: true });   // static tiles: never sorted
const actors = new Container({ sortableChildren: true }); // desks, chairs, plants, people
const overlay = new Container();                         // bubbles, particles, labels: always on top
world.addChild(floor, actors, overlay);

desk.zIndex = desk.y + DESK_FOOTPRINT_BOTTOM;  // sort key = bottom (feet) edge, in world px
person.zIndex = Math.round(person.y);          // updated in sync()
```

- With `sortableChildren = true`, the container re-sorts by `zIndex` before the next render,
  and changing a child's `zIndex` re-marks the parent dirty. Only sort the layer that needs it.
- Sort by the **foot/bottom** y, not the sprite's top. Tall furniture (bookshelf, whiteboard)
  uses its base row. Break ties with `zIndex = y * 1000 + x` if equal-y overlaps flicker.
- Multi-tile furniture that a character can stand both in front of and behind: split it into a
  back piece (sorted by its own base) and a front piece, or give it one base line and block those
  tiles in the walk grid.
- Need a child to keep its logical parent (for transforms) but draw elsewhere, e.g. a bubble
  attached to a character but drawn above everything? Use `RenderLayer` (see the
  `pixijs-scene-core-concepts` skill, references/layers.md). A plain overlay container works too.
- Lots of static tiles: put them in a render group (`isRenderGroup: true`) or bake with
  `floor.cacheAsTexture(true)`. Call `cacheAsTexture(false)` before destroying it.

## 6. Graphics v8 for pixel UI (`rect().fill()`)

v8 is shape-then-style: draw, then `.fill()` / `.stroke()`. `beginFill`, `drawRect`,
`lineStyle` and `endFill` are gone.

```ts
import { Graphics } from 'pixi.js';

// Pixel-art speech-bubble body: rectangles only (rounded corners anti-alias).
function bubbleBody(w: number, h: number) {
  return new Graphics({ roundPixels: true })
    .rect(1, 0, w - 2, h).fill(0x000000)        // 1px black outline (top/bottom rows)
    .rect(0, 1, w, h - 2).fill(0x000000)        // outline sides, notched corners
    .rect(1, 1, w - 2, h - 2).fill(0xffffff)    // white interior
    .rect(4, h, 3, 1).fill(0x000000)            // tail, drawn pixel by pixel
    .rect(5, h + 1, 1, 1).fill(0x000000);
}
```

- For 1 px strokes, use `stroke({ width: 1, color, pixelLine: true })`. It aligns to the pixel grid.
- Don't `clear()` and redraw Graphics every frame: geometry is rebuilt each time. Redraw only when
  the text size changes, or use a `NineSliceSprite` from a Kenney UI-pack panel:
  `new NineSliceSprite({ texture, leftWidth: 4, topHeight: 4, rightWidth: 4, bottomHeight: 4 })`.
  Then set `width`/`height` in whole pixels.

## 7. Pixel fonts and speech bubbles (`BitmapText`)

Text that changes often belongs in `BitmapText`: updates reposition glyph quads instead of
re-rasterising a canvas. Two ways to get a crisp pixel font:

```ts
import { Assets, BitmapFont, BitmapText } from 'pixi.js';

// A) Pre-made AngelCode BMFont (.fnt/.xml). Kenney font packs, or export from a tool.
await Assets.load('assets/fonts/pixel.fnt');

// B) Generate from a pixel TTF at its NATIVE size (e.g. 8 or 16 px), nearest-sampled.
await Assets.load({ src: 'assets/fonts/kenney-mini.ttf', data: { family: 'KenneyMini' } });
BitmapFont.install({
  name: 'PixelUI',
  style: { fontFamily: 'KenneyMini', fontSize: 8, fill: '#ffffff' }, // white => tint freely
  chars: [['a', 'z'], ['A', 'Z'], ['0', '9'], ' .,:;!?\'"-+()/%#@&*'],
  resolution: 1,
  padding: 0,
  textureStyle: { scaleMode: 'nearest' },
});

const label = new BitmapText({ text: 'Deploying...', style: { fontFamily: 'PixelUI', fontSize: 8 } });
label.tint = 0x222222;
label.roundPixels = true;
```

- Use `fontSize` equal to the font's design size (or an integer multiple). Any other size resamples
  and blurs. Let the world's integer scale do the enlarging.
- `BitmapText.resolution` cannot be changed after creation; it comes from the `BitmapFont`.
- Missing glyphs are silently skipped. Include every character the bubbles will show.
- Canvas `Text` is fine for rarely-changing labels. Give it `textureStyle: { scaleMode: 'nearest' }`
  and `roundPixels: true`, and never update it every frame.
- Bubble layout: measure `label.width/height` (integers for pixel fonts), build the body at
  `w = label.width + 6`, place the bubble at `Math.round(char.x - w / 2)`,
  `Math.round(char.y - CHAR_H - h - 2)`, and put it in `overlay` so it never y-sorts behind furniture.
  Typewriter effect: reveal `text.slice(0, n)` on a `deltaMS` timer (cheap with BitmapText).

## 8. Particles (`ParticleContainer` v8)

```ts
import { ParticleContainer, Particle, Rectangle } from 'pixi.js';

const fx = new ParticleContainer({
  texture: sparkTex,                             // every particle must share this base source (atlas OK)
  boundsArea: new Rectangle(0, 0, MAP_W, MAP_H), // required: bounds are empty by default
  dynamicProperties: { position: true, color: true }, // re-upload only what you animate
  roundPixels: true,
});
overlay.addChild(fx);

const p = new Particle({ texture: sparkTex, x: 40, y: 30, anchorX: 0.5, anchorY: 0.5 });
fx.addParticle(p);   // NOT addChild: Sprites are rejected; particles live in fx.particleChildren
```

- v8 rewrite: `Particle` is a lightweight struct (`x, y, scaleX, scaleY, anchorX, anchorY,
  rotation, tint, alpha, texture`), with no children, filters, or events.
- Changing a property that isn't in `dynamicProperties`? Call `fx.update()`.
- Bulk add/remove: mutate `fx.particleChildren` directly, then call `fx.update()` once.
- Pool particles (toggle `alpha`/reuse) instead of creating and destroying per burst.
- Pixel look: integer `scaleX/scaleY`, positions rounded by `roundPixels`, and 2 to 4 frame
  "spark/dust/steam" textures from the same atlas (swapping `texture` needs `uvs: true`).
- A dozen particles (coffee steam, typing sparks)? Plain pooled `Sprite`s in `overlay` are fine.

## 9. Pixel-snapped camera

```ts
const cam = { x: 0, y: 0 };            // float, smoothed (see camera-systems skill)
function updateCamera(dtMs: number, target: { x: number; y: number }) {
  const t = 1 - Math.exp(-8 * dtMs / 1000);        // frame-rate independent smoothing
  cam.x += (target.x - VIEW_W / 2 - cam.x) * t;
  cam.y += (target.y - VIEW_H / 2 - cam.y) * t;
  cam.x = Math.min(Math.max(cam.x, 0), MAP_W - VIEW_W); // clamp the VIEW to the map
  cam.y = Math.min(Math.max(cam.y, 0), MAP_H - VIEW_H);
  // pivot is in world (local) px, so a whole-number pivot x integer scale = whole device px.
  world.pivot.set(Math.round(cam.x), Math.round(cam.y));
}
```

Using `world.pivot` for the camera keeps the letterbox offset in `world.position` separate from
the scroll. Snap the camera **before** the actors render, and snap actors the same way, so they
move in lockstep (no 1 px wobble between a character and the floor). Screen shake: add an
integer offset (`Math.round(trauma² * 2)` px). Don't use a float offset.

## 10. Pointer input (`eventMode`) and click-to-move

```ts
import { FederatedPointerEvent, Rectangle } from 'pixi.js';

app.stage.eventMode = 'static';
app.stage.hitArea = app.screen;                 // receive clicks on empty space too
app.stage.on('pointertap', (e: FederatedPointerEvent) => {
  const p = world.toLocal(e.global);            // screen -> world px (accounts for scale+pivot)
  const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
  selected?.walkTo(tx, ty);                     // A* on the tile grid, see game-ai skill
});

person.eventMode = 'static';                    // default is 'passive': no events on self
person.cursor = 'pointer';
person.hitArea = new Rectangle(-6, -22, 12, 22); // tight box around the body, local px
person.on('pointertap', (e) => { e.stopPropagation(); select(person); });
```

- In v8, `pointermove` fires only over the object. Use `globalpointermove` to drag or track.
- `eventMode = 'none'` on the floor and overlay layers skips hit-testing them entirely.
- Hover outline: `person.filters = [new OutlineFilter({ thickness: 1, color: 0xffffff })]` (section 11).

## 11. Filters (pixi-filters v6 for Pixi v8)

| pixi.js | pixi-filters |
|---|---|
| v7.x | v5.x |
| v8.x | **v6.x** |

```ts
import { OutlineFilter } from 'pixi-filters/outline';     // per-filter subpath imports
import { GlowFilter } from 'pixi-filters/glow';
import { AdjustmentFilter } from 'pixi-filters/adjustment';
import { CRTFilter } from 'pixi-filters/crt';

world.filters = [new AdjustmentFilter({ saturation: 0.9, brightness: 1.05 })]; // one filter on a parent
```

- The old `@pixi/filter-*` packages are v7-only.
- Each filtered container costs a render-to-texture pass. Filter the parent, not every child, and
  set `filterArea` when the bounds are known.
- Filters can soften pixel edges. Prefer subtle global grading on `world`, and per-sprite outlines
  only for the hovered or selected actor. Check the result at your actual integer scale.
- Built-ins (`pixi.js`): `AlphaFilter`, `BlurFilter`, `ColorMatrixFilter`, `DisplacementFilter`,
  `NoiseFilter`. Custom ones: `Filter.from({ gl: { fragment }, resources: { u: { uTime: { value: 0, type: 'f32' } } } })`.

## 12. A* walkers (wiring)

Keep three layers decoupled: **decide** (FSM: idle -> walkToDesk -> type -> coffee...),
**path** (A* over a `walkable[ty][tx]` grid built from the furniture footprints), **move**
(follow waypoints at N px/s using `deltaMS`). Recompute paths on a goal change, not every
frame. Use the octile heuristic for 8-way movement and Manhattan for 4-way. Full algorithm:
`game-ai` skill, references/pathfinding.md. Pick the walk animation row from the dominant axis
of the current segment, and switch to idle frames on arrival.

## 13. v7 -> v8 breaking changes that bite pixel games

| v7 | v8 |
|---|---|
| `new Application({...})`, `app.view` | `await app.init({...})`, `app.canvas` |
| `@pixi/*` sub-packages | single `pixi.js` (plus `pixi-filters/<name>`) |
| `Texture.from(url)` loads | `await Assets.load(url)` first; `Texture.from` only reads the cache |
| `BaseTexture`, `SCALE_MODES.NEAREST` | `TextureSource`, `scaleMode: 'nearest'` (string) |
| `beginFill().drawRect().endFill()`, `lineStyle` | `rect().fill()`, `.stroke({ width, color })` |
| `new Text('hi', style)` | `new Text({ text: 'hi', style })`; same for `BitmapText` |
| `ticker.add((dt) => ...)` | `ticker.add((ticker) => ticker.deltaTime / deltaMS)` |
| `interactive = true`, `buttonMode` | `eventMode = 'static'`, `cursor = 'pointer'` |
| `pointermove` anywhere | only over the target; use `globalpointermove` |
| `ParticleContainer.addChild(sprite)` | `addParticle(new Particle(...))` plus `boundsArea` |
| `DisplayObject`, `container.name`, `cacheAsBitmap` | `Container`, `label`, `cacheAsTexture()` |
| `Assets.add('k', url)` | `Assets.add({ alias, src })` |
| children on a `Sprite`/`Graphics`/`Text` | leaves; wrap them in a `Container` |
| `updateTransform()` override | `onRender` callback |
| `getBounds()` -> Rectangle | `Bounds` (use `.rectangle`) |

Full checklist: `pixijs-migration-v8` skill.

## 14. Debug checklist when it looks wrong

- **Blurry**: is `scaleMode` 'nearest' on *this* source (fonts and Text have their own
  `textureStyle`)? Is `world.scale * resolution` an integer? Is `image-rendering: pixelated` set?
- **Shimmering/wobble**: a float position, camera offset or anchor somewhere. Log
  `sprite.getGlobalPosition()` times `resolution`: it should be an integer.
- **Seams between tiles**: sub-pixel camera, or a packed sheet sampled at a fractional position.
- **Wrong overlap**: the sort key isn't the base y, or the actor isn't in the sorted container.
- **Clicks ignored**: `eventMode` is still 'passive', or the stage has no `hitArea`.
- **Inspect the scene graph**: install the PixiJS Devtools Chrome extension.

## Sources (fetched 2026-10-18)

- PixiJS LLM index: https://pixijs.download/release/docs/llms.txt and https://pixijs.com/llms.txt
- Application options (`roundPixels`, `resolution`, `autoDensity`): https://pixijs.download/release/docs/app.ApplicationOptions.html.md
- Renderer `roundPixels` default false: https://pixijs.download/release/docs/rendering.AbstractRenderer.html.md
- Texture and TextureOptions (`source`, `frame`, `dynamic`): https://pixijs.download/release/docs/rendering.Texture.html.md and https://pixijs.download/release/docs/rendering.TextureOptions.html.md
- Textures guide: https://pixijs.download/release/docs/rendering-1.html.md
- TextureSource `defaultOptions` / `scaleMode`: https://pixijs.download/release/docs/rendering.TextureSource.html.md
- Spritesheet: https://pixijs.download/release/docs/assets.Spritesheet.html.md
- AnimatedSprite: https://pixijs.download/release/docs/scene.AnimatedSprite.html.md
- Container `sortableChildren` / `zIndex`: https://pixijs.download/release/docs/scene.Container.html.md
- Ticker: https://pixijs.download/release/docs/ticker.Ticker.html.md
- Bitmap Text guide: https://pixijs.download/release/docs/scene-11.html.md
- BitmapFont.install options: https://pixijs.download/release/docs/text.BitmapFontInstallOptions.html.md
- ParticleContainer: https://pixijs.download/release/docs/scene.ParticleContainer.html.md
- v8 migration guide: https://pixijs.download/release/docs/migrations.html.md
- pixi-filters (version table, `pixi-filters/<name>` imports): https://github.com/pixijs/filters
- Official skills this builds on: https://github.com/pixijs/pixijs-skills
