import { FilledButton } from "@excalidraw/excalidraw/components/FilledButton";
import { useUIAppState } from "@excalidraw/excalidraw/context/ui-appState";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type {
  AppState,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import {
  appJotaiStore,
  useAtom,
  useAtomValue,
  useSetAtom,
} from "../../app-jotai";
import { cloudSession } from "../cloud";
import {
  cloudSceneAtom,
  connectionIdAtom,
  localPresentationOrderAtom,
  participantsAtom,
  plusDialogAtom,
  presentationAtom,
} from "../state";
import { getFrameName, getOrderedFrames } from "../export/frames";

import { PresenterTalkControls } from "./HangoutControls";

import type { Frame } from "../export/frames";

/** The slide order for the open scene (cloud or local). */
export const usePresentationOrder = () => {
  const scene = useAtomValue(cloudSceneAtom);
  const [localOrder, setLocalOrder] = useAtom(localPresentationOrderAtom);
  const order = scene ? scene.presentation : localOrder;
  const setOrder = useCallback(
    (next: string[]) => {
      if (scene) {
        cloudSession.setPresentationOrder(next);
      } else {
        setLocalOrder(next);
      }
    },
    [scene, setLocalOrder],
  );
  return [order, setOrder] as const;
};

const getCurrentOrder = () =>
  appJotaiStore.get(cloudSceneAtom)?.presentation ??
  appJotaiStore.get(localPresentationOrderAtom);

/** The "Presentation" tab of the app sidebar: slide order and actions. */
export const PresentationPanel = ({
  api,
}: {
  api: ExcalidrawImperativeAPI;
}) => {
  // re-render when frames change
  useUIAppState();
  const elements = api.getSceneElements();
  const [order, setOrder] = usePresentationOrder();
  const setPresentation = useSetAtom(presentationAtom);
  const setDialog = useSetAtom(plusDialogAtom);
  const frames = getOrderedFrames(elements, order);
  const scene = useAtomValue(cloudSceneAtom);
  const canReorder = !scene || scene.role !== "viewer";
  const participants = useAtomValue(participantsAtom);
  const live = participants.find((p) => p.presenting);

  if (!frames.length) {
    return (
      <div className="plus-sidebar-empty">
        <p>Every frame is a slide.</p>
        <p className="plus-muted">
          Draw frames with the frame tool (F), then present them here or export
          them to PDF and PowerPoint.
        </p>
        <FilledButton
          label="Add a frame"
          onClick={() => api.setActiveTool({ type: "frame" })}
        />
      </div>
    );
  }

  const move = (index: number, delta: number) => {
    const ids = frames.map((frame) => frame.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + delta, 0, moved);
    setOrder(ids);
  };

  return (
    <div className="plus-presentation">
      <div className="plus-presentation__actions">
        <FilledButton
          label="Present"
          onClick={() => setPresentation({ active: true, index: 0 })}
        />
        <FilledButton
          variant="outlined"
          label="Export PDF / PPTX"
          onClick={() => setDialog({ name: "export-frames" })}
        />
        {scene?.role === "owner" && (
          <FilledButton
            variant="outlined"
            label="Share presentation"
            onClick={() => setDialog({ name: "share" })}
          />
        )}
      </div>
      {live && (
        <p className="plus-live-note">
          <span className="plus-live-badge">Live</span> {live.name} is
          presenting
        </p>
      )}
      <ol className="plus-slides">
        {frames.map((frame, index) => (
          <li key={frame.id} className="plus-slide">
            <button
              type="button"
              className="plus-slide__name"
              onClick={() =>
                api.setViewport({
                  target: frame,
                  fit: "contain",
                  animation: true,
                })
              }
              title="Show this slide"
            >
              <span className="plus-slide__number">{index + 1}</span>
              <span className="plus-slide__title">
                {getFrameName(frame, index)}
              </span>
            </button>
            <span className="plus-slide__actions">
              <button
                type="button"
                className="plus-slide__action"
                title="Present from this slide"
                aria-label="Present from this slide"
                onClick={() => setPresentation({ active: true, index })}
              >
                ▶
              </button>
              {canReorder && (
                <>
                  <button
                    type="button"
                    className="plus-slide__action"
                    title="Move up"
                    aria-label="Move up"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="plus-slide__action"
                    title="Move down"
                    aria-label="Move down"
                    disabled={index === frames.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </button>
                </>
              )}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
};

type SavedState = Pick<
  AppState,
  "viewModeEnabled" | "zenModeEnabled" | "frameRendering" | "openSidebar"
>;

const sameFrames = (a: readonly Frame[], b: readonly Frame[]) =>
  a.length === b.length &&
  a.every((f, i) => f.id === b[i].id && f.version === b[i].version);

/**
 * Full-screen slideshow over the canvas, one frame per slide.
 *
 * Whoever starts it from an editable scene is the presenter: the slide they
 * are on is announced to everyone else in the scene. Everyone else watches:
 * their slides follow the presenter until they navigate on their own, and
 * they can jump back. Opening a public presentation link is always watching,
 * for as long as the page is open.
 */
export const PresentationMode = ({ api }: { api: ExcalidrawImperativeAPI }) => {
  const [presentation, setPresentation] = useAtom(presentationAtom);
  const scene = useAtomValue(cloudSceneAtom);
  const participants = useAtomValue(participantsAtom);
  const connectionId = useAtomValue(connectionIdAtom);
  const [order] = usePresentationOrder();
  const [frames, setFrames] = useState<Frame[]>([]);
  const [following, setFollowing] = useState(true);
  const saved = useRef<SavedState | null>(null);
  const announced = useRef(false);

  // a public presentation link is nothing but the presentation
  const persistent = !!scene?.slidesOnly;
  const active = presentation.active || persistent;
  const watching = persistent || !!presentation.watching;
  const { index } = presentation;
  const presenter = participants.find(
    (p) => p.presenting && p.connectionId !== connectionId,
  );

  const exit = useCallback(() => {
    if (!persistent) {
      setPresentation({ active: false, index: 0 });
    }
  }, [persistent, setPresentation]);

  // public links start on their own; leaving the scene ends it
  useEffect(() => {
    if (persistent && !presentation.active) {
      setPresentation({ active: true, index: 0, watching: true });
    }
  }, [persistent, presentation.active, setPresentation]);

  // enter / leave
  useEffect(() => {
    if (!active) {
      return;
    }
    const ordered = getOrderedFrames(api.getSceneElements(), getCurrentOrder());
    if (!ordered.length && !persistent) {
      exit();
      return;
    }
    setFrames(ordered);
    setFollowing(true);
    const appState = api.getAppState();
    saved.current = {
      viewModeEnabled: appState.viewModeEnabled,
      zenModeEnabled: appState.zenModeEnabled,
      frameRendering: appState.frameRendering,
      openSidebar: appState.openSidebar,
    };
    api.updateScene({
      appState: {
        viewModeEnabled: true,
        zenModeEnabled: true,
        openSidebar: null,
        selectedElementIds: {},
        frameRendering: {
          enabled: true,
          clip: true,
          name: false,
          outline: false,
        },
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    document.body.classList.add("plus-presenting");
    if (!persistent) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    }

    const onFullscreenChange = () => {
      if (!document.fullscreenElement) {
        exit();
      }
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.body.classList.remove("plus-presenting");
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      if (saved.current) {
        api.updateScene({
          appState: saved.current,
          captureUpdate: CaptureUpdateAction.NEVER,
        });
        saved.current = null;
      }
      // drop the scroll lock and show everything again
      api.setActiveTool({ type: "selection" });
      api.setViewport({
        target: api.getSceneElements(),
        fit: "scale-down",
        animation: true,
      });
    };
  }, [active, persistent, api, exit]);

  // slides added, removed or reordered while presenting (by a collaborator,
  // or as the presenter edits a deck that's being watched)
  useEffect(() => {
    if (!active) {
      return;
    }
    const refresh = (elements: readonly ExcalidrawElement[]) => {
      const next = getOrderedFrames(elements, getCurrentOrder());
      setFrames((current) => (sameFrames(current, next) ? current : next));
    };
    refresh(api.getSceneElements());
    return api.onChange((elements) => refresh(elements));
  }, [active, api, order]);

  const frame = frames[Math.min(index, frames.length - 1)];

  // show the current slide, locked so it can't be panned away
  useEffect(() => {
    if (active && frame) {
      api.setViewport({
        target: frame,
        fit: "contain",
        lock: { scroll: true, zoom: true, overscroll: false },
        animation: { duration: 300 },
      });
    }
  }, [active, frame, api]);

  // presenter: tell everyone in the scene we're live, and which slide
  const canAnnounce = !watching && !!scene && !!connectionId;
  useEffect(() => {
    if (!active || !canAnnounce) {
      return;
    }
    announced.current = false;
    let cancelled = false;
    cloudSession
      .announcePresentation(
        "presentation-start",
        appJotaiStore.get(presentationAtom).index,
      )
      .then(() => {
        announced.current = !cancelled;
      })
      .catch((error) => {
        if (!cancelled) {
          // someone else is already presenting: watch them instead
          api.setToast({ message: error.message, closable: true });
          setPresentation((current) => ({ ...current, watching: true }));
        }
      });
    return () => {
      cancelled = true;
      if (announced.current) {
        announced.current = false;
        cloudSession
          .announcePresentation("presentation-stop", 0)
          .catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, canAnnounce, api, setPresentation]);

  useEffect(() => {
    if (active && canAnnounce && announced.current) {
      cloudSession.announcePresentation("follow-slide", index).catch(() => {});
    }
  }, [active, canAnnounce, index]);

  // watcher: move along with the presenter until they go their own way
  const presenterSlide = presenter?.slide;
  const isPresenterLive = !!presenter;
  useEffect(() => {
    if (
      active &&
      watching &&
      following &&
      isPresenterLive &&
      presenterSlide !== undefined &&
      frames.length
    ) {
      const target = Math.min(presenterSlide, frames.length - 1);
      setPresentation((current) =>
        current.index === target ? current : { ...current, index: target },
      );
    }
  }, [
    active,
    watching,
    following,
    isPresenterLive,
    presenterSlide,
    frames.length,
    setPresentation,
  ]);

  // the presenter starting again after a pause is followed again
  useEffect(() => {
    if (!presenter) {
      setFollowing(true);
    }
  }, [presenter]);

  const go = useCallback(
    (delta: number) => {
      if (watching) {
        setFollowing(false);
      }
      setPresentation((current) => ({
        ...current,
        index: Math.max(0, Math.min(frames.length - 1, current.index + delta)),
      }));
    },
    [frames.length, watching, setPresentation],
  );

  const goTo = useCallback(
    (target: number) => {
      if (watching) {
        setFollowing(false);
      }
      setPresentation((current) => ({ ...current, index: target }));
    },
    [watching, setPresentation],
  );

  useEffect(() => {
    if (!active) {
      return;
    }
    // capture phase, ahead of the editor's own shortcuts
    const onKeyDown = (event: KeyboardEvent) => {
      // typing in the talk's chat isn't a slideshow command
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA"].includes(target.tagName))
      ) {
        return;
      }
      const forward = ["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"];
      const back = ["ArrowLeft", "ArrowUp", "PageUp", "Backspace"];
      if (forward.includes(event.key)) {
        go(1);
      } else if (back.includes(event.key)) {
        go(-1);
      } else if (event.key === "Home") {
        goTo(0);
      } else if (event.key === "End") {
        goTo(Math.max(0, frames.length - 1));
      } else if (event.key === "Escape") {
        if (persistent) {
          return;
        }
        exit();
      } else if (event.key.toLowerCase() === "l" && !watching) {
        api.setActiveTool({ type: "laser" });
      } else {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [active, go, goTo, exit, api, frames.length, persistent, watching]);

  const names = useMemo(
    () => frames.map((f, i) => getFrameName(f, i)),
    [frames],
  );

  if (!active) {
    return null;
  }

  if (!frame) {
    // a public link to a deck with no slides (yet)
    return (
      <div className="plus-presenter plus-presenter--empty" role="status">
        {presenter
          ? `${presenter.name} is presenting…`
          : "This presentation has no slides yet."}
      </div>
    );
  }

  const current = Math.min(index, frames.length - 1);
  const offTrack = watching && !!presenter && !following;

  return (
    <div
      className="plus-presenter"
      role="toolbar"
      aria-label="Presentation controls"
    >
      {watching && (
        <span
          className="plus-presenter__status"
          title={
            presenter
              ? `${presenter.name} is presenting`
              : "Waiting for the presenter"
          }
        >
          {presenter ? (
            <>
              <span className="plus-live-badge">Live</span>
              {presenter.name}
            </>
          ) : (
            <span className="plus-muted">Waiting for the presenter</span>
          )}
        </span>
      )}
      {!watching && connectionId && scene && (
        <span className="plus-presenter__status" title="Others can watch">
          <span className="plus-live-badge">Live</span>
          {Math.max(0, participants.length - 1)} watching
        </span>
      )}
      <button
        onClick={() => go(-1)}
        disabled={current === 0}
        aria-label="Previous slide"
      >
        ←
      </button>
      <span className="plus-presenter__count" title={names[current]}>
        {current + 1} / {frames.length}
      </span>
      <button
        onClick={() => go(1)}
        disabled={current >= frames.length - 1}
        aria-label="Next slide"
      >
        →
      </button>
      {offTrack && (
        <button
          onClick={() => setFollowing(true)}
          title={`Jump to ${presenter!.name}'s slide`}
        >
          Follow
        </button>
      )}
      {!watching && (
        <button
          onClick={() => api.setActiveTool({ type: "laser" })}
          title="Laser pointer (L)"
        >
          Laser
        </button>
      )}
      {scene && <PresenterTalkControls />}
      {persistent ? (
        <button
          onClick={() =>
            document.fullscreenElement
              ? document.exitFullscreen().catch(() => {})
              : document.documentElement.requestFullscreen?.().catch(() => {})
          }
          title="Toggle full screen"
        >
          Full screen
        </button>
      ) : (
        <button onClick={exit} title="Exit (Esc)">
          Exit
        </button>
      )}
    </div>
  );
};
