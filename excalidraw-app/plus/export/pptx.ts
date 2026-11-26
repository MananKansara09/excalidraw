import { createZip } from "./zip";

import type { ZipEntry } from "./zip";

/**
 * Writes a .pptx with one slide per image, each image fitted and centered on
 * a 16:9 slide. Only the OOXML parts PowerPoint, Keynote and Google Slides
 * require are included.
 */

export type PptxSlide = {
  jpeg: Uint8Array;
  width: number;
  height: number;
  title: string;
};

const SLIDE_W = 12192000; // 13.333in in EMU
const SLIDE_H = 6858000; // 7.5in

const xmlEscape = (value: string) =>
  value.replace(/[<>&"']/g, (c) =>
    c === "<"
      ? "&lt;"
      : c === ">"
      ? "&gt;"
      : c === "&"
      ? "&amp;"
      : c === '"'
      ? "&quot;"
      : "&apos;",
  );

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const NS_R =
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const NS_P =
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const rels = (items: { id: string; type: string; target: string }[]) =>
  `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items
    .map(
      (item) =>
        `<Relationship Id="${item.id}" Type="${REL}/${item.type}" Target="${item.target}"/>`,
    )
    .join("")}</Relationships>`;

const emptyShapeTree = `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>`;

const THEME = `${XML}<a:theme ${NS_A} name="Excalidraw"><a:themeElements><a:clrScheme name="Excalidraw"><a:dk1><a:srgbClr val="1E1E1E"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="343A40"/></a:dk2><a:lt2><a:srgbClr val="F8F9FA"/></a:lt2><a:accent1><a:srgbClr val="6965DB"/></a:accent1><a:accent2><a:srgbClr val="1971C2"/></a:accent2><a:accent3><a:srgbClr val="2F9E44"/></a:accent3><a:accent4><a:srgbClr val="F08C00"/></a:accent4><a:accent5><a:srgbClr val="E03131"/></a:accent5><a:accent6><a:srgbClr val="9C36B5"/></a:accent6><a:hlink><a:srgbClr val="1971C2"/></a:hlink><a:folHlink><a:srgbClr val="6965DB"/></a:folHlink></a:clrScheme><a:fontScheme name="Excalidraw"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Excalidraw"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

const SLIDE_MASTER = `${XML}<p:sldMaster ${NS_A} ${NS_R} ${NS_P}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>${emptyShapeTree}</p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;

const SLIDE_LAYOUT = `${XML}<p:sldLayout ${NS_A} ${NS_R} ${NS_P} type="blank" preserve="1"><p:cSld name="Blank">${emptyShapeTree}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

const fit = (width: number, height: number) => {
  const scale = Math.min(SLIDE_W / width, SLIDE_H / height);
  const cx = Math.round(width * scale);
  const cy = Math.round(height * scale);
  return {
    x: Math.round((SLIDE_W - cx) / 2),
    y: Math.round((SLIDE_H - cy) / 2),
    cx,
    cy,
  };
};

const slideXML = (slide: PptxSlide, background: string) => {
  const box = fit(slide.width, slide.height);
  const title = xmlEscape(slide.title);
  return `${XML}<p:sld ${NS_A} ${NS_R} ${NS_P}><p:cSld name="${title}"><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${background}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:pic><p:nvPicPr><p:cNvPr id="2" name="${title}" descr="${title}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${box.x}" y="${box.y}"/><a:ext cx="${box.cx}" cy="${box.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
};

/** `#rrggbb` / `#rgb` → `RRGGBB`; anything else (e.g. transparent) → white. */
const toHex = (color: string) => {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!match) {
    return "FFFFFF";
  }
  const hex = match[1];
  return (
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex
  ).toUpperCase();
};

