import { test, expect } from "@playwright/test";

// Headless Chromium lets audio play without a click; real Chrome and Safari keep an AudioContext suspended until the
// page has been clicked. Recreate that policy so these tests see what an operator sees.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const Real = window.AudioContext;
    // (navigator.userActivation reports true from the start under Playwright, so track real clicks here)
    let wasClicked = false;
    for (const t of ["pointerdown", "keydown"]) window.addEventListener(t, () => (wasClicked = true), true);
    const clicked = () => wasClicked;
    window.AudioContext = class extends Real {
      constructor(o?: AudioContextOptions) { super(o); if (!clicked()) void super.suspend(); }
      resume() { return clicked() ? super.resume() : Promise.resolve(); }
    } as typeof AudioContext;
  });
});

/** A short silent WAV, standing in for the git-ignored finish.mp3. */
function silentWav(seconds = 3, rate = 8000): Buffer {
  const n = seconds * rate;
  const b = Buffer.alloc(44 + n);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate, 28);
  b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write("data", 36); b.writeUInt32LE(n, 40); b.fill(128, 44);
  return b;
}

test("SFX remembered as on waits for a click, and that click turns it on rather than off", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("forge.sfx", "1"));
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__ready === true);
  const sfx = page.locator("#hud .actions [data-a=sfx]");
  await expect(sfx).toHaveAttribute("aria-pressed", "mixed");
  await sfx.click();
  await expect(sfx).toHaveAttribute("aria-pressed", "true");
  await sfx.click();
  await expect(sfx).toHaveAttribute("aria-pressed", "false");
});

test("the finish song plays on its own when the run ends after any earlier click", async ({ page }) => {
  const log = [
    { ts: 1000, run: "yoga", phase: "report", kind: "phase_start" },
    { ts: 2000, run: "yoga", phase: "done", kind: "run_done", usd: 4.4 },
  ].map((e) => JSON.stringify(e)).join("\n");
  let release!: () => void;
  const clicked = new Promise<void>((r) => (release = r));
  await page.route("**/events*", (r) => r.abort());
  await page.route("**/state*", (r) => r.fulfill({ json: { run: "yoga", tasks: [] } }));
  await page.route("**/doc?*", async (r) => { await clicked; await r.fulfill({ status: 200, contentType: "text/plain", body: log }); });
  await page.route("**/finish.mp3", (r) => r.fulfill({ status: 200, contentType: "audio/mpeg", body: silentWav() }));
  await page.addInitScript(() => localStorage.setItem("forge.sfx", "1"));
  await page.goto("/?run=yoga&replay=1");
  await page.waitForFunction(() => (window as any).__ready === true);
  await page.mouse.click(5, 300); // any click on the page unlocks audio, like an operator glancing at the office
  release();
  await expect(page.locator("#finish-song")).toContainText("now playing", { timeout: 15000 });
  await expect(page.locator("#finish-song")).not.toContainText("click anywhere");
  await expect(page.locator("#hud .actions [data-a=sfx]")).toHaveAttribute("aria-pressed", "true");
});
