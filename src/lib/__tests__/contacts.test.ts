import { describe, expect, it } from "vitest";
import { matchContactsToDirectory } from "../contacts";
import { USER_DIRECTORY } from "../../data/seed";

describe("matchContactsToDirectory", () => {
  it("matches contacts by phone number regardless of formatting", () => {
    const matched = matchContactsToDirectory(
      [{ name: "Maya", tel: ["+1 415 555 0131"] }],
      USER_DIRECTORY
    );
    expect(matched.map((m) => m.email)).toContain("maya.chen@gmail.com");
  });

  it("matches contacts by email", () => {
    const matched = matchContactsToDirectory(
      [{ name: "Diego", email: ["DIEGO.SANTOS@GMAIL.COM"] }],
      USER_DIRECTORY
    );
    expect(matched.map((m) => m.email)).toContain("diego.santos@gmail.com");
  });

  it("matches multiple contacts and dedupes", () => {
    const matched = matchContactsToDirectory(
      [
        { name: "Maya", tel: ["4155550131"] },
        { name: "Maya again", tel: ["+1 (415) 555-0131"] },
        { name: "Priya", tel: ["+1 510 555 0164"] },
      ],
      USER_DIRECTORY
    );
    expect(matched.map((m) => m.email).sort()).toEqual([
      "maya.chen@gmail.com",
      "priya.kapoor@gmail.com",
    ]);
  });

  it("returns nothing when no contacts are on rythm", () => {
    const matched = matchContactsToDirectory([{ name: "Bob", tel: ["+1 999 555 0000"] }], USER_DIRECTORY);
    expect(matched).toEqual([]);
  });

  it("ignores malformed contact entries without crashing", () => {
    const matched = matchContactsToDirectory(
      [{ name: "", tel: [], email: [] }, {}],
      USER_DIRECTORY
    );
    expect(matched).toEqual([]);
  });
});
