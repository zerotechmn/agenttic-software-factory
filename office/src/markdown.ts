import type { RenderMarkdown } from "./shared/contracts";

/** Inline: `code` and **bold** (closed pairs only); everything else is literal text. */
function inline(parent: HTMLElement, text: string): void {
  const re = /`([^`\n]+)`|\*\*([^*\n]+?)\*\*/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
    const el = document.createElement(m[1] !== undefined ? "code" : "strong");
    el.textContent = m[1] ?? m[2];
    parent.appendChild(el);
    last = m.index + m[0].length;
  }
  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
}

/** Safe markdown subset → DOM nodes (paragraphs, bold, code, bullets, fences). Never uses innerHTML. */
export const renderMarkdown: RenderMarkdown = (src) => {
  const frag = document.createDocumentFragment();
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [];
  let list: HTMLUListElement | null = null;

  const flushPara = () => {
    if (!para.length) return;
    const p = document.createElement("p");
    inline(p, para.join("\n"));
    frag.appendChild(p);
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith("```")) {
      flushPara();
      list = null;
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i].trimStart().startsWith("```"); i++) body.push(lines[i]);
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = body.join("\n");
      pre.appendChild(code);
      frag.appendChild(pre);
    } else if (!line.trim()) {
      flushPara();
      list = null;
    } else if (line.startsWith("- ")) {
      flushPara();
      if (!list) {
        list = document.createElement("ul");
        frag.appendChild(list);
      }
      const li = document.createElement("li");
      inline(li, line.slice(2));
      list.appendChild(li);
    } else {
      list = null;
      para.push(line);
    }
  }
  flushPara();
  return frag;
};
