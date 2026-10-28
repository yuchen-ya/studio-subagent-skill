import test from 'node:test';
import assert from 'node:assert/strict';
import { appId, updateJob } from '../src/state.mjs';
import { unpackArchive } from '../src/archive.mjs';
import { AiStudioAgent } from '../src/agent.mjs';
import { zipSync, strToU8 } from 'fflate';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const job = { id: '11111111-1111-4111-8111-111111111111', marker: 'studio-job-1111', baselineAssistantCount: 1, accepted: false };
const state = { url: 'https://aistudio.google.com/apps/test-app', assistantCount: 2, messages: ['First paragraph\n\nSecond paragraph\n\nTask reference: studio-job-1111'], running: false, finished: true, response: 'Modified the attached file.', failure: null };

test('a submitted message confirms acceptance even when the original send signal is absent', () => {
  const result = updateJob(job, { ...state, running: true, finished: false });
  assert.equal(result.accepted, true);
  assert.equal(result.status, 'running');
});

test('an old answer and an empty composer cannot complete a newly submitted task', () => {
  assert.equal(updateJob(job, { ...state, messages: [], assistantCount: 1 }).status, 'submission_unknown');
  assert.equal(updateJob({ ...job, accepted: true }, { ...state, assistantCount: 1 }).status, 'running');
});

test('completion requires the new finished turn and stable output across observations', () => {
  const first = updateJob(job, state, 10000);
  assert.equal(first.status, 'running');
  assert.equal(updateJob(first, state, 11600).status, 'completed');
  assert.equal(updateJob(first, { ...state, response: 'Still editing.' }, 11600).status, 'running');
});

test('leaving the task tab pauses result collection', () => {
  assert.equal(updateJob({ ...job, appPath: '/apps/test-app', accepted: true }, { ...state, url: 'https://aistudio.google.com/apps/another-app' }).status, 'needs_attention');
  assert.throws(() => appId('https://aistudio.google.com.attacker.example/apps/test'));
  assert.equal(updateJob({ ...job, accepted: true }, { ...state, messages: [...state.messages, 'A separate manual task'] }).status, 'needs_attention');
});

test('ZIP contents are preserved and parent paths are rejected', () => {
  const content = '<h1>Changed by AI Studio</h1>';
  assert.equal(new TextDecoder().decode(unpackArchive(zipSync({ 'roundtrip.html': strToU8(content) }))['roundtrip.html']), content);
  assert.throws(() => unpackArchive(zipSync({ '../escape.html': strToU8(content) })), /Unsafe ZIP path/);
});

test('an uncertain click is recorded once and cannot be automatically resubmitted', async () => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-subagent-'));
  let clicks = 0;
  const browser = { run: async code => {
    if (code.includes('.click(')) { clicks++; throw new Error('Connection interrupted after click'); }
    return { draft: 'Make the edit' };
  } };
  const agent = new AiStudioAgent(browser, runtimeDir);
  agent.inspect = async () => ({ ...state, messages: [], assistantCount: 1, running: false, draft: '' });
  try {
    const submitted = await agent.submit({ prompt: 'Make the edit' });
    assert.equal(submitted.status, 'submission_unknown');
    await assert.rejects(() => agent.submit({ prompt: 'Make the edit' }), /Resolve active job/);
    assert.equal(clicks, 1);
  } finally {
    await fs.rm(runtimeDir, { recursive: true });
  }
});
