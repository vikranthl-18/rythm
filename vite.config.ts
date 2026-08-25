import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// The project's tsconfig has no @types/node; Vite provides the real `process`
// at runtime (this file runs in Node), so declare it ambient like api/*.ts do.
declare const process: {
  env: Record<string, string | undefined>;
  cwd(): string;
};

// ---------------------------------------------------------------------------
// Dev-only mail route. In production, Vercel deploys api/mail.ts to /api/mail
// (the api/ dir is auto-detected). In dev there's no deployment, so this
// plugin serves the SAME handler at /api/mail on the Vite dev server — the
// Resend key stays server-side (read from .env.local via loadEnv, never
// bundled), and the app's client just POSTs to same-origin /api/mail.
// ---------------------------------------------------------------------------
function mailDevRoute(): Plugin {
  return {
    name: "rythm-mail-dev-route",
    configureServer(server) {
      server.middlewares.use("/api/mail", async (req, res) => {
        const method = (req as { method?: string }).method ?? "POST";
        if (method !== "POST") {
          res.statusCode = 405;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: "POST only" }));
          return;
        }
        try {
          const env = loadEnv(server.config.mode, process.cwd(), "");
          // Server-side only vars — never reach the client bundle. Never fall
          // back to ambient process.env values (Vite can seed them with junk
          // strings); an unset token must be empty/falsy, not inherited.
          process.env.RESEND_API_KEY = env.RESEND_API_KEY ?? "";
          process.env.MAIL_FROM = env.MAIL_FROM ?? "rythm <onboarding@resend.dev>";
          process.env.MAIL_API_TOKEN = env.MAIL_API_TOKEN ?? "";
          const { default: handler } = await import("./api/mail");
          const body = await readBody(req);
          const url = (req as { url?: string }).url ?? "/api/mail";
          const request = new Request(`http://127.0.0.1${url}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
          });
          const response = await handler(request);
          res.statusCode = response.status;
          res.setHeader("content-type", response.headers.get("content-type") ?? "application/json");
          res.end(await response.text());
        } catch (e) {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: (e as Error).message ?? "mail route error" }));
        }
      });
    },
  };
}

function readBody(req: unknown): Promise<string> {
  const r = req as {
    on(event: "data", cb: (c: string) => void): unknown;
    on(event: "end", cb: () => void): unknown;
    on(event: "error", cb: (e: Error) => void): unknown;
  };
  return new Promise((resolve, reject) => {
    let data = "";
    r.on("data", (c) => (data += c));
    r.on("end", () => resolve(data));
    r.on("error", reject);
  });
}

export default defineConfig({
  plugins: [react(), viteSingleFile(), mailDevRoute()],
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
});
