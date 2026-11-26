import {
  Excalidraw,
  LiveCollaborationTrigger,
  TTDDialogTrigger,
  CaptureUpdateAction,
  reconcileElements,
  useEditorInterface,
  ExcalidrawAPIProvider,
  useExcalidrawAPI,
} from "@excalidraw/excalidraw";
import { trackEvent } from "@excalidraw/excalidraw/analytics";
import { getDefaultAppState } from "@excalidraw/excalidraw/appState";
import {
  CommandPalette,
  DEFAULT_CATEGORIES,
} from "@excalidraw/excalidraw/components/CommandPalette/CommandPalette";
import { ErrorDialog } from "@excalidraw/excalidraw/components/ErrorDialog";
import { OverwriteConfirmDialog } from "@excalidraw/excalidraw/components/OverwriteConfirm/OverwriteConfirm";
import { openConfirmModal } from "@excalidraw/excalidraw/components/OverwriteConfirm/OverwriteConfirmState";
import { ShareableLinkDialog } from "@excalidraw/excalidraw/components/ShareableLinkDialog";
import Trans from "@excalidraw/excalidraw/components/Trans";
import {
  APP_NAME,
  EVENT,
  VERSION_TIMEOUT,
  debounce,
  getVersion,
  getFrame,
  isTestEnv,
  preventUnload,
  resolvablePromise,
  isRunningInIframe,
  isDevEnv,
} from "@excalidraw/common";
import polyfill from "@excalidraw/excalidraw/polyfill";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadFromBlob } from "@excalidraw/excalidraw/data/blob";
import { t } from "@excalidraw/excalidraw/i18n";

import {
  ExcalLogo,
  eyeIcon,
  usersIcon,
  exportToPlus,
  share,
  youtubeIcon,
} from "@excalidraw/excalidraw/components/icons";
import { isElementLink } from "@excalidraw/element";
import {
  bumpElementVersions,
  restoreAppState,
  restoreElements,
} from "@excalidraw/excalidraw/data/restore";
import { newElementWith } from "@excalidraw/element";
import { isInitializedImageElement } from "@excalidraw/element";
import clsx from "clsx";
import {
  parseLibraryTokensFromUrl,
  useHandleLibrary,
} from "@excalidraw/excalidraw/data/library";

