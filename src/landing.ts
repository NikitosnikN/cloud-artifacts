const PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Cloud Artifacts publishes AI-generated HTML as shareable, expiring URLs on Cloudflare.">
  <title>Cloud Artifacts — share HTML instantly</title>
  <style>
    :root { color-scheme: dark; --bg:#090b10; --card:#121620; --line:#252b38; --text:#f7f8fb; --muted:#9ca6b7; --accent:#8aa2ff; }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; background:var(--bg); color:var(--text); font:16px/1.6 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    main { width:min(100% - 40px, 920px); margin:0 auto; padding:72px 0 56px; }
    .eyebrow { display:inline-flex; align-items:center; gap:9px; color:var(--accent); font-size:13px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; }
    .eyebrow::before { content:""; width:8px; height:8px; border-radius:50%; background:#7ee787; box-shadow:0 0 0 4px #7ee78718; }
    h1 { max-width:760px; margin:22px 0 18px; font-size:clamp(44px,8vw,78px); line-height:.98; letter-spacing:-.055em; }
    .lead { max-width:650px; margin:0; color:var(--muted); font-size:clamp(18px,2.5vw,22px); }
    .actions { display:flex; flex-wrap:wrap; align-items:center; gap:14px; margin:32px 0 56px; }
    .button { display:inline-flex; align-items:center; gap:10px; padding:11px 17px; border:1px solid #40507b; border-radius:10px; background:#18213a; color:#fff; font-weight:700; text-decoration:none; transition:.15s ease; }
    .button:hover { background:#202c4b; transform:translateY(-1px); }
    code { padding:4px 8px; border:1px solid var(--line); border-radius:7px; background:#0d1118; color:#c6d1ff; font:13px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace; }
    .flow { display:grid; grid-template-columns:repeat(3,1fr); border:1px solid var(--line); border-radius:16px; overflow:hidden; background:var(--card); }
    .step { min-height:205px; padding:26px; }
    .step + .step { border-left:1px solid var(--line); }
    .number { color:var(--accent); font:700 12px/1 ui-monospace,SFMono-Regular,Consolas,monospace; letter-spacing:.12em; }
    h2 { margin:42px 0 16px; font-size:14px; color:var(--muted); letter-spacing:.12em; text-transform:uppercase; }
    h3 { margin:46px 0 9px; font-size:19px; letter-spacing:-.02em; }
    .step p { margin:0; color:var(--muted); font-size:14px; }
    .facts { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
    .fact { padding:18px; border:1px solid var(--line); border-radius:12px; background:#0e1219; }
    .fact strong { display:block; margin-bottom:3px; font-size:14px; }
    .fact span { color:var(--muted); font-size:13px; }
    footer { display:flex; justify-content:space-between; gap:20px; margin-top:56px; padding-top:22px; border-top:1px solid var(--line); color:#737e91; font-size:13px; }
    footer a { color:#aebcf4; }
    @media (max-width:720px) { main { padding-top:48px; } .flow { grid-template-columns:1fr; } .step { min-height:0; } .step + .step { border-left:0; border-top:1px solid var(--line); } .facts { grid-template-columns:1fr 1fr; } footer { flex-direction:column; } }
    @media (max-width:420px) { .facts { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <main>
    <div class="eyebrow">Cloud Artifacts</div>
    <h1>Share HTML.<br>Get a URL.</h1>
    <p class="lead">An API-first publishing service for AI agents. Send a complete HTML page and receive a public, unguessable link in one request.</p>
    <div class="actions">
      <a class="button" href="https://github.com/NikitosnikN/cloud-artifacts" target="_blank" rel="noreferrer">View source on GitHub <span aria-hidden="true">↗</span></a>
      <code>artifacts.nikitayugov.com/mcp</code>
    </div>

    <section aria-labelledby="how-it-works">
      <h2 id="how-it-works">How it works</h2>
      <div class="flow">
        <article class="step"><div class="number">01 · PUBLISH</div><h3>Send HTML</h3><p>Use the REST API or the <code>publish_html</code> MCP tool. Only complete UTF-8 HTML documents are accepted.</p></article>
        <article class="step"><div class="number">02 · STORE</div><h3>Worker → R2</h3><p>A Cloudflare Worker validates the request, creates a UUID, and stores the immutable document in R2.</p></article>
        <article class="step"><div class="number">03 · SHARE</div><h3>Open the link</h3><p>The returned URL is public and easy to share. Optional TTL metadata expires the page automatically.</p></article>
      </div>
    </section>

    <section aria-labelledby="built-for-agents">
      <h2 id="built-for-agents">Built for agents</h2>
      <div class="facts">
        <div class="fact"><strong>HTML only</strong><span>5 MiB default limit</span></div>
        <div class="fact"><strong>REST + MCP</strong><span>One publishing tool</span></div>
        <div class="fact"><strong>Optional TTL</strong><span>Read-time expiry + cleanup</span></div>
        <div class="fact"><strong>Controlled access</strong><span>IP-allowlisted reads and writes</span></div>
      </div>
    </section>

    <footer><span>Powered by Cloudflare Workers and R2.</span><span>Open source · <a href="https://github.com/NikitosnikN/cloud-artifacts" target="_blank" rel="noreferrer">NikitosnikN/cloud-artifacts</a></span></footer>
  </main>
</body>
</html>`;

const HEADERS = {
  "cache-control": "public, max-age=3600",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "content-type": "text/html; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
} satisfies HeadersInit;

export function landingPage(method: "GET" | "HEAD"): Response {
  return new Response(method === "HEAD" ? null : PAGE, { headers: HEADERS });
}
