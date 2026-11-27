---
name: excalidraw
description: Drawing clear Excalidraw diagrams - flowcharts, architecture, sequence, mind maps, timelines and wireframes - with the element skeleton format. Use when creating or editing anything on an Excalidraw canvas or in a .excalidraw file.
---

# Excalidraw

## Choose the diagram type

| Content | Layout |
| --- | --- |
| Process with decisions | Flowchart, top to bottom; diamonds for questions, labelled "yes" / "no" arrows |
| System or architecture | Layers left to right (clients, services, data), one frame or colour per layer |
| Messages over time | Sequence: actors in a row, dashed lifelines, arrows stepping downwards |
| Ideas around a topic | Mind map: centre node, one colour per branch |
| Events in order | Timeline: one line, evenly spaced markers, labels alternating sides |
| Data model | One box per entity listing its fields, arrows labelled with cardinality |
| Screen design | Wireframe: a frame per screen, grey boxes, real labels |

More than about 15 nodes: split into frames, or draw an overview and then details.

## Geometry

- Box 160x70; for a longer label allow about 11 px per character at font size 20, or break the line with `\n`.
- Diamonds and ellipses hold less text: make them about 1.5x larger than the text needs.
- Gaps of 60-100 px, and at least 200 px where an arrow carries a label.
- Place a row or column on shared centres so arrows stay straight.
- Order nodes so arrows don't cross or pass through shapes.

## Elements (skeleton format)

- Shapes: `{type: "rectangle"|"ellipse"|"diamond", id, x, y, width, height, label: {text}}`.
- Text: `{type: "text", id, x, y, text, fontSize}`. Titles 28-36, labels 20, notes 16.
- Arrows: `{type: "arrow", id, x, y, start: {id}, end: {id}, label: {text}}`.
- Lines, only for what joins no two shapes (lifelines, axes, dividers): `{type: "line", id, x, y, width, height, strokeStyle: "dashed"}`.
- Frames: `{type: "frame", id, name, children: [elementIds]}`.
- Short readable ids (`api`, `db`, `api-db`).

## Connectors

These hold in every diagram, including ones inside frames and slides:

- Every connection between two shapes is an arrow with both `start: {id}` and `end: {id}`, so it moves with them. Leave out `width` and `height`.
- Create both shapes before the arrow, or in the same call.
- Text on a connection ("yes", "1 : N") goes in the arrow's `label`, never in a separate text element.
- A relation without direction is still an arrow: add `endArrowhead: null`.
- Arrows run straight from shape to shape, so place shapes where a return or loop arrow crosses nothing.

## Style

- Fills `#a5d8ff` blue, `#b2f2bb` green, `#ffec99` yellow, `#ffc9c9` red, `#d0bfff` purple; stroke `#1e1e1e`.
- `fillStyle: "solid"` keeps text readable.
- `roughness: 1` for a sketch, `0` for a formal diagram. Don't mix.
- Dashed lines for optional, asynchronous or planned links.

## Editing an existing canvas

- Keep what's there; add in free space and match its style.
- Recolour with an update. To change a shape's label, size or position, delete it and add it again with the arrows that touch it, so labels and arrows stay attached.

Writing `.excalidraw` files or code that uses the library: read `references/files-and-code.md`.
