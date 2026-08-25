import { describe, expect, it } from "vitest";
import { toCloudPerson, toFriend, toRequest } from "../supabaseFriends";
import type { FriendRequest } from "../../types";

const profile = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "jane.doe@gmail.com",
  name: "Jane Doe",
  avatar_url: "https://example.com/jane.jpg",
  goal: "Sub-20 5k",
  joined_at: "2026-01-02T09:00:00Z",
};

describe("toCloudPerson", () => {
  it("maps a cloud profile row to the directory shape", () => {
    const p = toCloudPerson(profile);
    expect(p.email).toBe("jane.doe@gmail.com");
    expect(p.name).toBe("Jane Doe");
    expect(p.avatar).toBe("https://example.com/jane.jpg");
    expect(p.goal).toBe("Sub-20 5k");
    expect(p.color).toBeTruthy();
  });

  it("falls back when avatar/goal/joinedAt are missing", () => {
    const p = toCloudPerson({ id: "x", email: "a@b.co", name: "A B", avatar_url: null, goal: null });
    expect(p.avatar).toBeUndefined();
    expect(p.goal).toBe("General fitness");
    expect(p.joinedAt).toBeTruthy();
  });
});

describe("toFriend", () => {
  it("builds an app Friend with empty workouts (not yet shared)", () => {
    const f = toFriend(profile);
    expect(f.id).toBe(profile.id);
    expect(f.email).toBe("jane.doe@gmail.com");
    expect(f.avatar).toBe(profile.avatar_url);
    expect(f.goal).toBe("Sub-20 5k");
    expect(f.workouts).toEqual([]);
  });
});

describe("toRequest", () => {
  const cloudReq = {
    id: "req-1",
    email: "jane.doe@gmail.com",
    name: "Jane Doe",
    avatar_url: "https://example.com/jane.jpg",
    note: "Let's train together",
    created_at: "2026-08-01T10:00:00Z",
  };

  it("maps an incoming request (from Jane, to me)", () => {
    const r: FriendRequest = toRequest(cloudReq, "me@rythm.app", "in");
    expect(r.fromEmail).toBe("jane.doe@gmail.com");
    expect(r.fromName).toBe("Jane Doe");
    expect(r.toEmail).toBe("me@rythm.app");
    expect(r.status).toBe("pending");
    expect(r.note).toBe("Let's train together");
    expect(r.fromAvatar).toBe(cloudReq.avatar_url);
  });

  it("maps an outgoing request (from me, to Jane)", () => {
    const r: FriendRequest = toRequest(cloudReq, "me@rythm.app", "out");
    expect(r.fromEmail).toBe("me@rythm.app");
    expect(r.toEmail).toBe("jane.doe@gmail.com");
    expect(r.fromName).toBe("You");
  });
});
