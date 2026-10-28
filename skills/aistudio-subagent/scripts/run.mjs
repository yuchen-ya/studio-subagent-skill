import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

let projectRoot;
try {
  projectRoot = JSON.parse(await fs.readFile(path.resolve(import.meta.dirname, '../project.json'), 'utf8')).projectRoot;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  projectRoot = path.resolve(import.meta.dirname, '../../..');
}
const child = spawn(process.execPath, [path.join(projectRoot, 'src/cli.mjs'), ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
