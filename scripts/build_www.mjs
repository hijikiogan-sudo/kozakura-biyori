// Copies the web app into www/ for Capacitor. GitHub Pages keeps serving the repository root as before.
// The file list comes from the service worker's app shell, so the iOS app and the offline web app ship the same files.
import {cpSync, mkdirSync, readFileSync, rmSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'www');
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const shell = JSON.parse(sw.match(/const SHELL = (\[[^\]]*\]);/)[1].replaceAll("'", '"'));
const files = shell.filter(Boolean);

rmSync(out, {recursive: true, force: true});
for (const file of files) {
  mkdirSync(dirname(join(out, file)), {recursive: true});
  cpSync(join(root, file), join(out, file));
}
console.log(`www/: ${files.length} files`);
