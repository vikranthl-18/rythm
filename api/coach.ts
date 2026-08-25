// ---------------------------------------------------------------------------
// rythm — serverless AI coach endpoint
//
// Proxies the app's coach context to a real LLM. Deploys as a Vercel Function
// (the api/ dir is auto-detected); it only uses the Web Request/Response API
// and fetch, so it ports to Netlify Functions or Cloudflare Workers almost
// verbatim.
//
// Env vars (set on the platform, never in the client bundle):
//   LLM_PROVIDER        "openai" (default) | "anthropic" | "gemini"
//   OPENAI_API_KEY      + OPENAI_MODEL      (default gpt-4o-mini)
//   ANTHROPIC_API_KEY   + ANTHROPIC_MODEL   (default claude-3-5-haiku-latest)
//   GEMINI_API_KEY      + GEMINI_MODEL      (default gemini-3.5-flash)
//   COACH_API_TOKEN     optional bearer token — if set, the app must send it
//
// Request body:
//   { system: string, messages: [{ role: "user"|"assistant", text: string }] }
// Response:
//   { reply: string }      (200)   |   { error: string } (4xx/5xx)
// ---------------------------------------------------------------------------

export const config = { runtime: "edge" };

// Ambient declaration so this file typechecks under the client tsconfig
// (which has no @types/node); Node provides the real `process` at runtime.
declare const process: { env: Record<string, string | undefined> };

interface CoachMsg {
  role: "user" | "assistant";
  text: string;
}

interface CoachBody {
  system?: string;
  messages?: CoachMsg[];
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const token = process.env.COACH_API_TOKEN;
  if (token && req.headers.get("authorization") !== `Bearer ${token}`) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: CoachBody = {};
  try {
    body = (await req.json()) as CoachBody;
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const system = body.system ?? "";
  const history = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: m.text }));

  const provider = process.env.LLM_PROVIDER ?? "openai";

  try {
    if (provider === "anthropic") {
      const key = process.env.ANTHROPIC_API_KEY;
      if (!key) return json({ error: "ANTHROPIC_API_KEY is not set" }, 500);
      const model = process.env.ANTHROPIC_MODEL ?? "claude-3-5-haiku-latest";
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({ model, max_tokens: 600, temperature: 0.7, system, messages: history }),
      });
      const data = (await res.json()) as {
        content?: { text?: string }[];
        error?: { message?: string };
      };
      if (!res.ok) throw new Error(data.error?.message ?? `anthropic ${res.status}`);
      const reply = (data.content ?? []).map((b) => b.text ?? "").join("").trim();
      if (!reply) return json({ error: "empty model response" }, 502);
      return json({ reply });
    }

    if (provider === "gemini") {
      const key = process.env.GEMINI_API_KEY;
      if (!key) return json({ error: "GEMINI_API_KEY is not set" }, 500);
      const model = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";
      // Gemini uses "model" for assistant turns; thinking is disabled so
      // maxOutputTokens goes to the visible reply, not reasoning.
      const contents = history.map((m) => ({
        role: m.role === "assistant" ? ("model" as const) : ("user" as const),
        parts: [{ text: m.content }],
      }));
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "x-goog-api-key": key,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents,
            generationConfig: { maxOutputTokens: 600, temperature: 0.7, thinkingConfig: { thinkingBudget: 0 } },
          }),
        }
      );
      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
        error?: { message?: string };
      };
      if (!res.ok) throw new Error(data.error?.message ?? `gemini ${res.status}`);
      const reply = (data.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? "")
        .join("")
        .trim();
      if (!reply) return json({ error: "empty model response" }, 502);
      return json({ reply });
    }

    // openai (default)
    const key = process.env.OPENAI_API_KEY;
    if (!key) return json({ error: "OPENAI_API_KEY is not set" }, 500);
    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: system }, ...history],
        max_tokens: 600,
        temperature: 0.7,
      }),
    });
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    };
    if (!res.ok) throw new Error(data.error?.message ?? `openai ${res.status}`);
    const reply = (data.choices?.[0]?.message?.content ?? "").trim();
    if (!reply) return json({ error: "empty model response" }, 502);
    return json({ reply });
  } catch (e) {
    return json({ error: (e as Error).message ?? "upstream error" }, 502);
  }
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
