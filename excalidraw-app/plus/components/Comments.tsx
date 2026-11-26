import {
  sceneCoordsToViewportCoords,
  viewportCoordsToSceneCoords,
} from "@excalidraw/common";
import { useUIAppState } from "@excalidraw/excalidraw/context/ui-appState";
import { FilledButton } from "@excalidraw/excalidraw/components/FilledButton";
import { getCommonBounds } from "@excalidraw/element";
import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { useAtom, useAtomValue, useSetAtom } from "../../app-jotai";
import { plusAPI } from "../api";
import { cloudSession } from "../cloud";
import { goToSignIn } from "../auth";
import {
  activeCommentIdAtom,
  cloudSceneAtom,
  commentsAtom,
  plusDialogAtom,
  plusUserAtom,
} from "../state";

import {
  AvatarContent,
  ErrorText,
  PlusAvatar,
  SmallButton,
  timeAgo,
  useAsyncAction,
} from "./ui";

import { CommentPopover } from "./CommentPopover";
import { CommentBody, MentionInput, mentionsInText } from "./MentionInput";

import type { Mention, Person, PlusComment } from "../api";

/** Where a thread is pinned: its element's top-right corner, or a point. */
const getAnchor = (
  comment: PlusComment,
  elementsMap: Map<string, ExcalidrawElement>,
) => {
  if (comment.elementId) {
    const element = elementsMap.get(comment.elementId);
    if (element && !element.isDeleted) {
      const [, minY, maxX] = getCommonBounds([element]);
      return { x: maxX, y: minY };
    }
  }
  if (comment.x !== null && comment.y !== null) {
    return { x: comment.x, y: comment.y };
  }
  return null;
};

const focusThread = (api: ExcalidrawImperativeAPI, comment: PlusComment) => {
  const element = comment.elementId
    ? api.getSceneElements().find((el) => el.id === comment.elementId)
    : null;
  if (element) {
    api.setViewport({ target: element, fit: "none", animation: true });
    api.updateScene({
      appState: { selectedElementIds: { [element.id]: true } },
    });
  } else if (comment.x !== null && comment.y !== null) {
    api.setViewport({
      target: { x: comment.x, y: comment.y },
      fit: "none",
      animation: true,
    });
  }
};

