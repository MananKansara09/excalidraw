import clsx from "clsx";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useAtomValue } from "../../app-jotai";
import { currentUserAtom, knownUsersAtom } from "../store";

import "./CanvasMentionAutocomplete.scss";

import type { KnownUser } from "../types";

interface ActiveMentionQuery {
  textarea: HTMLTextAreaElement;
  query: string;
  atIndex: number;
  caretIndex: number;
  rect: { top: number; left: number };
}

const MAX_SUGGESTIONS = 6;

const extractActiveQuery = (
  textarea: HTMLTextAreaElement,
): ActiveMentionQuery | null => {
  const caretIndex = textarea.selectionStart ?? textarea.value.length;
  const beforeCaret = textarea.value.slice(0, caretIndex);
  const match = beforeCaret.match(
    /(^|[^a-zA-Z0-9._%+-])@([a-zA-Z0-9._-]{0,32})$/,
  );
  if (!match) {
    return null;
  }

  const atIndex = beforeCaret.lastIndexOf("@");
  if (atIndex < 0) {
    return null;
  }

  const bounds = textarea.getBoundingClientRect();
  return {
    textarea,
    query: (match[2] ?? "").toLowerCase(),
    atIndex,
    caretIndex,
    rect: {
      top: bounds.bottom + 6,
      left: bounds.left,
    },
  };
};

export const CanvasMentionAutocomplete: React.FC = () => {
  const knownUsers = useAtomValue(knownUsersAtom);
  const currentUser = useAtomValue(currentUserAtom);
  const [activeQuery, setActiveQuery] = useState<ActiveMentionQuery | null>(
    null,
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const suggestions = useMemo(() => {
    if (!activeQuery) {
      return [];
    }
    const q = activeQuery.query;
    const pool: Array<
      Pick<KnownUser, "id" | "username" | "handle" | "isOnline">
    > = [
      ...knownUsers.filter((u) => u.handle !== currentUser.handle),
      {
        id: "everyone",
        username: "Everyone in canvas",
        handle: "everyone",
        isOnline: true,
      },
    ];

    return pool
      .filter(
        (u) =>
          !q || u.handle.includes(q) || u.username.toLowerCase().includes(q),
      )
      .slice(0, MAX_SUGGESTIONS);
  }, [activeQuery, knownUsers, currentUser.handle]);

  const applySuggestion = useCallback(
    (user: Pick<KnownUser, "handle">) => {
      if (!activeQuery) {
        return;
      }
      const { textarea, atIndex, caretIndex } = activeQuery;
      const before = textarea.value.slice(0, atIndex);
      const after = textarea.value.slice(caretIndex);
      const inserted = `@${user.handle} `;
      const nextValue = `${before}${inserted}${after}`;

      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      if (nativeSetter) {
        nativeSetter.call(textarea, nextValue);
      } else {
        textarea.value = nextValue;
      }

      const nextCaret = before.length + inserted.length;
      textarea.setSelectionRange(nextCaret, nextCaret);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      setActiveQuery(null);
    },
    [activeQuery],
  );

  useEffect(() => {
    const ownerDoc = rootRef.current?.ownerDocument ?? document;

    const syncFromTarget = (target: EventTarget | null) => {
      if (
        target instanceof HTMLTextAreaElement &&
        target.classList.contains("excalidraw-wysiwyg")
      ) {
        const next = extractActiveQuery(target);
        setActiveQuery(next);
        setSelectedIndex(0);
      } else {
        setActiveQuery(null);
      }
    };

    const handleInput = (event: Event) => {
      syncFromTarget(event.target);
    };

    const handleFocusOut = (event: FocusEvent) => {
      if (
        event.target instanceof HTMLTextAreaElement &&
        event.target.classList.contains("excalidraw-wysiwyg")
      ) {
        setActiveQuery(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!activeQuery || suggestions.length === 0) {
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        setSelectedIndex((prev) => (prev + 1) % suggestions.length);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        setSelectedIndex(
          (prev) => (prev - 1 + suggestions.length) % suggestions.length,
        );
      } else if (event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        applySuggestion(suggestions[selectedIndex] ?? suggestions[0]);
      } else if (event.key === "Escape") {
        setActiveQuery(null);
      }
    };

    ownerDoc.addEventListener("input", handleInput, true);
    ownerDoc.addEventListener("focusout", handleFocusOut, true);
    ownerDoc.addEventListener("keydown", handleKeyDown, true);

    return () => {
      ownerDoc.removeEventListener("input", handleInput, true);
      ownerDoc.removeEventListener("focusout", handleFocusOut, true);
      ownerDoc.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [activeQuery, suggestions, selectedIndex, applySuggestion]);

  return (
    <div ref={rootRef}>
      {activeQuery && suggestions.length > 0 && (
        <div
          className="CanvasMentionAutocomplete"
          style={{
            top: Math.min(
              activeQuery.rect.top,
              (rootRef.current?.ownerDocument.defaultView?.innerHeight ?? 800) -
                220,
            ),
            left: Math.max(12, activeQuery.rect.left),
          }}
          role="listbox"
          aria-label="Mention suggestions"
        >
          <div className="CanvasMentionAutocomplete__hint">
            Mention user (Tab or click)
          </div>
          {suggestions.map((user, idx) => (
            <button
              key={user.handle}
              type="button"
              role="option"
              aria-selected={idx === selectedIndex}
              className={clsx("CanvasMentionAutocomplete__item", {
                "is-selected": idx === selectedIndex,
              })}
              onMouseDown={(event) => {
                // Prevent textarea blur before inserting the @mention
                event.preventDefault();
                applySuggestion(user);
              }}
            >
              <span className="CanvasMentionAutocomplete__handle">
                @{user.handle}
              </span>
              <span className="CanvasMentionAutocomplete__name">
                {user.username}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
