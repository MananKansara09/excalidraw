import Anthropic from "@anthropic-ai/sdk";

import { get, run } from "./db.ts";
import { badRequest, HttpError } from "./http.ts";

import type { ServerResponse } from "node:http";
import type { AppContext } from "./context.ts";
import type { Request, Router } from "./http.ts";
import type { User } from "./auth.ts";

export const AI_MODEL = "claude-opus-5-5";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type AIStreamParams = {
  /** The user's own key; when absent, the server's credentials are used. */
  apiKey: string | null;
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
};

/** Streams text deltas. Swappable so tests don't call the real API. */
export type AIProvider = {
  isConfigured: () => boolean;
  stream: (params: AIStreamParams) => AsyncIterable<string>;
};

export class AIRefusalError extends Error {}

export const createAnthropicProvider = (
  effort: Effort = "medium",
): AIProvider => {
  let serverClient: Anthropic | null = null;
  return {
    isConfigured: () =>
      !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
    async *stream({ apiKey, system, messages }) {
      const client = apiKey
        ? new Anthropic({ apiKey })
        : (serverClient ??= new Anthropic());
      const stream = client.beta.messages.stream({
        model: AI_MODEL,
        max_tokens: 64000,
        // thinking is always on (adaptive) on this model; effort sets depth
        output_config: { effort },
        // a declined request is retried server-side on the recommended model
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system,
        messages,
      });
      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          yield event.delta.text;
        } else if (
          event.type === "message_delta" &&
          event.delta.stop_reason === "refusal"
        ) {
          throw new AIRefusalError(
            "The model declined this request. Try rephrasing it.",
          );
        }
      }
    },
  };
};

// prompts --------------------------------------------------------------------

const TEXT_TO_DIAGRAM_SYSTEM = `You turn a description into a diagram for Excalidraw, written in Mermaid syntax.

Reply with Mermaid code only: no prose before or after it, and no Markdown code fences. Prefer "flowchart TD" (or LR when the content reads left to right); use sequenceDiagram, classDiagram, erDiagram or stateDiagram-v2 when the request is clearly about those. Keep labels short, quote labels that contain punctuation, and avoid styling directives, since Excalidraw applies its own look.

When the conversation already contains a diagram and the user asks for a change, reply with the complete updated diagram.`;

const CHAT_SYSTEM = `You are Claude, an assistant built into a whiteboard app (Excalidraw). Answer concisely in plain text or light Markdown.

When the user asks you to draw, diagram, map out or visualize something, include exactly one Mermaid diagram in a fenced code block tagged "mermaid" (prefer "flowchart TD"; use sequenceDiagram, classDiagram, erDiagram or stateDiagram-v2 when clearly appropriate), with a one-line description before it. Keep labels short, quote labels that contain punctuation, and avoid styling directives. When changing an earlier diagram, reply with the complete updated diagram. Otherwise do not include a diagram.`;

const DIAGRAM_TO_CODE_SYSTEM = `You turn a hand-drawn wireframe into a working web page.

You get an image of the wireframe and the text found in it. Reply with one complete, self-contained HTML document: inline CSS, and inline JavaScript only where an element is plainly interactive. Follow the wireframe's layout and use its text verbatim. Replace scribbled placeholders with sensible content, and use no external resources other than images from https://placehold.co.

Reply with the HTML only: no explanation and no Markdown code fences.`;

// quota ----------------------------------------------------------------------

const today = () => new Date().toISOString().slice(0, 10);

const getUsage = (ctx: AppContext, subject: string) =>
  get<{ count: number }>(
    ctx.db,
    "SELECT count FROM ai_usage WHERE subject = ? AND day = ?",
    subject,
    today(),
  )?.count ?? 0;

const incrementUsage = (ctx: AppContext, subject: string) => {
  run(
    ctx.db,
    `INSERT INTO ai_usage (subject, day, count) VALUES (?, ?, 1)
     ON CONFLICT (subject, day) DO UPDATE SET count = count + 1`,
    subject,
    today(),
  );
};

type Quota = {
  apiKey: string | null;
  subject: string;
  limit: number | null;
  used: number;
};

export const getQuota = (
  ctx: AppContext,
  user: User | null,
  ip: string,
): Quota => {
  if (user?.ai_key_enc) {
    // bring-your-own-key: no server-side cap
    return {
      apiKey: ctx.secrets.decrypt(user.ai_key_enc),
      subject: `user:${user.id}`,
      limit: null,
      used: getUsage(ctx, `user:${user.id}`),
    };
  }
  const subject = user ? `user:${user.id}` : `ip:${ip}`;
  return {
    apiKey: null,
    subject,
    limit: user ? ctx.config.aiDailyLimit : ctx.config.aiAnonymousDailyLimit,
    used: getUsage(ctx, subject),
  };
};

// SSE in the format the editor's TTD dialog and DiagramToCode plugin read ---

