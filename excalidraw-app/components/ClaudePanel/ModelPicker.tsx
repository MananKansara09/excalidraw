import { useEffect, useRef, useState } from "react";

import { ClaudeLogo } from "./ClaudeLogo";

import type { ModelChoice } from "./claudeBridge";

const Glyph = ({ d }: { d: string }) => (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d={d} />
  </svg>
);

/** which model answers, chosen from what the connected account offers */
export const ModelPicker = ({
  models,
  selected,
  connected,
  plan,
  onSelect,
  onConnect,
}: {
  models: ModelChoice[];
  selected: ModelChoice | undefined;
  connected: boolean;
  plan: string | null | undefined;
  onSelect: (value: string) => void;
  onConnect: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  // any press elsewhere closes the menu; capture, as the canvas swallows events
  useEffect(() => {
    if (!open) {
      return;
    }
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [open]);

  return (
    <div
      ref={root}
      className="claude-model"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
          button.current?.focus();
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className="claude-model-button"
        title="Choose the model"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <ClaudeLogo size={13} />
        <span>{selected?.name ?? "Model"}</span>
        <Glyph d="m6 15 6-6 6 6" />
      </button>
      {open && (
        <div className="claude-model-menu" role="menu" aria-label="Models">
          <div className="claude-model-title">
            Select a model
            {plan && <em>{plan} plan</em>}
          </div>
          {models.map((m) => (
            <button
              key={m.value}
              type="button"
              role="menuitemradio"
              aria-checked={m.value === selected?.value}
              className="claude-model-option"
              onClick={() => {
                setOpen(false);
                onSelect(m.value);
              }}
            >
              <strong>{m.name}</strong>
              {m.value === selected?.value && <Glyph d="m5 12 5 5 9-10" />}
              {m.description && <small>{m.description}</small>}
            </button>
          ))}
          {!models.length &&
            (connected ? (
              <p className="claude-model-note">
                The model list isn't available, so Claude uses your account's
                default model. If you just updated, restart the Claude bridge.
              </p>
            ) : (
              <button
                type="button"
                role="menuitem"
                className="claude-model-option"
                onClick={() => {
                  setOpen(false);
                  onConnect();
                }}
              >
                <strong>Connect Claude</strong>
                <small>to see the models your plan includes</small>
              </button>
            ))}
        </div>
      )}
    </div>
  );
};