const Thread = ({
  thread,
  replies,
  api,
  canModerate,
  userId,
  active,
  people,
}: {
  thread: PlusComment;
  replies: PlusComment[];
  api: ExcalidrawImperativeAPI;
  canModerate: boolean;
  userId: string | null;
  active: boolean;
  people: Person[];
}) => {
  const [reply, setReply] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [replyMentions, setReplyMentions] = useState<Mention[]>([]);
  const { pending, error, run } = useAsyncAction();
  const ref = useRef<HTMLLIElement>(null);
  const setActive = useSetAtom(activeCommentIdAtom);
  const [flash, setFlash] = useState(false);

  const highlight = () => {
    ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    // restart the animation even when the same thread is clicked again
    setFlash(false);
    requestAnimationFrame(() => setFlash(true));
  };

  useEffect(() => {
    if (active) {
      highlight();
    }
  }, [active]);

  useEffect(() => {
    if (!flash) {
      return;
    }
    const timeout = setTimeout(() => setFlash(false), 1600);
    return () => clearTimeout(timeout);
  }, [flash]);

  // clicking a thread (resolved ones have no pin) jumps to it on the canvas
  const onThreadClick = (event: React.MouseEvent) => {
    if ((event.target as HTMLElement).closest("button, input, textarea, a")) {
      return;
    }
    setActive(thread.id);
    highlight();
    focusThread(api, thread);
  };

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

  return (
    <li
      ref={ref}
      className={clsx("plus-thread", {
        resolved: thread.resolved,
        active,
        flash,
      })}
      onClick={onThreadClick}
    >
      {[thread, ...replies].map((comment) => {
        // only the person who wrote a comment can delete it
        const isOwn = !!userId && comment.author.id === userId;
        const confirming = confirmingId === comment.id;
        return (
          <div
            key={comment.id}
            className={clsx("plus-comment", { reply: !!comment.parentId })}
          >
            <PlusAvatar
              name={comment.author.name}
              avatarUrl={comment.author.avatarUrl}
              size="small"
            />
            <div className="plus-comment__main">
              <div className="plus-comment__meta">
                <strong className="plus-comment__author">
                  {comment.author.name}
                </strong>
                <span className="plus-muted">{timeAgo(comment.createdAt)}</span>
                {isOwn && !confirming && (
                  <button
                    className="plus-comment__delete"
                    title="Delete comment"
                    aria-label="Delete comment"
                    onClick={() => setConfirmingId(comment.id)}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="14"
                      height="14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5" />
                    </svg>
                  </button>
                )}
                {isOwn && confirming && (
                  <span className="plus-comment__confirm">
                    <span>
                      {comment.parentId ? "Delete?" : "Delete thread?"}
                    </span>
                    <button
                      className="danger"
                      onClick={() => {
                        setConfirmingId(null);
                        run(() => plusAPI.deleteComment(comment.id));
                      }}
                    >
                      Yes
                    </button>
                    <button onClick={() => setConfirmingId(null)}>No</button>
                  </span>
                )}
              </div>
              <div className="plus-comment__body">
                <CommentBody
                  body={comment.body}
                  mentions={comment.mentions}
                  myUserId={userId}
                />
              </div>
            </div>
          </div>
        );
      })}
      <div className="plus-thread__actions">
        {(thread.elementId || thread.x !== null) && (
          <button
            className="plus-thread__action"
            onClick={() => {
              setActive(thread.id);
              highlight();
              focusThread(api, thread);
            }}
          >
            Show on canvas
          </button>
        )}
        {(canModerate || thread.author.id === userId) && (
          <button
            className="plus-thread__action"
            onClick={() =>
              run(() =>
                plusAPI.updateComment(thread.id, {
                  resolved: !thread.resolved,
                }),
              )
            }
          >
            {thread.resolved ? "Reopen" : "Resolve"}
          </button>
        )}
      </div>
      {userId && !thread.resolved && (
        <form
          className="plus-inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            sendReply();
          }}
        >
          <MentionInput
            label="Reply"
            placeholder="Reply (type @ to mention)"
            value={reply}
            onChange={setReply}
            mentions={replyMentions}
            onMentionsChange={setReplyMentions}
            people={people}
            onSubmit={sendReply}
          />
          <SmallButton type="submit" disabled={pending || !reply.trim()}>
            Reply
          </SmallButton>
        </form>
      )}
      <ErrorText error={error} />
    </li>
  );
};

