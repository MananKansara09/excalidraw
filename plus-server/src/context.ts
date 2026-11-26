import type { DB } from "./db.ts";
import type { RealtimeHub } from "./realtime.ts";
import type { SecretBox } from "./auth.ts";
import type { AIProvider } from "./ai.ts";

export type ServerConfig = {
  /** Requests a user may make per UTC day on the server's AI key. */
  aiDailyLimit: number;
  /** Requests per UTC day for signed-out visitors, counted per IP. */
  aiAnonymousDailyLimit: number;
  /** Sets the `Secure` flag on the session cookie. */
  secureCookies: boolean;
  /** Public origin of the web app, used for share/embed links. */
  publicUrl: string | null;
};

export type AppContext = {
  db: DB;
  hub: RealtimeHub;
  secrets: SecretBox;
  config: ServerConfig;
  ai: AIProvider;
};
