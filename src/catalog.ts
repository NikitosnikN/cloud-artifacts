import type { DocCard, DocSummary } from "./docs";
import { escapeHtml } from "./http";

const STYLE = `
  :root { color-scheme: dark; --bg:#090b10; --card:#121620; --line:#252b38; --text:#f7f8fb; --muted:#9ca6b7; --accent:#8aa2ff; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.55 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
  main { width:min(100% - 32px, 960px); margin:0 auto; padding:48px 0; }
  .eyebrow { color:var(--accent); font-size:12px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; }
  .eyebrow a { color:inherit; text-decoration:none; }
  h1 { margin:10px 0 6px; font-size:30px; letter-spacing:-.02em; }
  .lead { margin:0 0 28px; color:var(--muted); }
  .table { width:100%; border:1px solid var(--line); border-radius:12px; overflow:hidden; background:var(--card); border-collapse:collapse; }
  th, td { padding:12px 16px; text-align:left; vertical-align:top; border-top:1px solid var(--line); }
  th { border-top:0; color:var(--muted); font-size:12px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; }
  td a { color:var(--text); font-weight:600; text-decoration:none; }
  td a:hover { color:var(--accent); }
  .sub { display:block; color:var(--muted); font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace; }
  .muted { color:var(--muted); }
  .tag { padding:2px 8px; border:1px solid #40507b; border-radius:999px; color:#c6d1ff; font-size:12px; }
  .empty { padding:28px; border:1px dashed var(--line); border-radius:12px; color:var(--muted); }
  @media (max-width:640px) { .hide-sm { display:none; } th, td { padding:10px 12px; } }
`;

export function renderCatalog(docs: DocSummary[]): string {
  const rows = docs.map((doc) => `
      <tr>
        <td><a href="/d/${doc.name}">${escapeHtml(doc.title)}</a><span class="sub">/d/${doc.name}</span></td>
        <td class="muted">v${doc.current}</td>
        <td class="muted">${formatDate(doc.updatedAt)}</td>
        <td class="muted hide-sm">${escapeHtml(doc.updatedBy)}</td>
        <td class="hide-sm"><a class="muted" href="/d/${doc.name}/history">History</a></td>
      </tr>`).join("");
  const body = docs.length
    ? `<table class="table">
      <thead><tr><th>Doc</th><th>Version</th><th>Updated</th><th class="hide-sm">By</th><th class="hide-sm"></th></tr></thead>
      <tbody>${rows}
      </tbody>
    </table>`
    : `<div class="empty">No docs yet. Publish one with <code>PUT /api/docs/{name}</code>.</div>`;
  return page("Docs catalog", `
    <div class="eyebrow"><a href="/">Cloud Artifacts</a></div>
    <h1>Docs catalog</h1>
    <p class="lead">Every link here is permanent and always opens the latest version. ${docs.length} doc${docs.length === 1 ? "" : "s"}.</p>
    ${body}`);
}

export function renderHistory(card: DocCard): string {
  const rows = [...card.versions].reverse().map((entry) => `
      <tr>
        <td><a href="/d/${card.name}/v/${entry.version}">v${entry.version}</a>${entry.version === card.current ? ` <span class="tag">current</span>` : ""}</td>
        <td class="muted">${formatDate(entry.createdAt)}</td>
        <td class="muted">${escapeHtml(entry.author)}</td>
        <td class="muted hide-sm">${formatBytes(entry.bytes)}</td>
        <td class="muted">${entry.note ? escapeHtml(entry.note) : ""}</td>
      </tr>`).join("");
  return page(`${card.title} · history`, `
    <div class="eyebrow"><a href="/d/">Docs catalog</a></div>
    <h1>${escapeHtml(card.title)}</h1>
    <p class="lead">Permanent link: <a class="muted" href="/d/${card.name}">/d/${card.name}</a> · showing v${card.current}</p>
    <table class="table">
      <thead><tr><th>Version</th><th>Published</th><th>By</th><th class="hide-sm">Size</th><th>Note</th></tr></thead>
      <tbody>${rows}
      </tbody>
    </table>`);
}

function page(title: string, content: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${STYLE}</style>
</head>
<body>
  <main>${content}
  </main>
</body>
</html>`;
}

function formatDate(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso) ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : escapeHtml(iso);
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
