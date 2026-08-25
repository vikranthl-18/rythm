import { afterEach, describe, expect, it, vi } from "vitest";
import { authUserFromSession } from "../supabase";
import type { Session } from "@supabase/supabase-js";

// supabase.ts reads import.meta.env at module load, so each availability test
// stubs the env and re-imports the module fresh.
async function loadModule() {
  vi.resetModules();
  return import("../supabase");
}

describe("supabase availability", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("runs fully local when env vars are unset (local-first default)", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    const m = await loadModule();
    expect(m.supabaseAvailable).toBe(false);
    expect(m.supabase).toBeNull();
  });

  it("creates a client when both env vars are set", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    const m = await loadModule();
    expect(m.supabaseAvailable).toBe(true);
    expect(m.supabase).not.toBeNull();
  });
});

describe("authUserFromSession", () => {
  it("maps a Google session to an AuthUser with name/picture from metadata", () => {
    const session = {
      user: {
        id: "u1",
        email: "alex@gmail.com",
        user_metadata: { name: "Alex Rivera", picture: "https://p/1.jpg" },
        app_metadata: { provider: "google" },
      },
    } as unknown as Session;
    expect(authUserFromSession(session)).toEqual({
      name: "Alex Rivera",
      email: "alex@gmail.com",
      picture: "https://p/1.jpg",
      provider: "google",
      signedInAt: expect.any(String),
    });
  });

  it("falls back to full_name and the email prefix when name is missing", () => {
    const session = {
      user: {
        id: "u2",
        email: "sam@example.com",
        user_metadata: { full_name: "Sam Patel" },
        app_metadata: { provider: "email" },
      },
    } as unknown as Session;
    const u = authUserFromSession(session);
    expect(u?.name).toBe("Sam Patel");
    expect(u?.provider).toBe("email");
  });

  it("returns null for a session without an email", () => {
    const session = { user: { id: "u3", email: undefined } } as unknown as Session;
    expect(authUserFromSession(session)).toBeNull();
  });
});
