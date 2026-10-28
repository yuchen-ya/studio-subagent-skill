import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const installer = fileURLToPath(new URL('../scripts/install-skill.mjs', import.meta.url));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function run(script, args, directory, env) {
  return spawnSync(process.execPath, [script, ...args], { cwd: directory, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 20000, windowsHide: true });
}

test('runtime state is external, authenticated, and works from another working directory', { timeout: 30000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-runtime-'));
  const dataDir = path.join(directory, 'state');
  const env = { STUDIO_SUBAGENT_DATA_DIR: dataDir };
  let connection;
  try {
    const started = run(cli, ['start'], directory, env);
    assert.equal(started.status, 0, started.stderr);
    connection = JSON.parse(await fs.readFile(path.join(dataDir, 'connection.json'), 'utf8'));
    const response = await fetch(`http://127.0.0.1:${connection.port}`, { method: 'POST', body: JSON.stringify({ operation: 'health' }) });
    assert.equal(response.status, 401);
    assert.deepEqual((await fs.readdir(directory)).sort(), ['state']);
  } finally {
    if (connection) {
      const stopped = run(cli, ['stop'], directory, env);
      assert.equal(stopped.status, 0, stopped.stderr);
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        try { await fetch(`http://127.0.0.1:${connection.port}`); }
        catch (error) {
          if (error.cause?.code === 'ECONNREFUSED') break;
          throw error;
        }
        await sleep(50);
      }
    }
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('relative data-directory overrides are rejected', () => {
  const result = run(cli, ['help'], os.tmpdir(), { STUDIO_SUBAGENT_DATA_DIR: './relative-state' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must be an absolute path/);
});

test('skill installation resolves its project without machine-specific paths', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-skill-'));
  const env = { CODEX_HOME: directory, STUDIO_SUBAGENT_DATA_DIR: path.join(directory, 'state') };
  try {
    const installed = run(installer, [], directory, env);
    assert.equal(installed.status, 0, installed.stderr);
    const wrapper = path.join(directory, 'skills/aistudio-subagent/scripts/run.mjs');
    const result = run(wrapper, ['help'], directory, env);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Studio Subagent/);
    assert.equal((await fs.readdir(directory)).includes('state'), false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
