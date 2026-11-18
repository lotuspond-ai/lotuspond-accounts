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
  const file = JSON.parse(fs.readFileSync(tokensFile, 'utf8')) as { color: { tokens: Token[] }; shadow?: { tokens: { name: string; value: string }[] } };
  const tokens = file.color.tokens;
  const shadowCard = file.shadow?.tokens.find(t => t.name === 'shadow-card')?.value ?? 'none';
  return `
@font-face{font-family:"Atkinson Hyperlegible Next";src:url(/assets/fonts/atkinson.woff2) format("woff2");font-weight:200 800;font-display:swap}
@font-face{font-family:Platypi;src:url(/assets/fonts/platypi.woff2) format("woff2");font-weight:300 800;font-display:swap}
:root{${variables('light', tokens)}--font-sans:"Atkinson Hyperlegible Next",system-ui,-apple-system,"Segoe UI",sans-serif;--font-display:Platypi,Georgia,"Times New Roman",serif;--space-2:8px;--space-3:12px;--space-4:16px;--space-6:24px;--space-8:32px;--radius-sm:10px;--radius-xl:40px;--radius-lg:28px;--radius-md:16px;--shadow-card:${shadowCard};--radius-pill:999px;color-scheme:light}
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
.products{list-style:none;margin:0 0 var(--space-4);padding:var(--space-3);background:var(--surface-tint);border-radius:var(--radius-lg);display:grid;gap:var(--space-3)}
.product{background:var(--surface-raised);border-radius:var(--radius-md);box-shadow:var(--shadow-card);padding:var(--space-4) var(--space-6) var(--space-6)}
.product__head{display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);flex-wrap:wrap;margin:0 0 var(--space-2)}
.product h3{font:600 20px/1.25 var(--font-display);margin:0}
.product__line{color:var(--ink-muted);margin:0 0 var(--space-3)}
.product__facts{display:flex;flex-wrap:wrap;gap:var(--space-2) var(--space-8);margin:0 0 var(--space-3)}
.product__facts dt{font-size:14px;color:var(--ink-muted)}
.product__facts dd{margin:0;font-weight:600}
.product .hint{margin:0 0 var(--space-3)}
.product__open{font-weight:600}
section{margin:0}
footer{padding:0 var(--space-8) var(--space-6);color:var(--on-field-muted);font-size:14px}
footer a{color:var(--on-field)}
.lp-btn--brand{background:var(--sage-700);color:var(--white)}
.lp-btn--brand:hover{filter:brightness(1.08)}
.lp-btn--sm{min-height:38px;padding:0 var(--space-4);font-size:14px}
body.console{background:var(--surface-tint);display:block;font-size:14px}
.frame{display:grid;grid-template-columns:232px minmax(0,1fr);grid-template-rows:auto 1fr;min-height:100vh;max-width:1240px;margin:0 auto}
.bar{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:var(--space-4);padding:var(--space-4) var(--space-6)}
.bar .lp-wordmark{font-size:22px}
.bar .lp-wordmark b{font:600 15px/1 var(--font-sans);letter-spacing:0;margin-left:.5em;color:var(--ink-muted)}
.bar__who{display:flex;align-items:center;gap:var(--space-3);min-width:0}
.bar__email{color:var(--ink-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nav{padding:var(--space-2) var(--space-4) var(--space-6) var(--space-6)}
.nav ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.nav a{display:flex;align-items:center;gap:var(--space-3);min-height:44px;padding:0 var(--space-3);border-radius:var(--radius-sm);color:var(--ink);text-decoration:none;font-weight:600;font-size:15px}
.nav a:hover{background:var(--surface)}
.nav a[aria-current=page]{background:var(--surface-raised);color:var(--brand-text)}
.nav svg{width:20px;height:20px;flex:none;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.panel{display:block;flex:none;background:var(--surface-raised);border-radius:var(--radius-lg);margin:0 var(--space-6) var(--space-6) 0;padding:var(--space-8);min-width:0}
.screen-title{font:600 24px/1.25 var(--font-sans);letter-spacing:0;margin:0 0 var(--space-2)}
.screen-lede{color:var(--ink-muted);margin:0 0 var(--space-6);max-width:46em}
.console .hint{font-size:13px}
.console .rows{max-width:560px;margin-bottom:var(--space-6)}
.console .form{max-width:420px}
.console input[type=email],.console input[type=password],.console input[type=text]{min-height:44px}
.console .products{grid-template-columns:repeat(auto-fill,minmax(300px,1fr));padding:0;background:none;max-width:860px}
.console .product{background:var(--surface);box-shadow:none;border:1px solid var(--line);padding:var(--space-6)}
.console .product h3{font:600 18px/1.3 var(--font-sans)}
.console .product__line{font-size:14px}
.console .products+.hint{max-width:46em}
@media (max-width:760px){.frame{grid-template-columns:minmax(0,1fr);grid-template-rows:auto auto 1fr}.bar{padding:var(--space-3) var(--space-4)}.bar__email{display:none}.nav{padding:0 var(--space-2) var(--space-3);overflow-x:auto}.nav ul{flex-direction:row}.nav a{white-space:nowrap}.panel{margin:0 var(--space-2) var(--space-2);padding:var(--space-6) var(--space-4)}}
@media (max-width:600px){.top{padding:var(--space-4)}main{padding:0 var(--space-2) var(--space-6)}.sheet{border-radius:var(--radius-lg);padding:32px 20px 28px}h1{font-size:26px}footer{padding:0 var(--space-4) var(--space-4)}.products{padding:var(--space-2)}.product{padding:var(--space-4) var(--space-4) var(--space-6)}}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`.trim();
}
