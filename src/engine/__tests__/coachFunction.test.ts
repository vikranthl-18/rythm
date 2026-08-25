import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "../../../api/coach";

// Ambient declaration so this test typechecks without @types/node.
declare const process: { env: Record<string, string | undefined> };

const BASE = "https://rythm.app/api/coach";

afterEach(() => {
  delete process.env.LLM_PROVIDER;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_MODEL;
  delete process.env.COACH_API_TOKEN;
  vi.unstubAllGlobals();
});

describe("api/coach serverless function", () => {
  it("rejects non-POST requests", async () => {
    const res = await handler(new Request(BASE, { method: "GET" }));
    expect(res.status).toBe(405);
  });

  it("enforces the bearer token when COACH_API_TOKEN is set", async () => {
    process.env.COACH_API_TOKEN = "s3cret";
    const res = await handler(
      new Request(BASE, { method: "POST", body: JSON.stringify({ system: "", messages: [] }) })
    );
    expect(res.status).toBe(401);
  });

  it("proxies to OpenAI and returns the reply", async () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test";
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "Go run easy today." } }] }), {
          status: 200,
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await handler(
      new Request(BASE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          system: "You are rythm",
          messages: [{ role: "user", text: "hi" }],
        }),
      })
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { reply: string }).reply).toBe("Go run easy today.");

    const [url, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    const body = JSON.parse(String(opts.body)) as {
      model: string;
      messages: { role: string; content: string }[];
    };
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.messages[0]).toEqual({ role: "system", content: "You are rythm" });
  });

  it("proxies to Gemini when configured (assistant -> model roles)", async () => {
    process.env.LLM_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "gem-test";
    process.env.GEMINI_MODEL = "gemini-3.5-flash";
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: "Push day — threshold." }] } }] }),
          { status: 200 }
        )
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await handler(
      new Request(BASE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          system: "You are rythm",
          messages: [
            { role: "user", text: "hi" },
            { role: "assistant", text: "Hey!" },
          ],
        }),
      })
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { reply: string }).reply).toBe("Push day — threshold.");

    const [url, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/v1beta/models/gemini-3.5-flash:generateContent");
    const headers = new Headers(opts.headers);
    expect(headers.get("x-goog-api-key")).toBe("gem-test");
    const body = JSON.parse(String(opts.body)) as {
      contents: { role: string }[];
      generationConfig: { thinkingConfig: { thinkingBudget: number } };
    };
    expect(body.contents).toEqual([
      { role: "user", parts: [{ text: "hi" }] },
      { role: "model", parts: [{ text: "Hey!" }] },
    ]);
    expect(body.generationConfig.thinkingConfig.thinkingBudget).toBe(0);
  });

  it("proxies to Anthropic when configured", async () => {
    process.env.LLM_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ content: [{ text: "Rest day — recover." }] }), { status: 200 })
      )
    );

    const res = await handler(
      new Request(BASE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ system: "You are rythm", messages: [] }),
      })
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { reply: string }).reply).toBe("Rest day — recover.");
  });

  it("returns 502 with a message when the upstream fails", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: "insufficient_quota" } }), { status: 429 })
      )
    );
    const res = await handler(
      new Request(BASE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ system: "", messages: [] }),
      })
    );
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toContain("insufficient_quota");
  });
});
