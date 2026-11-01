import { withRun } from "./shared/contracts";

export interface VaultDoc { path: string; title: string; group: string; bytes: number }

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};
const size = (b: number) => (b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
const docUrl = (path: string, download = false) => withRun(`/doc?path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`);

/** The vault: every document the run produced, grouped, with view and download. Text only (no HTML from run data). */
export async function renderVault(body: HTMLElement, live: boolean, isOpen: () => boolean): Promise<void> {
  body.innerHTML = "";
  body.append(el("h2", "Vault"));
  if (!live) {
    body.append(el("div", "demo mode: start the console with `forge console` to browse a run's documents", "meta"));
    return;
  }
  body.append(el("div", "loading…", "meta"));
  let docs: VaultDoc[] = [];
  try {
    const r = await fetch(withRun("/docs"));
    docs = r.ok ? ((await r.json()) as VaultDoc[]) : [];
  } catch {
    docs = [];
  }
  if (!isOpen()) return;
  body.innerHTML = "";
  body.append(el("h2", `Vault (${docs.length})`));
  if (!docs.length) {
    body.append(el("div", "No documents yet: they appear as each phase finishes.", "meta"));
    return;
  }
  const groups = [...new Set(docs.map((d) => d.group))];
  for (const g of groups) {
    body.append(el("b", g, "vault-group"));
    const ul = el("ul");
    for (const d of docs.filter((x) => x.group === g)) {
      const li = el("li", undefined, "vault-row");
      const view = el("a", d.title);
      view.href = "#";
      view.addEventListener("click", (ev) => { ev.preventDefault(); void showDoc(body, d, live, isOpen); });
      const dl = el("a", "⬇");
      dl.href = docUrl(d.path, true);
      dl.title = `Download ${d.path}`;
      dl.setAttribute("aria-label", `Download ${d.title}`);
      li.append(view, el("span", ` ${size(d.bytes)} `, "meta"), dl);
      ul.append(li);
    }
    body.append(ul);
  }
}

async function showDoc(body: HTMLElement, d: VaultDoc, live: boolean, isOpen: () => boolean): Promise<void> {
  body.innerHTML = "";
  const back = el("span", "← vault", "back");
  back.addEventListener("click", () => void renderVault(body, live, isOpen));
  const dl = el("a", "⬇ download");
  dl.href = docUrl(d.path, true);
  body.append(back, el("h2", d.title), el("div", d.path, "meta"), dl);
  const pre = el("pre", "loading…", "vault-doc");
  body.append(pre);
  try {
    const r = await fetch(docUrl(d.path));
    let text = r.ok ? await r.text() : "could not load";
    if (d.path.endsWith(".json")) try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* keep as is */ }
    if (text.length > 400_000) text = `${text.slice(0, 400_000)}\n… (truncated: download for the full file)`;
    pre.textContent = text;
  } catch {
    pre.textContent = "could not load";
  }
}
