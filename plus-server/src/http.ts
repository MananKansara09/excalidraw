import type { IncomingMessage, ServerResponse } from "node:http";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const badRequest = (message: string) => new HttpError(400, message);
export const unauthorized = (message = "Sign in required") =>
  new HttpError(401, message);
export const forbidden = (message = "You don't have access to this") =>
  new HttpError(403, message);
export const notFound = (message = "Not found") => new HttpError(404, message);

export type Request = {
  raw: IncomingMessage;
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  headers: IncomingMessage["headers"];
  cookies: Record<string, string>;
  ip: string;
  body: () => Promise<any>;
};

export type Handler = (
  req: Request,
  res: ServerResponse,
) => Promise<unknown> | unknown;

type Route = {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
};

const MAX_BODY_BYTES = 50 * 1024 * 1024;

export const readBody = (raw: IncomingMessage): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    raw.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, "Request body too large"));
        raw.destroy();
        return;
      }
      chunks.push(chunk);
    });
    raw.on("end", () => resolve(Buffer.concat(chunks)));
    raw.on("error", reject);
  });

export const parseCookies = (header: string | undefined) => {
  const cookies: Record<string, string> = {};
  for (const part of (header || "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) {
      cookies[part.slice(0, index).trim()] = decodeURIComponent(
        part.slice(index + 1).trim(),
      );
    }
  }
  return cookies;
};

export const sendJSON = (
  res: ServerResponse,
  status: number,
  data: unknown,
) => {
  if (res.headersSent) {
    res.end();
    return;
  }
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
};

export class Router {
  private routes: Route[] = [];

  add(method: string, path: string, handler: Handler) {
    const keys: string[] = [];
    const pattern = new RegExp(
      `^${path.replace(/\/:([a-zA-Z]+)/g, (_, key) => {
        keys.push(key);
        return "/([^/]+)";
      })}/?$`,
    );
    this.routes.push({ method, pattern, keys, handler });
    return this;
  }

  get = (path: string, handler: Handler) => this.add("GET", path, handler);
  post = (path: string, handler: Handler) => this.add("POST", path, handler);
  put = (path: string, handler: Handler) => this.add("PUT", path, handler);
  patch = (path: string, handler: Handler) => this.add("PATCH", path, handler);
  delete = (path: string, handler: Handler) =>
    this.add("DELETE", path, handler);

  /** Returns false when no route matches the path. */
  async handle(raw: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(raw.url || "/", "http://localhost");
    const method = (raw.method || "GET").toUpperCase();
    let pathMatched = false;

    for (const route of this.routes) {
      const match = route.pattern.exec(url.pathname);
      if (!match) {
        continue;
      }
      pathMatched = true;
      if (route.method !== method) {
        continue;
      }
      const params: Record<string, string> = {};
      route.keys.forEach((key, index) => {
        params[key] = decodeURIComponent(match[index + 1]);
      });
      let bodyPromise: Promise<any> | null = null;
      const req: Request = {
        raw,
        method,
        path: url.pathname,
        query: url.searchParams,
        params,
        headers: raw.headers,
        cookies: parseCookies(raw.headers.cookie),
        ip:
          (raw.headers["x-forwarded-for"] as string | undefined)
            ?.split(",")[0]
            .trim() ||
          raw.socket.remoteAddress ||
          "unknown",
        body: () => {
          if (!bodyPromise) {
            bodyPromise = readBody(raw).then((buffer) => {
              if (!buffer.length) {
                return {};
              }
              try {
                return JSON.parse(buffer.toString("utf8"));
              } catch {
                throw badRequest("Invalid JSON body");
              }
            });
          }
          return bodyPromise;
        },
      };
      try {
        const result = await route.handler(req, res);
        if (!res.writableEnded && !res.headersSent) {
          if (result === undefined) {
            res.writeHead(204).end();
          } else {
            sendJSON(res, 200, result);
          }
        }
      } catch (error: any) {
        if (error instanceof HttpError) {
          sendJSON(res, error.status, {
            statusCode: error.status,
            message: error.message,
          });
        } else {
          console.error(error);
          sendJSON(res, 500, {
            statusCode: 500,
            message: "Internal server error",
          });
        }
      }
      return true;
    }

    if (pathMatched) {
      sendJSON(res, 405, { statusCode: 405, message: "Method not allowed" });
      return true;
    }
    return false;
  }
}

/** Small validation helpers for request bodies. */
export const requireString = (
  value: unknown,
  field: string,
  { max = 500, min = 1 }: { max?: number; min?: number } = {},
): string => {
  if (typeof value !== "string") {
    throw badRequest(`"${field}" must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length < min) {
    throw badRequest(`"${field}" is required`);
  }
  if (trimmed.length > max) {
    throw badRequest(`"${field}" must be at most ${max} characters`);
  }
  return trimmed;
};

export const optionalString = (
  value: unknown,
  field: string,
  opts?: { max?: number },
): string | null =>
  value === undefined || value === null || value === ""
    ? null
    : requireString(value, field, opts);

export const requireOneOf = <T extends string>(
  value: unknown,
  field: string,
  options: readonly T[],
): T => {
  if (!options.includes(value as T)) {
    throw badRequest(`"${field}" must be one of: ${options.join(", ")}`);
  }
  return value as T;
};
