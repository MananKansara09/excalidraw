import { FilledButton } from "@excalidraw/excalidraw/components/FilledButton";
import { useUIAppState } from "@excalidraw/excalidraw/context/ui-appState";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  localPresentationOrderAtom,
  plusDialogAtom,
  presentationAtom,
} from "../state";
import { getFrameName, getOrderedFrames } from "../export/frames";

import { PresenterTalkControls } from "./HangoutControls";
import { SmallButton } from "./ui";

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
        <SmallButton onClick={() => setDialog({ name: "export-frames" })}>
          Export PDF / PPTX
        </SmallButton>
      </div>
      <ol className="plus-slides">
        {frames.map((frame, index) => (
          <li key={frame.id} className="plus-slide">
            <button
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
              {getFrameName(frame, index)}
            </button>
            <span className="plus-slide__actions">
              <SmallButton
                title="Present from this slide"
                onClick={() => setPresentation({ active: true, index })}
              >
                ▶
              </SmallButton>
              {canReorder && (
                <>
                  <SmallButton
                    title="Move up"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </SmallButton>
                  <SmallButton
                    title="Move down"
                    disabled={index === frames.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </SmallButton>
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

/** Full-screen slideshow over the canvas, one frame per slide. */
export const PresentationMode = ({ api }: { api: ExcalidrawImperativeAPI }) => {
  const [presentation, setPresentation] = useAtom(presentationAtom);
  const [frames, setFrames] = useState<Frame[]>([]);
  const saved = useRef<SavedState | null>(null);
  const { active, index } = presentation;
  // the talk (voice, cameras, chat) lives on cloud scenes
  const scene = useAtomValue(cloudSceneAtom);

  const exit = useCallback(() => {
    setPresentation({ active: false, index: 0 });
  }, [setPresentation]);

  // enter / leave
  useEffect(() => {
    if (!active) {
      return;
    }
    const ordered = getOrderedFrames(api.getSceneElements(), getCurrentOrder());
    if (!ordered.length) {
      exit();
      return;
    }
    setFrames(ordered);
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
    document.documentElement.requestFullscreen?.().catch(() => {});

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
  }, [active, api, exit]);

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

  const go = useCallback(
    (delta: number) =>
      setPresentation((current) => ({
        ...current,
        index: Math.max(0, Math.min(frames.length - 1, current.index + delta)),
      })),
    [frames.length, setPresentation],
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
        setPresentation((current) => ({ ...current, index: 0 }));
      } else if (event.key === "End") {
        setPresentation((current) => ({
          ...current,
          index: frames.length - 1,
        }));
      } else if (event.key === "Escape") {
        exit();
      } else if (event.key.toLowerCase() === "l") {
        api.setActiveTool({ type: "laser" });
      } else {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [active, go, exit, api, frames.length, setPresentation]);

  const names = useMemo(
    () => frames.map((f, i) => getFrameName(f, i)),
    [frames],
  );

  if (!active || !frame) {
    return null;
  }

  return (
    <div
      className="plus-presenter"
      role="toolbar"
      aria-label="Presentation controls"
    >
      <button
        onClick={() => go(-1)}
        disabled={index === 0}
        aria-label="Previous slide"
      >
        ←
      </button>
      <span className="plus-presenter__count" title={names[index]}>
        {index + 1} / {frames.length}
      </span>
      <button
        onClick={() => go(1)}
        disabled={index >= frames.length - 1}
        aria-label="Next slide"
      >
        →
      </button>
      <button
        onClick={() => api.setActiveTool({ type: "laser" })}
        title="Laser pointer (L)"
      >
        Laser
      </button>
      {scene && <PresenterTalkControls />}
      <button onClick={exit} title="Exit (Esc)">
        Exit
      </button>
    </div>
  );
};
