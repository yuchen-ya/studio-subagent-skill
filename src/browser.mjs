import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import mime from 'mime-types';
import { COMPOSER, appId } from './state.mjs';

export class Browser {
  constructor(runtimeDir) {
    this.runtimeDir = runtimeDir;
  }

  async start() {
    await fs.mkdir(path.join(this.runtimeDir, 'downloads'), { recursive: true });
    let extensionToken = process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN;
    if (!extensionToken) {
      try { extensionToken = (await fs.readFile(path.join(this.runtimeDir, 'extension-token.txt'), 'utf8')).trim(); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    this.extensionToken = extensionToken;
    this.client = new Client({ name: 'Studio Subagent', version: '0.1.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('../node_modules/@playwright/mcp/cli.js', import.meta.url)), '--extension', '--output-dir', path.join(this.runtimeDir, 'downloads')],
      cwd: this.runtimeDir,
      stderr: 'inherit',
      env: { ...getDefaultEnvironment(), ...(extensionToken ? { PLAYWRIGHT_MCP_EXTENSION_TOKEN: extensionToken } : {}) },
    });
    await this.client.connect(transport);
  }

  async tool(name, args = {}) {
    const result = await this.client.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
    let text = result.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
    if (this.extensionToken) text = text.replaceAll(this.extensionToken, '[redacted]');
    if (result.isError || /^### Error\n/m.test(text)) throw new Error(text);
    return text;
  }

  async result(name, args) {
    const text = await this.tool(name, args);
    const match = text.match(/### Result\n([\s\S]*?)(?=\n### |$)/);
    if (!match) throw new Error(`Missing structured result from ${name}`);
    return JSON.parse(match[1]);
  }

  evaluate(expression) {
    return this.result('browser_evaluate', { function: `() => (${expression})` });
  }

  run(code) {
    const guarded = `async page => {
      const url = new URL(page.url());
      if (url.protocol !== 'https:' || !['aistudio.google.com','ai.studio'].includes(url.hostname) || !/^\\/apps(?:\\/|$)/.test(url.pathname)) throw new Error('The selected tab is not AI Studio Build.');
      await page.bringToFront();
      return (${code})(page);
    }`;
    return this.result('browser_run_code_unsafe', { code: guarded });
  }

  async connect(startUrl = 'https://aistudio.google.com/apps') {
    appId(startUrl);
    const tabs = await this.tool('browser_tabs', { action: 'list' });
    const url = await this.getUrl();
    const placeholder = url.startsWith('chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/connect.html');
    if (url === 'about:blank' || placeholder) {
      const existing = tabs.match(/^- (\d+):[^\n]*\]\(https:\/\/(?:aistudio\.google\.com|ai\.studio)\/apps(?:[/?#][^\s)]*)?\)$/m);
      if (existing) {
        // Close this connection's welcome page, never an existing user tab.
        if (placeholder) await this.tool('browser_tabs', { action: 'close' });
        const index = Number(existing[1]);
        const current = tabs.match(/^- (\d+): \(current\)/m);
        await this.tool('browser_tabs', { action: 'select', index: index - (placeholder && Number(current[1]) < index ? 1 : 0) });
      } else {
        await this.tool('browser_navigate', { url: startUrl });
        this.ownsTab = placeholder;
      }
    } else {
      appId(url);
    }
    return { url: await this.getUrl() };
  }

  getUrl() {
    return this.evaluate('location.href');
  }

  async upload(files) {
    const payloads = await Promise.all(files.map(async file => ({
      name: path.basename(file), type: mime.lookup(file) || 'application/octet-stream',
      data: (await fs.readFile(file)).toString('base64'),
    })));
    return this.run(`async page => page.locator(${JSON.stringify(COMPOSER)}).evaluate((node, files) => {
      if (node.getAttribute('aria-disabled') === 'true') throw new Error('The composer is disabled.');
      const transfer = new DataTransfer();
      for (const file of files) {
        const bytes = Uint8Array.from(atob(file.data), char => char.charCodeAt(0));
        transfer.items.add(new File([bytes], file.name, {type:file.type}));
      }
      for (const type of ['dragenter','dragover','drop']) {
        node.dispatchEvent(new DragEvent(type, {bubbles:true,cancelable:true,dataTransfer:transfer}));
      }
      return {dispatched:files.length};
    }, ${JSON.stringify(payloads)})`);
  }

  async close() {
    try {
      if (this.ownsTab) {
        appId(await this.getUrl());
        await this.tool('browser_tabs', { action: 'close' });
      }
    } finally {
      await this.client.close();
    }
  }
}
