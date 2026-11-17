// The service's root folder: the nearest folder above the running file that holds `drizzle/` and `design/`. Found
// the same way from src/ (development, tests) and from dist/ (the built image).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function findRoot(): string {
  for (let dir = path.dirname(fileURLToPath(import.meta.url)); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'drizzle', 'cell')) && fs.existsSync(path.join(dir, 'design', 'tokens.json'))) return dir;
    if (path.dirname(dir) === dir) throw new Error('The service root (with drizzle/ and design/) was not found above the server.');
  }
}

export const ROOT = findRoot();
export const fromRoot = (...parts: string[]): string => path.join(ROOT, ...parts);
