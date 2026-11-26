import { randomInt } from "node:crypto";

import { newId } from "./db.ts";
import { badRequest } from "./http.ts";

import type { SceneElement } from "./scenes.ts";

/**
 * A compact element description for API and MCP clients. The server expands
 * it into full Excalidraw elements: shapes get bound text labels and arrows
 * can bind to shapes by id.
 */
export type SimpleElement = {
  id?: string;
  type:
    | "rectangle"
    | "ellipse"
    | "diamond"
    | "text"
    | "arrow"
    | "line"
    | "frame";
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  label?: string;
  text?: string;
  name?: string;
  strokeColor?: string;
  backgroundColor?: string;
  fontSize?: number;
  /** For arrows/lines: points relative to (x, y). */
  points?: [number, number][];
  /** For arrows: ids of the shapes to connect. */
  start?: string;
  end?: string;
};

const SIMPLE_TYPES = [
  "rectangle",
  "ellipse",
  "diamond",
  "text",
  "arrow",
  "line",
  "frame",
] as const;

const FONT_FAMILY_EXCALIFONT = 5;
const LINE_HEIGHT = 1.25;

const base = (type: string, props: Partial<SceneElement>): SceneElement => ({
  id: newId(10),
  type,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 1,
  opacity: 100,
  groupIds: [],
  frameId: null,
  index: null,
  roundness: null,
  seed: randomInt(2 ** 31),
  version: 1,
  versionNonce: randomInt(2 ** 31),
  isDeleted: false,
  boundElements: [],
  updated: Date.now(),
  link: null,
  locked: false,
  ...props,
});

const measureText = (text: string, fontSize: number) => {
  const lines = text.split("\n");
  const longest = Math.max(...lines.map((line) => line.length), 1);
  return {
    width: Math.ceil(longest * fontSize * 0.6),
    height: Math.ceil(lines.length * fontSize * LINE_HEIGHT),
  };
};

const textElement = (
  text: string,
  props: Partial<SceneElement> & { fontSize?: number },
) => {
  const fontSize = props.fontSize ?? 20;
  const size = measureText(text, fontSize);
  return base("text", {
    width: size.width,
    height: size.height,
    text,
    originalText: text,
    fontSize,
    fontFamily: FONT_FAMILY_EXCALIFONT,
    textAlign: props.containerId ? "center" : "left",
    verticalAlign: props.containerId ? "middle" : "top",
    containerId: null,
    autoResize: true,
    lineHeight: LINE_HEIGHT,
    ...props,
  });
};

const num = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

type Box = { id: string; x: number; y: number; width: number; height: number };

/** Picks the facing sides of two boxes for an arrow between them. */
const connect = (from: Box, to: Box) => {
  const fc = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const tc = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  const horizontal = Math.abs(tc.x - fc.x) >= Math.abs(tc.y - fc.y);
  const startFixed: [number, number] = horizontal
    ? [tc.x >= fc.x ? 1 : 0, 0.5]
    : [0.5, tc.y >= fc.y ? 1 : 0];
  const endFixed: [number, number] = [1 - startFixed[0], 1 - startFixed[1]];
  if (horizontal) {
    endFixed[1] = 0.5;
  } else {
    endFixed[0] = 0.5;
  }
  const start = {
    x: from.x + from.width * startFixed[0],
    y: from.y + from.height * startFixed[1],
  };
  const end = {
    x: to.x + to.width * endFixed[0],
    y: to.y + to.height * endFixed[1],
  };
  return { start, end, startFixed, endFixed };
};

/**
 * Expands simple element descriptions. `existing` lets arrows bind to shapes
 * already in the scene.
 */
