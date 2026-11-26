import { getNonDeletedElements } from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { plusAPI } from "./api";
import { cloudSceneHash } from "./cloud";
import { uploadThumbnail } from "./thumbnail";

import type { PlusFile } from "./api";

/** Opens a cloud scene in the editor. */
export const openCloudScene = (sceneId: string) => {
  if (window.location.pathname === "/") {
    window.location.hash = cloudSceneHash(sceneId);
  } else {
    // from another page (the dashboard): load the editor
    window.location.assign(`/${cloudSceneHash(sceneId)}`);
  }
};

/** Opens a cloud scene and joins its live presentation as a watcher. */
export const watchCloudPresentation = (sceneId: string) => {
  const hash = `${cloudSceneHash(sceneId)}&watch=1`;
  if (window.location.pathname === "/") {
    window.location.hash = hash;
  } else {
    window.location.assign(`/${hash}`);
  }
};

/** Uploads the current canvas as a new cloud scene. */
export const saveCanvasToCloud = async (
  api: ExcalidrawImperativeAPI,
  location: { name: string; teamId: string | null; folderId: string | null },
) => {
  const elements = api.getSceneElementsIncludingDeleted();
  const allFiles = api.getFiles();
  const files: Record<string, PlusFile> = {};
  for (const element of getNonDeletedElements(elements)) {
    if (
      element.type === "image" &&
      element.fileId &&
      allFiles[element.fileId]
    ) {
      const file = allFiles[element.fileId];
      files[file.id] = {
        id: file.id,
        mimeType: file.mimeType,
        dataURL: file.dataURL,
        created: file.created,
      };
    }
  }
  const { scene } = await plusAPI.createScene({
    ...location,
    elements: getNonDeletedElements(elements),
    appState: { viewBackgroundColor: api.getAppState().viewBackgroundColor },
    files,
  });
  // a preview for the dashboard: best effort, but done before leaving
  await uploadThumbnail(api, scene.id);
  return scene;
};
