// The Claude starburst: twelve uneven, slightly flared rays around a centre.

const RAYS: [angle: number, length: number][] = [
  [-86, 44],
  [-58, 37],
  [-31, 45],
  [-3, 36],
  [26, 44],
  [54, 36],
  [84, 45],
  [112, 37],
  [141, 44],
  [168, 35],
  [199, 45],
  [229, 37],
];

const rad = (deg: number) => (deg * Math.PI) / 180;

const PATH = RAYS.map(([angle, length]) => {
  const a = rad(angle);
  const [dx, dy] = [Math.cos(a), Math.sin(a)];
  const [px, py] = [-dy, dx];
  const baseW = 2.6;
  const tipW = 4.6;
  const r0 = 6;
  const pt = (r: number, w: number) =>
    `${(50 + dx * r + px * w).toFixed(2)} ${(50 + dy * r + py * w).toFixed(2)}`;
  return `M${pt(r0, -baseW)}L${pt(length, -tipW)}L${pt(length, tipW)}L${pt(
    r0,
    baseW,
  )}Z`;
}).join("");

export const ClaudeLogo = ({
  size = 20,
  color = "currentColor",
  className,
}: {
  size?: number;
  color?: string;
  className?: string;
}) => (
  <svg
    viewBox="0 0 100 100"
    width={size}
    height={size}
    className={className}
    aria-hidden
  >
    <path
      d={PATH}
      fill={color}
      stroke={color}
      strokeWidth="2.4"
      strokeLinejoin="round"
    />
    <circle cx="50" cy="50" r="9" fill={color} />
  </svg>
);