import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type { RestoredDataState } from "@excalidraw/excalidraw/data/restore";
import type {
  FileId,
  NonDeletedExcalidrawElement,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";
import type {
  AppState,
  ExcalidrawImperativeAPI,
  BinaryFiles,
  ExcalidrawInitialDataState,
  UIAppState,
  ExcalidrawProps,
} from "@excalidraw/excalidraw/types";
import type { ResolutionType } from "@excalidraw/common/utility-types";
import type { ResolvablePromise } from "@excalidraw/common/utils";

import CustomStats from "./CustomStats";
import {
  Provider,
  useAtom,
  useAtomValue,
  useAtomWithInitialValue,
  useSetAtom,
  appJotaiStore,
} from "./app-jotai";
import {
  FIREBASE_STORAGE_PREFIXES,
  STORAGE_KEYS,
  SYNC_BROWSER_TABS_TIMEOUT,
} from "./app_constants";
import { APP_ROUTES } from "./app_routes";
import Collab, {
  collabAPIAtom,
  followedUserActivityAtom,
  isCollaboratingAtom,
  isOfflineAtom,
  userToFollowAtom,
} from "./collab/Collab";
import { AppFooter } from "./components/AppFooter";
import { AppMainMenu } from "./components/AppMainMenu";
import { AppWelcomeScreen } from "./components/AppWelcomeScreen";
import {
  ExportToExcalidrawPlus,
  exportToExcalidrawPlus,
} from "./components/ExportToExcalidrawPlus";
import { TopErrorBoundary } from "./components/TopErrorBoundary";

import {
  exportToBackend,
  getCollaborationLinkData,
  importFromBackend,
  isCollaborationLink,
} from "./data";

import { updateStaleImageStatuses } from "./data/FileManager";
import { FileStatusStore } from "./data/fileStatusStore";
import {
  importFromLocalStorage,
  importUsernameFromLocalStorage,
} from "./data/localStorage";

import { loadFilesFromFirebase } from "./data/firebase";
import {
  LibraryIndexedDBAdapter,
  LibraryLocalStorageMigrationAdapter,
  LocalData,
  localStorageQuotaExceededAtom,
} from "./data/LocalData";
import { isBrowserStorageStateNewer } from "./data/tabSync";
import { ShareDialog, shareDialogStateAtom } from "./share/ShareDialog";
import CollabError, { collabErrorIndicatorAtom } from "./collab/CollabError";
import { useHandleAppTheme } from "./useHandleAppTheme";
import { getPreferredLanguage } from "./app-language/language-detector";
import { useAppLangCode } from "./app-language/language-state";
import DebugCanvas, {
  debugRenderer,
  isVisualDebuggerEnabled,
  loadSavedDebugState,
} from "./components/DebugCanvas";
import { useSimulatedCollaborators } from "./debugCollaborators";
import { AIComponents } from "./components/AI";
import { ExcalidrawPlusIframeExport } from "./ExcalidrawPlusIframeExport";

import "./index.scss";

import { AppSidebar } from "./components/AppSidebar";
import { plusAPI } from "./plus/api";
import { goToSignIn } from "./plus/auth";
import { cloudSession, parseCloudHash } from "./plus/cloud";
import { DashboardPage } from "./plus/dashboard/DashboardPage";
import { SignInPage } from "./plus/SignInPage";
import { PlusRoot, usePlusSession } from "./plus/components/PlusRoot";
import { PlusTopRight } from "./plus/components/PlusTopRight";
import { openCloudScene } from "./plus/scenes";
import { hangout } from "./plus/hangout";
import {
  activeCommentIdAtom,
  cloudFollowedActivityAtom,
  cloudSceneAtom,
  cloudUserToFollowAtom,
  pendingCommentFocusAtom,
  plusDialogAtom,
  plusUserAtom,
  presentationAtom,
} from "./plus/state";
import "./plus/plus.scss";
import {
  notificationCenterOpenAtom,
  notificationEngine,
  type AppNotification,
} from "./notifications";
import { CanvasMentionAutocomplete } from "./notifications/components/CanvasMentionAutocomplete";
import { NotificationBell } from "./notifications/components/NotificationBell";
import { NotificationToastStack } from "./notifications/components/NotificationToast";

import type { CollabAPI } from "./collab/Collab";

polyfill();

window.EXCALIDRAW_THROTTLE_RENDER = true;

declare global {
  interface BeforeInstallPromptEventChoiceResult {
    outcome: "accepted" | "dismissed";
  }

  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<BeforeInstallPromptEventChoiceResult>;
  }

  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

let pwaEvent: BeforeInstallPromptEvent | null = null;

// Adding a listener outside of the component as it may (?) need to be
// subscribed early to catch the event.
//
// Also note that it will fire only if certain heuristics are met (user has
// used the app for some time, etc.)
window.addEventListener(
  "beforeinstallprompt",
  (event: BeforeInstallPromptEvent) => {
    // prevent Chrome <= 67 from automatically showing the prompt
    event.preventDefault();
    // cache for later use
    pwaEvent = event;
  },
);

let isSelfEmbedding = false;

if (window.self !== window.top) {
  try {
    const parentUrl = new URL(document.referrer);
    const currentUrl = new URL(window.location.href);
    if (parentUrl.origin === currentUrl.origin) {
      isSelfEmbedding = true;
    }
  } catch (error) {
    // ignore
  }
}

const shareableLinkConfirmDialog = {
  title: t("overwriteConfirm.modal.shareableLink.title"),
  description: (
    <Trans
      i18nKey="overwriteConfirm.modal.shareableLink.description"
      bold={(text) => <strong>{text}</strong>}
      br={() => <br />}
    />
  ),
  actionLabel: t("overwriteConfirm.modal.shareableLink.button"),
  color: "danger",
} as const;

const initializeScene = async (opts: {
  collabAPI: CollabAPI | null;
  excalidrawAPI: ExcalidrawImperativeAPI;
}): Promise<
  { scene: ExcalidrawInitialDataState | null } & (
    | { isExternalScene: true; id: string; key: string }
    | { isExternalScene: false; id?: null; key?: null }
  )
> => {
  const searchParams = new URLSearchParams(window.location.search);
  const id = searchParams.get("id");
  const jsonBackendMatch = window.location.hash.match(
    /^#json=([a-zA-Z0-9_-]+),([a-zA-Z0-9_-]+)$/,
  );
  const externalUrlMatch = window.location.hash.match(/^#url=(.*)$/);

  const localDataState = importFromLocalStorage();

  // Excalidraw Plus cloud scene (#cloud=<id> or #share=<token>)
  const cloudHash = parseCloudHash();
  if (cloudHash) {
    try {
      const cloudScene = await cloudSession.load(cloudHash);
      cloudSession.start(opts.excalidrawAPI, cloudScene, cloudHash);
      notificationEngine.seedCanvasElements(cloudScene.elements);
      return {
        scene: cloudSession.toInitialData(cloudScene, localDataState?.appState),
        isExternalScene: false,
      };
    } catch (error: any) {
      cloudSession.stop();
      if (error?.status === 401 && cloudHash.sceneId) {
        // private scene: sign in, then come back to it
        goToSignIn("signin", "scene");
      } else {
        window.history.replaceState({}, APP_NAME, window.location.origin);
      }
      return {
        scene: {
          elements: restoreElements(localDataState?.elements, null, {
            repairBindings: true,
            deleteInvisibleElements: true,
          }),
          appState: {
            ...restoreAppState(localDataState?.appState, null),
            errorMessage:
              error?.status === 401
                ? null
                : `Couldn't open the cloud scene: ${error?.message}`,
          },
        },
        isExternalScene: false,
      };
    }
  } else if (cloudSession.isActive()) {
    // navigated back to the local canvas
    cloudSession.stop();
  }

  let scene: Omit<
    RestoredDataState,
    // we're not storing files in the scene database/localStorage, and instead
    // fetch them async from a different store
    "files"
  > & {
    scrollToContent?: boolean;
  } = {
    elements: restoreElements(localDataState?.elements, null, {
      repairBindings: true,
      deleteInvisibleElements: true,
    }),
    appState: restoreAppState(localDataState?.appState, null),
  };

  let roomLinkData = getCollaborationLinkData(window.location.href);
  const isExternalScene = !!(id || jsonBackendMatch || roomLinkData);
  if (isExternalScene) {
    if (
      // don't prompt if scene is empty
      !scene.elements.length ||
      // don't prompt for collab scenes because we don't override local storage
      roomLinkData ||
      // otherwise, prompt whether user wants to override current scene
      (await openConfirmModal(shareableLinkConfirmDialog))
    ) {
      if (jsonBackendMatch) {
        const imported = await importFromBackend(
          jsonBackendMatch[1],
          jsonBackendMatch[2],
        );

        scene = {
          elements: bumpElementVersions(
            restoreElements(imported.elements, null, {
              repairBindings: true,
              deleteInvisibleElements: true,
            }),
            localDataState?.elements,
          ),
          appState: restoreAppState(
            imported.appState,
            // local appState when importing from backend to ensure we restore
            // localStorage user settings which we do not persist on server.
            localDataState?.appState,
          ),
        };
      }
      scene.scrollToContent = true;
      if (!roomLinkData) {
        window.history.replaceState({}, APP_NAME, window.location.origin);
      }
    } else {
      // https://github.com/excalidraw/excalidraw/issues/1919
      if (document.hidden) {
        return new Promise((resolve, reject) => {
          window.addEventListener(
            "focus",
            () => initializeScene(opts).then(resolve).catch(reject),
            {
              once: true,
            },
          );
        });
      }

      roomLinkData = null;
      window.history.replaceState({}, APP_NAME, window.location.origin);
    }
  } else if (externalUrlMatch) {
    window.history.replaceState({}, APP_NAME, window.location.origin);

    const url = externalUrlMatch[1];
    try {
      const request = await fetch(window.decodeURIComponent(url));
      const data = await loadFromBlob(await request.blob(), null, null);
      if (
        !scene.elements.length ||
        (await openConfirmModal(shareableLinkConfirmDialog))
      ) {
        return { scene: data, isExternalScene };
      }
    } catch (error: any) {
      return {
        scene: {
          appState: {
            errorMessage: t("alerts.invalidSceneUrl"),
          },
        },
        isExternalScene,
      };
    }
  }

  if (roomLinkData && opts.collabAPI) {
    const { excalidrawAPI } = opts;

    const scene = await opts.collabAPI.startCollaboration(roomLinkData);

    return {
      // when collaborating, the state may have already been updated at this
      // point (we may have received updates from other clients), so reconcile
      // elements and appState with existing state
      scene: {
        ...scene,
        appState: {
          ...restoreAppState(
            {
              ...scene?.appState,
              theme: localDataState?.appState?.theme || scene?.appState?.theme,
            },
            excalidrawAPI.getAppState(),
          ),
          // necessary if we're invoking from a hashchange handler which doesn't
          // go through App.initializeScene() that resets this flag
          isLoading: false,
        },
        elements: reconcileElements(
          scene?.elements || [],
          excalidrawAPI.getSceneElementsIncludingDeleted() as RemoteExcalidrawElement[],
          excalidrawAPI.getAppState(),
        ),
      },
      isExternalScene: true,
      id: roomLinkData.roomId,
      key: roomLinkData.roomKey,
    };
  } else if (scene) {
    return isExternalScene && jsonBackendMatch
      ? {
          scene,
          isExternalScene,
          id: jsonBackendMatch[1],
          key: jsonBackendMatch[2],
        }
      : { scene, isExternalScene: false };
  }
  return { scene: null, isExternalScene: false };
};

const ExcalidrawWrapper = () => {
  const excalidrawAPI = useExcalidrawAPI();

  const [errorMessage, setErrorMessage] = useState("");
  const isCollabDisabled = isRunningInIframe();

  const { editorTheme, appTheme, setAppTheme } = useHandleAppTheme();

  const [langCode, setLangCode] = useAppLangCode();

  const editorInterface = useEditorInterface();

  // initial state
  // ---------------------------------------------------------------------------

  const initialStatePromiseRef = useRef<{
    promise: ResolvablePromise<ExcalidrawInitialDataState | null>;
  }>({ promise: null! });
  if (!initialStatePromiseRef.current.promise) {
    initialStatePromiseRef.current.promise =
      resolvablePromise<ExcalidrawInitialDataState | null>();
  }

  const debugCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    trackEvent("load", "frame", getFrame());
    // Delayed so that the app has a time to load the latest SW
    setTimeout(() => {
      trackEvent("load", "version", getVersion());
    }, VERSION_TIMEOUT);
  }, []);

  const [, setShareDialogState] = useAtom(shareDialogStateAtom);
  const [, setNotificationCenterOpen] = useAtom(notificationCenterOpenAtom);
  const [collabAPI] = useAtom(collabAPIAtom);

  usePlusSession();
  const cloudScene = useAtomValue(cloudSceneAtom);
  const plusUser = useAtomValue(plusUserAtom);
  const setPlusDialog = useSetAtom(plusDialogAtom);
  const setPendingCommentFocus = useSetAtom(pendingCommentFocusAtom);
  const setActiveCommentId = useSetAtom(activeCommentIdAtom);
  const setPresentation = useSetAtom(presentationAtom);
  const pendingMentionFocusRef = useRef<{
    elementId: string;
    containerId?: string | null;
  } | null>(null);
  const handleSelectNotificationRef = useRef<
    ((notification: AppNotification) => void) | null
  >(null);
  const [isCollaborating] = useAtomWithInitialValue(isCollaboratingAtom, () => {
    return isCollaborationLink(window.location.href);
  });
  const collabError = useAtomValue(collabErrorIndicatorAtom);
  const userToFollow = useAtomValue(userToFollowAtom);
  const followedUserActivity = useAtomValue(followedUserActivityAtom);
  const cloudUserToFollow = useAtomValue(cloudUserToFollowAtom);
  const cloudFollowedActivity = useAtomValue(cloudFollowedActivityAtom);
  const activeUserToFollow = cloudScene ? cloudUserToFollow : userToFollow;
  const activeFollowedActivity = cloudScene
    ? cloudFollowedActivity
    : followedUserActivity;

  const viewportStatusFrame = useMemo(
    () =>
      activeUserToFollow
        ? {
            border: "var(--color-primary-hover)",
            label: {
              icon: eyeIcon,
              label: (
                <>
                  Following{" "}
                  <span
                    style={{
                      display: "block",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      maxWidth: 100,
                    }}
                    title={activeUserToFollow.username}
                  >
                    {activeUserToFollow.username}
                  </span>
                  {activeFollowedActivity && (
                    <span
                      style={{
                        opacity: 0.85,
                        fontSize: "0.7rem",
                        whiteSpace: "nowrap",
                      }}
                    >
                      • {activeFollowedActivity}
                    </span>
                  )}
                </>
              ),
              onClose: () =>
                cloudScene
                  ? cloudSession.setUserToFollow(null)
                  : collabAPI?.setUserToFollow(null),
            },
          }
        : null,
    [activeUserToFollow, activeFollowedActivity, cloudScene, collabAPI],
  );

  useHandleLibrary({
    excalidrawAPI,
    adapter: LibraryIndexedDBAdapter,
    // TODO maybe remove this in several months (shipped: 24-03-11)
    migrationAdapter: LibraryLocalStorageMigrationAdapter,
  });

  const [, forceRefresh] = useState(false);

  useEffect(() => {
    if (isDevEnv()) {
      const debugState = loadSavedDebugState();

      if (debugState.enabled && !window.visualDebug) {
        window.visualDebug = {
          data: [],
        };
      } else {
        delete window.visualDebug;
      }
      forceRefresh((prev) => !prev);
    }
  }, [excalidrawAPI]);

  // ?collaborators=<N> — populate the canvas with N static fake
  // collaborators for exercising avatar/UserList UI without a real
  // collab room
  useSimulatedCollaborators(excalidrawAPI);

  // ---------------------------------------------------------------------------
  // Hoisted loadImages
  // ---------------------------------------------------------------------------
  const loadImages = useCallback(
    (data: ResolutionType<typeof initializeScene>, isInitialLoad = false) => {
      if (!data.scene || !excalidrawAPI) {
        return;
      }

      if (cloudSession.isActive()) {
        // initial load passes files via initialData; hash changes don't
        if (!isInitialLoad && data.scene.files) {
          excalidrawAPI.addFiles(Object.values(data.scene.files));
        }
        return;
      }

      if (collabAPI?.isCollaborating()) {
        if (data.scene.elements) {
          collabAPI
            .fetchImageFilesFromFirebase({
              elements: data.scene.elements,
              forceFetchFiles: true,
            })
            .then(({ loadedFiles, erroredFiles }) => {
              excalidrawAPI.addFiles(loadedFiles);
              updateStaleImageStatuses({
                excalidrawAPI,
                erroredFiles,
                elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
              });
            });
        }
      } else {
        const fileIds =
          data.scene.elements?.reduce((acc, element) => {
            if (isInitializedImageElement(element)) {
              return acc.concat(element.fileId);
            }
            return acc;
          }, [] as FileId[]) || [];

        if (data.isExternalScene) {
          if (fileIds.length) {
            // Direct Firebase call (not through FileManager), so track manually
            FileStatusStore.updateStatuses(
              fileIds.map((id) => [id, "loading"]),
            );
          }
          loadFilesFromFirebase(
            `${FIREBASE_STORAGE_PREFIXES.shareLinkFiles}/${data.id}`,
            data.key,
            fileIds,
          ).then(({ loadedFiles, erroredFiles }) => {
            excalidrawAPI.addFiles(loadedFiles);
            updateStaleImageStatuses({
              excalidrawAPI,
              erroredFiles,
              elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
            });
            FileStatusStore.updateStatuses([
              ...loadedFiles.map((f) => [f.id, "loaded"] as [FileId, "loaded"]),
              ...[...erroredFiles.keys()].map(
                (id) => [id, "error"] as [FileId, "error"],
              ),
            ]);
          });
        } else if (isInitialLoad) {
          if (fileIds.length) {
            LocalData.fileStorage
              .getFiles(fileIds)
              .then(async ({ loadedFiles, erroredFiles }) => {
                if (loadedFiles.length) {
                  excalidrawAPI.addFiles(loadedFiles);
                }
                updateStaleImageStatuses({
                  excalidrawAPI,
                  erroredFiles,
                  elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
                });
              });
          }
          // on fresh load, clear unused files from IDB (from previous
          // session)
          LocalData.fileStorage.clearObsoleteFiles({
            currentFileIds: fileIds,
          });
        }
      }
    },
    [collabAPI, excalidrawAPI],
  );

  useEffect(() => {
    void notificationEngine.init();
    notificationEngine.setNativeActivationHandler((activated) => {
      void handleSelectNotificationRef.current?.(activated);
    });
    return () => {
      notificationEngine.setNativeActivationHandler(null);
      notificationEngine.destroy();
    };
  }, []);

  useEffect(() => {
    if (!excalidrawAPI || (!isCollabDisabled && !collabAPI)) {
      return;
    }

    initializeScene({ collabAPI, excalidrawAPI }).then(async (data) => {
      loadImages(data, /* isInitialLoad */ true);
      if (data.scene?.elements) {
        notificationEngine.seedCanvasElements(data.scene.elements);
      }
      initialStatePromiseRef.current.promise.resolve(data.scene);
    });

    const onHashChange = async (event: HashChangeEvent) => {
      event.preventDefault();
      const libraryUrlTokens = parseLibraryTokensFromUrl();
      if (!libraryUrlTokens) {
        if (
          collabAPI?.isCollaborating() &&
          !isCollaborationLink(window.location.href)
        ) {
          collabAPI.stopCollaboration(false);
        }
        excalidrawAPI.updateScene({ appState: { isLoading: true } });

        initializeScene({ collabAPI, excalidrawAPI }).then((data) => {
          loadImages(data);
          if (data.scene) {
            excalidrawAPI.updateScene({
              elements: restoreElements(data.scene.elements, null, {
                repairBindings: true,
              }),
              appState: restoreAppState(data.scene.appState, null),
              captureUpdate: CaptureUpdateAction.IMMEDIATELY,
            });
          }
        });
      }
    };

    const syncData = debounce(() => {
      if (isTestEnv()) {
        return;
      }
      if (
        !document.hidden &&
        // a cloud scene syncs with the server, not with other tabs' local data
        !cloudSession.isActive() &&
        ((collabAPI && !collabAPI.isCollaborating()) || isCollabDisabled)
      ) {
        // don't sync if local state is newer or identical to browser state
        if (isBrowserStorageStateNewer(STORAGE_KEYS.VERSION_DATA_STATE)) {
          const localDataState = importFromLocalStorage();
          const username = importUsernameFromLocalStorage();
          setLangCode(getPreferredLanguage());
          excalidrawAPI.updateScene({
            ...localDataState,
            // a text edit goes on through the sync: its editor takes the
            // synced text, or closes if the text is gone
            appState: localDataState.appState && {
              ...localDataState.appState,
              editingTextElement:
                excalidrawAPI.getAppState().editingTextElement,
            },
            captureUpdate: CaptureUpdateAction.NEVER,
          });
          LibraryIndexedDBAdapter.load().then((data) => {
            if (data) {
              excalidrawAPI.updateLibrary({
                libraryItems: data.libraryItems,
              });
            }
          });
          if (!collabAPI?.getUsername()) {
            collabAPI?.setUsername(username || "");
          }
        }

        if (isBrowserStorageStateNewer(STORAGE_KEYS.VERSION_FILES)) {
          const elements = excalidrawAPI.getSceneElementsIncludingDeleted();
          const currFiles = excalidrawAPI.getFiles();
          const fileIds =
            elements?.reduce((acc, element) => {
              if (
                isInitializedImageElement(element) &&
                // only load and update images that aren't already loaded
                !currFiles[element.fileId]
              ) {
                return acc.concat(element.fileId);
              }
              return acc;
            }, [] as FileId[]) || [];
          if (fileIds.length) {
            LocalData.fileStorage
              .getFiles(fileIds)
              .then(({ loadedFiles, erroredFiles }) => {
                if (loadedFiles.length) {
                  excalidrawAPI.addFiles(loadedFiles);
                }
                updateStaleImageStatuses({
                  excalidrawAPI,
                  erroredFiles,
                  elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
                });
              });
          }
        }
      }
    }, SYNC_BROWSER_TABS_TIMEOUT);

    const onUnload = () => {
      LocalData.flushSave();
    };

    const visibilityChange = (event: FocusEvent | Event) => {
      if (event.type === EVENT.BLUR || document.hidden) {
        LocalData.flushSave();
      }
      if (
        event.type === EVENT.VISIBILITY_CHANGE ||
        event.type === EVENT.FOCUS
      ) {
        syncData();
      }
    };

    window.addEventListener(EVENT.HASHCHANGE, onHashChange, false);
    window.addEventListener(EVENT.UNLOAD, onUnload, false);
    window.addEventListener(EVENT.BLUR, visibilityChange, false);
    document.addEventListener(EVENT.VISIBILITY_CHANGE, visibilityChange, false);
    window.addEventListener(EVENT.FOCUS, visibilityChange, false);
    return () => {
      window.removeEventListener(EVENT.HASHCHANGE, onHashChange, false);
      window.removeEventListener(EVENT.UNLOAD, onUnload, false);
      window.removeEventListener(EVENT.BLUR, visibilityChange, false);
      window.removeEventListener(EVENT.FOCUS, visibilityChange, false);
      document.removeEventListener(
        EVENT.VISIBILITY_CHANGE,
        visibilityChange,
        false,
      );
    };
  }, [isCollabDisabled, collabAPI, excalidrawAPI, setLangCode, loadImages]);

  useEffect(() => {
    const unloadHandler = (event: BeforeUnloadEvent) => {
      LocalData.flushSave();

      if (
        excalidrawAPI &&
        LocalData.fileStorage.shouldPreventUnload(
          excalidrawAPI.getSceneElements(),
        )
      ) {
        if (import.meta.env.VITE_APP_DISABLE_PREVENT_UNLOAD !== "true") {
          preventUnload(event);
        } else {
          console.warn(
            "preventing unload disabled (VITE_APP_DISABLE_PREVENT_UNLOAD)",
          );
        }
      }
    };
    window.addEventListener(EVENT.BEFORE_UNLOAD, unloadHandler);
    return () => {
      window.removeEventListener(EVENT.BEFORE_UNLOAD, unloadHandler);
    };
  }, [excalidrawAPI]);

  const onChange = (
    elements: readonly OrderedExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => {
    if (collabAPI?.isCollaborating()) {
      collabAPI.syncElements(elements);
    }

    // pushes this user's edits to the cloud scene's other collaborators
    cloudSession.onLocalChange(elements, appState);

    void notificationEngine
      .processCanvasElements(elements, {
        editingElementId: appState.editingTextElement?.id ?? null,
        roomId: collabAPI?.getRoomId() ?? null,
        roomLink: collabAPI?.getActiveRoomLink() ?? null,
      })
      .then((emitted) => {
        if (cloudScene?.id && emitted.length > 0) {
          void plusAPI
            .syncCanvasMentions(cloudScene.id, {
              mentions: emitted.map((item) => ({
                elementId: item.payload.elementId,
                textSnippet: item.payload.textSnippet,
                recipientNameOrHandle: item.recipientHandle || "",
                x: item.payload.x,
                y: item.payload.y,
              })),
            })
            .catch(() => {});
        }
      });

    if (pendingMentionFocusRef.current && excalidrawAPI) {
      const targetInfo = pendingMentionFocusRef.current;
      const found =
        elements.find(
          (el) => !el.isDeleted && el.id === targetInfo.elementId,
        ) ||
        (targetInfo.containerId
          ? elements.find(
              (el) => !el.isDeleted && el.id === targetInfo.containerId,
            )
          : undefined);
      if (found) {
        pendingMentionFocusRef.current = null;
        excalidrawAPI.setViewport({
          target: found,
          fit: "scale-down",
          animation: true,
          offsets: { ui: true },
        });
        excalidrawAPI.selection.select([found]);
      }
    }

    // this check is redundant, but since this is a hot path, it's best
    // not to evaludate the nested expression every time
    if (!LocalData.isSavePaused()) {
      LocalData.save(elements, appState, files, () => {
        if (excalidrawAPI) {
          let didChange = false;

          const elements = excalidrawAPI
            .getSceneElementsIncludingDeleted()
            .map((element) => {
              if (
                LocalData.fileStorage.shouldUpdateImageElementStatus(element)
              ) {
                const newElement = newElementWith(element, { status: "saved" });
                if (newElement !== element) {
                  didChange = true;
                }
                return newElement;
              }
              return element;
            });

          if (didChange) {
            excalidrawAPI.updateScene({
              elements,
              captureUpdate: CaptureUpdateAction.NEVER,
            });
          }
        }
      });
    }

    // Render the debug scene if the debug canvas is available
    if (debugCanvasRef.current && excalidrawAPI) {
      debugRenderer(
        debugCanvasRef.current,
        appState,
        elements,
        window.devicePixelRatio,
      );
    }
  };

  const [latestShareableLink, setLatestShareableLink] = useState<string | null>(
    null,
  );

  const onExportToBackend = async (
    exportedElements: readonly NonDeletedExcalidrawElement[],
    appState: Partial<AppState>,
    files: BinaryFiles,
  ) => {
    if (exportedElements.length === 0) {
      throw new Error(t("alerts.cannotExportEmptyCanvas"));
    }
    try {
      const { url, errorMessage } = await exportToBackend(
        exportedElements,
        {
          ...appState,
          viewBackgroundColor: appState.exportBackground
            ? appState.viewBackgroundColor
            : getDefaultAppState().viewBackgroundColor,
        },
        files,
      );

      if (errorMessage) {
        throw new Error(errorMessage);
      }

      if (url) {
        setLatestShareableLink(url);
      }
    } catch (error: any) {
      if (error.name !== "AbortError") {
        const { width, height } = appState;
        console.error(error, {
          width,
          height,
          devicePixelRatio: window.devicePixelRatio,
        });
        throw new Error(error.message);
      }
    }
  };

  const renderCustomStats = (
    elements: readonly NonDeletedExcalidrawElement[],
    appState: UIAppState,
  ) => {
    return (
      <CustomStats
        setToast={(message) => excalidrawAPI!.setToast({ message })}
        appState={appState}
        elements={elements}
      />
    );
  };

  const isOffline = useAtomValue(isOfflineAtom);
  const isCollabAvailable =
    !isCollabDisabled && (!isOffline || isCollaborating);

  useEffect(() => {
    if (!isCollabAvailable) {
      setShareDialogState({ isOpen: false });
    }
  }, [isCollabAvailable, setShareDialogState]);

  const localStorageQuotaExceeded = useAtomValue(localStorageQuotaExceededAtom);

  const onCollabDialogOpen = useCallback(
    () => setShareDialogState({ isOpen: true, type: "collaborationOnly" }),
    [setShareDialogState],
  );

  const focusCanvasElement = useCallback(
    (elementId: string, containerId?: string | null) => {
      if (!excalidrawAPI) {
        return false;
      }
      const elements = excalidrawAPI.getSceneElements();
      const target =
        elements.find((el) => el.id === elementId) ||
        (containerId
          ? elements.find((el) => el.id === containerId)
          : undefined);

      if (!target) {
        return false;
      }

      excalidrawAPI.setViewport({
        target,
        fit: "scale-down",
        animation: true,
        offsets: { ui: true },
      });
      excalidrawAPI.selection.select([target]);
      return true;
    },
    [excalidrawAPI],
  );

  const joinSharedRoomLink = useCallback(
    async (roomLink: string) => {
      if (!collabAPI || !excalidrawAPI) {
        return;
      }
      const linkData = getCollaborationLinkData(roomLink);
      if (!linkData) {
        return;
      }
      if (collabAPI.getRoomId() === linkData.roomId) {
        excalidrawAPI.setToast({
          message: "Already viewing this shared canvas.",
          duration: 3000,
          closable: true,
        });
        return;
      }
      if (collabAPI.isCollaborating()) {
        collabAPI.stopCollaboration(false);
      }
      window.history.pushState({}, APP_NAME, roomLink);
      const scene = await collabAPI.startCollaboration(linkData);
      if (scene?.elements) {
        notificationEngine.seedCanvasElements(scene.elements);
        excalidrawAPI.updateScene({
          elements: restoreElements(scene.elements, null, {
            repairBindings: true,
          }),
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      }
    },
    [collabAPI, excalidrawAPI],
  );

  const handleSelectNotification = useCallback(
    async (notification: AppNotification) => {
      if (notification.type === "share_invite") {
        await joinSharedRoomLink(notification.payload.roomLink);
        return;
      }

      if (
        notification.type === "scene_share" ||
        notification.type === "scene_assigned"
      ) {
        if (notification.payload.sceneId) {
          openCloudScene(notification.payload.sceneId);
        }
        return;
      }

      if (notification.type === "team_added") {
        if (notification.payload.teamId) {
          window.location.assign(
            `${APP_ROUTES.dashboard}?team=${encodeURIComponent(
              notification.payload.teamId,
            )}`,
          );
        }
        return;
      }

      if (
        notification.type === "comment_mention" ||
        notification.type === "comment_reply"
      ) {
        const { sceneId, commentId } = notification.payload;
        if (!sceneId) {
          return;
        }
        if (cloudScene?.id === sceneId) {
          setActiveCommentId(commentId);
          excalidrawAPI?.toggleSidebar({
            name: "default",
            tab: "comments",
            force: true,
          });
        } else {
          setPendingCommentFocus({ sceneId, commentId });
          openCloudScene(sceneId);
        }
        return;
      }

      if (notification.type === "canvas_mention") {
        const { elementId, containerId, roomId, roomLink, sceneId } =
          notification.payload;
        const activeRoomId = collabAPI?.getRoomId() ?? null;

        if (sceneId && cloudScene?.id !== sceneId) {
          pendingMentionFocusRef.current = { elementId, containerId };
          openCloudScene(sceneId);
          return;
        }

        if (roomId && roomLink && roomId !== activeRoomId) {
          pendingMentionFocusRef.current = { elementId, containerId };
          await joinSharedRoomLink(roomLink);
          if (focusCanvasElement(elementId, containerId)) {
            pendingMentionFocusRef.current = null;
          }
          return;
        }

        if (!focusCanvasElement(elementId, containerId)) {
          excalidrawAPI?.setToast({
            message: "Mentioned element is no longer on this canvas.",
            duration: 3000,
            closable: true,
          });
        }
      }
    },
    [
      cloudScene?.id,
      collabAPI,
      excalidrawAPI,
      focusCanvasElement,
      joinSharedRoomLink,
      setActiveCommentId,
      setPendingCommentFocus,
    ],
  );

  handleSelectNotificationRef.current = handleSelectNotification;

  // ---------------------------------------------------------------------------
  // onExport — intercepts file save to wait for pending image loads
  // ---------------------------------------------------------------------------
  const onExport: Required<ExcalidrawProps>["onExport"] = useCallback(
    async function* () {
      let snapshot = FileStatusStore.getSnapshot();
      const { pending, total } = FileStatusStore.getPendingCount(
        snapshot.value,
      );
      if (pending === 0) {
        return;
      }

      // Yield initial progress
      yield {
        type: "progress",
        progress: (total - pending) / total,
        message: `Loading images (${total - pending}/${total})...`,
      };

      // Wait for all pending images to finish
      while (true) {
        snapshot = await FileStatusStore.pull(snapshot.version);
        const { pending: nowPending, total: nowTotal } =
          FileStatusStore.getPendingCount(snapshot.value);

        yield {
          type: "progress",
          progress: (nowTotal - nowPending) / nowTotal,
          message: `Loading images (${nowTotal - nowPending}/${nowTotal})...`,
        };

        if (nowPending === 0) {
          await new Promise((r) => setTimeout(r, 500));
          yield {
            type: "progress",
            message: `Preparing export...`,
          };
          return;
        }
      }
    },
    [],
  );

  // const onExport = () => {
  //   return new Promise((r) => setTimeout(r, 2500));
  //   // console.log("onExport");
  // };

  // browsers generally prevent infinite self-embedding, there are
  // cases where it still happens, and while we disallow self-embedding
  // by not whitelisting our own origin, this serves as an additional guard
  if (isSelfEmbedding) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          height: "100%",
        }}
      >
        <h1>I'm not a pretzel!</h1>
      </div>
    );
  }

  const plusIcon = <div style={{ width: 14 }}>{ExcalLogo}</div>;
  const plusCommands = [
    {
      label: plusUser ? "Open workspace" : "Sign in",
      category: DEFAULT_CATEGORIES.app,
      predicate: true,
      icon: plusIcon,
      keywords: [
        "plus",
        "cloud",
        "scenes",
        "folders",
        "teams",
        "workspace",
        "signin",
        "login",
        "signup",
      ],
      perform: () =>
        plusUser ? setPlusDialog({ name: "workspace" }) : goToSignIn(),
    },
    {
      label: "Save to workspace",
      category: DEFAULT_CATEGORIES.app,
      predicate: () => !!plusUser && !cloudScene,
      icon: plusIcon,
      keywords: ["cloud", "save", "upload", "backup", "plus"],
      perform: () => setPlusDialog({ name: "save-to-cloud" }),
    },
    {
      label: "Share cloud scene",
      category: DEFAULT_CATEGORIES.app,
      predicate: () => !!cloudScene && !cloudScene.embed,
      icon: share,
      keywords: ["share", "access", "permissions", "link", "embed", "readonly"],
      perform: () => setPlusDialog({ name: "share" }),
    },
    {
      label: "Close cloud scene (back to local canvas)",
      category: DEFAULT_CATEGORIES.app,
      predicate: () => !!cloudScene,
      keywords: ["local", "close", "leave"],
      perform: () => {
        window.location.hash = "";
      },
    },
    {
      label: "Start presentation",
      category: DEFAULT_CATEGORIES.app,
      predicate: () =>
        !!excalidrawAPI
          ?.getSceneElements()
          .some((element) => element.type === "frame"),
      keywords: ["present", "slides", "slideshow", "frames"],
      perform: () => setPresentation({ active: true, index: 0 }),
    },
    {
      label: "Export frames to PDF / PowerPoint",
      category: DEFAULT_CATEGORIES.export,
      predicate: true,
      keywords: ["pdf", "pptx", "powerpoint", "slides", "frames", "export"],
      perform: () => setPlusDialog({ name: "export-frames" }),
    },
    {
      label: "Join voice hangout",
      category: DEFAULT_CATEGORIES.app,
      predicate: () => !!cloudScene && !cloudScene.embed && !hangout.isJoined(),
      keywords: ["voice", "call", "audio", "hangout", "screen", "share"],
      perform: () => hangout.join(),
    },
    {
      label: "Account & API keys",
      category: DEFAULT_CATEGORIES.app,
      predicate: () => !!plusUser,
      keywords: ["account", "api", "key", "mcp", "ai", "profile", "logout"],
      perform: () => setPlusDialog({ name: "account" }),
    },
  ];

  return (
    <div
      style={{ height: "100%" }}
      className={clsx("excalidraw-app", {
        "is-collaborating": isCollaborating,
        "is-cloud-scene": !!cloudScene,
        "is-embed": !!cloudScene?.embed,
      })}
    >
      <Excalidraw
        viewModeEnabled={cloudScene?.role === "viewer" ? true : undefined}
        zenModeEnabled={cloudScene?.embed ? true : undefined}
        viewportStatusFrame={viewportStatusFrame}
        userToFollow={activeUserToFollow}
        onUserFollow={
          cloudScene
            ? (payload) =>
                cloudSession.setUserToFollow(
                  payload.action === "FOLLOW" ? payload.userToFollow : null,
                )
            : undefined
        }
        onChange={onChange}
        onExport={onExport}
        initialData={initialStatePromiseRef.current.promise}
        isCollaborating={isCollaborating}
        onPointerUpdate={
          cloudScene ? cloudSession.onPointerUpdate : collabAPI?.onPointerUpdate
        }
        UIOptions={{
          canvasActions: {
            toggleTheme: true,
            export: {
              onExportToBackend,
              renderCustomUI: excalidrawAPI
                ? (elements, appState, files) => {
                    return (
                      <ExportToExcalidrawPlus
                        elements={elements}
                        appState={appState}
                        files={files}
                        name={excalidrawAPI.getName()}
                        onError={(error) => {
                          excalidrawAPI?.updateScene({
                            appState: {
                              errorMessage: error.message,
                            },
                          });
                        }}
                        onSuccess={() => {
                          excalidrawAPI.updateScene({
                            appState: { openDialog: null },
                          });
                        }}
                      />
                    );
                  }
                : undefined,
            },
          },
        }}
        langCode={langCode}
        renderCustomStats={renderCustomStats}
        detectScroll={false}
        handleKeyboardGlobally={true}
        autoFocus={true}
        theme={editorTheme}
        onThemeChange={setAppTheme}
        renderTopRightUI={(isMobile) => {
          if (isMobile || !collabAPI || !isCollabAvailable || cloudScene) {
            // cloud scenes sync through the Plus server, not live rooms
            return isMobile ? (
              <PlusTopRight />
            ) : (
              <div className="excalidraw-ui-top-right">
                <PlusTopRight />
                <NotificationBell
                  onSelectNotification={handleSelectNotification}
                />
              </div>
            );
          }

          return (
            <div className="excalidraw-ui-top-right">
              <PlusTopRight />

              {collabError.message && <CollabError collabError={collabError} />}
              <NotificationBell
                onSelectNotification={handleSelectNotification}
              />
              <LiveCollaborationTrigger
                isCollaborating={isCollaborating}
                onSelect={() =>
                  setShareDialogState({ isOpen: true, type: "share" })
                }
                editorInterface={editorInterface}
              />
            </div>
          );
        }}
        onLinkOpen={(element, event) => {
          if (element.link && isElementLink(element.link)) {
            event.preventDefault();
            excalidrawAPI?.setViewport({
              target: element.link,
              fit: "scale-down",
              animation: true,
            });
          }
        }}
      >
        <AppMainMenu
          onCollabDialogOpen={onCollabDialogOpen}
          isCollaborating={isCollaborating}
          isCollabEnabled={isCollabAvailable}
          theme={appTheme}
          refresh={() => forceRefresh((prev) => !prev)}
        />
        <AppWelcomeScreen
          onCollabDialogOpen={onCollabDialogOpen}
          isCollabEnabled={isCollabAvailable}
        />
        <OverwriteConfirmDialog>
          <OverwriteConfirmDialog.Actions.ExportToImage />
          <OverwriteConfirmDialog.Actions.SaveToDisk />
          {excalidrawAPI && (
            <OverwriteConfirmDialog.Action
              title={t("overwriteConfirm.action.excalidrawPlus.title")}
              actionLabel={t("overwriteConfirm.action.excalidrawPlus.button")}
              onClick={() => {
                exportToExcalidrawPlus(
                  excalidrawAPI.getSceneElements(),
                  excalidrawAPI.getAppState(),
                  excalidrawAPI.getFiles(),
                  excalidrawAPI.getName(),
                );
              }}
            >
              {t("overwriteConfirm.action.excalidrawPlus.description")}
            </OverwriteConfirmDialog.Action>
          )}
        </OverwriteConfirmDialog>
        <AppFooter onChange={() => excalidrawAPI?.refresh()} />
        {excalidrawAPI && <AIComponents excalidrawAPI={excalidrawAPI} />}
        {excalidrawAPI && <PlusRoot api={excalidrawAPI} />}

        <TTDDialogTrigger />
        {isCollaborating && isOffline && (
          <div className="alertalert--warning">
            {t("alerts.collabOfflineWarning")}
          </div>
        )}
        {localStorageQuotaExceeded && (
          <div className="alert alert--danger">
            {t("alerts.localStorageQuotaExceeded")}
          </div>
        )}
        {latestShareableLink && (
          <ShareableLinkDialog
            link={latestShareableLink}
            onCloseRequest={() => setLatestShareableLink(null)}
            setErrorMessage={setErrorMessage}
          />
        )}
        {excalidrawAPI && !isCollabDisabled && (
          <Collab excalidrawAPI={excalidrawAPI} />
        )}

        <ShareDialog
          collabAPI={collabAPI}
          onExportToBackend={async () => {
            if (excalidrawAPI) {
              try {
                await onExportToBackend(
                  excalidrawAPI.getSceneElements(),
                  excalidrawAPI.getAppState(),
                  excalidrawAPI.getFiles(),
                );
              } catch (error: any) {
                setErrorMessage(error.message);
              }
            }
          }}
        />

        <AppSidebar />
        <NotificationToastStack
          onSelectNotification={handleSelectNotification}
        />
        <CanvasMentionAutocomplete />

        {errorMessage && (
          <ErrorDialog onClose={() => setErrorMessage("")}>
            {errorMessage}
          </ErrorDialog>
        )}

        <CommandPalette
          customCommandPaletteItems={[
            {
              label: t("labels.liveCollaboration"),
              category: DEFAULT_CATEGORIES.app,
              predicate: isCollabAvailable,
              keywords: [
                "team",
                "multiplayer",
                "share",
                "public",
                "session",
                "invite",
              ],
              icon: usersIcon,
              perform: () => {
                setShareDialogState({
                  isOpen: true,
                  type: "collaborationOnly",
                });
              },
            },
            {
              label: t("roomDialog.button_stopSession"),
              category: DEFAULT_CATEGORIES.app,
              predicate: () => !!collabAPI?.isCollaborating(),
              keywords: [
                "stop",
                "session",
                "end",
                "leave",
                "close",
                "exit",
                "collaboration",
              ],
              perform: () => {
                if (collabAPI) {
                  collabAPI.stopCollaboration();
                  if (!collabAPI.isCollaborating()) {
                    setShareDialogState({ isOpen: false });
                  }
                }
              },
            },
            {
              label: t("labels.share"),
              category: DEFAULT_CATEGORIES.app,
              predicate: isCollabAvailable,
              icon: share,
              keywords: [
                "link",
                "shareable",
                "readonly",
                "export",
                "publish",
                "snapshot",
                "url",
                "collaborate",
                "invite",
              ],
              perform: async () => {
                setShareDialogState({ isOpen: true, type: "share" });
              },
            },
            {
              label: "Notifications",
              category: DEFAULT_CATEGORIES.app,
              predicate: true,
              keywords: [
                "notifications",
                "alerts",
                "mentions",
                "inbox",
                "share",
              ],
              perform: () => {
                setNotificationCenterOpen(true);
              },
            },
            {
              label: "YouTube",
              icon: youtubeIcon,
              category: DEFAULT_CATEGORIES.links,
              predicate: true,
              keywords: ["features", "tutorials", "howto", "help", "community"],
              perform: () => {
                window.open(
                  "https://youtube.com/@excalidraw",
                  "_blank",
                  "noopener noreferrer",
                );
              },
            },
            ...plusCommands,

            {
              label: t("overwriteConfirm.action.excalidrawPlus.button"),
              category: DEFAULT_CATEGORIES.export,
              icon: exportToPlus,
              predicate: true,
              keywords: ["plus", "export", "save", "backup"],
              perform: () => {
                if (excalidrawAPI) {
                  exportToExcalidrawPlus(
                    excalidrawAPI.getSceneElements(),
                    excalidrawAPI.getAppState(),
                    excalidrawAPI.getFiles(),
                    excalidrawAPI.getName(),
                  );
                }
              },
            },
            {
              label: t("labels.installPWA"),
              category: DEFAULT_CATEGORIES.app,
              predicate: () => !!pwaEvent,
              perform: () => {
                if (pwaEvent) {
                  pwaEvent.prompt();
                  pwaEvent.userChoice.then(() => {
                    // event cannot be reused, but we'll hopefully
                    // grab new one as the event should be fired again
                    pwaEvent = null;
                  });
                }
              },
            },
          ]}
        />
        {isVisualDebuggerEnabled() && excalidrawAPI && (
          <DebugCanvas
            appState={excalidrawAPI.getAppState()}
            scale={window.devicePixelRatio}
            ref={debugCanvasRef}
          />
        )}
      </Excalidraw>
    </div>
  );
};

const ExcalidrawApp = () => {
  const isCloudExportWindow =
    window.location.pathname === APP_ROUTES.excalidrawPlusExport;
  if (isCloudExportWindow) {
    return <ExcalidrawPlusIframeExport />;
  }
  if (window.location.pathname === APP_ROUTES.signIn) {
    return <SignInPage />;
  }
  if (window.location.pathname === APP_ROUTES.dashboard) {
    return <DashboardPage />;
  }

  return (
    <TopErrorBoundary>
      <Provider store={appJotaiStore}>
        <ExcalidrawAPIProvider>
          <ExcalidrawWrapper />
        </ExcalidrawAPIProvider>
      </Provider>
    </TopErrorBoundary>
  );
};

export default ExcalidrawApp;
