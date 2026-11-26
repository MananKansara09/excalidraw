import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

import { plusAPI } from "../api";
import { cloudSession, commentLinkURL } from "../cloud";

import { initials, timeAgo, useAsyncAction } from "./ui";
import { CommentBody, MentionInput, mentionsInText } from "./MentionInput";

import type { Mention, Person, PlusComment } from "../api";

const Icon = ({ children }: { children: React.ReactNode }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

const copyLink = async (comment: PlusComment) => {
  try {
    await navigator.clipboard.writeText(commentLinkURL(comment.id));
    return true;
  } catch {
    return false;
  }
};

const CommentRow = ({
  comment,
  canRemove,
  userId,
  onRemove,
}: {
  comment: PlusComment;
  canRemove: boolean;
  userId: string | null;
  onRemove: () => void;
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menuOpen]);

  return (
    <div className="plus-popover__comment">
      <div className="plus-popover__meta">
        <span className="plus-avatar small" aria-hidden="true">
          {initials(comment.author.name)}
        </span>
        <strong>{comment.author.name}</strong>
        <span className="plus-popover__time">
          • {timeAgo(comment.createdAt)}
        </span>
        <div className="plus-popover__menu-wrap" ref={menuRef}>
          <button
            className={clsx("plus-popover__icon", { active: menuOpen })}
            aria-label="Comment actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Icon>
              <circle cx="12" cy="5" r="1" />
              <circle cx="12" cy="12" r="1" />
              <circle cx="12" cy="19" r="1" />
            </Icon>
          </button>
          {menuOpen && (
            <div className="plus-popover__menu" role="menu">
              <button
                role="menuitem"
                onClick={async () => {
                  setCopied(await copyLink(comment));
                  setTimeout(() => {
                    setCopied(false);
                    setMenuOpen(false);
                  }, 900);
                }}
              >
                <Icon>
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </Icon>
                {copied ? "Copied" : "Copy link"}
              </button>
              {canRemove && (
                <button
                  role="menuitem"
                  className="danger"
                  onClick={() => {
                    setMenuOpen(false);
                    onRemove();
                  }}
                >
                  <Icon>
                    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                  </Icon>
                  Remove
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="plus-popover__body">
        <CommentBody
          body={comment.body}
          mentions={comment.mentions}
          myUserId={userId}
        />
      </div>
    </div>
  );
};

/**
 * The card shown when hovering (or clicking) a comment pin: the whole
 * thread, a reply box, and thread actions (previous/next, resolve, copy
 * link, delete, close).
 */
export const CommentPopover = ({
  thread,
  replies,
  position,
  userId,
  canModerate,
  people,
  index,
  total,
  onPrev,
  onNext,
  onClose,
  onPointerEnter,
  onPointerLeave,
}: {
  thread: PlusComment;
  replies: PlusComment[];
  position: { left: number; top: number };
  userId: string | null;
  canModerate: boolean;
  people: Person[];
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}) => {
  const [reply, setReply] = useState("");
  const [replyMentions, setReplyMentions] = useState<Mention[]>([]);
  const [linkCopied, setLinkCopied] = useState(false);
  const { pending, error, run } = useAsyncAction();
  const listRef = useRef<HTMLDivElement>(null);
  const canResolve = canModerate || thread.author.id === userId;

  // a new reply scrolls into view
  useEffect(() => {
    const list = listRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }, [replies.length]);

  const sendReply = async () => {
    const text = reply.trim();
    if (!text || pending) {
      return;
    }
    const result = await run(() =>
      plusAPI.addComment(thread.sceneId, {
        body: text,
        parentId: thread.id,
        mentions: mentionsInText(text, replyMentions),
      }),
    );
    if (result) {
      cloudSession.upsertComment(result.comment);
      setReply("");
      setReplyMentions([]);
    }
  };

  const removeComment = (comment: PlusComment) => {
    if (
      comment.parentId ||
      window.confirm("Delete this thread and its replies?")
    ) {
      run(() => plusAPI.deleteComment(comment.id));
      if (!comment.parentId) {
        onClose();
      }
    }
  };

  return (
    <div
      className="plus-popover"
      style={position}
      role="dialog"
      aria-label={`Comment thread by ${thread.author.name}`}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="plus-popover__header">
        <div className="plus-popover__nav">
          <button
            className="plus-popover__icon"
            aria-label="Previous thread"
            title={`Previous (${index + 1} of ${total})`}
            disabled={total < 2}
            onClick={onPrev}
          >
            <Icon>
              <path d="m15 18-6-6 6-6" />
            </Icon>
          </button>
          <button
            className="plus-popover__icon"
            aria-label="Next thread"
            title={`Next (${index + 1} of ${total})`}
            disabled={total < 2}
            onClick={onNext}
          >
            <Icon>
              <path d="m9 18 6-6-6-6" />
            </Icon>
          </button>
        </div>
        <div className="plus-popover__tools">
          {canResolve && (
            <button
              className="plus-popover__icon"
              aria-label="Resolve thread"
              title="Resolve thread"
              onClick={() =>
                run(() => plusAPI.updateComment(thread.id, { resolved: true }))
              }
            >
              <Icon>
                <circle cx="12" cy="12" r="9" />
                <path d="m8.5 12.5 2.5 2.5 4.5-5" />
              </Icon>
            </button>
          )}
          <button
            className="plus-popover__icon"
            aria-label="Copy link to thread"
            title={linkCopied ? "Link copied" : "Copy link to thread"}
            onClick={async () => {
              setLinkCopied(await copyLink(thread));
              setTimeout(() => setLinkCopied(false), 1500);
            }}
          >
            {linkCopied ? (
              <Icon>
                <path d="m5 12.5 4.5 4.5L19 7" />
              </Icon>
            ) : (
              <Icon>
                <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1 1" />
                <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1-1" />
              </Icon>
            )}
          </button>
          {(canModerate || thread.author.id === userId) && (
            <button
              className="plus-popover__icon"
              aria-label="Delete thread"
              title="Delete thread"
              onClick={() => removeComment(thread)}
            >
              <Icon>
                <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
              </Icon>
            </button>
          )}
          <button
            className="plus-popover__icon"
            aria-label="Close"
            title="Close"
            onClick={onClose}
          >
            <Icon>
              <path d="M18 6 6 18M6 6l12 12" />
            </Icon>
          </button>
        </div>
      </div>

      <div className="plus-popover__list" ref={listRef}>
        {[thread, ...replies].map((comment) => (
          <CommentRow
            key={comment.id}
            comment={comment}
            userId={userId}
            canRemove={comment.author.id === userId || canModerate}
            onRemove={() => removeComment(comment)}
          />
        ))}
      </div>

      {error && <div className="plus-popover__error">{error}</div>}

      {userId && (
        <form
          className="plus-popover__reply"
          onSubmit={(event) => {
            event.preventDefault();
            sendReply();
          }}
        >
          <span className="plus-avatar small" aria-hidden="true">
            {initials(people.find((p) => p.userId === userId)?.name ?? "Me")}
          </span>
          <MentionInput
            label="Reply"
            placeholder="Reply, @mention someone…"
            value={reply}
            onChange={setReply}
            mentions={replyMentions}
            onMentionsChange={setReplyMentions}
            people={people}
            onSubmit={sendReply}
          />
          <button
            type="submit"
            className="plus-popover__send"
            aria-label="Send reply"
            disabled={pending || !reply.trim()}
          >
            <Icon>
              <path d="M12 19V5M5 12l7-7 7 7" />
            </Icon>
          </button>
        </form>
      )}
    </div>
  );
};
