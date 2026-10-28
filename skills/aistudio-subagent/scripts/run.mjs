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
const cli = path.join(projectRoot, 'src/cli.mjs');
try {
  await fs.access(cli);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  console.error('Project runtime is not installed. Clone https://github.com/yuchen-ya/studio-subagent-skill.git, then run npm ci and npm run install-skill in the clone.');
  process.exit(1);
}
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
