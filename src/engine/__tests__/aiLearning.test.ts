import { describe, expect, it } from "vitest";
import { AI_LEARNING_DAYS, learningStatus } from "../aiLearning";

const daysAgo = (n: number, from = new Date()) =>
  new Date(from.getTime() - n * 86400000).toISOString();

describe("learningStatus", () => {
  it("is learned when there's no recorded start (legacy accounts)", () => {
    expect(learningStatus(undefined)).toEqual({ learned: true, elapsed: AI_LEARNING_DAYS, daysLeft: 0 });
    expect(learningStatus("not-a-date")).toEqual({ learned: true, elapsed: AI_LEARNING_DAYS, daysLeft: 0 });
  });

  it("is still learning at the start", () => {
    const s = learningStatus(new Date().toISOString());
    expect(s.learned).toBe(false);
    expect(s.elapsed).toBe(0);
    expect(s.daysLeft).toBe(AI_LEARNING_DAYS);
  });

  it("reports the right remaining days mid-window", () => {
    const s = learningStatus(daysAgo(2));
    expect(s.learned).toBe(false);
    expect(s.elapsed).toBe(2);
    expect(s.daysLeft).toBe(AI_LEARNING_DAYS - 2);
  });

  it("unlocks exactly at the window boundary", () => {
    const s = learningStatus(daysAgo(AI_LEARNING_DAYS));
    expect(s.learned).toBe(true);
    expect(s.daysLeft).toBe(0);
  });

  it("caps elapsed at the window size", () => {
    const s = learningStatus(daysAgo(100));
    expect(s.learned).toBe(true);
    expect(s.elapsed).toBe(AI_LEARNING_DAYS);
  });
});
