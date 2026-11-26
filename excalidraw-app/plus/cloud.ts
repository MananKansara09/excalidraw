import {
  CaptureUpdateAction,
  reconcileElements,
  restoreAppState,
  restoreElements,
} from "@excalidraw/excalidraw";
import { debounce } from "@excalidraw/common";

import type {
  ExcalidrawElement,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import { appJotaiStore } from "../app-jotai";
import { LocalData } from "../data/LocalData";

import { plusAPI, PlusAPIError, setActiveShareToken } from "./api";
import {
  cloudSceneAtom,
  cloudStatusAtom,
  commentsAtom,
  connectionIdAtom,
  participantsAtom,
  plusUserAtom,
} from "./state";

import type { PlusComment, PlusFile, SceneDetail } from "./api";
import type { CloudScene, Participant } from "./state";

export type CloudHash = {
  sceneId: string | null;
  shareToken: string | null;
  embed: boolean;
};

/** `#cloud=<sceneId>` or `#share=<token>`, optionally with `&embed=1`. */
export const parseCloudHash = (
  hash = window.location.hash,
): CloudHash | null => {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const sceneId = params.get("cloud");
  const shareToken = params.get("share");
  if (!sceneId && !shareToken) {
    return null;
  }
  return { sceneId, shareToken, embed: params.get("embed") === "1" };
};

export const cloudSceneHash = (sceneId: string) => `#cloud=${sceneId}`;

export const getShareURL = (token: string, embed = false) =>
  `${window.location.origin}/#share=${token}${embed ? "&embed=1" : ""}`;

export type SignalMessage = { type: string; from: string; data: any };
type SignalListener = (message: SignalMessage) => void;

const toBinaryFiles = (files: Record<string, PlusFile> | undefined) =>
  Object.values(files ?? {}).map(
    (file) =>
      ({
        id: file.id,
        mimeType: file.mimeType,
        dataURL: file.dataURL,
        created: file.created ?? Date.now(),
      } as BinaryFileData),
  );

/**
 * Keeps the open cloud scene in sync with the server: pushes local edits
 * (debounced, only elements whose version changed), applies remote edits as
 * they stream in, and relays presence, comments and hangout signaling.
 */
class CloudSession {
  private api: ExcalidrawImperativeAPI | null = null;
  private scene: CloudScene | null = null;
  private events: EventSource | null = null;
  private syncedVersions = new Map<string, number>();
  private uploadedFiles = new Set<string>();
  private syncedBackground: string | null = null;
  private syncedName: string | null = null;
  private inFlight: Promise<void> | null = null;
  private needsAnotherFlush = false;
  private signalListeners = new Set<SignalListener>();
  private connectedOnce = false;

  get sceneId() {
    return this.scene?.id ?? null;
  }

  isActive() {
    return !!this.scene;
  }

  canEdit() {
    return this.scene?.role === "owner" || this.scene?.role === "editor";
  }

  /**
   * Loads the scene the hash points to. Resolves share links first so the
   * token is attached to every later request.
   */
  async load(hash: CloudHash) {
    let sceneId = hash.sceneId;
    setActiveShareToken(hash.shareToken);
    if (hash.shareToken) {
      sceneId = (await plusAPI.resolveShareLink(hash.shareToken)).sceneId;
    }
    const { scene } = await plusAPI.getScene(sceneId!);
    return scene;
  }

  /** Starts syncing a loaded scene. Local autosave pauses meanwhile. */
  start(api: ExcalidrawImperativeAPI, scene: SceneDetail, hash: CloudHash) {
    this.stop({ resumeLocalSave: false });
    // stop() clears the share token load() set; requests still need it
    setActiveShareToken(hash.shareToken);
    LocalData.pauseSave("cloud");
    this.api = api;
    this.scene = {
      id: scene.id,
      name: scene.name,
      role: hash.embed && scene.role !== "viewer" ? "viewer" : scene.role,
      teamId: scene.teamId,
      presentation: scene.presentation,
      shareToken: hash.shareToken,
      embed: hash.embed,
    };
    this.syncedVersions = new Map(
      scene.elements.map((element: ExcalidrawElement) => [
        element.id,
        element.version,
      ]),
    );
    this.uploadedFiles = new Set(Object.keys(scene.files ?? {}));
    this.syncedBackground =
      (scene.appState.viewBackgroundColor as string | undefined) ?? null;
    this.syncedName = scene.name;
    appJotaiStore.set(cloudSceneAtom, this.scene);
    appJotaiStore.set(cloudStatusAtom, { state: "saved", at: Date.now() });
    this.openEvents();
    this.loadComments();
  }

  /** Data for the editor's initial render. */
  toInitialData(scene: SceneDetail, localAppState: Partial<AppState> | null) {
    return {
      elements: restoreElements(scene.elements, null, { repairBindings: true }),
      appState: {
        ...restoreAppState(
          { ...scene.appState, name: scene.name },
          localAppState as AppState | null,
        ),
        isLoading: false,
      },
      files: Object.fromEntries(
        toBinaryFiles(scene.files).map((file) => [file.id, file]),
      ) as BinaryFiles,
      scrollToContent: true,
    };
  }

  stop({ resumeLocalSave = true } = {}) {
    if (this.scene && this.canEdit()) {
      this.flush.flush();
    }
    this.events?.close();
    this.events = null;
    this.scene = null;
    this.api = null;
    this.connectedOnce = false;
    setActiveShareToken(null);
    appJotaiStore.set(cloudSceneAtom, null);
    appJotaiStore.set(participantsAtom, []);
    appJotaiStore.set(connectionIdAtom, null);
    appJotaiStore.set(commentsAtom, []);
    appJotaiStore.set(cloudStatusAtom, { state: "idle" });
    if (resumeLocalSave) {
      LocalData.resumeSave("cloud");
    }
  }

  // local → server -------------------------------------------------------------

  onLocalChange(
    elements: readonly OrderedExcalidrawElement[],
    appState: AppState,
  ) {
    if (!this.scene || !this.canEdit()) {
      return;
    }
    const dirty =
      elements.some(
        (element) => this.syncedVersions.get(element.id) !== element.version,
      ) ||
      appState.viewBackgroundColor !== this.syncedBackground ||
      (appState.name && appState.name !== this.syncedName);
    if (dirty) {
      appJotaiStore.set(cloudStatusAtom, { state: "saving" });
      this.flush();
    }
  }

  private flush = debounce(() => {
    if (this.inFlight) {
      this.needsAnotherFlush = true;
      return;
    }
    this.inFlight = this.push().finally(() => {
      this.inFlight = null;
      if (this.needsAnotherFlush) {
        this.needsAnotherFlush = false;
        this.flush();
      }
    });
  }, 400);

  private async push() {
    const api = this.api;
    const scene = this.scene;
    if (!api || !scene) {
      return;
    }
    const elements = api.getSceneElementsIncludingDeleted();
    const changed = elements.filter(
      (element) => this.syncedVersions.get(element.id) !== element.version,
    );
    const allFiles = api.getFiles();
    const files: Record<string, PlusFile> = {};
    for (const element of elements) {
      if (
        element.type === "image" &&
        element.fileId &&
        !element.isDeleted &&
        !this.uploadedFiles.has(element.fileId) &&
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
    const appState = api.getAppState();
    const background = appState.viewBackgroundColor;
    const name = appState.name;

    try {
      if (
        changed.length ||
        Object.keys(files).length ||
        background !== this.syncedBackground
      ) {
        await plusAPI.syncScene(scene.id, {
          elements: changed,
          files,
          appState:
            background !== this.syncedBackground
              ? { viewBackgroundColor: background }
              : undefined,
          connectionId: appJotaiStore.get(connectionIdAtom),
        });
        for (const element of changed) {
          this.syncedVersions.set(element.id, element.version);
        }
        Object.keys(files).forEach((id) => this.uploadedFiles.add(id));
        this.syncedBackground = background;
      }
      if (name && name !== this.syncedName) {
        await plusAPI.updateScene(scene.id, { name });
        this.syncedName = name;
      }
      if (this.scene === scene) {
        appJotaiStore.set(cloudStatusAtom, { state: "saved", at: Date.now() });
      }
    } catch (error: any) {
      appJotaiStore.set(
        cloudStatusAtom,
        error instanceof PlusAPIError && error.status === 0
          ? { state: "offline" }
          : { state: "error", message: error.message },
      );
      // retry while offline; other failures wait for the next edit
      if (error instanceof PlusAPIError && error.status === 0) {
        setTimeout(() => this.scene === scene && this.flush(), 5000);
      }
    }
  }

  // server → local -------------------------------------------------------------

  private applyRemoteElements(remote: readonly ExcalidrawElement[]) {
    const api = this.api;
    if (!api || !remote.length) {
      return;
    }
    const existing = api.getSceneElementsIncludingDeleted();
    const restored = restoreElements(
      remote,
      existing,
    ) as RemoteExcalidrawElement[];
    const reconciled = reconcileElements(existing, restored, api.getAppState());
    const byId = new Map(reconciled.map((element) => [element.id, element]));
    // what the server sent is synced; don't echo it back
    for (const element of restored) {
      if (byId.get(element.id)?.version === element.version) {
        this.syncedVersions.set(element.id, element.version);
      }
    }
    api.updateScene({
      elements: reconciled,
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }

  private async fetchMissingFiles(fileIds: string[]) {
    const api = this.api;
    const scene = this.scene;
    if (!api || !scene) {
      return;
    }
    const known = api.getFiles();
    const missing = fileIds.filter((id) => !known[id]);
    if (!missing.length) {
      return;
    }
    const { files } = await plusAPI.getSceneFiles(scene.id, missing);
    missing.forEach((id) => this.uploadedFiles.add(id));
    api.addFiles(toBinaryFiles(files));
  }

  /** Catches up after a reconnect, when updates may have been missed. */
  private async resync() {
    const scene = this.scene;
    if (!scene) {
      return;
    }
    try {
      const { scene: fresh } = await plusAPI.getScene(scene.id);
      if (this.scene !== scene) {
        return;
      }
      this.applyRemoteElements(fresh.elements);
      this.api?.addFiles(toBinaryFiles(fresh.files));
      Object.keys(fresh.files ?? {}).forEach((id) =>
        this.uploadedFiles.add(id),
      );
      this.loadComments();
    } catch (error) {
      console.warn("Cloud resync failed", error);
    }
  }

  private openEvents() {
    const scene = this.scene!;
    const user = appJotaiStore.get(plusUserAtom);
    const events = new EventSource(
      plusAPI.eventsURL(scene.id, user ? null : "Guest"),
    );
    this.events = events;

    const on = (type: string, handler: (data: any) => void) =>
      events.addEventListener(type, (event) => {
        if (this.events !== events) {
          return;
        }
        try {
          handler(JSON.parse((event as MessageEvent).data));
        } catch (error) {
          console.error(`Bad "${type}" event`, error);
        }
      });

    on("hello", (data) => {
      appJotaiStore.set(connectionIdAtom, data.connectionId);
      if (this.connectedOnce) {
        this.resync();
      }
      this.connectedOnce = true;
      if (appJotaiStore.get(cloudStatusAtom).state === "offline") {
        appJotaiStore.set(cloudStatusAtom, { state: "saved", at: Date.now() });
      }
    });
    on("presence", (data: { participants: Participant[] }) => {
      appJotaiStore.set(participantsAtom, data.participants);
    });
    on("scene-update", (data) => {
      this.applyRemoteElements(data.elements);
      if (data.appState?.viewBackgroundColor) {
        this.syncedBackground = data.appState.viewBackgroundColor;
        this.api?.updateScene({
          appState: { viewBackgroundColor: data.appState.viewBackgroundColor },
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      }
      if (data.fileIds?.length) {
        this.fetchMissingFiles(data.fileIds);
      }
    });
    on("scene-meta", (data: { name: string; presentation: string[] }) => {
      if (!this.scene) {
        return;
      }
      this.scene = {
        ...this.scene,
        name: data.name,
        presentation: data.presentation,
      };
      this.syncedName = data.name;
      appJotaiStore.set(cloudSceneAtom, this.scene);
      if (this.api && this.api.getAppState().name !== data.name) {
        this.api.updateScene({
          appState: { name: data.name },
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      }
    });
    on("comment", (data) => {
      const comments = appJotaiStore.get(commentsAtom);
      if (data.action === "delete") {
        appJotaiStore.set(
          commentsAtom,
          comments.filter(
            (c) => c.id !== data.commentId && c.parentId !== data.commentId,
          ),
        );
      } else {
        const comment = data.comment as PlusComment;
        appJotaiStore.set(
          commentsAtom,
          comments.some((c) => c.id === comment.id)
            ? comments.map((c) => (c.id === comment.id ? comment : c))
            : [...comments, comment],
        );
      }
    });
    on("signal", (data: SignalMessage) => {
      this.signalListeners.forEach((listener) => listener(data));
    });
    on("scene-deleted", () => {
      appJotaiStore.set(cloudStatusAtom, {
        state: "error",
        message: "This scene was deleted",
      });
      events.close();
    });
    events.onerror = () => {
      if (this.events === events) {
        appJotaiStore.set(cloudStatusAtom, { state: "offline" });
      }
    };
  }

  // comments -------------------------------------------------------------------

  async loadComments() {
    const scene = this.scene;
    if (!scene) {
      return;
    }
    try {
      const { comments } = await plusAPI.listComments(scene.id);
      if (this.scene === scene) {
        appJotaiStore.set(commentsAtom, comments);
      }
    } catch (error) {
      console.warn("Couldn't load comments", error);
    }
  }

  // presentation ---------------------------------------------------------------

  async setPresentationOrder(frameIds: string[]) {
    if (!this.scene) {
      return;
    }
    this.scene = { ...this.scene, presentation: frameIds };
    appJotaiStore.set(cloudSceneAtom, this.scene);
    if (this.canEdit()) {
      await plusAPI.updateScene(this.scene.id, { presentation: frameIds });
    }
  }

  // signaling ------------------------------------------------------------------

  onSignal(listener: SignalListener) {
    this.signalListeners.add(listener);
    return () => {
      this.signalListeners.delete(listener);
    };
  }

  async signal(type: string, data?: unknown, to?: string) {
    const from = appJotaiStore.get(connectionIdAtom);
    if (!this.scene || !from) {
      throw new Error("Not connected to the scene");
    }
    await plusAPI.signal(this.scene.id, { from, to, type, data });
  }
}

export const cloudSession = new CloudSession();
