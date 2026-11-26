export type AvatarStyle =
  | "bot"
  | "cat"
  | "cosmic"
  | "pixel"
  | "shapes"
  | "monogram";

export type AvatarTheme = {
  id: string;
  label: string;
  bg1: string;
  bg2: string;
  accent: string;
  fg: string;
};

export const AVATAR_STYLES: readonly { id: AvatarStyle; label: string }[] = [
  { id: "bot", label: "Bot" },
  { id: "cat", label: "Cat" },
  { id: "cosmic", label: "Cosmic" },
  { id: "pixel", label: "Pixel" },
  { id: "shapes", label: "Shapes" },
  { id: "monogram", label: "Initials" },
];

export const AVATAR_THEMES: readonly AvatarTheme[] = [
  {
    id: "indigo",
    label: "Indigo",
    bg1: "#4f46e5",
    bg2: "#7c3aed",
    accent: "#c4b5fd",
    fg: "#ffffff",
  },
  {
    id: "ocean",
    label: "Ocean",
    bg1: "#0284c7",
    bg2: "#0d9488",
    accent: "#99f6e4",
    fg: "#ffffff",
  },
  {
    id: "sunset",
    label: "Sunset",
    bg1: "#ea580c",
    bg2: "#db2777",
    accent: "#fed7aa",
    fg: "#ffffff",
  },
  {
    id: "emerald",
    label: "Emerald",
    bg1: "#059669",
    bg2: "#16a34a",
    accent: "#bbf7d0",
    fg: "#ffffff",
  },
  {
    id: "berry",
    label: "Berry",
    bg1: "#9333ea",
    bg2: "#e11d48",
    accent: "#fbcfe8",
    fg: "#ffffff",
  },
  {
    id: "amber",
    label: "Amber",
    bg1: "#d97706",
    bg2: "#e11d48",
    accent: "#fef08a",
    fg: "#ffffff",
  },
  {
    id: "coral",
    label: "Coral",
    bg1: "#f43f5e",
    bg2: "#fb923c",
    accent: "#ffe4e6",
    fg: "#ffffff",
  },
  {
    id: "midnight",
    label: "Midnight",
    bg1: "#1e293b",
    bg2: "#334155",
    accent: "#38bdf8",
    fg: "#f8fafc",
  },
];

const hashSeed = (seed: number) => {
  let x = (seed ^ 0x9e3779b9) >>> 0;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0xffffffff;
  };
};

const escapeXml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const getInitials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => Array.from(part)[0]?.toUpperCase() ?? "")
    .join("") || "?";

const renderBot = (rand: () => number, theme: AvatarTheme) => {
  const eyeKind = Math.floor(rand() * 3);
  const mouthKind = Math.floor(rand() * 3);
  const antenna = rand() > 0.35;
  const visor =
    eyeKind === 0
      ? `<rect x="34" y="47" width="60" height="22" rx="11" fill="#0f172a"/><circle cx="50" cy="58" r="5" fill="${theme.accent}"/><circle cx="78" cy="58" r="5" fill="${theme.accent}"/>`
      : eyeKind === 1
      ? `<circle cx="49" cy="56" r="8" fill="#0f172a"/><circle cx="79" cy="56" r="8" fill="#0f172a"/><circle cx="51" cy="54" r="3" fill="${theme.fg}"/><circle cx="81" cy="54" r="3" fill="${theme.fg}"/>`
      : `<rect x="39" y="52" width="18" height="8" rx="4" fill="#0f172a"/><rect x="71" y="52" width="18" height="8" rx="4" fill="#0f172a"/>`;
  const mouth =
    mouthKind === 0
      ? `<rect x="46" y="78" width="36" height="8" rx="4" fill="#0f172a"/>`
      : mouthKind === 1
      ? `<path d="M48 79 Q64 90 80 79" stroke="#0f172a" stroke-width="5" stroke-linecap="round" fill="none"/>`
      : `<circle cx="54" cy="81" r="3.5" fill="#0f172a"/><circle cx="64" cy="81" r="3.5" fill="#0f172a"/><circle cx="74" cy="81" r="3.5" fill="#0f172a"/>`;

  return `${
    antenna
      ? `<line x1="64" y1="16" x2="64" y2="30" stroke="${theme.accent}" stroke-width="5" stroke-linecap="round"/><circle cx="64" cy="14" r="6" fill="${theme.accent}"/>`
      : ""
  }<rect x="20" y="50" width="10" height="24" rx="5" fill="${
    theme.accent
  }"/><rect x="98" y="50" width="10" height="24" rx="5" fill="${
    theme.accent
  }"/><rect x="28" y="30" width="72" height="68" rx="22" fill="${
    theme.fg
  }" fill-opacity="0.94"/>${visor}${mouth}`;
};

