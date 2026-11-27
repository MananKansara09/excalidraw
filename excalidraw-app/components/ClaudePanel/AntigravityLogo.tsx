import logoUrl from "./antigravity-logo.png";

export const AntigravityLogo = ({
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
    className={`antigravity-logo${className ? ` ${className}` : ""}`}
    // the artwork has a wide clear margin: draw it larger than its slot
    style={{ width: size, height: size, flexShrink: 0, scale: "1.3" }}
  />
);
