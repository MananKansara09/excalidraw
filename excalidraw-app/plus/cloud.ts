import {
  CaptureUpdateAction,
  reconcileElements,
  restoreAppState,
  restoreElements,
  zoomToFitBounds,
} from "@excalidraw/excalidraw";
import { getCollaboratorActivityLabel } from "@excalidraw/excalidraw/clients";
import { throttleRAF } from "@excalidraw/common";
import { getVisibleSceneBounds } from "@excalidraw/element";
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
  CollaboratorActivity,
  CollaboratorPointer,
  ExcalidrawImperativeAPI,
  SocketId,
  UserToFollow,
} from "@excalidraw/excalidraw/types";

import { appJotaiStore } from "../app-jotai";
import { LocalData } from "../data/LocalData";

import { plusAPI, PlusAPIError, setActiveShareToken } from "./api";
import {
  cloudCollaboratorsAtom,
  cloudFollowedActivityAtom,
  cloudSceneAtom,
  cloudStatusAtom,
  cloudUserToFollowAtom,
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

/** What each client broadcasts about its pointer, selection and activity. */
type PointerPayload = {
  pointer: { x: number; y: number; tool: "pointer" | "laser" } | null;
  button: "up" | "down";
  selectedElementIds: AppState["selectedElementIds"];
  activity?: CollaboratorActivity;
};

/** Interval between pointer broadcasts. */
const POINTER_INTERVAL_MS = 40;
/**
 * Live edits go out at most this often (and immediately for the first change
 * of a gesture), so collaborators see a drag or a stroke as it happens.
 */
const SYNC_INTERVAL_MS = 50;
/** Backoff between WebSocket reconnect attempts. */
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8000;
/** Ping the server this often; no reply for this long means the link is dead. */
const KEEPALIVE_MS = 20_000;
const DEAD_AFTER_MS = 50_000;
/** Give up on an unacknowledged edit (it is then re-sent over HTTP). */
const ACK_TIMEOUT_MS = 15_000;
/** Initial connection failures before falling back to SSE + HTTP. */
const SOCKET_FALLBACK_AFTER = 2;
/** Skip best-effort pointer frames while this much is still unsent. */
const POINTER_BACKPRESSURE_BYTES = 64 * 1024;
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
  /** SSE stream: only used when WebSockets can't connect. */
  private events: EventSource | null = null;
  private socket: WebSocket | null = null;
  private socketReady = false;
  private socketAttempts = 0;
  private everOpened = false;
  private reconnectTimer = 0;
  private keepAliveTimer = 0;
  private lastServerMessage = 0;
  private syncSeq = 0;
  private pendingAcks = new Map<
    string,
    {
      resolve: (value: { version: number; accepted: number }) => void;
      reject: (error: Error) => void;
      timer: number;
    }
  >();
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
  /** Connection ids currently following this user's screen navigation. */
  private followers = new Set<string>();
  private followTarget: UserToFollow | null = null;
  private unsubScroll: (() => void) | null = null;
  private prevViewportSize: { width: number; height: number } | null = null;
  private lastActivityKey = "";

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
    const appState = api.getAppState();
    this.prevViewportSize = {
      width: appState.width,
      height: appState.height,
    };
    this.unsubScroll = api.onScrollChange(() => this.relayViewport());
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
    this.closeTransport();
    this.scene = null;
    this.api = null;
    this.connectedOnce = false;
    setActiveShareToken(null);
    appJotaiStore.set(cloudSceneAtom, null);
    appJotaiStore.set(participantsAtom, []);
    appJotaiStore.set(connectionIdAtom, null);
    this.sendPointer.cancel();
    this.relayViewport.cancel();
    this.unsubScroll?.();
    this.unsubScroll = null;
    this.followers.clear();
    this.followTarget = null;
    this.prevViewportSize = null;
    this.lastActivityKey = "";
    appJotaiStore.set(cloudUserToFollowAtom, null);
    appJotaiStore.set(cloudFollowedActivityAtom, null);
    appJotaiStore.set(cloudCollaboratorsAtom, new Map());
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
    // everyone, viewers included, shares what they have selected & what they are doing
    const selectionKey = Object.keys(appState.selectedElementIds)
      .filter((id) => appState.selectedElementIds[id])
      .sort()
      .join(",");
    const activity = this.getActivityFromAppState(appState);
    const activityKey = `${
      activity.tool ?? ""
    }|${!!activity.isEditingText}|${!!activity.isDrawing}|${!!activity.isPanning}`;
    if (
      selectionKey !== this.lastSelectionKey ||
      activityKey !== this.lastActivityKey
    ) {
      this.lastSelectionKey = selectionKey;
      this.lastActivityKey = activityKey;
      this.lastPointer = {
        ...this.lastPointer,
        selectedElementIds: appState.selectedElementIds,
        activity,
      };
      this.sendPointer();
    }
    if (
      this.prevViewportSize &&
      (appState.width !== this.prevViewportSize.width ||
        appState.height !== this.prevViewportSize.height)
    ) {
      this.prevViewportSize = {
        width: appState.width,
        height: appState.height,
      };
      this.relayViewport();
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
  private flush = throttle(() => this.runFlush(), SYNC_INTERVAL_MS, {
    leading: true,
    trailing: true,
  });

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
        await this.syncRemote(scene.id, {
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

  /** Server → client events, whichever transport delivered them. */
  private handleEvent(type: string, data: any) {
    switch (type) {
      case "hello": {
        appJotaiStore.set(connectionIdAtom, data.connectionId);
        if (this.connectedOnce) {
          this.resync();
        }
        this.connectedOnce = true;
        if (appJotaiStore.get(cloudStatusAtom).state === "offline") {
          appJotaiStore.set(cloudStatusAtom, {
            state: "saved",
            at: Date.now(),
          });
        }
        // edits made while disconnected go out now
        if (this.canEdit()) {
          this.flush();
        }
        break;
      }
      case "presence": {
        const { participants } = data as { participants: Participant[] };
        appJotaiStore.set(participantsAtom, participants);
        this.syncCollaboratorsWithPresence(participants);
        // newcomers learn where everyone's pointer and selection are
        this.sendPointer();
        break;
      }
      case "scene-update": {
        this.applyRemoteElements(data.elements);
        if (data.appState?.viewBackgroundColor) {
          this.syncedBackground = data.appState.viewBackgroundColor;
          this.api?.updateScene({
            appState: {
              viewBackgroundColor: data.appState.viewBackgroundColor,
            },
            captureUpdate: CaptureUpdateAction.NEVER,
          });
        }
        if (data.fileIds?.length) {
          this.fetchMissingFiles(data.fileIds);
        }
        break;
      }
      case "scene-meta": {
        if (!this.scene) {
          return;
        }
        const meta = data as { name: string; presentation: string[] };
        this.scene = {
          ...this.scene,
          name: meta.name,
          presentation: meta.presentation,
        };
        this.syncedName = meta.name;
        appJotaiStore.set(cloudSceneAtom, this.scene);
        if (this.api && this.api.getAppState().name !== meta.name) {
          this.api.updateScene({
            appState: { name: meta.name },
            captureUpdate: CaptureUpdateAction.NEVER,
          });
        }
        break;
      }
      case "comment": {
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
        break;
      }
      case "signal": {
        const message = data as SignalMessage;
        if (message.type === "pointer") {
          this.onRemotePointer(message.from, message.data);
          return;
        }
        if (message.type === "follow-start") {
          this.followers.add(message.from);
          this.sendViewportTo(message.from);
          return;
        }
        if (message.type === "follow-stop") {
          this.followers.delete(message.from);
          return;
        }
        if (message.type === "viewport") {
          this.onRemoteViewport(message.from, message.data);
          return;
        }
        this.signalListeners.forEach((listener) => listener(message));
        break;
      }
      case "scene-deleted": {
        appJotaiStore.set(cloudStatusAtom, {
          state: "error",
          message: "This scene was deleted",
        });
        this.closeTransport();
        break;
      }
      case "sync-ack": {
        const pending = this.pendingAcks.get(data.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingAcks.delete(data.id);
          pending.resolve({ version: data.version, accepted: data.accepted });
        }
        break;
      }
      case "sync-error": {
        const pending = this.pendingAcks.get(data.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingAcks.delete(data.id);
          pending.reject(new PlusAPIError(data.status ?? 500, data.message));
        }
        break;
      }
      default:
        break;
    }
  }

  private closeTransport() {
    this.events?.close();
    this.events = null;
    const socket = this.socket;
    this.socket = null;
    this.socketReady = false;
    this.socketAttempts = 0;
    this.everOpened = false;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.keepAliveTimer);
    this.reconnectTimer = this.keepAliveTimer = 0;
    this.failPendingAcks();
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      socket.close();
    }
  }

  private failPendingAcks() {
    for (const pending of this.pendingAcks.values()) {
      clearTimeout(pending.timer);
      pending.reject(new PlusAPIError(0, "Connection lost"));
    }
    this.pendingAcks.clear();
  }

  private openEvents() {
    if (typeof WebSocket === "undefined") {
      this.openEventSource();
      return;
    }
    this.openSocket();
  }

  /** The realtime WebSocket: reconnects with backoff until the scene closes. */
  private openSocket() {
    const scene = this.scene;
    if (!scene) {
      return;
    }
    const user = appJotaiStore.get(plusUserAtom);
    let socket: WebSocket;
    try {
      socket = new WebSocket(
        plusAPI.socketURL(scene.id, user ? null : "Guest"),
      );
    } catch {
      this.openEventSource();
      return;
    }
    this.socket = socket;
    this.socketReady = false;
    const current = () => this.socket === socket && this.scene === scene;

    socket.onopen = () => {
      if (!current()) {
        return;
      }
      this.everOpened = true;
      this.socketAttempts = 0;
      this.lastServerMessage = Date.now();
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = window.setInterval(() => {
        if (!current()) {
          return;
        }
        if (Date.now() - this.lastServerMessage > DEAD_AFTER_MS) {
          // silent drop: close so we reconnect and resync
          socket.close();
          return;
        }
        socket.send(JSON.stringify({ type: "ping", t: Date.now() }));
      }, KEEPALIVE_MS);
    };
    socket.onmessage = (message) => {
      if (!current()) {
        return;
      }
      this.lastServerMessage = Date.now();
      try {
        const { event, data } = JSON.parse(String(message.data));
        if (event === "hello") {
          this.socketReady = true;
        }
        this.handleEvent(event, data);
      } catch (error) {
        console.error("Bad realtime message", error);
      }
    };
    socket.onclose = () => {
      if (!current()) {
        return;
      }
      this.socket = null;
      this.socketReady = false;
      clearInterval(this.keepAliveTimer);
      this.failPendingAcks();
      if (!this.everOpened && ++this.socketAttempts >= SOCKET_FALLBACK_AFTER) {
        // sockets are blocked here (proxy, firewall): use SSE + HTTP instead
        this.openEventSource();
        return;
      }
      appJotaiStore.set(cloudStatusAtom, { state: "offline" });
      const delay = Math.min(
        RECONNECT_BASE_MS * 2 ** Math.min(this.socketAttempts, 5),
        RECONNECT_MAX_MS,
      );
      this.socketAttempts++;
      this.reconnectTimer = window.setTimeout(() => {
        if (this.scene === scene) {
          this.openSocket();
        }
      }, delay);
    };
    socket.onerror = () => {
      // followed by `close`, which handles reconnecting
    };
  }

  /** Fallback transport: SSE for events, HTTP for everything the client sends. */
  private openEventSource() {
    const scene = this.scene;
    if (!scene) {
      return;
    }
    const user = appJotaiStore.get(plusUserAtom);
    const events = new EventSource(
      plusAPI.eventsURL(scene.id, user ? null : "Guest"),
    );
    this.events = events;
    for (const type of [
      "hello",
      "presence",
      "scene-update",
      "scene-meta",
      "comment",
      "signal",
      "scene-deleted",
    ]) {
      events.addEventListener(type, (event) => {
        if (this.events !== events) {
          return;
        }
        try {
          this.handleEvent(type, JSON.parse((event as MessageEvent).data));
        } catch (error) {
          console.error(`Bad "${type}" event`, error);
        }
      });
    }
    events.onerror = () => {
      if (this.events === events) {
        appJotaiStore.set(cloudStatusAtom, { state: "offline" });
      }
    };
  }

  private get socketOpen() {
    return (
      !!this.socket &&
      this.socketReady &&
      this.socket.readyState === WebSocket.OPEN
    );
  }

  /** Pushes edits over the socket (acknowledged), or HTTP if it's down. */
  private async syncRemote(
    sceneId: string,
    body: Parameters<typeof plusAPI.syncScene>[1],
  ) {
    const socket = this.socket;
    if (socket && this.socketOpen) {
      try {
        return await new Promise<{ version: number; accepted: number }>(
          (resolve, reject) => {
            const id = String(++this.syncSeq);
            const timer = window.setTimeout(() => {
              this.pendingAcks.delete(id);
              reject(new PlusAPIError(0, "Save timed out"));
            }, ACK_TIMEOUT_MS);
            this.pendingAcks.set(id, { resolve, reject, timer });
            const { elements, appState, files } = body;
            socket.send(
              JSON.stringify({ type: "sync", id, elements, appState, files }),
            );
          },
        );
      } catch (error) {
        // the server answered (e.g. view-only): that's final. Transport
        // trouble falls through to HTTP; merging is idempotent.
        if (!(error instanceof PlusAPIError) || error.status !== 0) {
          throw error;
        }
      }
    }
    return plusAPI.syncScene(sceneId, body);
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
      activity: this.api
        ? this.getActivityFromAppState(this.api.getAppState())
        : undefined,
    };
    this.sendPointer();
  };

  setUserToFollow = (userToFollow: UserToFollow | null) => {
    const prev = this.followTarget;
    if (prev?.socketId === userToFollow?.socketId) {
      return;
    }
    if (prev) {
      this.signal("follow-stop", {}, prev.socketId).catch(() => {});
    }
    this.followTarget = userToFollow;
    appJotaiStore.set(cloudUserToFollowAtom, userToFollow);
    this.syncFollowedActivity();
    if (userToFollow && this.scene && appJotaiStore.get(connectionIdAtom)) {
      this.signal("follow-start", {}, userToFollow.socketId).catch(() => {});
    }
  };

  private getActivityFromAppState(
    appState: Pick<
      AppState,
      | "activeTool"
      | "editingTextElement"
      | "newElement"
      | "selectedLinearElement"
      | "selectedElementsAreBeingDragged"
    >,
  ): CollaboratorActivity {
    return {
      tool: appState.activeTool.type,
      isEditingText: !!appState.editingTextElement,
      isDrawing:
        !!appState.newElement ||
        !!appState.selectedLinearElement?.isEditing ||
        appState.selectedElementsAreBeingDragged,
      isPanning: appState.activeTool.type === "hand",
    };
  }

  private relayViewport = throttleRAF(() => {
    if (!this.api || !this.scene || this.followers.size === 0) {
      return;
    }
    const sceneBounds = getVisibleSceneBounds(this.api.getAppState());
    for (const followerId of this.followers) {
      this.signal("viewport", { sceneBounds }, followerId).catch(() => {});
    }
  });

  private sendViewportTo(followerId: string) {
    if (!this.api || !this.scene) {
      return;
    }
    const sceneBounds = getVisibleSceneBounds(this.api.getAppState());
    this.signal("viewport", { sceneBounds }, followerId).catch(() => {});
  }

  private onRemoteViewport(
    from: string,
    data: { sceneBounds?: ReturnType<typeof getVisibleSceneBounds> },
  ) {
    if (
      !this.api ||
      !data?.sceneBounds ||
      this.followTarget?.socketId !== from ||
      this.followers.has(from)
    ) {
      return;
    }
    const fitted = zoomToFitBounds({
      appState: this.api.getAppState(),
      bounds: data.sceneBounds,
      fit: "contain",
    });
    this.api.updateScene({
      appState: {
        scrollX: fitted.appState.scrollX,
        scrollY: fitted.appState.scrollY,
        zoom: fitted.appState.zoom,
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }

  private syncFollowedActivity() {
    if (!this.followTarget) {
      appJotaiStore.set(cloudFollowedActivityAtom, null);
      return;
    }
    const collaborator = this.collaborators.get(this.followTarget.socketId);
    appJotaiStore.set(
      cloudFollowedActivityAtom,
      collaborator
        ? getCollaboratorActivityLabel(collaborator)
        : "Viewing canvas",
    );
  }

  private sendPointer = throttle(
    () => {
      if (!this.scene || !appJotaiStore.get(connectionIdAtom)) {
        return;
      }
      if (
        this.socket &&
        this.socket.bufferedAmount > POINTER_BACKPRESSURE_BYTES
      ) {
        return; // a bulky edit is still uploading; the next move retries
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
    const next = new Map(this.collaborators);
    appJotaiStore.set(cloudCollaboratorsAtom, next);
    this.syncFollowedActivity();
    this.api?.updateScene({ collaborators: next });
  }

  private onRemotePointer(from: string, data: PointerPayload) {
    const participant = appJotaiStore
      .get(participantsAtom)
      .find((p) => p.connectionId === from);
    const id = from as SocketId;
    const existing = this.collaborators.get(id);
    const previous = existing?.pointer;
    // glide from where the cursor is drawn now, instead of jumping
    const pointer: CollaboratorPointer | undefined = data?.pointer
      ? {
          x: previous?.x ?? data.pointer.x,
          y: previous?.y ?? data.pointer.y,
          tool: data.pointer.tool === "laser" ? "laser" : "pointer",
        }
      : existing?.pointer;
    if (data?.pointer) {
      this.cursorTargets.set(id, { x: data.pointer.x, y: data.pointer.y });
    }
    const incomingActivity = data?.activity;
    const prevActivity = existing?.activity;
    const activity =
      incomingActivity &&
      prevActivity &&
      prevActivity.tool === incomingActivity.tool &&
      prevActivity.isEditingText === incomingActivity.isEditingText &&
      prevActivity.isDrawing === incomingActivity.isDrawing &&
      prevActivity.isPanning === incomingActivity.isPanning
        ? prevActivity
        : incomingActivity ?? prevActivity;
    this.collaborators.set(id, {
      ...existing,
      id: participant?.userId ?? from,
      socketId: id,
      username: participant?.name ?? "Guest",
      avatarUrl: participant?.avatarUrl ?? undefined,
      pointer,
      button: data?.button === "down" ? "down" : "up",
      selectedElementIds: data?.selectedElementIds ?? {},
      activity,
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

  /** Drops the cursors of people who left, refreshes names, avatars and call state. */
  private syncCollaboratorsWithPresence(participants: Participant[]) {
    const byId = new Map(participants.map((p) => [p.connectionId, p]));
    const myConnectionId = appJotaiStore.get(connectionIdAtom);
    const me = appJotaiStore.get(plusUserAtom);
    for (const followerId of [...this.followers]) {
      if (!byId.has(followerId)) {
        this.followers.delete(followerId);
      }
    }
    if (this.followTarget && !byId.has(this.followTarget.socketId)) {
      this.setUserToFollow(null);
    }
    let changed = false;
    for (const [id, collaborator] of this.collaborators) {
      const participant = byId.get(id);
      if (!participant) {
        this.collaborators.delete(id);
        this.cursorTargets.delete(id);
        changed = true;
      } else {
        const nextAvatarUrl = participant.avatarUrl ?? undefined;
        if (
          collaborator.username !== participant.name ||
          collaborator.avatarUrl !== nextAvatarUrl ||
          collaborator.isInCall !== participant.inHangout
        ) {
          this.collaborators.set(id, {
            ...collaborator,
            username: participant.name,
            avatarUrl: nextAvatarUrl,
            isInCall: participant.inHangout,
          });
          changed = true;
        }
      }
    }
    for (const participant of participants) {
      if (
        participant.connectionId === myConnectionId ||
        (me && participant.userId === me.id)
      ) {
        continue;
      }
      const id = participant.connectionId as SocketId;
      if (!this.collaborators.has(id)) {
        this.collaborators.set(id, {
          id: participant.userId ?? participant.connectionId,
          socketId: id,
          username: participant.name,
          avatarUrl: participant.avatarUrl ?? undefined,
          selectedElementIds: {},
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
    if (this.socket && this.socketOpen) {
      this.socket.send(
        JSON.stringify({ type: "signal", signal: type, to, data }),
      );
      return;
    }
    await plusAPI.signal(this.scene.id, { from, to, type, data });
  }
}

export const cloudSession = new CloudSession();