/** The "Comments" tab of the app sidebar. */
export const CommentsPanel = ({ api }: { api: ExcalidrawImperativeAPI }) => {
  const scene = useAtomValue(cloudSceneAtom);
  const user = useAtomValue(plusUserAtom);
  const comments = useAtomValue(commentsAtom);
  const [activeId] = useAtom(activeCommentIdAtom);
  const setDialog = useSetAtom(plusDialogAtom);
  const { selectedElementIds } = useUIAppState();
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [showResolved, setShowResolved] = useState(false);
  const { pending, error, run } = useAsyncAction();

  // who can be @-mentioned: everyone with access to the scene but you
  const sceneId = scene?.id;
  useEffect(() => {
    if (!sceneId || !user) {
      setPeople([]);
      return;
    }
    let cancelled = false;
    plusAPI
      .listPeople(sceneId)
      .then(({ people }) => {
        if (!cancelled) {
          setPeople(people.filter((person) => person.userId !== user.id));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sceneId, user]);

  const threads = useMemo(() => {
    const replies = new Map<string, PlusComment[]>();
    for (const comment of comments) {
      if (comment.parentId) {
        replies.set(comment.parentId, [
          ...(replies.get(comment.parentId) ?? []),
          comment,
        ]);
      }
    }
    return comments
      .filter((c) => !c.parentId && (showResolved || !c.resolved))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((thread) => ({ thread, replies: replies.get(thread.id) ?? [] }));
  }, [comments, showResolved]);

  if (!scene) {
    return (
      <div className="plus-sidebar-empty">
        <p>Comments live on cloud scenes.</p>
        <p className="plus-muted">
          Save this canvas to your workspace to discuss it with your team.
        </p>
        <FilledButton
          label={user ? "Save to workspace" : "Sign in"}
          onClick={() =>
            user ? setDialog({ name: "save-to-cloud" }) : goToSignIn()
          }
        />
      </div>
    );
  }

  const selectedId = Object.keys(selectedElementIds).find(
    (id) => selectedElementIds[id],
  );

  const postComment = async () => {
    const text = body.trim();
    if (!text || pending) {
      return;
    }
    const appState = api.getAppState();
    const center = viewportCoordsToSceneCoords(
      {
        clientX: appState.offsetLeft + appState.width / 2,
        clientY: appState.offsetTop + appState.height / 2,
      },
      appState,
    );
    const result = await run(() =>
      plusAPI.addComment(scene.id, {
        body: text,
        elementId: selectedId ?? null,
        x: selectedId ? null : center.x,
        y: selectedId ? null : center.y,
        mentions: mentionsInText(text, mentions),
      }),
    );
    if (result) {
      // shown right away; the live update for everyone else is a no-op here
      cloudSession.upsertComment(result.comment);
      setBody("");
      setMentions([]);
    }
  };
  const canModerate = scene.role === "owner" || scene.role === "editor";
  const resolvedCount = comments.filter(
    (c) => !c.parentId && c.resolved,
  ).length;

  return (
    <div className="plus-comments">
      {user ? (
        <form
          className="plus-comments__compose"
          onSubmit={(event) => {
            event.preventDefault();
            postComment();
          }}
        >
          <MentionInput
            multiline
            label="New comment"
            placeholder={
              selectedId
                ? "Comment on the selected element. Type @ to mention someone"
                : "Comment on this spot (select an element to pin it there). Type @ to mention someone"
            }
            value={body}
            onChange={setBody}
            mentions={mentions}
            onMentionsChange={setMentions}
            people={people}
            onSubmit={postComment}
          />
          <div className="plus-comments__compose-actions">
            <span className="plus-muted">
              Enter to post · Shift+Enter for a new line
            </span>
            <SmallButton type="submit" disabled={pending || !body.trim()}>
              Comment
            </SmallButton>
          </div>
        </form>
      ) : (
        <div className="plus-sidebar-empty">
          <p className="plus-muted">Sign in to join the discussion.</p>
          <SmallButton onClick={() => goToSignIn("signin", "comment")}>
            Sign in
          </SmallButton>
        </div>
      )}
      <ErrorText error={error} />
      {resolvedCount > 0 && (
        <label className="plus-checkbox">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(event) => setShowResolved(event.target.checked)}
          />
          Show resolved ({resolvedCount})
        </label>
      )}
      {threads.length === 0 ? (
        <p className="plus-muted plus-center">No comments yet.</p>
      ) : (
        <ul className="plus-threads">
          {threads.map(({ thread, replies }) => (
            <Thread
              key={thread.id}
              thread={thread}
              replies={replies}
              api={api}
              canModerate={canModerate}
              userId={user?.id ?? null}
              active={thread.id === activeId}
              people={people}
            />
          ))}
        </ul>
      )}
    </div>
  );
};

const POPOVER_WIDTH = 320;
const POPOVER_HEIGHT = 380;

/** Pins for open threads, drawn over the canvas. */
export const CommentPins = ({ api }: { api: ExcalidrawImperativeAPI }) => {
  const comments = useAtomValue(commentsAtom);
  const scene = useAtomValue(cloudSceneAtom);
  const user = useAtomValue(plusUserAtom);
  const [activeId, setActive] = useAtom(activeCommentIdAtom);
  const [, setTick] = useState(0);
  const [people, setPeople] = useState<Person[]>([]);
  // `hoverId` follows the pointer; `stickyId` stays until closed (click)
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [stickyId, setStickyId] = useState<string | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setTick((tick) => tick + 1));
    };
    const offScroll = api.onScrollChange(schedule);
    const offChange = api.onChange(schedule);
    return () => {
      cancelAnimationFrame(frame);
      offScroll();
      offChange();
    };
  }, [api]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const sceneId = scene?.id;
  useEffect(() => {
    if (!sceneId || !user) {
      setPeople([]);
      return;
    }
    let cancelled = false;
    plusAPI
      .listPeople(sceneId)
      .then((result) => {
        if (!cancelled) {
          setPeople(result.people.filter((p) => p.userId !== user.id));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sceneId, user]);

  // a comment link (or the inbox) asks for a thread to be shown
  useEffect(() => {
    if (activeId) {
      setStickyId(activeId);
    }
  }, [activeId]);

  const keepOpen = () => window.clearTimeout(closeTimer.current);
  const leave = () => {
    keepOpen();
    closeTimer.current = window.setTimeout(() => setHoverId(null), 250);
  };
  const close = () => {
    keepOpen();
    setHoverId(null);
    setStickyId(null);
    setActive(null);
  };

  const open = comments
    .filter((c) => !c.parentId && !c.resolved)
    .sort((a, b) => a.createdAt - b.createdAt);
  if (!open.length) {
    return null;
  }
  const appState = api.getAppState();
  if (appState.viewModeEnabled && appState.zenModeEnabled) {
    return null;
  }
  const elementsMap = new Map(
    api
      .getSceneElements()
      .map((element) => [element.id, element as ExcalidrawElement]),
  );
  const repliesByThread = new Map<string, PlusComment[]>();
  for (const comment of comments) {
    if (comment.parentId) {
      repliesByThread.set(comment.parentId, [
        ...(repliesByThread.get(comment.parentId) ?? []),
        comment,
      ]);
    }
  }

  const shownId = hoverId ?? stickyId;
  const shownIndex = open.findIndex((thread) => thread.id === shownId);
  const shown = shownIndex >= 0 ? open[shownIndex] : null;
  const canModerate = scene?.role === "owner" || scene?.role === "editor";

  const step = (delta: number) => {
    const next = open[(shownIndex + delta + open.length) % open.length];
    setHoverId(null);
    setStickyId(next.id);
    focusThread(api, next);
  };

  const toViewport = (comment: PlusComment) => {
    const anchor = getAnchor(comment, elementsMap);
    return anchor
      ? sceneCoordsToViewportCoords(
          { sceneX: anchor.x, sceneY: anchor.y },
          appState,
        )
      : null;
  };

  let popover: React.ReactElement | null = null;
  if (shown) {
    const point = toViewport(shown);
    if (point) {
      const maxLeft = window.innerWidth - POPOVER_WIDTH - 8;
      // open to the right of the pin, flipped when it would leave the screen
      const left =
        point.x + 14 + POPOVER_WIDTH > window.innerWidth
          ? Math.max(8, point.x - 14 - POPOVER_WIDTH)
          : Math.min(point.x + 14, maxLeft);
      const top = Math.max(
        8,
        Math.min(point.y - 28, window.innerHeight - POPOVER_HEIGHT - 8),
      );
      popover = (
        <CommentPopover
          key={shown.id}
          thread={shown}
          replies={repliesByThread.get(shown.id) ?? []}
          position={{ left, top }}
          userId={user?.id ?? null}
          canModerate={canModerate}
          people={people}
          myName={user?.name ?? ""}
          myAvatarUrl={user?.avatarUrl ?? null}
          index={shownIndex}
          total={open.length}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          onClose={close}
          onPointerEnter={keepOpen}
          onPointerLeave={leave}
        />
      );
    }
  }

  return (
    <div className="plus-pins" aria-label="Comment pins">
      {open.map((thread) => {
        const point = toViewport(thread);
        if (!point) {
          return null;
        }
        const { x, y } = point;
        if (
          x < appState.offsetLeft ||
          y < appState.offsetTop ||
          x > appState.offsetLeft + appState.width ||
          y > appState.offsetTop + appState.height
        ) {
          return null;
        }
        const replies = repliesByThread.get(thread.id)?.length ?? 0;
        return (
          <button
            key={thread.id}
            className={clsx("plus-pin", {
              active: thread.id === shownId,
              "has-avatar": !!thread.author.avatarUrl,
            })}
            style={{ left: x, top: y }}
            aria-label={`Comment by ${thread.author.name}`}
            aria-expanded={thread.id === shownId}
            onPointerEnter={() => {
              keepOpen();
              setHoverId(thread.id);
            }}
            onPointerLeave={leave}
            onFocus={() => setHoverId(thread.id)}
            onClick={() => {
              setStickyId((id) => (id === thread.id ? null : thread.id));
              setHoverId(null);
            }}
          >
            <AvatarContent
              name={thread.author.name}
              avatarUrl={thread.author.avatarUrl}
              imgClassName="plus-pin__avatar"
            />
            {replies > 0 && (
              <span className="plus-pin__count">{replies + 1}</span>
            )}
          </button>
        );
      })}
      {popover}
    </div>
  );
};
