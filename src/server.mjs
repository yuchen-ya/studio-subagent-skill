import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { Browser } from './browser.mjs';
import { AiStudioAgent } from './agent.mjs';
import { dataDirectory } from './config.mjs';

const runtimeDir = dataDirectory();
await fs.mkdir(runtimeDir, { recursive: true, mode: 0o700 });
const browser = new Browser(runtimeDir);
await browser.start();
const agent = new AiStudioAgent(browser, runtimeDir);
const token = crypto.randomBytes(32).toString('hex');
let queue = Promise.resolve();
const server = http.createServer(async (req, res) => {
  if (req.headers.origin || req.headers.authorization !== `Bearer ${token}`) {
    res.writeHead(401); res.end(); return;
  }
  try {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 2000000) throw new Error('Request is too large.');
    }
    const { operation, args = {} } = JSON.parse(body);
    const operations = {
      health: async () => ({ ready: true, pid: process.pid }),
      connect: async () => {
        let startUrl = 'https://aistudio.google.com/apps';
        try {
          const { id } = JSON.parse(await fs.readFile(path.join(runtimeDir, 'active.json'), 'utf8'));
          const job = await agent.readJob(id);
          if (['submitting', 'submission_unknown', 'running', 'needs_attention', 'completed'].includes(job.status)) startUrl = job.url;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        return browser.connect(startUrl);
      },
      inspect: () => agent.inspect(),
      submit: () => agent.submit(args),
      status: () => agent.status(args.id),
      collect: () => agent.collect(args.id),
      stop: async () => { setTimeout(() => server.close(async () => { await browser.close(); process.exit(0); }), 100); return { stopped: true }; },
    };
    if (!Object.hasOwn(operations, operation)) throw new Error('Unknown operation.');
    const independent = ['health', 'stop'].includes(operation);
    const pending = independent ? operations[operation]() : queue.then(operations[operation]);
    if (!independent) queue = pending.catch(() => {}); // Report failed operations without blocking later requests.
    const result = await pending;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (error) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
});
server.listen(0, '127.0.0.1', async () => {
  await fs.writeFile(path.join(runtimeDir, 'connection.json'), JSON.stringify({ port: server.address().port, token, pid: process.pid }), { mode: 0o600 });
  console.log('Studio Subagent ready.');
});
