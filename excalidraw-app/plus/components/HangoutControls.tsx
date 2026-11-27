import { useEffect, useRef, useState } from "react";
import clsx from "clsx";

import { useAtom, useAtomValue } from "../../app-jotai";
import {
  chatAtom,
  chatOpenAtom,
  chatUnreadAtom,
  classifyVideos,
  hangout,
  hangoutAtom,
} from "../hangout";
import { connectionIdAtom, participantsAtom } from "../state";

const MediaElement = ({
  stream,
  kind,
  mirror,
}: {
  stream: MediaStream;
  kind: "audio" | "video";
  /** Flip a self-view like a mirror. */
  mirror?: boolean;
}) => {
  const ref = useRef<HTMLMediaElement | null>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) {
      ref.current.srcObject = stream;
      ref.current.play().catch(() => {
        // autoplay can be blocked until the user interacts; joining counts
      });
    }
  }, [stream]);
  return kind === "audio" ? (
    <audio
      ref={(el) => {
        ref.current = el;
      }}
      autoPlay
    />
  ) : (
    <video
      ref={(el) => {
        ref.current = el;
      }}
      autoPlay
      playsInline
      muted
      style={mirror ? { transform: "scaleX(-1)" } : undefined}
    />
  );
};

/** Opens and closes the talk's chat; shows how many messages are unread. */
const ChatToggle = ({ className }: { className?: string }) => {
  const [open, setOpen] = useAtom(chatOpenAtom);
  const unread = useAtomValue(chatUnreadAtom);
  return (
    <button
      className={clsx(className, { on: open })}
      onClick={() => setOpen(!open)}
      aria-pressed={open}
      title={open ? "Close the chat" : "Chat with everyone in the talk"}
    >
      <span aria-hidden="true">💬</span>
      {unread > 0 && (
        <span className="plus-badge" aria-label={`${unread} unread`}>
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </button>
  );
};

/**
 * The talk's controls inside the presenter bar: join, mic, camera, chat. The
 * rest of the editor chrome is hidden while presenting.
 */
export const PresenterTalkControls = () => {
  const state = useAtomValue(hangoutAtom);
  if (!state.joined) {
    return (
      <button
        onClick={() => hangout.join()}
        disabled={state.joining}
        title={
          state.error ??
          "Join the talk: only people who join hear you, see your camera and chat"
        }
      >
        <span aria-hidden="true">🎧</span>{" "}
        {state.joining ? "Joining…" : "Join talk"}
      </button>
    );
  }
  return (
    <>
      <button
        onClick={() => hangout.toggleMute()}
        aria-pressed={state.muted || !state.micOn}
        title={
          state.error ??
          (!state.micOn
            ? "Turn your microphone on"
            : state.muted
            ? "Unmute"
            : "Mute")
        }
      >
        {state.muted || !state.micOn ? "🔇" : "🎙️"}
      </button>
      <button
        onClick={() => hangout.toggleCamera()}
        aria-pressed={state.cameraOn}
        title={state.error ?? (state.cameraOn ? "Camera off" : "Camera on")}
      >
        {state.cameraOn ? "📷" : "🚫"}
      </button>
      <ChatToggle />
      <button onClick={() => hangout.leave()} title="Leave the talk">
        Leave talk
      </button>
    </>
  );
};

export const HangoutButtons = () => {
  const state = useAtomValue(hangoutAtom);
  const participants = useAtomValue(participantsAtom);
  const me = useAtomValue(connectionIdAtom);
  const inCall = participants.filter((p) => p.inHangout).length;
  const sharer = participants.find(
    (p) => p.sharingScreen && p.connectionId !== me,
  );

  if (!state.joined) {
    return (
      <>
        {sharer && (
          <button
            className="plus-pill-button primary"
            onClick={() => hangout.join({ mic: false })}
            disabled={state.joining}
            title="Watch the shared screen and listen to the call, with your microphone off"
          >
            <span aria-hidden="true">🖥️</span> Watch {sharer.name}'s screen
          </button>
        )}
        <button
          className="plus-pill-button"
          onClick={() => hangout.join()}
          disabled={state.joining}
          title={
            state.error ??
            "Talk with everyone on this scene, and share your screen"
          }
        >
          <span aria-hidden="true">🎧</span>{" "}
          {state.joining
            ? "Joining…"
            : inCall
            ? `Join voice (${inCall})`
            : "Voice"}
        </button>
      </>
    );
  }

  return (
    <span
      className="plus-hangout-controls"
      role="group"
      aria-label="Voice hangout"
    >
      <button
        className={clsx("plus-pill-button", {
          off: state.muted || !state.micOn,
        })}
        onClick={() => hangout.toggleMute()}
        aria-pressed={state.muted || !state.micOn}
        title={
          state.error ??
          (!state.micOn
            ? "Turn your microphone on"
            : state.muted
            ? "Unmute"
            : "Mute")
        }
      >
        {state.muted || !state.micOn ? "🔇" : "🎙️"}
      </button>
      <button
        className={clsx("plus-pill-button", { off: !state.cameraOn })}
        onClick={() => hangout.toggleCamera()}
        aria-pressed={state.cameraOn}
        title={state.cameraOn ? "Turn your camera off" : "Turn your camera on"}
      >
        {state.cameraOn ? "📷" : "🚫"}
      </button>
      <ChatToggle className="plus-pill-button" />
      <button
        className={clsx("plus-pill-button", { on: state.sharingScreen })}
        onClick={() =>
          state.sharingScreen
            ? hangout.stopScreenShare()
            : hangout.startScreenShare()
        }
        aria-pressed={state.sharingScreen}
        title={
          state.sharingScreen ? "Stop sharing your screen" : "Share your screen"
        }
      >
        🖥️
      </button>
      <button
        className="plus-pill-button danger"
        onClick={() => hangout.leave()}
        title="Leave voice"
      >
        Leave
      </button>
    </span>
  );
};

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

/** The talk's chat: only people who joined the talk see and send messages. */
const HangoutChat = () => {
  const messages = useAtomValue(chatAtom);
  const me = useAtomValue(connectionIdAtom);
  const [, setOpen] = useAtom(chatOpenAtom);
  const [, setUnread] = useAtom(chatUnreadAtom);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLOListElement | null>(null);

  useEffect(() => {
    // open and looking: nothing is unread
    setUnread(0);
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, setUnread]);

  const send = () => {
    if (draft.trim()) {
      hangout.sendChat(draft);
      setDraft("");
    }
  };

  return (
    <section className="plus-chat" aria-label="Talk chat">
      <header className="plus-chat__bar">
        <span>Chat · only people in the talk</span>
        <button onClick={() => setOpen(false)} aria-label="Close chat">
          ✕
        </button>
      </header>
      <ol className="plus-chat__list" ref={listRef} aria-live="polite">
        {!messages.length && (
          <li className="plus-chat__empty">No messages yet. Say hello!</li>
        )}
        {messages.map((message) => (
          <li
            key={message.id}
            className={clsx("plus-chat__message", {
              mine: message.from === me,
            })}
          >
            <span className="plus-chat__meta">
              {message.from === me ? "You" : message.name} ·{" "}
              {timeFormat.format(message.at)}
            </span>
            <span className="plus-chat__text">{message.text}</span>
          </li>
        ))}
      </ol>
      <form
        className="plus-chat__form"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // slideshow and editor shortcuts shouldn't see what you type
            event.stopPropagation();
            if (event.key === "Escape") {
              event.currentTarget.blur();
            }
          }}
          placeholder="Message everyone in the talk"
          maxLength={1000}
          aria-label="Message"
        />
        <button type="submit" disabled={!draft.trim()}>
          Send
        </button>
      </form>
    </section>
  );
};

