import logoUrl from "./codex-logo.svg?url";

export const CodexLogo = ({
  size = 20,
  className,
}: {
  size?: number;
  className?: string;
}) => (
  <img
    src={logoUrl}
    alt=""
    aria-hidden
    draggable={false}
    className={`codex-logo${className ? ` ${className}` : ""}`}
    style={{ width: size, height: size, flexShrink: 0 }}
  />
);
