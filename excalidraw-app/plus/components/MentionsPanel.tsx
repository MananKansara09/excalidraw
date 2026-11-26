import { useEffect, useState } from "react";

import { useSetAtom } from "../../app-jotai";
import { plusAPI } from "../api";
import {
  mentionsUnreadAtom,
  pendingCommentFocusAtom,
  plusDialogAtom,
} from "../state";

import { openCloudScene } from "../scenes";

import { CommentBody } from "./MentionInput";
import { ErrorText, PlusAvatar, timeAgo, useAsyncAction } from "./ui";

import type { MentionInboxItem, PlusUser } from "../api";

/** The "Mentions" view of the Workspace: comments that @-mention you. */
export const MentionsPanel = ({ user }: { user: PlusUser }) => {
  const [mentions, setMentions] = useState<MentionInboxItem[] | null>(null);
  const setUnread = useSetAtom(mentionsUnreadAtom);
  const setPendingFocus = useSetAtom(pendingCommentFocusAtom);
  const setDialog = useSetAtom(plusDialogAtom);
  const { error, run } = useAsyncAction();

  useEffect(() => {
    run(async () => {
      const inbox = await plusAPI.myMentions();
      setMentions(inbox.mentions);
      // opening the list counts as reading it
      if (inbox.unread) {
        await plusAPI.markMentionsSeen();
      }
      setUnread(0);
    });
  }, [run, setUnread]);

  if (!mentions) {
    return (
      <>
        <ErrorText error={error} />
        {!error && <p className="plus-muted">Loading…</p>}
      </>
    );
  }

  if (!mentions.length) {
    return (
      <div className="plus-empty">
        When someone mentions you in a comment with @{user.name}, it shows up
        here.
      </div>
    );
  }

  return (
    <ul className="plus-scenes">
      {mentions.map((mention) => (
        <li key={mention.id} className="plus-scene">
          <button
            className="plus-scene__open plus-mention-item"
            onClick={() => {
              setPendingFocus({
                sceneId: mention.sceneId,
                commentId: mention.parentId ?? mention.id,
              });
              setDialog(null);
              openCloudScene(mention.sceneId);
            }}
          >
            <span className="plus-mention-item__meta">
              <PlusAvatar
                name={mention.author.name}
                avatarUrl={mention.author.avatarUrl}
                size="small"
              />
              <strong>{mention.author.name}</strong>
              <span className="plus-muted">
                in {mention.sceneName} · {timeAgo(mention.createdAt)}
              </span>
              {mention.unread && <span className="plus-badge">new</span>}
            </span>
            <span className="plus-mention-item__body">
              <CommentBody
                body={mention.body}
                mentions={mention.mentions}
                myUserId={user.id}
              />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
};
