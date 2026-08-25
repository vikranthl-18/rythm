import { afterEach, describe, expect, it } from "vitest";
import { sendEmail } from "../mail";

// With no VITE_MAIL_API override the client posts to the same-origin
// /api/mail route (served by the Vite dev server / Vercel function).
const apiSet = !!import.meta.env.VITE_MAIL_API;

afterEach(() => {
  delete (globalThis as { fetch?: unknown }).fetch;
});

describe("sendEmail", () => {
  it.skipIf(apiSet)("posts to same-origin /api/mail when no override is set", async () => {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    (globalThis as { fetch?: unknown }).fetch = (async (url: unknown, init: unknown) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
    await expect(
      sendEmail("welcome", { to: "athlete@example.com", name: "Alex", data: { goal: "5k" } })
    ).resolves.toBeUndefined();
    expect(calls.length).toBe(1);
    expect(String(calls[0].url)).toBe("/api/mail");
    const sent = JSON.parse(String((calls[0].init as { body?: string }).body ?? "{}"));
    expect(sent.kind).toBe("welcome");
    expect(sent.to).toBe("athlete@example.com");
  });

  it("never throws on a missing endpoint or empty recipient", async () => {
    let calls = 0;
    (globalThis as { fetch?: unknown }).fetch = (async () => {
      calls++;
      throw new Error("network down");
    }) as typeof fetch;
    await expect(sendEmail("welcome", { to: "" })).resolves.toBeUndefined();
    await expect(sendEmail("milestone", { to: "x@y.com" })).resolves.toBeUndefined();
    expect(calls).toBe(1); // one attempted call, the failure is swallowed
  });
});