export const createPptx = (
  slides: PptxSlide[],
  opts: { title?: string; background?: string } = {},
): Uint8Array => {
  const background = toHex(opts.background ?? "#ffffff");
  const title = xmlEscape(opts.title ?? "Excalidraw");
  const entries: ZipEntry[] = [];

  entries.push({
    path: "[Content_Types].xml",
    data: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/><Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/><Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${slides
      .map(
        (_, i) =>
          `<Override PartName="/ppt/slides/slide${
            i + 1
          }.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
      )
      .join("")}</Types>`,
  });

  entries.push({
    path: "_rels/.rels",
    data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`,
  });

  entries.push({
    path: "docProps/core.xml",
    data: `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${title}</dc:title><dc:creator>Excalidraw</dc:creator></cp:coreProperties>`,
  });
  entries.push({
    path: "docProps/app.xml",
    data: `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Excalidraw</Application><Slides>${slides.length}</Slides></Properties>`,
  });

  // presentation: rId1 master, rId2.. slides, then props and theme
  const slideRelIds = slides.map((_, i) => `rId${i + 2}`);
  const after = slides.length + 2;
  entries.push({
    path: "ppt/presentation.xml",
    data: `${XML}<p:presentation ${NS_A} ${NS_R} ${NS_P} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slideRelIds
      .map((rid, i) => `<p:sldId id="${256 + i}" r:id="${rid}"/>`)
      .join(
        "",
      )}</p:sldIdLst><p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle/></p:presentation>`,
  });
  entries.push({
    path: "ppt/_rels/presentation.xml.rels",
    data: rels([
      {
        id: "rId1",
        type: "slideMaster",
        target: "slideMasters/slideMaster1.xml",
      },
      ...slides.map((_, i) => ({
        id: slideRelIds[i],
        type: "slide",
        target: `slides/slide${i + 1}.xml`,
      })),
      { id: `rId${after}`, type: "presProps", target: "presProps.xml" },
      { id: `rId${after + 1}`, type: "viewProps", target: "viewProps.xml" },
      { id: `rId${after + 2}`, type: "theme", target: "theme/theme1.xml" },
      { id: `rId${after + 3}`, type: "tableStyles", target: "tableStyles.xml" },
    ]),
  });
  entries.push({
    path: "ppt/presProps.xml",
    data: `${XML}<p:presentationPr ${NS_A} ${NS_R} ${NS_P}/>`,
  });
  entries.push({
    path: "ppt/viewProps.xml",
    data: `${XML}<p:viewPr ${NS_A} ${NS_R} ${NS_P}/>`,
  });
  entries.push({
    path: "ppt/tableStyles.xml",
    data: `${XML}<a:tblStyleLst ${NS_A} def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`,
  });
  entries.push({ path: "ppt/theme/theme1.xml", data: THEME });
  entries.push({
    path: "ppt/slideMasters/slideMaster1.xml",
    data: SLIDE_MASTER,
  });
  entries.push({
    path: "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    data: rels([
      {
        id: "rId1",
        type: "slideLayout",
        target: "../slideLayouts/slideLayout1.xml",
      },
      { id: "rId2", type: "theme", target: "../theme/theme1.xml" },
    ]),
  });
  entries.push({
    path: "ppt/slideLayouts/slideLayout1.xml",
    data: SLIDE_LAYOUT,
  });
  entries.push({
    path: "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    data: rels([
      {
        id: "rId1",
        type: "slideMaster",
        target: "../slideMasters/slideMaster1.xml",
      },
    ]),
  });

  slides.forEach((slide, i) => {
    entries.push({
      path: `ppt/slides/slide${i + 1}.xml`,
      data: slideXML(slide, background),
    });
    entries.push({
      path: `ppt/slides/_rels/slide${i + 1}.xml.rels`,
      data: rels([
        {
          id: "rId1",
          type: "slideLayout",
          target: "../slideLayouts/slideLayout1.xml",
        },
        { id: "rId2", type: "image", target: `../media/image${i + 1}.jpeg` },
      ]),
    });
    entries.push({ path: `ppt/media/image${i + 1}.jpeg`, data: slide.jpeg });
  });

  return createZip(entries);
};
