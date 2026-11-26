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
import {
  activeCommentIdAtom,
  cloudSceneAtom,
  commentsAtom,
  plusDialogAtom,
  plusUserAtom,
} from "../state";

import {
  ErrorText,
  initials,
  SmallButton,
  timeAgo,
  useAsyncAction,
} from "./ui";

import type { PlusComment } from "../api";

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
}: {
  thread: PlusComment;
  replies: PlusComment[];
  api: ExcalidrawImperativeAPI;
  canModerate: boolean;
  userId: string | null;
  active: boolean;
}) => {
  const [reply, setReply] = useState("");
  const { pending, error, run } = useAsyncAction();
  const ref = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (active) {
      ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [active]);

  return (
    <li
      ref={ref}
      className={clsx("plus-thread", { resolved: thread.resolved, active })}
    >
      {[thread, ...replies].map((comment) => (
        <div key={comment.id} className="plus-comment">
          <div className="plus-comment__meta">
            <span className="plus-avatar small" aria-hidden="true">
              {initials(comment.author.name)}
            </span>
            <strong>{comment.author.name}</strong>
            <span className="plus-muted">{timeAgo(comment.createdAt)}</span>
            {(comment.author.id === userId || canModerate) && (
              <button
                className="plus-icon-text danger"
                title="Delete comment"
                onClick={() => {
                  if (
                    comment.parentId ||
                    window.confirm("Delete this thread and its replies?")
                  ) {
                    run(() => plusAPI.deleteComment(comment.id));
                  }
                }}
              >
                Delete
              </button>
            )}
          </div>
          <div className="plus-comment__body">{comment.body}</div>
        </div>
      ))}
      <div className="plus-thread__actions">
        {(thread.elementId || thread.x !== null) && (
          <SmallButton onClick={() => focusThread(api, thread)}>
            Show
          </SmallButton>
        )}
        {(canModerate || thread.author.id === userId) && (
          <SmallButton
            onClick={() =>
              run(() =>
                plusAPI.updateComment(thread.id, {
                  resolved: !thread.resolved,
                }),
              )
            }
          >
            {thread.resolved ? "Reopen" : "Resolve"}
          </SmallButton>
        )}
      </div>
      {userId && !thread.resolved && (
        <form
          className="plus-inline-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!reply.trim()) {
              return;
            }
            const done = await run(() =>
              plusAPI.addComment(thread.sceneId, {
                body: reply.trim(),
                parentId: thread.id,
              }),
            );
            if (done) {
              setReply("");
            }
          }}
        >
          <input
            placeholder="Reply"
            aria-label="Reply"
            value={reply}
            onChange={(event) => setReply(event.target.value)}
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
  const [showResolved, setShowResolved] = useState(false);
  const { pending, error, run } = useAsyncAction();

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
            setDialog(
              user
                ? { name: "save-to-cloud" }
                : { name: "auth", mode: "signin" },
            )
          }
        />
      </div>
    );
  }

  const selectedId = Object.keys(selectedElementIds).find(
    (id) => selectedElementIds[id],
  );
  const canModerate = scene.role === "owner" || scene.role === "editor";
  const resolvedCount = comments.filter(
    (c) => !c.parentId && c.resolved,
  ).length;

  return (
    <div className="plus-comments">
      {user ? (
        <form
          className="plus-comments__compose"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!body.trim()) {
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
            const done = await run(() =>
              plusAPI.addComment(scene.id, {
                body: body.trim(),
                elementId: selectedId ?? null,
                x: selectedId ? null : center.x,
                y: selectedId ? null : center.y,
              }),
            );
            if (done) {
              setBody("");
            }
          }}
        >
          <textarea
            rows={3}
            placeholder={
              selectedId
                ? "Comment on the selected element"
                : "Comment on this spot (select an element to pin it there)"
            }
            aria-label="New comment"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <SmallButton type="submit" disabled={pending || !body.trim()}>
            Comment
          </SmallButton>
        </form>
      ) : (
        <div className="plus-sidebar-empty">
          <p className="plus-muted">Sign in to join the discussion.</p>
          <SmallButton
            onClick={() => setDialog({ name: "auth", mode: "signin" })}
          >
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
            />
          ))}
        </ul>
      )}
    </div>
  );
};

/** Pins for open threads, drawn over the canvas. */
export const CommentPins = ({ api }: { api: ExcalidrawImperativeAPI }) => {
  const comments = useAtomValue(commentsAtom);
  const setActive = useSetAtom(activeCommentIdAtom);
  const [, setTick] = useState(0);

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

  const open = comments.filter((c) => !c.parentId && !c.resolved);
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
  const replyCounts = new Map<string, number>();
  for (const comment of comments) {
    if (comment.parentId) {
      replyCounts.set(
        comment.parentId,
        (replyCounts.get(comment.parentId) ?? 0) + 1,
      );
    }
  }

  return (
    <div className="plus-pins" aria-label="Comment pins">
      {open.map((thread) => {
        const anchor = getAnchor(thread, elementsMap);
        if (!anchor) {
          return null;
        }
        const { x, y } = sceneCoordsToViewportCoords(
          { sceneX: anchor.x, sceneY: anchor.y },
          appState,
        );
        if (
          x < appState.offsetLeft ||
          y < appState.offsetTop ||
          x > appState.offsetLeft + appState.width ||
          y > appState.offsetTop + appState.height
        ) {
          return null;
        }
        const replies = replyCounts.get(thread.id) ?? 0;
        return (
          <button
            key={thread.id}
            className="plus-pin"
            style={{ left: x, top: y }}
            title={`${thread.author.name}: ${thread.body}`}
            onClick={() => {
              setActive(thread.id);
              api.toggleSidebar({
                name: "default",
                tab: "comments",
                force: true,
              });
            }}
          >
            {initials(thread.author.name)}
            {replies > 0 && (
              <span className="plus-pin__count">{replies + 1}</span>
            )}
          </button>
        );
      })}
    </div>
  );
};
