import {
  CaptureUpdateAction,
  reconcileElements,
  restoreAppState,
  restoreElements,
} from "@excalidraw/excalidraw";
import throttle from "lodash.throttle";

import type {
  ExcalidrawElement,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
  Collaborator,
  CollaboratorPointer,
  ExcalidrawImperativeAPI,
  SocketId,
} from "@excalidraw/excalidraw/types";

import { appJotaiStore } from "../app-jotai";
import { LocalData } from "../data/LocalData";

import { plusAPI, PlusAPIError, setActiveShareToken } from "./api";
import {
  cloudSceneAtom,
  cloudStatusAtom,
  commentsAtom,
  connectionIdAtom,
  mentionsUnreadAtom,
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

/** What each client broadcasts about its pointer and selection. */
type PointerPayload = {
  pointer: { x: number; y: number; tool: "pointer" | "laser" } | null;
  button: "up" | "down";
  selectedElementIds: AppState["selectedElementIds"];
};

/** Interval between pointer broadcasts. */
const POINTER_INTERVAL_MS = 40;
/**
 * Live edits go out at most this often (and immediately for the first change
 * of a gesture), so collaborators see a drag or a stroke as it happens.
 */
const SYNC_INTERVAL_MS = 50;
/** How quickly a remote cursor glides towards its latest position (per frame). */
const CURSOR_EASING = 0.35;
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
  /** Other people's cursors and selections, by connection id. */
  private collaborators = new Map<SocketId, Collaborator>();
  private lastPointer: PointerPayload = {
    pointer: null,
    button: "up",
    selectedElementIds: {},
  };
  private lastSelectionKey = "";
  /** Remote elements received but not yet applied (applied once per frame). */
  private pendingRemote = new Map<string, ExcalidrawElement>();
  private remoteFrame = 0;
  /** Where each remote cursor is heading; the drawn one eases towards it. */
  private cursorTargets = new Map<SocketId, { x: number; y: number }>();
  private cursorFrame = 0;
  private pointerInFlight = false;
  private pointerQueued = false;

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
    this.sendPointer.cancel();
    cancelAnimationFrame(this.remoteFrame);
    cancelAnimationFrame(this.cursorFrame);
    this.remoteFrame = this.cursorFrame = 0;
    this.pendingRemote.clear();
    this.cursorTargets.clear();
    this.pointerInFlight = this.pointerQueued = false;
    this.collaborators.clear();
    this.lastSelectionKey = "";
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
    if (!this.scene) {
      return;
    }
    // everyone, viewers included, shares what they have selected
    const selectionKey = Object.keys(appState.selectedElementIds)
      .filter((id) => appState.selectedElementIds[id])
      .sort()
      .join(",");
    if (selectionKey !== this.lastSelectionKey) {
      this.lastSelectionKey = selectionKey;
      this.lastPointer = {
        ...this.lastPointer,
        selectedElementIds: appState.selectedElementIds,
      };
      this.sendPointer();
    }
    if (!this.canEdit()) {
      return;
    }
    const dirty =
      elements.some(
        (element) => this.syncedVersions.get(element.id) !== element.version,
      ) ||
      appState.viewBackgroundColor !== this.syncedBackground ||
      (appState.name && appState.name !== this.syncedName);
    if (dirty) {
      if (appJotaiStore.get(cloudStatusAtom).state !== "saving") {
        appJotaiStore.set(cloudStatusAtom, { state: "saving" });
      }
      this.flush();
    }
  }

  // throttled rather than debounced: a debounce never fires while the user
  // keeps dragging or drawing, so others would only see the result afterwards
  private flush = throttle(
    () => this.runFlush(),
    SYNC_INTERVAL_MS,
    { leading: true, trailing: true },
  );

  private runFlush() {
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
  }

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

  /** Queues remote elements; a burst of updates is applied in one frame. */
  private applyRemoteElements(remote: readonly ExcalidrawElement[]) {
    if (!this.api || !remote.length) {
      return;
    }
    for (const element of remote) {
      const queued = this.pendingRemote.get(element.id);
      if (!queued || element.version >= queued.version) {
        this.pendingRemote.set(element.id, element);
      }
    }
    if (!this.remoteFrame) {
      this.remoteFrame = requestAnimationFrame(() => {
        this.remoteFrame = 0;
        const batch = [...this.pendingRemote.values()];
        this.pendingRemote.clear();
        this.applyRemoteElementsNow(batch);
      });
    }
  }

  private applyRemoteElementsNow(remote: readonly ExcalidrawElement[]) {
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
      this.syncCollaboratorsWithPresence(data.participants);
      // newcomers learn where everyone's pointer and selection are
      this.sendPointer();
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
        this.upsertComment(data.comment as PlusComment);
      }
    });
    on("signal", (data: SignalMessage) => {
      if (data.type === "pointer") {
        this.onRemotePointer(data.from, data.data);
        return;
      }
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

  // live pointers ----------------------------------------------------------------

  /** The editor's `onPointerUpdate`: shares where this user's pointer is. */
  onPointerUpdate = (payload: {
    pointer: { x: number; y: number; tool: "pointer" | "laser" };
    button: "down" | "up";
    pointersMap: Map<number, unknown>;
  }) => {
    // multi-touch gestures (pinch zoom) aren't a pointer
    if (!this.scene || payload.pointersMap.size > 1) {
      return;
    }
    this.lastPointer = {
      ...this.lastPointer,
      pointer: payload.pointer,
      button: payload.button,
    };
    this.sendPointer();
  };

  private sendPointer = throttle(
    () => {
      if (!this.scene || !appJotaiStore.get(connectionIdAtom)) {
        return;
      }
      // never stack requests: only the freshest pointer matters, so while one
      // is on the wire remember that another is due and send it afterwards
      if (this.pointerInFlight) {
        this.pointerQueued = true;
        return;
      }
      this.pointerInFlight = true;
      this.signal("pointer", this.lastPointer)
        .catch(() => {
          // pointers are best-effort; the next move sends a fresh one
        })
        .finally(() => {
          this.pointerInFlight = false;
          if (this.pointerQueued) {
            this.pointerQueued = false;
            this.sendPointer();
          }
        });
    },
    POINTER_INTERVAL_MS,
    { leading: true, trailing: true },
  );

  private renderCollaborators() {
    this.api?.updateScene({ collaborators: new Map(this.collaborators) });
  }

  private onRemotePointer(from: string, data: PointerPayload) {
    const participant = appJotaiStore
      .get(participantsAtom)
      .find((p) => p.connectionId === from);
    const id = from as SocketId;
    const previous = this.collaborators.get(id)?.pointer;
    // glide from where the cursor is drawn now, instead of jumping
    const pointer: CollaboratorPointer | undefined = data?.pointer
      ? {
          x: previous?.x ?? data.pointer.x,
          y: previous?.y ?? data.pointer.y,
          tool: data.pointer.tool === "laser" ? "laser" : "pointer",
        }
      : undefined;
    if (data?.pointer) {
      this.cursorTargets.set(id, { x: data.pointer.x, y: data.pointer.y });
    } else {
      this.cursorTargets.delete(id);
    }
    this.collaborators.set(id, {
      ...this.collaborators.get(id),
      id: participant?.userId ?? from,
      socketId: id,
      username: participant?.name ?? "Guest",
      pointer,
      button: data?.button === "down" ? "down" : "up",
      selectedElementIds: data?.selectedElementIds ?? {},
      isInCall: participant?.inHangout,
    });
    this.renderCollaborators();
    this.animateCursors();
  }

  /** Eases every remote cursor towards its latest reported position. */
  private animateCursors() {
    if (this.cursorFrame) {
      return;
    }
    const step = () => {
      this.cursorFrame = 0;
      let moving = false;
      for (const [id, target] of this.cursorTargets) {
        const collaborator = this.collaborators.get(id);
        const pointer = collaborator?.pointer;
        if (!collaborator || !pointer) {
          this.cursorTargets.delete(id);
          continue;
        }
        const dx = target.x - pointer.x;
        const dy = target.y - pointer.y;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
          if (dx || dy) {
            this.collaborators.set(id, {
              ...collaborator,
              pointer: { ...pointer, x: target.x, y: target.y },
            });
            moving = true;
          }
          continue;
        }
        this.collaborators.set(id, {
          ...collaborator,
          pointer: {
            ...pointer,
            x: pointer.x + dx * CURSOR_EASING,
            y: pointer.y + dy * CURSOR_EASING,
          },
        });
        moving = true;
      }
      if (moving && this.api) {
        this.renderCollaborators();
        this.cursorFrame = requestAnimationFrame(step);
      }
    };
    this.cursorFrame = requestAnimationFrame(step);
  }

  /** Drops the cursors of people who left, refreshes names and call state. */
  private syncCollaboratorsWithPresence(participants: Participant[]) {
    const byId = new Map(participants.map((p) => [p.connectionId, p]));
    let changed = false;
    for (const [id, collaborator] of this.collaborators) {
      const participant = byId.get(id);
      if (!participant) {
        this.collaborators.delete(id);
        this.cursorTargets.delete(id);
        changed = true;
      } else if (
        collaborator.username !== participant.name ||
        collaborator.isInCall !== participant.inHangout
      ) {
        this.collaborators.set(id, {
          ...collaborator,
          username: participant.name,
          isInCall: participant.inHangout,
        });
        changed = true;
      }
    }
    if (changed) {
      this.renderCollaborators();
    }
  }

  // comments -------------------------------------------------------------------

  /** Adds or replaces a comment; tells the user when it mentions them. */
  upsertComment(comment: PlusComment) {
    const comments = appJotaiStore.get(commentsAtom);
    const isNew = !comments.some((c) => c.id === comment.id);
    appJotaiStore.set(
      commentsAtom,
      isNew
        ? [...comments, comment]
        : comments.map((c) => (c.id === comment.id ? comment : c)),
    );
    const me = appJotaiStore.get(plusUserAtom);
    if (
      isNew &&
      me &&
      comment.author.id !== me.id &&
      comment.mentions?.some((mention) => mention.userId === me.id)
    ) {
      appJotaiStore.set(
        mentionsUnreadAtom,
        appJotaiStore.get(mentionsUnreadAtom) + 1,
      );
      this.api?.setToast({
        message: `${comment.author.name} mentioned you: “${
          comment.body.length > 80
            ? `${comment.body.slice(0, 80)}…`
            : comment.body
        }”`,
        duration: 8000,
        closable: true,
      });
    }
  }

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
