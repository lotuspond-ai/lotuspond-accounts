// Writes the placeholder's stylesheet and fonts (placeholder/public/assets/), the same ones the Accounts app serves,
// so the placeholder follows design/tokens.json. Run before deploying the placeholder.
import fs from 'node:fs';
import { fromRoot } from '../src/lib/paths.ts';
import { buildStylesheet } from '../src/views/styles.ts';

const out = fromRoot('placeholder', 'public', 'assets');
fs.mkdirSync(fromRoot('placeholder', 'public', 'assets', 'fonts'), { recursive: true });
fs.writeFileSync(`${out}/accounts.css`, buildStylesheet());
const fonts: Record<string, string[]> = {
  'atkinson.woff2': ['node_modules', '@fontsource-variable', 'atkinson-hyperlegible-next', 'files', 'atkinson-hyperlegible-next-latin-wght-normal.woff2'],
  'platypi.woff2': ['node_modules', '@fontsource-variable', 'platypi', 'files', 'platypi-latin-wght-normal.woff2'],
};
for (const [name, from] of Object.entries(fonts)) fs.copyFileSync(fromRoot(...from), `${out}/fonts/${name}`);
console.log('Wrote placeholder/public/assets.');
