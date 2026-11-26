import {
  exportScene,
  getNonDeletedElements,
  THEME,
} from "@excalidraw/excalidraw";
import { isFrameLikeElement } from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawFrameLikeElement,
  NonDeleted,
} from "@excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

export type Frame = NonDeleted<ExcalidrawFrameLikeElement>;

/**
 * Frames in presentation order: those listed in `order` first, then the rest
 * in reading order (top to bottom, left to right).
 */
export const getOrderedFrames = (
  elements: readonly ExcalidrawElement[],
  order: readonly string[] = [],
): Frame[] => {
  const frames = getNonDeletedElements(elements).filter((element) =>
    isFrameLikeElement(element),
  ) as Frame[];
  const byId = new Map(frames.map((frame) => [frame.id, frame]));
  const ordered = order
    .map((id) => byId.get(id))
    .filter((frame): frame is Frame => !!frame);
  const listed = new Set(ordered.map((frame) => frame.id));
  const rest = frames
    .filter((frame) => !listed.has(frame.id))
    .sort((a, b) => (Math.abs(a.y - b.y) > 40 ? a.y - b.y : a.x - b.x));
  return [...ordered, ...rest];
};

export const getFrameName = (frame: Frame, index: number) =>
  frame.name?.trim() || `Slide ${index + 1}`;

export type RenderedFrame = {
  frame: Frame;
  /** JPEG bytes. */
  jpeg: Uint8Array;
  /** Pixel size of the JPEG. */
  width: number;
  height: number;
};

/** Renders each frame to a JPEG at `scale` (2 keeps text crisp in slides). */
export const renderFrames = async (opts: {
  frames: Frame[];
  elements: readonly ExcalidrawElement[];
  files: BinaryFiles;
  appState: AppState;
  scale?: number;
  dark?: boolean;
  onProgress?: (done: number, total: number) => void;
}): Promise<RenderedFrame[]> => {
  const elements = getNonDeletedElements(opts.elements);
  const rendered: RenderedFrame[] = [];
  for (const [index, frame] of opts.frames.entries()) {
    const canvas = await exportScene({
      type: "canvas",
      data: {
        elements,
        appState: opts.appState,
        files: opts.files,
      },
      config: {
        exportingFrame: frame,
        scale: opts.scale ?? 2,
        padding: 0,
        theme: opts.dark ? THEME.DARK : THEME.LIGHT,
        canvasBackgroundColor: opts.appState.viewBackgroundColor,
      },
    });
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Couldn't render frame"))),
        "image/jpeg",
        0.92,
      ),
    );
    rendered.push({
      frame,
      jpeg: new Uint8Array(await blob.arrayBuffer()),
      width: canvas.width,
      height: canvas.height,
    });
    opts.onProgress?.(index + 1, opts.frames.length);
  }
  return rendered;
};
