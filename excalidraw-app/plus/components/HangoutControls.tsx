import { useEffect, useRef, useState } from "react";
import clsx from "clsx";

import { useAtomValue } from "../../app-jotai";
import { hangout, hangoutAtom } from "../hangout";
import { participantsAtom } from "../state";

const MediaElement = ({
  stream,
  kind,
}: {
  stream: MediaStream;
  kind: "audio" | "video";
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
    />
  );
};

export const HangoutButtons = () => {
  const state = useAtomValue(hangoutAtom);
  const participants = useAtomValue(participantsAtom);
  const inCall = participants.filter((p) => p.inHangout).length;

  if (!state.joined) {
    return (
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
    );
  }

  return (
    <span
      className="plus-hangout-controls"
      role="group"
      aria-label="Voice hangout"
    >
      <button
        className={clsx("plus-pill-button", { off: state.muted })}
        onClick={() => hangout.toggleMute()}
        aria-pressed={state.muted}
        title={state.muted ? "Unmute" : "Mute"}
      >
        {state.muted ? "🔇" : "🎙️"}
      </button>
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

/** Plays remote audio and shows shared screens in a floating panel. */
export const HangoutMedia = () => {
  const state = useAtomValue(hangoutAtom);
  const participants = useAtomValue(participantsAtom);
  const [expanded, setExpanded] = useState(false);
  const [hidden, setHidden] = useState(false);

  const nameOf = (id: string) =>
    participants.find((p) => p.connectionId === id)?.name ?? "Someone";

  const screens = Object.entries(state.remote).filter(
    ([, media]) => media.screen,
  );

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
      {(screens.length > 0 || state.localScreen) && !hidden && (
        <div className={clsx("plus-screens", { expanded })}>
          <div className="plus-screens__bar">
            <span>
              {screens.length
                ? `${screens.map(([id]) => nameOf(id)).join(", ")} sharing`
                : "You're sharing your screen"}
            </span>
            <button onClick={() => setExpanded(!expanded)}>
              {expanded ? "Shrink" : "Enlarge"}
            </button>
            <button onClick={() => setHidden(true)}>Hide</button>
          </div>
          {screens.map(([id, media]) => (
            <MediaElement
              key={`screen-${id}`}
              stream={media.screen!}
              kind="video"
            />
          ))}
          {!screens.length && state.localScreen && (
            <MediaElement stream={state.localScreen} kind="video" />
          )}
        </div>
      )}
    </>
  );
};
