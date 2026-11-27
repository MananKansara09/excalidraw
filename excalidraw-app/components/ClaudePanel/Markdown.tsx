// A small, dependency-free Markdown renderer for chat replies. It builds React
// elements (never raw HTML), so model output can't inject markup, and it
// tolerates half-streamed input (an unclosed ``` fence is shown as code).

import clsx from "clsx";
import { Fragment, memo, useState } from "react";

import type { ReactNode } from "react";

// ---- inline ---------------------------------------------------------------------

const SAFE_URL = /^(https?:|mailto:|#)/i;

const INLINE =
  /(`+)([\s\S]+?)\1|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|~~([\s\S]+?)~~|\*([^\s*][\s\S]*?)\*|(?<![\w])_([^\s_][\s\S]*?)_(?![\w])|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

const renderInline = (text: string, keyBase = "i"): ReactNode[] => {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const index = m.index ?? 0;
    if (index > last) {
      out.push(text.slice(last, index));
    }
    const key = `${keyBase}-${n++}`;
    if (m[2] !== undefined) {
      out.push(
        <code key={key} className="md-inline-code">
          {m[2].trim()}
        </code>,
      );
    } else if (m[3] !== undefined || m[4] !== undefined) {
      out.push(<strong key={key}>{renderInline(m[3] ?? m[4], key)}</strong>);
    } else if (m[5] !== undefined) {
      out.push(<del key={key}>{renderInline(m[5], key)}</del>);
    } else if (m[6] !== undefined || m[7] !== undefined) {
      out.push(<em key={key}>{renderInline(m[6] ?? m[7], key)}</em>);
    } else if (m[8] !== undefined) {
      out.push(
        SAFE_URL.test(m[9]) ? (
          <a key={key} href={m[9]} target="_blank" rel="noopener noreferrer">
            {renderInline(m[8], key)}
          </a>
        ) : (
          m[0]
        ),
      );
    } else if (m[10] !== undefined) {
      out.push(
        <a key={key} href={m[10]} target="_blank" rel="noopener noreferrer">
          {m[10]}
        </a>,
      );
    }
    last = index + m[0].length;
  }
  if (last < text.length) {
    out.push(text.slice(last));
  }
  return out;
};

/** paragraph text: keep the author's line breaks */
const renderLines = (lines: string[], keyBase: string): ReactNode[] =>
  lines.flatMap((line, i) => [
    i > 0 ? <br key={`${keyBase}-br${i}`} /> : null,
    ...renderInline(line, `${keyBase}-${i}`),
  ]);

// ---- code -----------------------------------------------------------------------

const KEYWORDS = new Set(
  (
    "const let var function return if else for while do switch case break continue new class extends " +
    "import export from default async await try catch finally throw typeof instanceof in of null true " +
    "false undefined this super def lambda None True False self pass raise with as yield not and or " +
    "is elif except select insert update delete create table where join group order by limit values " +
    "into primary key foreign references interface type enum public private static void int string " +
    "boolean number fn pub struct impl use mut let match"
  ).split(" "),
);

const TOKEN =
  /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|--[^\n]*)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g;

const NO_HIGHLIGHT = new Set(["", "text", "txt", "plain", "markdown", "md"]);

const highlight = (code: string, lang: string): ReactNode[] => {
  if (NO_HIGHLIGHT.has(lang) || code.length > 20000) {
    return [code];
  }
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of code.matchAll(TOKEN)) {
    const index = m.index ?? 0;
    let cls: string | null = null;
    if (m[1] !== undefined) {
      // '#' only starts a comment in languages that use it
      cls =
        m[1].startsWith("#") && /^(js|ts|tsx|jsx|json|css|c|java)/.test(lang)
          ? null
          : "tok-comment";
    } else if (m[2] !== undefined) {
      cls = "tok-string";
    } else if (m[3] !== undefined) {
      cls = "tok-number";
    } else if (m[4] !== undefined && KEYWORDS.has(m[4])) {
      cls = "tok-keyword";
    }
    if (!cls) {
      continue;
    }
    if (index > last) {
      out.push(code.slice(last, index));
    }
    out.push(
      <span key={n++} className={cls}>
        {m[0]}
      </span>,
    );
    last = index + m[0].length;
  }
  out.push(code.slice(last));
  return out;
};

export const CodeBlock = ({ code, lang }: { code: string; lang: string }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  return (
    <div className="md-code">
      <div className="md-code-head">
        <span>{lang || "code"}</span>
        <button type="button" onClick={copy} aria-label="Copy code">
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{highlight(code, lang.toLowerCase())}</code>
      </pre>
    </div>
  );
};

// ---- blocks ---------------------------------------------------------------------

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)[^\n]*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const BULLET = /^(\s*)([-*+])\s+(.*)$/;
const ORDERED = /^(\s*)(\d+)[.)]\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const splitRow = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));

const indentOf = (line: string) =>
  line.match(/^\s*/)![0].replace(/\t/g, "  ").length;

const startsBlock = (line: string, next?: string) =>
  FENCE.test(line) ||
  HEADING.test(line) ||
  HR.test(line) ||
  /^\s{0,3}>/.test(line) ||
  BULLET.test(line) ||
  ORDERED.test(line) ||
  (line.includes("|") && next !== undefined && TABLE_SEP.test(next));

const parseBlocks = (lines: string[], keyBase: string): ReactNode[] => {
  const out: ReactNode[] = [];
  let i = 0;
  let n = 0;
  const key = () => `${keyBase}-${n++}`;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = line.match(FENCE);
    if (fence) {
      const marker = fence[1];
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(marker)) {
        body.push(lines[i++]);
      }
      i++; // closing fence (absent while streaming)
      out.push(
        <CodeBlock key={key()} code={body.join("\n")} lang={fence[2]} />,
      );
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      const Tag = `h${Math.min(heading[1].length + 1, 6)}` as "h2";
      out.push(
        <Tag key={key()} className="md-heading">
          {renderInline(heading[2])}
        </Tag>,
      );
      i++;
      continue;
    }

    if (HR.test(line)) {
      out.push(<hr key={key()} className="md-hr" />);
      i++;
      continue;
    }

    if (/^\s{0,3}>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) {
        quote.push(lines[i++].replace(/^\s{0,3}>\s?/, ""));
      }
      out.push(
        <blockquote key={key()} className="md-quote">
          {parseBlocks(quote, key())}
        </blockquote>,
      );
      continue;
    }

    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      TABLE_SEP.test(lines[i + 1])
    ) {
      const head = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((c) =>
        c.startsWith(":") && c.endsWith(":")
          ? "center"
          : c.endsWith(":")
          ? "right"
          : undefined,
      );
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
        rows.push(splitRow(lines[i++]));
      }
      const k = key();
      out.push(
        <div key={k} className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>
                {head.map((c, j) => (
                  <th key={j} style={{ textAlign: aligns[j] }}>
                    {renderInline(c, `${k}h${j}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {head.map((_, j) => (
                    <td key={j} style={{ textAlign: aligns[j] }}>
                      {renderInline(r[j] ?? "", `${k}r${ri}c${j}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    const first = line.match(BULLET) || line.match(ORDERED);
    if (first) {
      const ordered = !BULLET.test(line);
      const base = indentOf(line);
      const items: { lines: string[]; task?: boolean; done?: boolean }[] = [];
      const start = ordered ? parseInt(first[2], 10) : 1;
      while (i < lines.length) {
        const cur = lines[i];
        if (!cur.trim()) {
          // a blank line continues the list only if an indented line follows
          const nextLine = lines.slice(i + 1).find((l) => l.trim());
          if (
            nextLine !== undefined &&
            indentOf(nextLine) > base &&
            items.length
          ) {
            items[items.length - 1].lines.push("");
            i++;
            continue;
          }
          if (
            nextLine !== undefined &&
            indentOf(nextLine) === base &&
            (ordered ? ORDERED : BULLET).test(nextLine)
          ) {
            i++;
            continue;
          }
          break;
        }
        const m = (ordered ? ORDERED : BULLET).exec(cur);
        if (m && indentOf(cur) === base) {
          const text = m[3];
          const task = text.match(/^\[([ xX])\]\s+(.*)$/);
          items.push({
            lines: [task ? task[2] : text],
            task: !!task,
            done: !!task && task[1] !== " ",
          });
          i++;
        } else if (items.length && indentOf(cur) > base) {
          items[items.length - 1].lines.push(
            cur.slice(Math.min(indentOf(cur), base + 2)),
          );
          i++;
        } else if (items.length && !startsBlock(cur)) {
          // lazy continuation of the previous item
          items[items.length - 1].lines.push(cur.trim());
          i++;
        } else {
          break;
        }
      }
      const k = key();
      const children = items.map((item, j) => {
        const [head, ...rest] = item.lines;
        return (
          <li key={j} className={clsx({ "md-task": item.task })}>
            {item.task && (
              <input type="checkbox" checked={item.done} readOnly disabled />
            )}
            {renderInline(head, `${k}-${j}`)}
            {rest.some((l) => l.trim()) && parseBlocks(rest, `${k}-${j}n`)}
          </li>
        );
      });
      out.push(
        ordered ? (
          <ol key={k} className="md-list" start={start}>
            {children}
          </ol>
        ) : (
          <ul key={k} className="md-list">
            {children}
          </ul>
        ),
      );
      continue;
    }

    // paragraph
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      (para.length === 0 || !startsBlock(lines[i], lines[i + 1]))
    ) {
      para.push(lines[i++]);
    }
    const k = key();
    out.push(
      <p key={k} className="md-p">
        {renderLines(para, k)}
      </p>,
    );
  }
  return out;
};

export const Markdown = memo(
  ({ text, className }: { text: string; className?: string }) => (
    <div className={clsx("md", className)}>
      <Fragment>
        {parseBlocks(text.replace(/\r\n?/g, "\n").split("\n"), "b")}
      </Fragment>
    </div>
  ),
);
Markdown.displayName = "Markdown";