const renderCat = (rand: () => number, theme: AvatarTheme) => {
  const happy = rand() > 0.5;
  const blush = rand() > 0.3;
  const eyes = happy
    ? `<path d="M42 60 Q48 52 54 60" stroke="#0f172a" stroke-width="4.5" stroke-linecap="round" fill="none"/><path d="M74 60 Q80 52 86 60" stroke="#0f172a" stroke-width="4.5" stroke-linecap="round" fill="none"/>`
    : `<circle cx="48" cy="58" r="5.5" fill="#0f172a"/><circle cx="80" cy="58" r="5.5" fill="#0f172a"/><circle cx="50" cy="56" r="2" fill="#ffffff"/><circle cx="82" cy="56" r="2" fill="#ffffff"/>`;

  return `<path d="M32 54 L28 24 L54 40 Z" fill="${
    theme.fg
  }"/><path d="M96 54 L100 24 L74 40 Z" fill="${
    theme.fg
  }"/><path d="M35 48 L33 31 L49 41 Z" fill="${
    theme.accent
  }"/><path d="M93 48 L95 31 L79 41 Z" fill="${
    theme.accent
  }"/><circle cx="64" cy="66" r="34" fill="${theme.fg}"/>${eyes}${
    blush
      ? `<circle cx="39" cy="70" r="5.5" fill="${theme.accent}" fill-opacity="0.75"/><circle cx="89" cy="70" r="5.5" fill="${theme.accent}" fill-opacity="0.75"/>`
      : ""
  }<polygon points="60,67 68,67 64,73" fill="#0f172a"/><path d="M56 77 Q60 82 64 76 Q68 82 72 77" stroke="#0f172a" stroke-width="3.5" stroke-linecap="round" fill="none"/>`;
};

const renderCosmic = (rand: () => number, theme: AvatarTheme) => {
  const tilt = -28 + Math.floor(rand() * 56);
  const planetR = 22 + Math.floor(rand() * 6);
  const s1x = 24 + Math.floor(rand() * 18);
  const s1y = 24 + Math.floor(rand() * 20);
  const s2x = 86 + Math.floor(rand() * 20);
  const s2y = 22 + Math.floor(rand() * 24);
  return `<circle cx="${s1x}" cy="${s1y}" r="2.8" fill="${theme.fg}" fill-opacity="0.9"/><circle cx="${s2x}" cy="${s2y}" r="2.2" fill="${theme.accent}"/><circle cx="96" cy="96" r="3" fill="${theme.fg}" fill-opacity="0.8"/><circle cx="28" cy="94" r="2" fill="${theme.accent}"/><g transform="rotate(${tilt} 64 64)"><ellipse cx="64" cy="64" rx="46" ry="13" fill="none" stroke="${theme.accent}" stroke-width="5" stroke-opacity="0.75"/><circle cx="64" cy="64" r="${planetR}" fill="${theme.fg}"/><path d="M18 64 A46 13 0 0 0 110 64" fill="none" stroke="${theme.accent}" stroke-width="5"/></g>`;
};

const renderPixel = (rand: () => number, theme: AvatarTheme) => {
  const cells: string[] = [];
  const cell = 14;
  const start = 29;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      const on = rand() > 0.42 || (row === 2 && col === 2);
      if (!on) {
        continue;
      }
      const fill = rand() > 0.3 ? theme.fg : theme.accent;
      const x1 = start + col * cell;
      const y = start + row * cell;
      cells.push(
        `<rect x="${x1}" y="${y}" width="${cell}" height="${cell}" rx="2.5" fill="${fill}"/>`,
      );
      if (col < 2) {
        const x2 = start + (4 - col) * cell;
        cells.push(
          `<rect x="${x2}" y="${y}" width="${cell}" height="${cell}" rx="2.5" fill="${fill}"/>`,
        );
      }
    }
  }
  return cells.join("");
};

const renderShapes = (rand: () => number, theme: AvatarTheme) => {
  const cx1 = 36 + Math.floor(rand() * 24);
  const cy1 = 36 + Math.floor(rand() * 24);
  const cx2 = 66 + Math.floor(rand() * 28);
  const cy2 = 62 + Math.floor(rand() * 30);
  const rot = Math.floor(rand() * 180);
  return `<circle cx="${cx1}" cy="${cy1}" r="26" fill="${theme.accent}" fill-opacity="0.78"/><circle cx="${cx2}" cy="${cy2}" r="22" fill="${theme.fg}" fill-opacity="0.92"/><rect x="44" y="44" width="40" height="40" rx="10" transform="rotate(${rot} 64 64)" fill="${theme.bg1}" fill-opacity="0.65" stroke="${theme.fg}" stroke-width="4"/>`;
};

