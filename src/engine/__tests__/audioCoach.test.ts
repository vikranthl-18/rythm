import { describe, expect, it } from "vitest";
import { evaluateCue, type AudioCueState } from "../audioCoach";

function state(over: Partial<AudioCueState> = {}): AudioCueState {
  return {
    hr: 150,
    hrMax: 190,
    targetZone: [0.72, 0.84],
    paceMs: 3.2,
    targetPaceMs: 3.2,
    elapsedSec: 600,
    ghostDeltaSec: null,
    ghostName: null,
    km: 2.1,
    lastKmAnnounced: 2,
    lastCue: null,
    lastCueAtSec: 0,
    ...over,
  };
}

describe("evaluateCue", () => {
  it("stays silent inside the target band", () => {
    expect(evaluateCue(state())).toBeNull();
  });

  it("tells you to ease off when HR is above the band", () => {
    const cue = evaluateCue(state({ hr: 168 }));
    expect(cue?.text).toContain("over target");
    expect(cue?.text).toContain("Ease off");
  });

  it("tells you to pick it up when HR is below the band (after warmup)", () => {
    const cue = evaluateCue(state({ hr: 120 }));
    expect(cue?.text).toContain("under target");
  });

  it("doesn't nag about low HR during the first 2 minutes", () => {
    expect(evaluateCue(state({ hr: 120, elapsedSec: 90 }))).toBeNull();
  });

  it("announces a new kilometer split with pace", () => {
    const cue = evaluateCue(state({ km: 3.05, lastKmAnnounced: 2, elapsedSec: 700 }));
    expect(cue?.text).toContain("Kilometer 3");
    expect(cue?.text).toContain("per kilometer");
  });

  it("won't re-announce the same kilometer", () => {
    expect(evaluateCue(state({ km: 2.9, lastKmAnnounced: 2 }))).toBeNull();
  });

  it("calls out the ghost gap when racing", () => {
    const behind = evaluateCue(state({ ghostDeltaSec: -25, ghostName: "Maya" }));
    expect(behind?.text).toContain("25 seconds behind Maya");
    const ahead = evaluateCue(state({ ghostDeltaSec: 18, ghostName: "Maya" }));
    expect(ahead?.text).toContain("18 seconds ahead of Maya");
  });

  it("ignores a small ghost gap", () => {
    expect(evaluateCue(state({ ghostDeltaSec: 4, ghostName: "Maya" }))).toBeNull();
  });

  it("respects the cooldown after a recent cue", () => {
    expect(evaluateCue(state({ hr: 168, lastCue: "x", lastCueAtSec: 590 }))).toBeNull();
  });
});
