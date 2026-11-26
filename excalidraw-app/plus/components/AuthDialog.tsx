import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import { FilledButton } from "@excalidraw/excalidraw/components/FilledButton";
import { useState } from "react";

import { useAtom, useSetAtom } from "../../app-jotai";
import { plusAPI } from "../api";
import { cloudSession, parseCloudHash } from "../cloud";
import { plusDialogAtom, plusUserAtom } from "../state";

import { ErrorText, Field, useAsyncAction } from "./ui";

export const AuthDialog = ({
  mode: initialMode,
  reason,
}: {
  mode: "signin" | "signup";
  reason?: string;
}) => {
  const [, setDialog] = useAtom(plusDialogAtom);
  const setUser = useSetAtom(plusUserAtom);
  const [mode, setMode] = useState(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { pending, error, setError, run } = useAsyncAction();

  const submit = async () => {
    const result = await run(() =>
      mode === "signup"
        ? plusAPI.signUp({ email, name, password })
        : plusAPI.login({ email, password }),
    );
    if (result) {
      setUser(result.user);
      if (parseCloudHash() && !cloudSession.isActive()) {
        // a private scene link brought us here: open it now
        setDialog(null);
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      } else {
        setDialog(cloudSession.isActive() ? null : { name: "workspace" });
      }
    }
  };

  return (
    <Dialog
      size="small"
      onCloseRequest={() => setDialog(null)}
      title={mode === "signup" ? "Create your account" : "Sign in"}
      className="plus-dialog"
    >
      <form
        className="plus-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {reason && <p className="plus-muted">{reason}</p>}
        {mode === "signup" && (
          <Field label="Name (optional)">
            <input
              value={name}
              autoComplete="name"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
        )}
        <Field label="Email">
          <input
            type="email"
            required
            value={email}
            autoComplete="email"
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field
          label="Password"
          hint={mode === "signup" ? "At least 8 characters" : undefined}
        >
          <input
            type="password"
            required
            minLength={mode === "signup" ? 8 : undefined}
            value={password}
            autoComplete={
              mode === "signup" ? "new-password" : "current-password"
            }
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <ErrorText error={error} />
        <FilledButton
          size="large"
          fullWidth
          label={mode === "signup" ? "Create account" : "Sign in"}
          status={pending ? "loading" : null}
          onClick={submit}
        />
        <p className="plus-muted plus-center">
          {mode === "signup" ? "Already have an account? " : "New here? "}
          <button
            type="button"
            className="plus-link-button"
            onClick={() => {
              setError(null);
              setMode(mode === "signup" ? "signin" : "signup");
            }}
          >
            {mode === "signup" ? "Sign in" : "Create an account"}
          </button>
        </p>
        {/* lets Enter submit; FilledButton isn't a submit button */}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
};
