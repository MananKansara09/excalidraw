import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ReactNode } from "react";

export const Field = ({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
}) => (
  <label className="plus-field">
    <span className="plus-field__label">{label}</span>
    {children}
    {hint && <span className="plus-field__hint">{hint}</span>}
  </label>
);

export const ErrorText = ({ error }: { error: string | null | undefined }) =>
  error ? (
    <div className="plus-error" role="alert">
      {error}
    </div>
  ) : null;

export const SmallButton = ({
  children,
  onClick,
  danger,
  disabled,
  title,
  className,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
  type?: "button" | "submit";
}) => (
  <button
    type={type}
    className={clsx("plus-small-button", className, { danger })}
    onClick={onClick}
    disabled={disabled}
    title={title}
  >
    {children}
  </button>
);

export const RoleSelect = <T extends string>({
  value,
  options,
  onChange,
  disabled,
  label,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  label: string;
}) => (
  <select
    className="plus-select"
    aria-label={label}
    value={value}
    disabled={disabled}
    onChange={(event) => onChange(event.target.value as T)}
  >
    {options.map((option) => (
      <option key={option.value} value={option.value}>
        {option.label}
      </option>
    ))}
  </select>
);

/** Runs an async action, tracking pending state and the error message. */
export const useAsyncAction = () => {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    // set on every mount: StrictMode mounts, unmounts and mounts again
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
      setPending(true);
      setError(null);
      try {
        return await action();
      } catch (err: any) {
        if (mounted.current) {
          setError(err?.message || "Something went wrong");
        }
        return undefined;
      } finally {
        if (mounted.current) {
          setPending(false);
        }
      }
    },
    [],
  );
  return { pending, error, setError, run };
};

export const CopyField = ({
  value,
  label,
}: {
  value: string;
  label: string;
}) => {
  const [copied, setCopied] = useState(false);
  return (
    <div className="plus-copy-field">
      <input
        readOnly
        value={value}
        aria-label={label}
        onFocus={(event) => event.target.select()}
      />
      <SmallButton
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </SmallButton>
    </div>
  );
};

export const timeAgo = (timestamp: number) => {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) {
    return "just now";
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }
  return new Date(timestamp).toLocaleDateString();
};

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("") || "?";

export const AvatarContent = ({
  name,
  avatarUrl,
  imgClassName = "plus-avatar__img",
}: {
  name: string;
  avatarUrl?: string | null;
  imgClassName?: string;
}) => {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [avatarUrl]);

  if (avatarUrl && !imgError) {
    return (
      <img
        className={imgClassName}
        src={avatarUrl}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setImgError(true)}
      />
    );
  }

  return <>{initials(name)}</>;
};

export const PlusAvatar = ({
  name,
  avatarUrl,
  size = "medium",
  className,
}: {
  name: string;
  avatarUrl?: string | null;
  size?: "small" | "medium" | "large";
  className?: string;
}) => (
  <span
    className={clsx(
      "plus-avatar",
      size === "small" && "small",
      size === "large" && "large",
      !!avatarUrl && "has-image",
      className,
    )}
    aria-hidden="true"
  >
    <AvatarContent name={name} avatarUrl={avatarUrl} />
  </span>
);
