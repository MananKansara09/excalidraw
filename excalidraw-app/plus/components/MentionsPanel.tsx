import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";

import { useSetAtom } from "../../app-jotai";
import { plusAPI, sceneThumbnailURL } from "../api";
import { openCloudScene } from "../scenes";
import {
  mentionsUnreadAtom,
  pendingCommentFocusAtom,
  plusDialogAtom,
} from "../state";

import { CommentBody } from "./MentionInput";
import { AvatarContent, timeAgo, useAsyncAction } from "./ui";

import type { MentionInboxItem, PlusUser } from "../api";

/** How many mentions a card shows before "Show more". */
const PREVIEW_COUNT = 2;

type SceneMentions = {
  sceneId: string;
  sceneName: string;
  thumbnailAt: number | null;
  /** newest first */
  mentions: MentionInboxItem[];
  unread: number;
};

/** One entry per scene, the most recently mentioned scene first. */
const groupByScene = (mentions: MentionInboxItem[]) => {
  const scenes = new Map<string, SceneMentions>();
  for (const mention of [...mentions].sort(
    (a, b) => b.createdAt - a.createdAt,
  )) {
    let scene = scenes.get(mention.sceneId);
    if (!scene) {
      scene = {
        sceneId: mention.sceneId,
        sceneName: mention.sceneName,
        thumbnailAt: mention.sceneThumbnailAt ?? null,
        mentions: [],
        unread: 0,
      };
      scenes.set(mention.sceneId, scene);
    }
    scene.mentions.push(mention);
    if (mention.unread) {
      scene.unread++;
    }
  }
  return [...scenes.values()];
};

/**
 * The "Mentions" view of the dashboard: the scenes where comments @-mention
 * you, each with those comments underneath its preview.
 */
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

  const scenes = useMemo(() => groupByScene(mentions ?? []), [mentions]);

  const errorMessage = error && (
    <div className="dash-error" role="alert">
      {error}
    </div>
  );

  if (!mentions) {
    return (
      errorMessage || (
        <ul className="dash-grid dash-grid--mentions" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="dash-card dash-card--skeleton" />
          ))}
        </ul>
      )
    );
  }

  if (!scenes.length) {
    return (
      <>
        {errorMessage}
        <div className="dash-empty">
          When someone mentions you in a comment with @{user.name}, the scene
          shows up here.
        </div>
      </>
    );
  }

  /** Opens the scene at one comment's thread. */
  const openMention = (mention: MentionInboxItem) => {
    setPendingFocus({
      sceneId: mention.sceneId,
      commentId: mention.parentId ?? mention.id,
    });
    setDialog(null);
    openCloudScene(mention.sceneId);
  };

  return (
    <>
      {errorMessage}
      <ul className="dash-grid dash-grid--mentions">
        {scenes.map((scene) => (
          <MentionSceneCard
            key={scene.sceneId}
            scene={scene}
            myUserId={user.id}
            onOpen={openMention}
          />
        ))}
      </ul>
    </>
  );
};

const MentionSceneCard = ({
  scene,
  myUserId,
  onOpen,
}: {
  scene: SceneMentions;
  myUserId: string;
  onOpen: (mention: MentionInboxItem) => void;
}) => {
  const [expanded, setExpanded] = useState(false);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const total = scene.mentions.length;
  const shown = expanded
    ? scene.mentions
    : scene.mentions.slice(0, PREVIEW_COUNT);
  // the scene itself opens at the latest mention
  const openLatest = () => onOpen(scene.mentions[0]);

  return (
    <li className={clsx("dash-mention-card", { "is-unread": scene.unread })}>
      <button
        className="dash-mention-card__preview"
        onClick={openLatest}
        aria-label={`Open ${scene.sceneName}`}
      >
        {scene.thumbnailAt && !thumbnailFailed ? (
          <img
            className="dash-card__thumb"
            src={sceneThumbnailURL(scene.sceneId, scene.thumbnailAt)}
            alt=""
            loading="lazy"
            draggable={false}
            onError={() => setThumbnailFailed(true)}
          />
        ) : (
          <span className="dash-card__initial" aria-hidden="true">
            {scene.sceneName.trim()[0]?.toUpperCase() || "?"}
          </span>
        )}
        {scene.unread > 0 && (
          <span className="dash-mention-card__new">{scene.unread} new</span>
        )}
      </button>

      <div className="dash-mention-card__title">
        <button
          className="dash-card__name"
          onClick={openLatest}
          title={scene.sceneName}
        >
          {scene.sceneName}
        </button>
        <span className="dash-card__sub">
          {total} {total === 1 ? "mention" : "mentions"}
        </span>
      </div>

      <ul className="dash-mention-card__list">
        {shown.map((mention) => (
          <li key={mention.id}>
            <button
              className={clsx("dash-mention", {
                "is-unread": mention.unread,
              })}
              onClick={() => onOpen(mention)}
            >
              <span className="dash-avatar dash-mention__avatar">
                <AvatarContent
                  name={mention.author.name}
                  avatarUrl={mention.author.avatarUrl}
                  imgClassName="dash-avatar__img"
                />
              </span>
              <span className="dash-mention__content">
                <span className="dash-mention__meta">
                  <strong>{mention.author.name}</strong>
                  <span>{timeAgo(mention.createdAt)}</span>
                </span>
                <span className="dash-mention__body">
                  <CommentBody
                    body={mention.body}
                    mentions={mention.mentions}
                    myUserId={myUserId}
                  />
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      {total > PREVIEW_COUNT && (
        <button
          className="dash-mention-card__more"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show less" : `Show ${total - PREVIEW_COUNT} more`}
        </button>
      )}
    </li>
  );
};
