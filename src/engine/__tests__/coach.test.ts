import { afterEach, describe, expect, it, vi } from "vitest";
import { coachReplyWithLLM, type CoachContext } from "../coach";

const ctx: CoachContext = {
  goal: "Sub-20 min 5k",
  age: 28,
  recovery: 67,
  recoveryColor: "green",
  strain: 4.2,
  strainTarget: 14.5,
  hrv: 62,
  hrvBaseline: 58,
  rhr: 53,
  rhrBaseline: 54,
  sleepScore: 79,
  sleepMin: 371,
  needMin: 525,
  sleepDebtMin: 154,
  steps: 5200,
  habits: [],
  habitsDone: 0,
  habitsDue: 3,
  weekMileageKm: 18.3,
  weekSessions: 3,
  weekStrain: 30.6,
  workouts7: [],
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("coachReplyWithLLM", () => {
  it("returns null (engine fallback) when no model path is configured", async () => {
    vi.stubEnv("VITE_COACH_API", "");
    vi.stubEnv("VITE_GEMINI_API_KEY", "");
    expect(await coachReplyWithLLM("hi", ctx, [])).toBeNull();
  });

  it("calls Gemini directly when VITE_GEMINI_API_KEY is set (dev path)", async () => {
    vi.stubEnv("VITE_COACH_API", "");
    vi.stubEnv("VITE_GEMINI_API_KEY", "test-key");
    vi.stubEnv("VITE_GEMINI_MODEL", "gemini-3.5-flash");
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: "Quality threshold day." }] } }] }),
          { status: 200 }
        )
    );
    vi.stubGlobal("fetch", fetchMock);

    const reply = await coachReplyWithLLM("what should I do", ctx, []);

    expect(reply).toBe("Quality threshold day.");
    const [url, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent"
    );
    const headers = new Headers(opts.headers);
    expect(headers.get("x-goog-api-key")).toBe("test-key");
    const body = JSON.parse(String(opts.body)) as {
      systemInstruction: { parts: { text: string }[] };
      contents: { role: string }[];
    };
    expect(body.systemInstruction.parts[0].text).toContain("rythm");
    expect(body.contents).toEqual([{ role: "user", parts: [{ text: "what should I do" }] }]);
  });

  it("falls back to null when the direct Gemini call throws", async () => {
    vi.stubEnv("VITE_COACH_API", "");
    vi.stubEnv("VITE_GEMINI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    expect(await coachReplyWithLLM("hi", ctx, [])).toBeNull();
  });

  it("posts the built system prompt + history and returns the model reply", async () => {
    vi.stubEnv("VITE_COACH_API", "https://example.com/api/coach");
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ reply: "Fresh legs — quality threshold day." }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const reply = await coachReplyWithLLM("what should I do", ctx, [
      { role: "user", text: "hi" },
      { role: "assistant", text: "Hey!" },
    ]);

    expect(reply).toBe("Fresh legs — quality threshold day.");
    const [url, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.com/api/coach");
    const body = JSON.parse(String(opts.body)) as {
      system: string;
      messages: { role: string; text: string }[];
    };
    expect(body.system).toContain("rythm");
    expect(body.system).toContain("67"); // grounded context
    expect(body.messages).toEqual([
      { role: "user", text: "hi" },
      { role: "assistant", text: "Hey!" },
      { role: "user", text: "what should I do" },
    ]);
  });

  it("falls back to null when the model call throws", async () => {
    vi.stubEnv("VITE_COACH_API", "https://example.com/api/coach");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    expect(await coachReplyWithLLM("hi", ctx, [])).toBeNull();
  });

  it("falls back to null on a non-2xx response", async () => {
    vi.stubEnv("VITE_COACH_API", "https://example.com/api/coach");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "boom" }), { status: 500 })));
    expect(await coachReplyWithLLM("hi", ctx, [])).toBeNull();
  });

  it("falls back to null on an empty reply", async () => {
    vi.stubEnv("VITE_COACH_API", "https://example.com/api/coach");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ reply: "   " }), { status: 200 })));
    expect(await coachReplyWithLLM("hi", ctx, [])).toBeNull();
  });
});
