// The assistants the chat can talk to. All are served by the local bridge and
// share one chat UI; each keeps its own chats, logs and model choice.

import { AntigravityLogo } from "./AntigravityLogo";
import { ClaudeLogo } from "./ClaudeLogo";
import { CodexLogo } from "./CodexLogo";

import type { ComponentType } from "react";

export type AgentId = "claude" | "antigravity" | "codex";

export type Agent = {
  id: AgentId;
  name: string;
  /** where the bridge serves this agent */
  base: string;
  Logo: ComponentType<{ size?: number; className?: string }>;
  historyKey: string;
  modelKey: string;
};

export const AGENTS: readonly Agent[] = [
  {
    id: "claude",
    name: "Claude",
    base: "/claude-bridge",
    Logo: ClaudeLogo,
    historyKey: "excalidraw-claude-history",
    modelKey: "excalidraw-claude-model",
  },
  {
    id: "antigravity",
    name: "Antigravity",
    base: "/claude-bridge/antigravity",
    Logo: AntigravityLogo,
    historyKey: "excalidraw-antigravity-history",
    modelKey: "excalidraw-antigravity-model",
  },
  {
    id: "codex",
    name: "Codex",
    base: "/claude-bridge/codex",
    Logo: CodexLogo,
    historyKey: "excalidraw-codex-history",
    modelKey: "excalidraw-codex-model",
  },
];