/**
 * Plays the talk's audio and shows its cameras, shared screens and chat in
 * floating panels. Everything here is only for people who joined the talk.
 */
export const HangoutMedia = () => {
  const state = useAtomValue(hangoutAtom);
  const participants = useAtomValue(participantsAtom);
  const chatOpen = useAtomValue(chatOpenAtom);
  const [expanded, setExpanded] = useState(false);
  const [hidden, setHidden] = useState(false);

  const nameOf = (id: string) =>
    participants.find((p) => p.connectionId === id)?.name ?? "Someone";

  const { cameras, screens } = classifyVideos(state.remote, participants);

  useEffect(() => {
    // a new share should be seen even if an earlier one was hidden
    setHidden(false);
  }, [screens.length]);

  if (!state.joined) {
    return null;
  }

  return (
    <>
      {Object.entries(state.remote).map(([id, media]) =>
        media.audio ? (
          <MediaElement key={`audio-${id}`} stream={media.audio} kind="audio" />
        ) : null,
      )}
      {(cameras.length > 0 || state.localCamera) && (
        <div className="plus-cameras" aria-label="Cameras">
          {state.localCamera && (
            <figure className="plus-camera">
              <MediaElement stream={state.localCamera} kind="video" mirror />
              <figcaption>You</figcaption>
            </figure>
          )}
          {cameras.map(({ id, stream }) => (
            <figure className="plus-camera" key={`camera-${id}`}>
              <MediaElement stream={stream} kind="video" />
              <figcaption>{nameOf(id)}</figcaption>
            </figure>
          ))}
        </div>
      )}
      {chatOpen && <HangoutChat />}
      {(screens.length > 0 || state.localScreen) && !hidden && (
        <div className={clsx("plus-screens", { expanded })}>
          <div className="plus-screens__bar">
            <span>
              {screens.length
                ? `${screens.map(({ id }) => nameOf(id)).join(", ")} sharing`
                : "You're sharing your screen"}
            </span>
            <button onClick={() => setExpanded(!expanded)}>
              {expanded ? "Shrink" : "Enlarge"}
            </button>
            <button onClick={() => setHidden(true)}>Hide</button>
          </div>
          {screens.map(({ id, stream }) => (
            <MediaElement key={`screen-${id}`} stream={stream} kind="video" />
          ))}
          {!screens.length && state.localScreen && (
            <MediaElement stream={state.localScreen} kind="video" />
          )}
        </div>
      )}
    </>
  );
};
