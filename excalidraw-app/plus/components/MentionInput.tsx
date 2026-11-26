import clsx from "clsx";
import { Fragment, useLayoutEffect, useMemo, useRef, useState } from "react";

import { initials } from "./ui";

import type { Mention, Person } from "../api";

/** "@query" right before the caret, if the user is typing a mention. */
const getMentionQuery = (text: string, caret: number) => {
  const match = /(?:^|\s)@([^\s@]{0,40})$/.exec(text.slice(0, caret));
  return match ? { query: match[1], start: caret - match[1].length - 1 } : null;
};

/** Mentions still present in the text as "@Name". */
export const mentionsInText = (text: string, mentions: Mention[]) => {
  const seen = new Set<string>();
  return mentions.filter((mention) => {
    if (seen.has(mention.userId) || !text.includes(`@${mention.name}`)) {
      return false;
    }
    seen.add(mention.userId);
    return true;
  });
};

/**
 * A comment field with @-mentions: typing "@" lists the people with access
 * to the scene (by name or email), and picking one inserts "@Name". Enter
 * submits; Shift+Enter adds a line in multi-line fields.
 */
export const MentionInput = ({
  value,
  onChange,
  mentions,
  onMentionsChange,
  people,
  onSubmit,
  multiline = false,
  placeholder,
  label,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  mentions: Mention[];
  onMentionsChange: (mentions: Mention[]) => void;
  people: Person[];
  onSubmit: () => void;
  multiline?: boolean;
  placeholder?: string;
  label: string;
  disabled?: boolean;
}) => {
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const [caret, setCaret] = useState(0);
  const [highlighted, setHighlighted] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const pendingCaret = useRef<number | null>(null);

  useLayoutEffect(() => {
    const field = ref.current;
    if (field && pendingCaret.current !== null) {
      field.focus();
      field.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [value]);

  const mention = getMentionQuery(value, caret);
  const suggestions = useMemo(() => {
    if (!mention) {
      return [];
    }
    const query = mention.query.toLowerCase();
    return people
      .filter(
        (person) =>
          person.name.toLowerCase().includes(query) ||
          person.email.toLowerCase().includes(query),
      )
      .sort(
        (a, b) =>
          Number(!a.name.toLowerCase().startsWith(query)) -
          Number(!b.name.toLowerCase().startsWith(query)),
      )
      .slice(0, 6);
  }, [mention, people]);
  const open =
    !!mention && suggestions.length > 0 && dismissedAt !== mention.start;

  const pick = (person: Person) => {
    if (!mention) {
      return;
    }
    const inserted = `@${person.name} `;
    const next = value.slice(0, mention.start) + inserted + value.slice(caret);
    const nextCaret = mention.start + inserted.length;
    onChange(next);
    onMentionsChange(
      mentions.some((m) => m.userId === person.userId)
        ? mentions
        : [...mentions, { userId: person.userId, name: person.name }],
    );
    setCaret(nextCaret);
    // placed when the new text renders, before the next key press lands
    pendingCaret.current = nextCaret;
  };

  const props = {
    ref,
    value,
    placeholder,
    disabled,
    "aria-label": label,
    "aria-autocomplete": "list" as const,
    "aria-expanded": open,
    onChange: (
      event: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>,
    ) => {
      onChange(event.target.value);
      setCaret(event.target.selectionStart ?? event.target.value.length);
      setHighlighted(0);
    },
    onSelect: (
      event: React.SyntheticEvent<HTMLTextAreaElement | HTMLInputElement>,
    ) => setCaret(event.currentTarget.selectionStart ?? 0),
    onKeyDown: (
      event: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>,
    ) => {
      if (open) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const step = event.key === "ArrowDown" ? 1 : -1;
          setHighlighted(
            (highlighted + step + suggestions.length) % suggestions.length,
          );
          return;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          pick(suggestions[Math.min(highlighted, suggestions.length - 1)]);
          return;
        }
        if (event.key === "Escape") {
          // closes the list, not the sidebar
          event.preventDefault();
          event.stopPropagation();
          setDismissedAt(mention!.start);
          return;
        }
      }
      if (event.key === "Enter" && !(multiline && event.shiftKey)) {
        event.preventDefault();
        onSubmit();
      }
    },
  };

  return (
    <div className="plus-mention-input">
      {multiline ? <textarea rows={3} {...props} /> : <input {...props} />}
      {open && (
        <ul className="plus-mention-list" role="listbox" aria-label="People">
          {suggestions.map((person, index) => (
            <li
              key={person.userId}
              role="option"
              aria-selected={index === highlighted}
              className={clsx({ active: index === highlighted })}
              // mousedown keeps focus in the field
              onMouseDown={(event) => {
                event.preventDefault();
                pick(person);
              }}
              onMouseEnter={() => setHighlighted(index)}
            >
              <span className="plus-avatar small" aria-hidden="true">
                {initials(person.name)}
              </span>
              <span className="plus-mention-list__text">
                <span>{person.name}</span>
                <span className="plus-muted">{person.email}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

/** Comment text with its mentions highlighted. */
export const CommentBody = ({
  body,
  mentions,
  myUserId,
}: {
  body: string;
  mentions: Mention[];
  myUserId: string | null;
}) => {
  if (!mentions?.length) {
    return <>{body}</>;
  }
  // longest names first, so "@Ann Lee" wins over "@Ann"
  const sorted = [...mentions].sort((a, b) => b.name.length - a.name.length);
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(${sorted.map((m) => `@${escape(m.name)}`).join("|")})`,
    "g",
  );
  return (
    <>
      {body.split(pattern).map((part, index) => {
        const mention = sorted.find((m) => `@${m.name}` === part);
        return mention ? (
          <span
            key={index}
            className={clsx("plus-mention", {
              me: mention.userId === myUserId,
            })}
          >
            {part}
          </span>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        );
      })}
    </>
  );
};
