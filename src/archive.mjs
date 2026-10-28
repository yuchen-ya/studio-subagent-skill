import fs from 'node:fs/promises';
import path from 'node:path';
import { unzipSync } from 'fflate';

export function unpackArchive(bytes) {
  let totalSize = 0;
  let count = 0;
  return unzipSync(bytes, { filter(file) {
    const name = file.name.replaceAll('\\', '/');
    if (name.startsWith('/') || name.includes(':') || name.includes('\0') || name.split('/').includes('..')) throw new Error(`Unsafe ZIP path: ${name}`);
    totalSize += file.originalSize;
    if (++count > 10000 || totalSize > 256 * 1024 * 1024) throw new Error('Project archive exceeds extraction limits.');
    return !name.endsWith('/');
  } });
}

export async function saveArchive(zipPath, outputDir) {
  const bytes = await fs.readFile(zipPath);
  const entries = unpackArchive(bytes);
  await fs.mkdir(outputDir, { recursive: false });
  await fs.writeFile(path.join(outputDir, 'project.zip'), bytes, { flag: 'wx' });
  const sourceDir = path.join(outputDir, 'source');
  await fs.mkdir(sourceDir);
  for (const [name, content] of Object.entries(entries)) {
    const destination = path.resolve(sourceDir, name.replaceAll('\\', '/'));
    if (!destination.startsWith(sourceDir + path.sep)) throw new Error(`Unsafe ZIP destination: ${name}`);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, content, { flag: 'wx' });
  }
  return { archive: path.join(outputDir, 'project.zip'), sourceDir, files: Object.keys(entries) };
}

function downloadSlug(title) {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
}

export async function findDownload(directory, before, title, timeoutMs = 30000) {
  const slug = downloadSlug(title);
  let lastCandidate = null;
  let lastSize = null;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const names = await fs.readdir(directory);
    const candidates = [];
    for (const name of names) {
      if (!name.endsWith('.zip') || !name.startsWith(slug)) continue;
      const fullPath = path.join(directory, name);
      const stat = await fs.stat(fullPath);
      if (stat.size > 0 && before[name] !== `${stat.mtimeMs}:${stat.size}`) candidates.push({ fullPath, size: stat.size });
    }
    if (candidates.length > 1) throw new Error('Multiple matching downloads appeared. Inspect the download directory before collecting.');
    const candidate = candidates[0];
    if (candidate && candidate.fullPath === lastCandidate && candidate.size === lastSize) return candidate.fullPath;
    lastCandidate = candidate?.fullPath;
    lastSize = candidate?.size;
    await new Promise(resolve => setTimeout(resolve, 600));
  }
  throw new Error(`No completed ZIP download for "${title}" appeared in ${directory}. Check Chrome's download location.`);
}

export async function downloadInventory(directory) {
  const entries = {};
  for (const name of await fs.readdir(directory)) {
    if (!name.endsWith('.zip')) continue;
    const stat = await fs.stat(path.join(directory, name));
    entries[name] = `${stat.mtimeMs}:${stat.size}`;
  }
  return entries;
}
