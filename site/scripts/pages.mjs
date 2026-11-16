import { execFileSync } from 'node:child_process';
import { cpSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(site, '..');
const out = join(site, 'out');
const base = (process.env.EKTOS_BASE_PATH || '').replace(/\/+$/, '');
const env = { ...process.env, EKTOS_PAGES: '1', EKTOS_BASE_PATH: base };

const node = (script, args = []) => execFileSync(process.execPath, [script, ...args], { cwd: site, env, stdio: 'inherit' });

node(join(site, 'scripts/sync-assets.mjs'));
rmSync(out, { recursive: true, force: true });
node(join(site, 'node_modules/next/dist/bin/next'), ['build']);

cpSync(join(repo, 'web'), join(out, 'tool'), { recursive: true });

const page = (title, body, head = '') => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${head}<style>html{background:#05070D;color:#E8ECF4;color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-content:center;gap:1rem;padding:1.5rem;font:400 1rem/1.55 "Segoe UI",system-ui,sans-serif;text-align:center}a{color:#E8ECF4;text-underline-offset:.2em}p{margin:0}.k{color:#9BA5B8;font-size:.8125rem;letter-spacing:.04em}</style>
</head>
<body>
${body}
</body>
</html>
`;

const pick = `var m=document.cookie.match(/(?:^|; )ektos-lang=(en|tr)(?:;|$)/);`;

writeFileSync(join(out, 'index.html'), page(
  'Ektos',
  `<p><a href="${base}/en/">Ektos</a></p>`,
  `<script>${pick}location.replace(${JSON.stringify(`${base}/`)}+(m?m[1]:'en')+'/'+location.hash);</script>
<noscript><meta http-equiv="refresh" content="0; url=${base}/en/"></noscript>
<link rel="canonical" href="${base}/en/">
`,
));

writeFileSync(join(out, '404.html'), page(
  'Not found · Ektos',
  `<p class="k">404</p>
<p>This page does not exist. · Bu sayfa yok.</p>
<p><a href="${base}/en/">Overview</a> · <a href="${base}/tr/">Genel bakış</a></p>`,
));

writeFileSync(join(out, '.nojekyll'), '');

console.log(`pages: out/ ready${base ? ` for ${base}/` : ''}`);
