import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../../src/markdown";

const html = (s: string) => {
  const d = document.createElement("div");
  d.appendChild(renderMarkdown(s));
  return d;
};

describe("renderMarkdown", () => {
  it("bold and code", () => {
    const d = html("**hi** `x`");
    expect(d.querySelector("strong")?.textContent).toBe("hi");
    expect(d.querySelector("code")?.textContent).toBe("x");
  });
  it("paragraphs", () => expect(html("a\n\nb").querySelectorAll("p").length).toBe(2));
  it("lists", () => {
    const d = html("- a\n- b");
    expect(d.querySelectorAll("ul").length).toBe(1);
    expect(d.querySelectorAll("li").length).toBe(2);
  });
  it("fenced block is verbatim", () => {
    const d = html("```\n**x** <b>\n- y\n```");
    expect(d.querySelector("pre > code")?.textContent).toBe("**x** <b>\n- y");
    expect(d.querySelector("strong")).toBeNull();
  });
  it("html stays text", () => {
    const d = html("<img src=x onerror=alert(1)>");
    expect(d.querySelector("img")).toBeNull();
    expect(d.textContent).toBe("<img src=x onerror=alert(1)>");
  });
  it("links stay text", () => {
    const d = html("[a](http://x)");
    expect(d.querySelector("a")).toBeNull();
    expect(d.textContent).toBe("[a](http://x)");
  });
  it("unclosed bold is literal", () => {
    const d = html("**oops");
    expect(d.querySelector("strong")).toBeNull();
    expect(d.textContent).toBe("**oops");
  });
});
