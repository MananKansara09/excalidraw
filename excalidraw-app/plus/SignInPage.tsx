import { useEffect, useState } from "react";

import { STORAGE_KEYS } from "../app_constants";

import { plusAPI } from "./api";
import { safeNextURL, SIGN_IN_REASONS } from "./auth";

import "./signin.scss";

import type { AuthMode, SignInReason } from "./auth";

const getTheme = () => {
  const stored = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_THEME);
  if (stored === "dark" || stored === "light") {
    return stored;
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
};

/**
 * The sign-in / sign-up page at `/signin`, on its own without the editor, so
 * nothing on a canvas reacts to typing. `?next=` is where to go afterwards.
 */
export const SignInPage = () => {
  const params = new URLSearchParams(window.location.search);
  const next = safeNextURL(params.get("next"));
  const reason = SIGN_IN_REASONS[params.get("reason") as SignInReason] as
    | string
    | undefined;

  const [mode, setMode] = useState<AuthMode>(
    params.get("mode") === "signup" ? "signup" : "signin",
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    document.title = `${
      mode === "signup" ? "Create account" : "Sign in"
    } | Excalidraw`;
  }, [mode]);

  // already signed in: nothing to do here
  useEffect(() => {
    plusAPI
      .me()
      .then(() => window.location.replace(next))
      .catch(() => setChecking(false));
  }, [next]);

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError(null);
    const url = new URL(window.location.href);
    if (nextMode === "signup") {
      url.searchParams.set("mode", "signup");
    } else {
      url.searchParams.delete("mode");
    }
    window.history.replaceState(null, "", url);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      if (mode === "signup") {
        await plusAPI.signUp({ email, name, password });
      } else {
        await plusAPI.login({ email, password });
      }
      window.location.replace(next);
    } catch (err: any) {
      setError(err?.message || "Something went wrong");
      setPending(false);
    }
  };

  return (
    <div className={`plus-signin-page theme--${getTheme()}`}>
      <main className="plus-signin">
        <a className="plus-signin__brand" href={next}>
          <img src="/favicon.svg" alt="" />
          Excalidraw
        </a>
        {checking ? (
          <p className="plus-signin__muted" role="status">
            Loading…
          </p>
        ) : (
          <form className="plus-signin__card" onSubmit={submit} noValidate>
            <h1>{mode === "signup" ? "Create your account" : "Sign in"}</h1>
            {reason && <p className="plus-signin__muted">{reason}</p>}
            {mode === "signup" && (
              <label className="plus-signin__field">
                <span>
                  Name <span className="plus-signin__muted">(optional)</span>
                </span>
                <input
                  value={name}
                  autoComplete="name"
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            )}
            <label className="plus-signin__field">
              <span>Email</span>
              <input
                type="email"
                required
                autoFocus
                value={email}
                autoComplete="email"
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="plus-signin__field">
              <span>Password</span>
              <input
                type="password"
                required
                minLength={mode === "signup" ? 8 : undefined}
                value={password}
                autoComplete={
                  mode === "signup" ? "new-password" : "current-password"
                }
                onChange={(e) => setPassword(e.target.value)}
              />
              {mode === "signup" && (
                <span className="plus-signin__muted">
                  At least 8 characters
                </span>
              )}
            </label>
            {error && (
              <p className="plus-signin__error" role="alert">
                {error}
              </p>
            )}
            <button
              type="submit"
              className="plus-signin__submit"
              disabled={pending}
            >
              {pending
                ? "Please wait…"
                : mode === "signup"
                ? "Create account"
                : "Sign in"}
            </button>
            <p className="plus-signin__muted plus-signin__switch">
              {mode === "signup" ? "Already have an account? " : "New here? "}
              <button
                type="button"
                onClick={() =>
                  switchMode(mode === "signup" ? "signin" : "signup")
                }
              >
                {mode === "signup" ? "Sign in" : "Create an account"}
              </button>
            </p>
          </form>
        )}
        <a className="plus-signin__back" href={next}>
          ← Back to the canvas
        </a>
      </main>
    </div>
  );
};