const streamToClient = async (
  ctx: AppContext,
  req: Request,
  res: ServerResponse,
  user: User | null,
  params: Omit<AIStreamParams, "apiKey">,
) => {
  const quota = getQuota(ctx, user, req.ip);
  if (!quota.apiKey && !ctx.ai.isConfigured()) {
    throw new HttpError(
      503,
      "AI isn't set up on this server. Add your own Anthropic API key in Account settings.",
    );
  }
  if (quota.limit !== null && quota.used >= quota.limit) {
    res.setHeader("X-Ratelimit-Limit", String(quota.limit));
    res.setHeader("X-Ratelimit-Remaining", "0");
    throw new HttpError(
      429,
      user
        ? "You've used today's AI requests. Add your own API key for unlimited use."
        : "Too many requests today. Sign in to get more.",
    );
  }
  incrementUsage(ctx, quota.subject);

  const headers: Record<string, string> = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };
  if (quota.limit !== null) {
    headers["X-Ratelimit-Limit"] = String(quota.limit);
    headers["X-Ratelimit-Remaining"] = String(quota.limit - quota.used - 1);
  }
  res.writeHead(200, headers);
  const write = (data: unknown) =>
    res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    for await (const delta of ctx.ai.stream({
      ...params,
      apiKey: quota.apiKey,
    })) {
      if (res.destroyed) {
        return;
      }
      write({ type: "content", delta });
    }
    write({ type: "done", finishReason: "stop" });
  } catch (error: any) {
    let message = "Generation failed";
    if (error instanceof AIRefusalError) {
      message = error.message;
    } else if (error instanceof Anthropic.AuthenticationError) {
      message = quota.apiKey
        ? "Your Anthropic API key was rejected. Check it in Account settings."
        : "The server's AI key was rejected.";
    } else if (error instanceof Anthropic.RateLimitError) {
      message = "The AI service is busy. Try again in a minute.";
    } else if (error instanceof Anthropic.APIError) {
      message = `AI service error (${error.status ?? "network"})`;
    } else {
      console.error(error);
    }
    write({ type: "error", error: { message } });
  }
  res.write("data: [DONE]\n\n");
  res.end();
};

type LLMMessage = { role: "user" | "assistant"; content: string };

const validateMessages = (messages: unknown): LLMMessage[] => {
  if (!Array.isArray(messages) || !messages.length) {
    throw badRequest('"messages" must be a non-empty array');
  }
  const valid = messages
    .filter(
      (m): m is LLMMessage =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0,
    )
    .slice(-30);
  if (!valid.length || valid[valid.length - 1].role !== "user") {
    throw badRequest("The last message must be from the user");
  }
  // the API expects the conversation to open with a user turn
  while (valid[0]?.role === "assistant") {
    valid.shift();
  }
  if (valid.reduce((sum, m) => sum + m.content.length, 0) > 100_000) {
    throw badRequest("The conversation is too long");
  }
  return valid;
};

export const registerAIRoutes = (
  router: Router,
  ctx: AppContext,
  getUser: (req: Request) => User | null,
) => {
  router.get("/api/v1/ai/usage", (req) => {
    const user = getUser(req);
    const quota = getQuota(ctx, user, req.ip);
    return {
      model: AI_MODEL,
      configured: !!quota.apiKey || ctx.ai.isConfigured(),
      ownKey: !!quota.apiKey,
      limit: quota.limit,
      used: quota.used,
      remaining:
        quota.limit === null ? null : Math.max(0, quota.limit - quota.used),
    };
  });

  router.post("/api/v1/ai/text-to-diagram/chat-streaming", async (req, res) => {
    const body = await req.body();
    const messages = validateMessages(body.messages);
    await streamToClient(ctx, req, res, getUser(req), {
      system: TEXT_TO_DIAGRAM_SYSTEM,
      messages,
    });
  });

  router.post("/api/v1/ai/chat/streaming", async (req, res) => {
    const body = await req.body();
    const messages = validateMessages(body.messages);
    await streamToClient(ctx, req, res, getUser(req), {
      system: CHAT_SYSTEM,
      messages,
    });
  });

  router.post(
    "/api/v1/ai/diagram-to-code/generate-streaming",
    async (req, res) => {
      const body = await req.body();
      const match =
        typeof body.image === "string" &&
        /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(body.image);
      if (!match) {
        throw badRequest('"image" must be a base64 image data URL');
      }
      const texts =
        typeof body.texts === "string" ? body.texts.slice(0, 20_000) : "";
      await streamToClient(ctx, req, res, getUser(req), {
        system: DIAGRAM_TO_CODE_SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: match[1] as "image/jpeg",
                  data: match[2],
                },
              },
              {
                type: "text",
                text: `Text in the wireframe:\n${
                  texts || "(none)"
                }\n\nPreferred color theme: ${
                  body.theme === "dark" ? "dark" : "light"
                }.`,
              },
            ],
          },
        ],
      });
    },
  );
};
