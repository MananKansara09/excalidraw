/**
 * Writes a PDF with one page per image. JPEGs embed as-is (DCTDecode), so
 * there's no re-encoding and no dependency.
 */

export type PdfPage = {
  jpeg: Uint8Array;
  /** Pixel size of the JPEG. */
  width: number;
  height: number;
};

const encoder = new TextEncoder();

/** Pages are sized to the image, with the longer side at most 1000pt. */
const pageSize = (width: number, height: number) => {
  const scale = 1000 / Math.max(width, height, 1);
  return {
    w: Math.round(width * scale * 100) / 100,
    h: Math.round(height * scale * 100) / 100,
  };
};

export const createPdf = (
  pages: PdfPage[],
  title = "Excalidraw",
): Uint8Array => {
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: Uint8Array | string) => {
    const bytes = typeof data === "string" ? encoder.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const startObject = (id: number) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
  };

  // object ids: 1 catalog, 2 pages, 3 info, then 3 per page
  // (page, content stream, image)
  const pageIds = pages.map((_, index) => 4 + index * 3);

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

  startObject(1);
  push("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  startObject(2);
  push(
    `<< /Type /Pages /Count ${pages.length} /Kids [${pageIds
      .map((id) => `${id} 0 R`)
      .join(" ")}] >>\nendobj\n`,
  );

  const escapedTitle = title
    .replace(/[\\()]/g, (c) => `\\${c}`)
    .replace(/[^\x20-\x7e]/g, "");
  startObject(3);
  push(`<< /Title (${escapedTitle}) /Producer (Excalidraw) >>\nendobj\n`);

  pages.forEach((page, index) => {
    const pageId = pageIds[index];
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    const { w, h } = pageSize(page.width, page.height);

    startObject(pageId);
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im${index} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`,
    );

    const content = `q\n${w} 0 0 ${h} 0 0 cm\n/Im${index} Do\nQ\n`;
    startObject(contentId);
    push(`<< /Length ${encoder.encode(content).length} >>\nstream\n`);
    push(content);
    push("\nendstream\nendobj\n");

    startObject(imageId);
    push(
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
    );
    push(page.jpeg);
    push("\nendstream\nendobj\n");
  });

  const objectCount = 4 + pages.length * 3;
  const xrefOffset = length;
  let xref = `xref\n0 ${objectCount}\n0000000000 65535 f \n`;
  for (let id = 1; id < objectCount; id++) {
    xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  push(xref);
  push(
    `trailer\n<< /Size ${objectCount} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );

  const out = new Uint8Array(length);
  let position = 0;
  for (const chunk of chunks) {
    out.set(chunk, position);
    position += chunk.length;
  }
  return out;
};
