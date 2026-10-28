import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { dataDirectory } from './config.mjs';

const root = path.resolve(import.meta.dirname, '..');
const runtimeDir = dataDirectory();
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  'prompt-file': { type: 'string' }, file: { type: 'string', multiple: true },
  new: { type: 'boolean', default: false }, job: { type: 'string' },
  'output-dir': { type: 'string' }, 'download-dir': { type: 'string' },
  timeout: { type: 'string', default: '45' }, help: { type: 'boolean' },
} });
const command = positionals[0] || 'help';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function request(operation, args = {}) {
  const connection = JSON.parse(await fs.readFile(path.join(runtimeDir, 'connection.json'), 'utf8'));
  const response = await fetch(`http://127.0.0.1:${connection.port}`, {
    method: 'POST', headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ operation, args }), signal: AbortSignal.timeout(150000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

async function start() {
  try { return await request('health'); } catch (error) {
    if (!(error.code === 'ENOENT' || error.cause?.code === 'ECONNREFUSED')) throw error;
  }
  await fs.mkdir(runtimeDir, { recursive: true });
  const log = await fs.open(path.join(runtimeDir, 'server.log'), 'a');
  const child = spawn(process.execPath, [path.join(root, 'src/server.mjs')], { cwd: root, detached: true, windowsHide: true, stdio: ['ignore', log.fd, log.fd] });
  child.unref();
  await log.close();
  for (let attempt = 0; attempt < 40; attempt++) {
    await sleep(250);
    try { return await request('health'); } catch (error) {
      if (!(error.code === 'ENOENT' || error.cause?.code === 'ECONNREFUSED')) throw error;
    }
  }
  throw new Error(`Server did not start. Read ${path.join(runtimeDir, 'server.log')}.`);
}

try {
  let result;
  if (command === 'help' || values.help) {
    console.log(`Studio Subagent — existing Chrome + AI Studio Build
node src/cli.mjs start
node src/cli.mjs connect
node src/cli.mjs inspect
node src/cli.mjs submit --prompt-file TASK.txt --file INPUT [--file MORE] [--new] [--output-dir DIR] [--download-dir CHROME_DOWNLOADS]
node src/cli.mjs status --job ID
node src/cli.mjs wait --job ID [--timeout 45]
node src/cli.mjs collect --job ID
node src/cli.mjs stop
Connect may require you to select an AI Studio Build tab in the Chrome extension.
Set STUDIO_SUBAGENT_DATA_DIR to an absolute path to override the system user data directory.
Submission is never automatically retried. Files and prompts are sent to Google only by submit.`);
  } else {
    if (command === 'start') result = await start();
    else if (command === 'submit') {
      if (!values['prompt-file']) throw new Error('--prompt-file is required.');
      result = await request('submit', {
        prompt: await fs.readFile(values['prompt-file'], 'utf8'), files: (values.file || []).map(file => path.resolve(file)),
        newApp: values.new, outputDir: values['output-dir'] && path.resolve(values['output-dir']),
        downloadDir: values['download-dir'] && path.resolve(values['download-dir']),
      });
    } else if (command === 'wait') {
      if (!values.job) throw new Error('--job is required.');
      const seconds = Number(values.timeout);
      if (!Number.isFinite(seconds) || seconds < 1 || seconds > 60) throw new Error('--timeout must be between 1 and 60 seconds.');
      const deadline = Date.now() + seconds * 1000;
      do {
        result = await request('status', { id: values.job });
        if (!['running', 'submitting', 'submission_unknown'].includes(result.status)) break;
        await sleep(2000);
      } while (Date.now() < deadline);
    } else if (['connect', 'inspect', 'status', 'collect', 'stop'].includes(command)) {
      if (['status', 'collect'].includes(command) && !values.job) throw new Error('--job is required.');
      result = await request(command, { id: values.job });
    } else throw new Error(`Unknown command: ${command}`);
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(JSON.stringify({ error: error.message }));
  process.exitCode = 1;
}
