// Route-handler failures must stay HTML. An unhandled empty response can be
// offered as a zero-byte download by mobile browsers instead of a recovery page.
export function workspaceUnavailableResponse() {
  return new Response(
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Workspace unavailable | Shop Revenue</title>
<style>
:root{color-scheme:light dark;font:16px/1.5 system-ui,sans-serif}
body{margin:0;padding:24px}main{max-width:40rem;margin:48px auto}
h1{font-size:2rem;line-height:1.25}p{max-width:65ch}
a{display:inline-flex;align-items:center;justify-content:center;min-height:48px;
padding:0 24px;margin-top:24px;border-radius:8px;background:#087b59;color:#fff;
font-weight:700;text-decoration:none}a:focus-visible{outline:3px solid;outline-offset:4px}
</style></head><body><main>
<p>Shop Revenue</p><h1>We couldn’t load your workspace</h1>
<p>Please reload this page to try again.</p>
<a href="">Try again</a>
</main></body></html>`,
    {
      status: 503,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "private, no-store, max-age=0",
        "x-content-type-options": "nosniff",
        "retry-after": "30",
      },
    },
  );
}
