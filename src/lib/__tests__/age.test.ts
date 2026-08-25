import { describe, expect, it } from "vitest";
import { ageFromBirthday, birthdayForAge, isSupportedAge } from "../age";

describe("ageFromBirthday", () => {
  it("computes whole years", () => {
    const now = new Date();
    const bd = `${now.getFullYear() - 28}-06-15`;
    expect(ageFromBirthday(bd)).toBe(28);
  });

  it("returns null for invalid dates", () => {
    expect(ageFromBirthday("")).toBeNull();
    expect(ageFromBirthday("not-a-date")).toBeNull();
  });

  it("doesn't count a birthday that hasn't happened yet this year", () => {
    const now = new Date();
    const year = now.getFullYear() - 30;
    // birthday later this year → still 29
    const future = `${year}-12-31`;
    const age = ageFromBirthday(future);
    expect(age).toBe(now.getMonth() === 11 && now.getDate() > 31 ? 30 : 29);
  });
});

describe("isSupportedAge", () => {
  it("accepts 13–100 and rejects outside", () => {
    expect(isSupportedAge(13)).toBe(true);
    expect(isSupportedAge(28)).toBe(true);
    expect(isSupportedAge(100)).toBe(true);
    expect(isSupportedAge(12)).toBe(false);
    expect(isSupportedAge(101)).toBe(false);
  });
});

describe("birthdayForAge", () => {
  it("produces a birthday matching the age", () => {
    const bd = birthdayForAge(25);
    expect(ageFromBirthday(bd)).toBe(25);
  });
});
