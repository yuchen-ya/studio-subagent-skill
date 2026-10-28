import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const projectRoot = path.resolve(import.meta.dirname, '..');
const source = path.join(projectRoot, 'skills/aistudio-subagent');
const destination = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'skills/aistudio-subagent');
try {
  const existing = JSON.parse(await fs.readFile(path.join(destination, 'project.json'), 'utf8'));
  if (path.resolve(existing.projectRoot) !== projectRoot) throw new Error('An installed skill already points to a different project. Review it before replacing.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await fs.mkdir(destination, { recursive: true });
for (const relative of ['SKILL.md', 'agents/openai.yaml', 'scripts/run.mjs']) {
  await fs.mkdir(path.dirname(path.join(destination, relative)), { recursive: true });
  await fs.copyFile(path.join(source, relative), path.join(destination, relative));
}
await fs.writeFile(path.join(destination, 'project.json'), JSON.stringify({ projectRoot }, null, 2));
console.log(JSON.stringify({ installed: destination, projectRoot }, null, 2));
