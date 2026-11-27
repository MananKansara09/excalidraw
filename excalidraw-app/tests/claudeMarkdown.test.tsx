import { renderToStaticMarkup } from "react-dom/server";

import { Markdown } from "../components/ClaudePanel/Markdown";

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

describe("Claude chat markdown", () => {
  it("renders headings, emphasis, lists and links", () => {
    const out = html(
      "## Title\n\n**bold** and *it* and `code`\n\n1. one\n2. two\n\n- a\n  - nested\n\n[x](https://e.com)",
    );
    expect(out).toContain("<h3");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<em>it</em>");
    expect(out).toContain("md-inline-code");
    expect(out).toContain("<ol");
    expect(out).toContain("<ul");
    expect(out.match(/<ul/g)).toHaveLength(2);
    expect(out).toContain('href="https://e.com"');
  });

  it("renders fenced code, including an unclosed (streaming) fence", () => {
    expect(html("```ts\nconst a = 1;\n```")).toContain("tok-keyword");
    expect(html('```json\n{ "a": 1')).toContain("md-code");
  });

  it("renders tables and never emits raw html or javascript links", () => {
    expect(html("| a | b |\n|---|---|\n| 1 | 2 |")).toContain("<table");
    const out = html("<script>alert(1)</script> [x](javascript:alert(1))");
    expect(out).not.toContain("<script>");
    expect(out).not.toContain('href="javascript');
  });
});