export const expandSimpleElements = (
  input: unknown,
  existing: SceneElement[] = [],
): SceneElement[] => {
  if (!Array.isArray(input)) {
    throw badRequest('"elements" must be an array');
  }
  const out: SceneElement[] = [];
  const shapes = new Map<string, SceneElement>();
  for (const element of existing) {
    if (!element.isDeleted) {
      shapes.set(element.id, element);
    }
  }

  let cursorY = 0;
  const arrows: SimpleElement[] = [];

  for (const raw of input as SimpleElement[]) {
    if (!raw || !SIMPLE_TYPES.includes(raw.type)) {
      throw badRequest(
        `Each element needs a "type" of: ${SIMPLE_TYPES.join(", ")}`,
      );
    }
    if (raw.type === "arrow" || raw.type === "line") {
      arrows.push(raw);
      continue;
    }
    const id = typeof raw.id === "string" && raw.id ? raw.id : newId(10);
    const x = num(raw.x, 0);
    const y = num(raw.y, cursorY);
    const colors = {
      ...(raw.strokeColor ? { strokeColor: raw.strokeColor } : {}),
      ...(raw.backgroundColor ? { backgroundColor: raw.backgroundColor } : {}),
    };

    if (raw.type === "text") {
      const text = textElement(String(raw.text ?? raw.label ?? ""), {
        id,
        x,
        y,
        fontSize: num(raw.fontSize, 20),
        ...colors,
      });
      out.push(text);
      cursorY = Math.max(cursorY, y + (text.height as number) + 40);
      continue;
    }

    if (raw.type === "frame") {
      const frame = base("frame", {
        id,
        x,
        y,
        width: num(raw.width, 800),
        height: num(raw.height, 450),
        name: raw.name ?? raw.label ?? null,
        strokeColor: "#bbb",
        roughness: 0,
        strokeWidth: 2,
      });
      out.push(frame);
      shapes.set(id, frame);
      cursorY = Math.max(cursorY, y + (frame.height as number) + 40);
      continue;
    }

    const shape = base(raw.type, {
      id,
      x,
      y,
      width: num(raw.width, 160),
      height: num(raw.height, 80),
      roundness: raw.type === "rectangle" ? { type: 3 } : { type: 2 },
      ...colors,
    });
    out.push(shape);
    shapes.set(id, shape);
    const label = raw.label ?? raw.text;
    if (label) {
      const text = textElement(String(label), {
        containerId: id,
        fontSize: num(raw.fontSize, 20),
        ...(raw.strokeColor ? { strokeColor: raw.strokeColor } : {}),
      });
      text.x =
        (shape.x as number) +
        ((shape.width as number) - (text.width as number)) / 2;
      text.y =
        (shape.y as number) +
        ((shape.height as number) - (text.height as number)) / 2;
      (shape.boundElements as any[]).push({ id: text.id, type: "text" });
      out.push(text);
    }
    cursorY = Math.max(cursorY, y + (shape.height as number) + 40);
  }

  for (const raw of arrows) {
    const id = typeof raw.id === "string" && raw.id ? raw.id : newId(10);
    const from = raw.start ? shapes.get(raw.start) : undefined;
    const to = raw.end ? shapes.get(raw.end) : undefined;
    if ((raw.start && !from) || (raw.end && !to)) {
      throw badRequest(
        `Arrow "${id}" connects to an element that doesn't exist (${
          raw.start ?? ""
        } → ${raw.end ?? ""})`,
      );
    }
    let x: number;
    let y: number;
    let points: [number, number][];
    let startBinding = null;
    let endBinding = null;
    if (from && to && raw.type === "arrow") {
      const link = connect(from as unknown as Box, to as unknown as Box);
      x = link.start.x;
      y = link.start.y;
      points = [
        [0, 0],
        [link.end.x - x, link.end.y - y],
      ];
      startBinding = {
        elementId: from.id,
        fixedPoint: link.startFixed,
        mode: "orbit",
      };
      endBinding = {
        elementId: to.id,
        fixedPoint: link.endFixed,
        mode: "orbit",
      };
    } else {
      x = num(raw.x, 0);
      y = num(raw.y, 0);
      points =
        Array.isArray(raw.points) && raw.points.length >= 2
          ? raw.points.map(
              (p) => [num(p?.[0], 0), num(p?.[1], 0)] as [number, number],
            )
          : [
              [0, 0],
              [num(raw.width, 200), num(raw.height, 0)],
            ];
    }
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const arrow = base(raw.type, {
      id,
      x,
      y,
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
      points,
      roundness: { type: 2 },
      startBinding,
      endBinding,
      startArrowhead: null,
      endArrowhead: raw.type === "arrow" ? "arrow" : null,
      elbowed: false,
      ...(raw.strokeColor ? { strokeColor: raw.strokeColor } : {}),
    });
    out.push(arrow);
    for (const bound of [from, to]) {
      if (bound && startBinding) {
        // shapes created in this batch are in `out`; existing ones get a new
        // version so the binding reaches clients through the merge
        const target = out.find((element) => element.id === bound.id);
        if (target) {
          (target.boundElements as any[]).push({ id, type: "arrow" });
        } else {
          out.push({
            ...bound,
            boundElements: [
              ...((bound.boundElements as any[]) ?? []),
              { id, type: "arrow" },
            ],
            version: (bound.version ?? 0) + 1,
            versionNonce: randomInt(2 ** 31),
            updated: Date.now(),
          });
        }
      }
    }
    if (raw.label) {
      const text = textElement(String(raw.label), {
        containerId: id,
        fontSize: num(raw.fontSize, 16),
      });
      const mid = points[Math.floor(points.length / 2)];
      text.x = x + mid[0] / 2 - (text.width as number) / 2;
      text.y = y + mid[1] / 2 - (text.height as number) / 2;
      (arrow.boundElements as any[]).push({ id: text.id, type: "text" });
      out.push(text);
    }
  }
  return out;
};

/** A readable digest of a scene for agents: what's drawn and where. */
export const describeElements = (elements: SceneElement[]) => {
  const live = elements.filter((element) => !element.isDeleted);
  const labels = new Map<string, string>();
  for (const element of live) {
    if (element.type === "text" && element.containerId) {
      labels.set(element.containerId as string, element.text as string);
    }
  }
  return live
    .filter((element) => !(element.type === "text" && element.containerId))
    .map((element) => {
      const summary: Record<string, unknown> = {
        id: element.id,
        type: element.type,
        x: Math.round(element.x as number),
        y: Math.round(element.y as number),
        width: Math.round(element.width as number),
        height: Math.round(element.height as number),
      };
      if (element.type === "text") {
        summary.text = element.text;
      }
      if (labels.has(element.id)) {
        summary.label = labels.get(element.id);
      }
      if (element.type === "frame" && element.name) {
        summary.name = element.name;
      }
      if (element.startBinding) {
        summary.start = (element.startBinding as any).elementId;
      }
      if (element.endBinding) {
        summary.end = (element.endBinding as any).elementId;
      }
      if (element.frameId) {
        summary.frameId = element.frameId;
      }
      if (
        element.backgroundColor &&
        element.backgroundColor !== "transparent"
      ) {
        summary.backgroundColor = element.backgroundColor;
      }
      return summary;
    });
};
