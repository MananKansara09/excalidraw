import { APP_ROUTES } from "../app_routes";

export type AuthMode = "signin" | "signup";

/** Why sign-in was asked for, shown above the form. */
export const SIGN_IN_REASONS = {
  scene: "This scene is private: you need an account with access to it.",
  workspace: "You need an account to use your workspace.",
  comment: "You need an account to join the discussion.",
} as const;

export type SignInReason = keyof typeof SIGN_IN_REASONS;

/**
 * Only same-origin paths may be returned to after signing in, so the page
 * can't be used to bounce people to another site.
 */
export const safeNextURL = (next: string | null | undefined) =>
  next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\")
    ? next
    : "/";

/**
 * Opens the sign-in page, which returns to the current address (scene links
 * included) once signed in.
 */
export const goToSignIn = (
  mode: AuthMode = "signin",
  reason?: SignInReason,
) => {
  const params = new URLSearchParams({
    next: `${window.location.pathname}${window.location.search}${window.location.hash}`,
  });
  if (mode === "signup") {
    params.set("mode", "signup");
  }
  if (reason) {
    params.set("reason", reason);
  }
  window.location.assign(`${APP_ROUTES.signIn}?${params}`);
};
