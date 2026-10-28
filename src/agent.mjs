import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { COMPOSER, appId, readBuildState, updateJob } from './state.mjs';
import { saveArchive, findDownload, downloadInventory } from './archive.mjs';

export class AiStudioAgent {
  constructor(browser, runtimeDir) {
    this.browser = browser;
    this.runtimeDir = runtimeDir;
    this.jobsDir = path.join(runtimeDir, 'jobs');
  }

  async inspect() {
    appId(await this.browser.getUrl());
    return this.browser.evaluate(`(${readBuildState.toString()})()`);
  }

  jobPath(id) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid job id.');
    return path.join(this.jobsDir, id, 'job.json');
  }

  async readJob(id) {
    return JSON.parse(await fs.readFile(this.jobPath(id), 'utf8'));
  }

  async writeJob(job) {
    await fs.writeFile(this.jobPath(job.id), JSON.stringify(job, null, 2));
    return job;
  }

  async submit({ prompt, files = [], newApp = false, outputDir, downloadDir }) {
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 200000) throw new Error('Provide a nonempty prompt of at most 200000 characters.');
    if (!Array.isArray(files) || files.some(file => typeof file !== 'string')) throw new Error('files must be an array of paths.');
    const names = files.map(file => path.basename(file));
    if (new Set(names).size !== names.length) throw new Error('Attachment names must be unique.');
    for (const file of files) if (!(await fs.stat(file)).isFile()) throw new Error(`Not a file: ${file}`);
    const current = await this.inspect();
    if (current.running) throw new Error('Build is already running. Wait for it to finish before submitting another task.');
    if (current.draft?.trim()) throw new Error('The current composer contains an unsent draft. Save or clear it before submitting.');
    const activeFile = path.join(this.runtimeDir, 'active.json');
    try {
      const activeId = JSON.parse(await fs.readFile(activeFile, 'utf8')).id;
      const active = await this.readJob(activeId);
      if (['submitting', 'submission_unknown', 'running', 'needs_attention'].includes(active.status)) throw new Error(`Resolve active job ${activeId} before submitting again.`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (newApp) {
      await this.browser.tool('browser_navigate', { url: 'https://aistudio.google.com/apps' });
      await this.browser.run(`async page => { await page.locator(${JSON.stringify(COMPOSER)}).waitFor({state:'visible'}); return true; }`);
    }
    const baseline = await this.inspect();
    const id = crypto.randomUUID();
    const jobDir = path.join(this.jobsDir, id);
    const inputDir = path.join(jobDir, 'input');
    await fs.mkdir(inputDir, { recursive: true });
    const attachments = [];
    for (const file of files) {
      const staged = path.join(inputDir, path.basename(file));
      await fs.copyFile(file, staged, fs.constants.COPYFILE_EXCL);
      attachments.push(staged);
    }
    const job = {
      id, status: 'preparing', createdAt: new Date().toISOString(), prompt: prompt.trim(), marker: `studio-job-${id}`,
      baselineAssistantCount: baseline.assistantCount,
      appPath: newApp ? null : appId(baseline.url),
      url: baseline.url,
      outputRoot: path.resolve(outputDir || path.join(jobDir, 'output')),
      downloadDir: path.resolve(downloadDir || path.join(os.homedir(), 'Downloads')),
      attachments: files.map(file => path.resolve(file)), accepted: false,
    };
    await this.writeJob(job);
    if (attachments.length) {
      await this.browser.upload(attachments);
      await this.browser.run(`async page => {
        for (const name of ${JSON.stringify(names)}) {
          await page.getByRole('button',{name,exact:false})
            .filter({has:page.getByRole('button',{name:'Remove file',exact:true})})
            .waitFor({state:'visible',timeout:10000});
        }
        return {uploaded:true};
      }`);
    }
    await this.browser.run(`async page => {
      const composer = page.locator(${JSON.stringify(COMPOSER)});
      await composer.fill(${JSON.stringify(job.prompt + `\n\nTask reference: ${job.marker}`)});
      return {draft:await composer.evaluate(node => node.value ?? node.innerText)};
    }`);
    job.status = 'submitting';
    await this.writeJob(job);
    await fs.writeFile(activeFile, JSON.stringify({ id }));
    try {
      await this.browser.run(`async page => {
        const send = page.getByRole('button',{name:/^(Build|Send|Run)$/});
        if (!await send.isEnabled()) throw new Error('The send button is disabled.');
        await send.click({force:true,timeout:10000});
        return {clicked:true};
      }`);
    } catch (error) {
      job.status = 'submission_unknown';
      job.reason = error.message;
      await this.writeJob(job);
      return this.summary(job);
    }
    return this.status(id);
  }

  summary(job) {
    const { prompt, baselineAssistantCount, ...summary } = job;
    return summary;
  }

  async status(id) {
    const job = await this.readJob(id);
    if (job.status === 'collected') return this.summary(job);
    const state = await this.inspect();
    const next = updateJob(job, state);
    await this.writeJob(next);
    return this.summary(next);
  }

  async collect(id) {
    const job = await this.readJob(id);
    if (job.status === 'collected') return this.summary(job);
    const status = await this.status(id);
    if (status.status !== 'completed') throw new Error(`Job is ${status.status}; only a confirmed completed task can be collected.`);
    const state = await this.inspect();
    const before = await downloadInventory(job.downloadDir);
    await this.browser.run(`async page => {
      await page.getByRole('radio',{name:'Code',exact:true}).click();
      await page.getByRole('button',{name:'Export options',exact:true}).click();
      await page.getByRole('menuitem',{name:/^Download as \\.zip file/}).click();
      return {exportRequested:true};
    }`);
    const zipPath = await findDownload(job.downloadDir, before, state.title);
    await fs.mkdir(job.outputRoot, { recursive: true });
    const result = await saveArchive(zipPath, path.join(job.outputRoot, id));
    const completed = { ...await this.readJob(id), status: 'collected', collectedAt: new Date().toISOString(), result };
    await this.writeJob(completed);
    return this.summary(completed);
  }
}