const renderMonogram = (
  rand: () => number,
  theme: AvatarTheme,
  name: string,
) => {
  const label = escapeXml(getInitials(name));
  const ringR = 52;
  const dash = 12 + Math.floor(rand() * 14);
  return `<circle cx="64" cy="64" r="${ringR}" fill="none" stroke="${
    theme.accent
  }" stroke-opacity="0.45" stroke-width="3" stroke-dasharray="${dash} 8"/><text x="64" y="66" text-anchor="middle" dominant-baseline="central" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-weight="700" font-size="${
    label.length > 1 ? 44 : 52
  }" fill="${theme.fg}">${label}</text>`;
};

export const generateAvatarDataURL = ({
  style,
  themeId,
  seed,
  name,
}: {
  style: AvatarStyle;
  themeId: string;
  seed: number;
  name: string;
}): string => {
  const theme = AVATAR_THEMES.find((t) => t.id === themeId) ?? AVATAR_THEMES[0];
  const rand = hashSeed(seed);
  const angle = Math.floor(rand() * 360);

  let artwork = "";
  switch (style) {
    case "bot":
      artwork = renderBot(rand, theme);
      break;
    case "cat":
      artwork = renderCat(rand, theme);
      break;
    case "cosmic":
      artwork = renderCosmic(rand, theme);
      break;
    case "pixel":
      artwork = renderPixel(rand, theme);
      break;
    case "shapes":
      artwork = renderShapes(rand, theme);
      break;
    case "monogram":
      artwork = renderMonogram(rand, theme, name);
      break;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><defs><linearGradient id="g" gradientTransform="rotate(${angle} 0.5 0.5)"><stop offset="0%" stop-color="${theme.bg1}"/><stop offset="100%" stop-color="${theme.bg2}"/></linearGradient></defs><rect width="128" height="128" fill="url(#g)"/>${artwork}</svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

export const getAvatarPresets = (name: string) => {
  const combos: { style: AvatarStyle; themeId: string; seed: number }[] = [
    { style: "bot", themeId: "indigo", seed: 101 },
    { style: "cat", themeId: "sunset", seed: 202 },
    { style: "cosmic", themeId: "midnight", seed: 303 },
    { style: "pixel", themeId: "ocean", seed: 404 },
    { style: "shapes", themeId: "berry", seed: 505 },
    { style: "monogram", themeId: "emerald", seed: 606 },
    { style: "bot", themeId: "coral", seed: 707 },
    { style: "cat", themeId: "amber", seed: 808 },
    { style: "cosmic", themeId: "indigo", seed: 909 },
    { style: "pixel", themeId: "berry", seed: 1010 },
    { style: "shapes", themeId: "ocean", seed: 1111 },
    { style: "monogram", themeId: "sunset", seed: 1212 },
  ];
  return combos.map((combo) => ({
    ...combo,
    url: generateAvatarDataURL({ ...combo, name }),
  }));
};

const AVATAR_OUTPUT_PX = 256;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Loads a user-selected image file, center-crops it to a square, and scales
 * it down to a compact 256×256 data URL suitable for syncing and DB storage.
 */
export const readImageFileAsAvatarDataURL = (
  file: File,
  ownerDocument: Document = document,
): Promise<string> => {
  if (!file.type.startsWith("image/")) {
    return Promise.reject(new Error("Please select an image file"));
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return Promise.reject(new Error("Image must be smaller than 10 MB"));
  }

  return new Promise((resolve, reject) => {
    const objectURL = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = ownerDocument.createElement("canvas");
        canvas.width = AVATAR_OUTPUT_PX;
        canvas.height = AVATAR_OUTPUT_PX;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          throw new Error("Could not prepare image canvas");
        }
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const sx = Math.floor((img.naturalWidth - side) / 2);
        const sy = Math.floor((img.naturalHeight - side) / 2);
        ctx.drawImage(
          img,
          sx,
          sy,
          side,
          side,
          0,
          0,
          AVATAR_OUTPUT_PX,
          AVATAR_OUTPUT_PX,
        );
        let dataURL = canvas.toDataURL("image/webp", 0.85);
        if (!dataURL.startsWith("data:image/webp")) {
          dataURL = canvas.toDataURL("image/png");
        }
        if (dataURL.length > 280_000) {
          dataURL = canvas.toDataURL("image/jpeg", 0.8);
        }
        resolve(dataURL);
      } catch (error) {
        reject(
          error instanceof Error ? error : new Error("Couldn't process image"),
        );
      } finally {
        URL.revokeObjectURL(objectURL);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectURL);
      reject(new Error("Couldn't read that image file"));
    };
    img.src = objectURL;
  });
};
