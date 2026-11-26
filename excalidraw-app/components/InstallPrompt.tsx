import { useCallback, useEffect, useState } from "react";

import "./InstallPrompt.scss";

/** Chromium's (non-standard) install event. */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISSED_KEY = "excalidraw-install-prompt-dismissed";
// ask again after a week if the person said "not now"
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
// let the app settle before asking
const SHOW_DELAY_MS = 3000;

const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches ||
  window.matchMedia?.("(display-mode: fullscreen)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  // iPadOS reports itself as a Mac
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** Other iOS browsers can't install web apps, only Safari can. */
const isIOSSafari = () =>
  isIOS() &&
  /safari/i.test(navigator.userAgent) &&
  !/crios|fxios|edgios|opios/i.test(navigator.userAgent);

const isSnoozed = () => {
  try {
    const at = Number(localStorage.getItem(DISMISSED_KEY));
    return !!at && Date.now() - at < SNOOZE_MS;
  } catch {
    return false;
  }
};

const snooze = () => {
  try {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()));
  } catch {
    // private mode etc.: the banner just comes back next visit
  }
};

/**
 * Tells people they can install the app on their phone/tablet/desktop.
 *
 * - Android/desktop Chromium: one-tap install through the browser's prompt.
 * - iPhone/iPad Safari (no install API): shows the "Add to Home Screen" steps.
 * - Nothing when already installed (running standalone) or recently dismissed.
 */
export const InstallPrompt = () => {
  const [installEvent, setInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [showIOSSteps, setShowIOSSteps] = useState(false);

  useEffect(() => {
    if (isStandalone() || isSnoozed()) {
      return;
    }

    let timer: number | undefined;
    const reveal = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    };

    const onBeforeInstall = (event: Event) => {
      // keep the event so we can show our own prompt instead of the mini-infobar
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
      reveal();
    };
    const onInstalled = () => {
      window.clearTimeout(timer);
      setVisible(false);
      setInstallEvent(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    if (isIOSSafari()) {
      reveal();
    }

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = useCallback(() => {
    snooze();
    setVisible(false);
    setShowIOSSteps(false);
  }, []);

  const install = useCallback(async () => {
    if (!installEvent) {
      setShowIOSSteps(true);
      return;
    }
    await installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    // the event can only be used once
    setInstallEvent(null);
    if (outcome === "accepted") {
      setVisible(false);
    } else {
      dismiss();
    }
  }, [installEvent, dismiss]);

  if (!visible) {
    return null;
  }

  return (
    <div
      className="install-prompt"
      role="dialog"
      aria-label="Install Excalidraw"
    >
      <img
        className="install-prompt__icon"
        src="/android-chrome-192x192.png"
        alt=""
        width={44}
        height={44}
      />
      <div className="install-prompt__body">
        <strong>Install Excalidraw</strong>
        {showIOSSteps ? (
          <ol className="install-prompt__steps">
            <li>
              Tap the <b>Share</b> button{" "}
              <svg
                aria-hidden="true"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
              </svg>{" "}
              in Safari
            </li>
            <li>
              Choose <b>Add to Home Screen</b>
            </li>
          </ol>
        ) : (
          <span>
            Get the app on your phone or tablet: full screen, faster to open,
            works offline.
          </span>
        )}
      </div>
      <div className="install-prompt__actions">
        {!showIOSSteps && (
          <button className="install-prompt__install" onClick={install}>
            {installEvent ? "Install" : "How?"}
          </button>
        )}
        <button
          className="install-prompt__dismiss"
          onClick={dismiss}
          aria-label="Not now"
        >
          {showIOSSteps ? "Got it" : "Not now"}
        </button>
      </div>
    </div>
  );
};
