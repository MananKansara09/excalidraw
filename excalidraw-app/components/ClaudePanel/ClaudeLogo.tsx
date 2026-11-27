// The Claude starburst, drawn from the supplied image. It is rendered as a
// CSS mask filled with currentColor so it follows the surrounding text colour
// (white on the orange tiles, like the original inline SVG).
import starburstUrl from "./claude-starburst.png";

export const ClaudeLogo = ({
  size = 20,
  className,
}: {
  size?: number;
  className?: string;
}) => (
  <span
    role="presentation"
    aria-hidden
    className={`claude-logo${className ? ` ${className}` : ""}`}
    style={{
      display: "inline-block",
      flexShrink: 0,
      width: size,
      height: size,
      backgroundColor: "currentColor",
      WebkitMaskImage: `url(${starburstUrl})`,
      maskImage: `url(${starburstUrl})`,
      WebkitMaskSize: "contain",
      maskSize: "contain",
      WebkitMaskRepeat: "no-repeat",
      maskRepeat: "no-repeat",
      WebkitMaskPosition: "center",
      maskPosition: "center",
    }}
  />
);
