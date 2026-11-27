import clsx from "clsx";
import { useCallback, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { AGENTS } from "./agents";
import { ClaudePanel } from "./ClaudePanel";

import type { AgentId } from "./agents";

export type Layout = {
  open: boolean;
  wide: boolean;
  mode: "bar" | "panel";
};

type Prefs = Layout & { agent: AgentId };

const PREFS_KEY = "excalidraw-claude-panel";

const loadPrefs = (): Prefs => {
  let raw: any = {};
  try {
    raw = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") ?? {};
  } catch {}
  return {
    open: !!raw.open,
    wide: !!raw.wide,
    mode: raw.mode === "panel" ? "panel" : "bar",
    agent: AGENTS.find((a) => a.id === raw.agent)?.id ?? "claude",
  };
};

/**
 * The assistants on the canvas: a plate at the bottom to pick one, and that
 * one's chat. Every chat stays mounted, so switching never cuts off an answer.
 */
export const AgentHub = ({
  excalidrawAPI,
  theme,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI;
  theme: "light" | "dark";
}) => {
  const [prefs, setPrefs] = useState(loadPrefs);
  const [busy, setBusy] = useState<Partial<Record<AgentId, boolean>>>({});
  // an assistant isn't contacted until it has been picked once
  const [visited, setVisited] = useState<readonly AgentId[]>([prefs.agent]);

  const updatePrefs = useCallback((patch: Partial<Prefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try {
        // keep what else is stored under the key (an older model choice)
        const stored = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
        localStorage.setItem(PREFS_KEY, JSON.stringify({ ...stored, ...next }));
      } catch {}
      return next;
    });
  }, []);

  const onBusyChange = useCallback((id: AgentId, value: boolean) => {
    setBusy((b) => (!!b[id] === value ? b : { ...b, [id]: value }));
  }, []);

  const pick = (id: AgentId) => {
    setVisited((v) => (v.includes(id) ? v : [...v, id]));
    // pressing the one in front again puts its chat away
    updatePrefs({
      agent: id,
      open: id === prefs.agent ? !prefs.open : true,
    });
  };

  return (
    <>
      {AGENTS.filter((agent) => visited.includes(agent.id)).map((agent) => (
        <ClaudePanel
          key={agent.id}
          agent={agent}
          active={agent.id === prefs.agent}
          layout={prefs}
          onLayout={updatePrefs}
          onBusyChange={onBusyChange}
          excalidrawAPI={excalidrawAPI}
          theme={theme}
        />
      ))}
      <div
        className={clsx("claude-root", `theme-${theme}`)}
        // keys pressed on the plate must not reach the canvas
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div
          className={clsx("agent-dock", {
            "beside-panel": prefs.open && prefs.mode === "panel",
            wide: prefs.wide,
          })}
          role="toolbar"
          aria-label="AI assistants"
        >
          {AGENTS.map((agent) => {
            const front = agent.id === prefs.agent;
            const label =
              front && prefs.open
                ? `Close ${agent.name}`
                : `Open ${agent.name}`;
            return (
              <button
                key={agent.id}
                type="button"
                className={clsx("agent-chip", `agent-${agent.id}`, {
                  front,
                  open: front && prefs.open,
                  busy: busy[agent.id],
                })}
                title={label}
                aria-label={label}
                aria-pressed={front}
                onClick={() => pick(agent.id)}
              >
                <agent.Logo size={22} />
                {front && <span>{agent.name}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
};
