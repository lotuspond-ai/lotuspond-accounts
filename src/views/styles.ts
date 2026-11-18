// The stylesheet, built once from the LotusPond design system's tokens (design/tokens.json, a copy of
// design-system/project/tokens.json in lotuspond-ai/lotuspond) and the account-screen rules in its README: a sage
// field, one off-white sheet, the wordmark, and one accent Button for the main action of each view.
import fs from 'node:fs';
import { fromRoot } from '../lib/paths.ts';

interface Token { name: string; value: { light: string; dark: string } }

const tokensFile = fromRoot('design', 'tokens.json');

function variables(theme: 'light' | 'dark', tokens: Token[]): string {
  const byName = new Map(tokens.map(t => [t.name, t]));
  const resolve = (v: string): string => {
    const ref = /^\{([\w-]+)\}$/.exec(v);
    return ref ? resolve(byName.get(ref[1])?.value[theme] ?? v) : v;
  };
  return tokens.map(t => `--${t.name}:${resolve(t.value[theme])};`).join('');
}

export function buildStylesheet(): string {
  const tokens = (JSON.parse(fs.readFileSync(tokensFile, 'utf8')) as { color: { tokens: Token[] } }).color.tokens;
  return `
@font-face{font-family:"Atkinson Hyperlegible Next";src:url(/assets/fonts/atkinson.woff2) format("woff2");font-weight:200 800;font-display:swap}
@font-face{font-family:Platypi;src:url(/assets/fonts/platypi.woff2) format("woff2");font-weight:300 800;font-display:swap}
:root{${variables('light', tokens)}--font-sans:"Atkinson Hyperlegible Next",system-ui,-apple-system,"Segoe UI",sans-serif;--font-display:Platypi,Georgia,"Times New Roman",serif;--space-2:8px;--space-3:12px;--space-4:16px;--space-6:24px;--space-8:32px;--radius-sm:10px;--radius-xl:40px;--radius-lg:28px;--radius-pill:999px;color-scheme:light}
@media (prefers-color-scheme:dark){:root{${variables('dark', tokens)}color-scheme:dark}}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;background:var(--field);color:var(--ink);font:400 16px/1.5 var(--font-sans);display:flex;flex-direction:column}
.top{padding:var(--space-6) var(--space-8);color:var(--on-field)}
main{flex:1;display:flex;justify-content:center;align-items:flex-start;padding:0 var(--space-4) var(--space-8)}
.sheet{width:100%;max-width:520px;background:var(--surface);border-radius:var(--radius-xl);padding:48px 48px 40px}
h1{font:600 34px/1.14 var(--font-display);letter-spacing:-.015em;margin:0 0 var(--space-3);text-wrap:balance}
h2{font:600 20px/1.3 var(--font-sans);margin:var(--space-8) 0 var(--space-3)}
p{margin:0 0 var(--space-4);max-width:34em}
.lede{color:var(--ink-muted)}
a{color:var(--brand-text);text-underline-offset:2px}
a:focus-visible,input:focus-visible,select:focus-visible,button:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
form{margin:0}
.field{display:flex;flex-direction:column;gap:6px;margin:0 0 var(--space-4)}
label{font-weight:600;font-size:15px}
.hint{font-size:14px;color:var(--ink-muted)}
input[type=email],input[type=password],input[type=text],select{font:inherit;color:var(--ink);background:var(--surface-raised);border:1.5px solid var(--line-strong);border-radius:var(--radius-sm);min-height:48px;padding:10px 14px;width:100%}
input[aria-invalid=true],select[aria-invalid=true]{border-color:var(--danger)}
.check{display:flex;gap:var(--space-3);align-items:flex-start;margin:0 0 var(--space-4)}
.check input{width:22px;height:22px;margin:2px 0 0;flex:none;accent-color:var(--sage-700)}
.check label{font-weight:400}
.error{color:var(--danger);font-size:15px;font-weight:600;margin:0}
.notice{border-radius:var(--radius-sm);padding:var(--space-3) var(--space-4);margin:0 0 var(--space-4);background:var(--surface-tint)}
.notice.danger{background:transparent;box-shadow:inset 0 0 0 1.5px var(--danger);color:var(--danger);font-weight:600}
.actions{display:flex;flex-wrap:wrap;gap:var(--space-3);align-items:center;margin:var(--space-6) 0 0}
.lp-btn{display:inline-flex;align-items:center;justify-content:center;gap:var(--space-2);min-height:50px;padding:0 var(--space-6);border:0;border-radius:var(--radius-pill);font:600 16px/1 var(--font-sans);text-decoration:none;white-space:nowrap;cursor:pointer}
.lp-btn--accent{background:var(--accent);color:var(--on-accent)}
.lp-btn--accent:hover{background:var(--accent-hover)}
.lp-btn--outline{background:transparent;color:var(--ink);box-shadow:inset 0 0 0 1.5px var(--line-strong)}
.lp-btn--ink{background:var(--ink);color:var(--surface)}
.lp-btn--danger{background:var(--danger-fill);color:var(--on-danger)}
.lp-wordmark{display:inline-flex;align-items:baseline;gap:.16em;font:700 24px/1 var(--font-display);letter-spacing:-.02em;color:inherit;text-decoration:none;white-space:nowrap}
.lp-wordmark b{font-weight:400}
.lp-wordmark i{width:.33em;height:.33em;border-radius:50%;background:var(--accent-mark)}
.after{margin-top:var(--space-6)}
.rows{list-style:none;padding:0;margin:0 0 var(--space-4)}
.rows li{padding:var(--space-3) 0;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:var(--space-4);flex-wrap:wrap}
.rows li:last-child{border-bottom:1px solid var(--line)}
.tag{display:inline-block;border-radius:var(--radius-pill);padding:2px 10px;font-size:14px;font-weight:600;background:var(--positive-tint);color:var(--ink)}
.tag.wait{background:transparent;box-shadow:inset 0 0 0 1.5px var(--line-strong)}
footer{padding:0 var(--space-8) var(--space-6);color:var(--on-field-muted);font-size:14px}
footer a{color:var(--on-field)}
@media (max-width:600px){.top{padding:var(--space-4)}main{padding:0 var(--space-2) var(--space-6)}.sheet{border-radius:var(--radius-lg);padding:32px 20px 28px}h1{font-size:26px}footer{padding:0 var(--space-4) var(--space-4)}}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`.trim();
}
