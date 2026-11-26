import { safeNextURL } from "../plus/auth";
import {
  AVATAR_STYLES,
  AVATAR_THEMES,
  generateAvatarDataURL,
  getAvatarPresets,
} from "../plus/avatar";
import { parseCloudHash } from "../plus/cloud";
import { getOrderedFrames } from "../plus/export/frames";
import { createPdf } from "../plus/export/pdf";
import { createPptx } from "../plus/export/pptx";
import { crc32, createZip } from "../plus/export/zip";

// 1×1 white JPEG
const JPEG = Uint8Array.from(
  atob(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=",
  ),
  (c) => c.charCodeAt(0),
);

const decoder = new TextDecoder("latin1");

/** Reads the stored entries of a ZIP back (STORE only). */
const readZip = (zip: Uint8Array) => {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const entries = new Map<string, Uint8Array>();
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const name = new TextDecoder().decode(
      zip.subarray(offset + 30, offset + 30 + nameLength),
    );
    const start = offset + 30 + nameLength;
    const data = zip.subarray(start, start + size);
    expect(view.getUint32(offset + 14, true)).toBe(crc32(data));
    entries.set(name, data);
    offset = start + size;
  }
  return entries;
};

describe("parseCloudHash", () => {
  it("reads cloud scene, share and embed links", () => {
    expect(parseCloudHash("#cloud=abc")).toEqual({
      sceneId: "abc",
      shareToken: null,
      embed: false,
    });
    expect(parseCloudHash("#share=tok&embed=1")).toEqual({
      sceneId: null,
      shareToken: "tok",
      embed: true,
    });
    expect(parseCloudHash("#json=1,2")).toBe(null);
    expect(parseCloudHash("")).toBe(null);
  });
});

describe("getOrderedFrames", () => {
  const frame = (id: string, x: number, y: number, isDeleted = false) =>
    ({ id, type: "frame", x, y, isDeleted } as any);

  it("puts listed frames first, then the rest in reading order", () => {
    const elements = [
      frame("c", 0, 500),
      frame("b", 500, 0),
      frame("a", 0, 0),
      frame("gone", 0, 0, true),
      { id: "r", type: "rectangle", x: 0, y: 0, isDeleted: false } as any,
    ];
    expect(getOrderedFrames(elements).map((f) => f.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(
      getOrderedFrames(elements, ["c", "missing", "gone"]).map((f) => f.id),
    ).toEqual(["c", "a", "b"]);
  });
});

describe("createZip", () => {
  it("round-trips entries with valid checksums", () => {
    const zip = createZip([
      { path: "a.txt", data: "hello" },
      { path: "dir/b.bin", data: new Uint8Array([1, 2, 3]) },
    ]);
    const entries = readZip(zip);
    expect(new TextDecoder().decode(entries.get("a.txt"))).toBe("hello");
    expect([...entries.get("dir/b.bin")!]).toEqual([1, 2, 3]);
    // end of central directory lists both entries
    const view = new DataView(zip.buffer);
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
  });
});

describe("createPdf", () => {
  it("writes one page per image with a valid xref table", () => {
    const pdf = createPdf(
      [
        { jpeg: JPEG, width: 1600, height: 900 },
        { jpeg: JPEG, width: 900, height: 1600 },
      ],
      "My (deck)",
    );
    const text = decoder.decode(pdf);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/Count 2");
    expect(text).toContain("/MediaBox [0 0 1000 562.5]");
    expect(text).toContain("/MediaBox [0 0 562.5 1000]");
    expect(text).toContain("/Title (My \\(deck\\))");

    // every xref offset points at its object header
    const startxref = Number(/startxref\n(\d+)/.exec(text)![1]);
    const xref = text.slice(startxref);
    const offsets = [...xref.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) =>
      Number(m[1]),
    );
    expect(offsets.length).toBe(3 + 2 * 3);
    offsets.forEach((offset, index) => {
      expect(text.slice(offset, offset + 12)).toMatch(
        new RegExp(`^${index + 1} 0 obj`),
      );
    });
  });
});

describe("createPptx", () => {
  it("packages slides, images and relationships", () => {
    const pptx = createPptx(
      [
        { jpeg: JPEG, width: 1600, height: 900, title: "Intro & <goals>" },
        { jpeg: JPEG, width: 800, height: 800, title: "Square" },
      ],
      { title: "Deck", background: "#fff" },
    );
    const entries = readZip(pptx);
    const text = (path: string) => new TextDecoder().decode(entries.get(path));

    expect(entries.has("[Content_Types].xml")).toBe(true);
    expect(text("ppt/presentation.xml")).toContain(
      '<p:sldId id="257" r:id="rId3"/>',
    );
    expect(text("ppt/_rels/presentation.xml.rels")).toContain(
      'Target="slides/slide2.xml"',
    );
    expect(text("ppt/slides/slide1.xml")).toContain(
      'name="Intro &amp; &lt;goals&gt;"',
    );
    expect(text("ppt/slides/slide1.xml")).toContain(
      '<a:srgbClr val="FFFFFF"/>',
    );
    // the square image is centered on the 16:9 slide
    expect(text("ppt/slides/slide2.xml")).toContain(
      '<a:off x="2667000" y="0"/><a:ext cx="6858000" cy="6858000"/>',
    );
    expect(entries.get("ppt/media/image2.jpeg")).toEqual(JPEG);
    expect(text("[Content_Types].xml")).toContain("/ppt/slides/slide2.xml");
  });
});

describe("safeNextURL", () => {
  it("allows same-origin paths only", () => {
    expect(safeNextURL("/#cloud=abc")).toBe("/#cloud=abc");
    expect(safeNextURL("/?x=1#share=t")).toBe("/?x=1#share=t");
    for (const unsafe of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      // eslint-disable-next-line no-script-url
      "javascript:alert(1)",
      "",
      null,
    ]) {
      expect(safeNextURL(unsafe)).toBe("/");
    }
  });
});

describe("avatar generator", () => {
  it("creates valid SVG data URLs for all styles and themes", () => {
    for (const style of AVATAR_STYLES) {
      const url = generateAvatarDataURL({
        style: style.id,
        themeId: AVATAR_THEMES[0].id,
        seed: 42,
        name: "Manan Kansara",
      });
      expect(url.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
      const svg = decodeURIComponent(
        url.slice("data:image/svg+xml;charset=utf-8,".length),
      );
      expect(svg).toContain("<svg");
      expect(svg).not.toContain("<script");
    }

    const mono = generateAvatarDataURL({
      style: "monogram",
      themeId: "sunset",
      seed: 1,
      name: "Manan <Kansara>",
    });
    const monoSvg = decodeURIComponent(
      mono.slice("data:image/svg+xml;charset=utf-8,".length),
    );
    expect(monoSvg).toContain("M&lt;");

    const presets = getAvatarPresets("Ada Lovelace");
    expect(presets.length).toBe(12);
    expect(new Set(presets.map((p) => p.url)).size).toBe(12);
  });
});
