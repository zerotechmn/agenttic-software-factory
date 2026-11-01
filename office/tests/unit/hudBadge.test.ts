import { describe, expect, it } from "vitest";
import { badgeFor } from "../../src/hud";

describe("badgeFor", () => {
  it("shows LIVE while a live run is in progress", () => {
    expect(badgeFor("live", "build").text).toBe("LIVE");
  });
  it("shows DONE once a live run reaches its final phase", () => {
    expect(badgeFor("live", "report").text).toBe("DONE");
  });
  it("keeps REPLAY for replays", () => {
    expect(badgeFor("replay", "report").text).toBe("REPLAY");
  });
});
