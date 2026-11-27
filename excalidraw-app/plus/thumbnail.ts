import {
  exportScene,
  getNonDeletedElements,
  THEME,
} from "@excalidraw/excalidraw";
import { getCommonBounds } from "@excalidraw/element";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { plusAPI } from "./api";

/** Longest side of a preview, in pixels. */
const MAX_SIDE = 480;
const PADDING = 16;
/** The server accepts up to 400 000 characters. */
const MAX_CHARS = 350_000;

/**
 * Renders the canvas as a small image (a data URL), or `null` when it's
 * empty or can't be rendered.
 */
export const renderThumbnail = async (
  api: ExcalidrawImperativeAPI,
): Promise<string | null> => {
  const elements = getNonDeletedElements(
    api.getSceneElementsIncludingDeleted(),
  );
  if (!elements.length) {
    return null;
  }
  const appState = api.getAppState();
  const [minX, minY, maxX, maxY] = getCommonBounds(elements);
  const side = Math.max(maxX - minX, maxY - minY, 1) + PADDING * 2;
  const canvas = await exportScene({
    type: "canvas",
    data: { elements, appState, files: api.getFiles() },
    config: {
      scale: Math.min(1, MAX_SIDE / side),
      padding: PADDING,
      theme: THEME.LIGHT,
      canvasBackgroundColor: appState.viewBackgroundColor,
    },
  });
  for (const [type, quality] of [
    ["image/webp", 0.8],
    ["image/jpeg", 0.7],
    ["image/jpeg", 0.5],
  ] as const) {
    const url = canvas.toDataURL(type, quality);
    // (a browser without webp encoding falls back to png)
    if (url.length <= MAX_CHARS && /^data:image\/(webp|jpeg);/.test(url)) {
      return url;
    }
  }
  return null;
};

/** Renders and uploads the preview of a cloud scene. Never throws. */
export const uploadThumbnail = async (
  api: ExcalidrawImperativeAPI,
  sceneId: string,
) => {
  try {
    const image = await renderThumbnail(api);
    if (image) {
      await plusAPI.setSceneThumbnail(sceneId, image);
    }
  } catch (error) {
    // previews are nice to have: they must never get in the way of saving
    console.info("Couldn't update the scene preview:", error);
  }
};
