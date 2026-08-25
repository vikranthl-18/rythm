import { describe, expect, it } from "vitest";
import {
  buildFriendFromRequest,
  directoryFor,
  findByPhone,
  handleOf,
  normalizePhone,
  validateSendRequest,
} from "../friends";
import { USER_DIRECTORY } from "../../data/seed";
import type { Friend, FriendRequest } from "../../types";

describe("directoryFor", () => {
  it("excludes the current user's own email", () => {
    const dir = directoryFor("alex.rivera@gmail.com");
    expect(dir.some((d) => d.email === "alex.rivera@gmail.com")).toBe(false);
    // static directory users remain
    expect(dir.some((d) => d.email === "maya.chen@gmail.com")).toBe(true);
    expect(dir.length).toBeGreaterThanOrEqual(5);
  });

  it("includes other registered accounts (demo account) when they're not you", () => {
    const dir = directoryFor("someone.else@gmail.com");
    expect(dir.some((d) => d.email === "alex.rivera@gmail.com")).toBe(true);
  });

  it("dedupes by email", () => {
    const dir = directoryFor("someone.else@gmail.com");
    const emails = dir.map((d) => d.email.toLowerCase());
    expect(new Set(emails).size).toBe(emails.length);
  });
});

describe("validateSendRequest", () => {
  const me = "alex.rivera@gmail.com";
  const friends: Friend[] = [
    {
      id: "fr_1",
      name: "Maya Chen",
      email: "maya.chen@gmail.com",
      joinedAt: "",
      emoji: "🏃‍♀️",
      color: "#f472b6",
      goal: "Sub-3:30 marathon",
      workouts: [],
    },
  ];
  const requests: FriendRequest[] = [
    {
      id: "frq_1",
      fromEmail: "diego.santos@gmail.com",
      fromName: "Diego Santos",
      fromEmoji: "🚴",
      fromColor: "#60a5fa",
      toEmail: me,
      status: "pending",
      sentAt: new Date().toISOString(),
    },
  ];
  const dir = directoryFor(me);

  it("rejects empty and malformed emails", () => {
    expect(validateSendRequest("", me, friends, requests, dir)).toBeTruthy();
    expect(validateSendRequest("not-an-email", me, friends, requests, dir)).toBeTruthy();
  });

  it("rejects friending yourself", () => {
    expect(validateSendRequest(me, me, friends, requests, dir)).toMatch(/yourself/);
  });

  it("rejects unknown accounts", () => {
    expect(validateSendRequest("ghost@nowhere.com", me, friends, requests, dir)).toMatch(
      /no rythm account/i
    );
  });

  it("rejects people you're already friends with", () => {
    expect(validateSendRequest("maya.chen@gmail.com", me, friends, requests, dir)).toMatch(
      /already friends/
    );
  });

  it("rejects duplicate pending requests", () => {
    expect(validateSendRequest("diego.santos@gmail.com", me, friends, requests, dir)).toMatch(
      /already pending/
    );
  });

  it("accepts a valid new request", () => {
    expect(validateSendRequest("priya.kapoor@gmail.com", me, friends, requests, dir)).toBeNull();
  });
});

describe("buildFriendFromRequest", () => {
  it("builds a full friend profile from an accepted request", () => {
    const req: FriendRequest = {
      id: "frq_x",
      fromEmail: "maya.chen@gmail.com",
      fromName: "Maya Chen",
      fromEmoji: "🏃‍♀️",
      fromColor: "#f472b6",
      toEmail: "alex.rivera@gmail.com",
      status: "accepted",
      sentAt: new Date().toISOString(),
    };
    const f = buildFriendFromRequest(req);
    expect(f.email).toBe("maya.chen@gmail.com");
    expect(f.name).toBe("Maya Chen");
    expect(f.joinedAt).toBeTruthy();
    expect(f.workouts.length).toBeGreaterThan(0);
  });

  it("builds the recipient as the friend from a sent-request normalization", () => {
    // For a request the current user sent, the store normalizes the request
    // so from* describe the *other* person (the recipient).
    const req: FriendRequest = {
      id: "frq_y",
      fromEmail: "sam.patel@gmail.com",
      fromName: "",
      fromEmoji: "",
      fromColor: "",
      toEmail: "alex.rivera@gmail.com",
      status: "accepted",
      sentAt: new Date().toISOString(),
    };
    const f = buildFriendFromRequest(req);
    expect(f.email).toBe("sam.patel@gmail.com");
    expect(f.name).toBe("Sam Patel"); // pulled from the directory
    expect(f.workouts.length).toBeGreaterThan(0);
  });
});

describe("handleOf", () => {
  it("derives a handle from the email", () => {
    expect(handleOf("maya.chen@gmail.com")).toBe("@maya.chen");
  });
});

describe("normalizePhone", () => {
  it("keeps digits only and drops a leading US country code", () => {
    expect(normalizePhone("+1 (415) 555-0131")).toBe("4155550131");
    expect(normalizePhone("(415) 555-0131")).toBe("4155550131");
    expect(normalizePhone("4155550131")).toBe("4155550131");
    expect(normalizePhone("")).toBe("");
    expect(normalizePhone("call me")).toBe("");
  });
});

describe("findByPhone", () => {
  it("finds a directory user by their phone, any formatting", () => {
    const u = findByPhone(USER_DIRECTORY, "(415) 555-0131");
    expect(u?.email).toBe("maya.chen@gmail.com");
  });

  it("returns null for an unknown or empty number", () => {
    expect(findByPhone(USER_DIRECTORY, "+1 999 555 0000")).toBeNull();
    expect(findByPhone(USER_DIRECTORY, "")).toBeNull();
  });
});
