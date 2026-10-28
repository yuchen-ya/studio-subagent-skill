import test from 'node:test';
import assert from 'node:assert/strict';
import { Browser } from '../src/browser.mjs';

const build = 'https://aistudio.google.com/apps';
const welcome = 'chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/connect.html';

function browserWithTabs(urls, current = 0) {
  const browser = new Browser('unused');
  browser.client = { close: async () => {} };
  browser.getUrl = async () => urls[current];
  browser.tool = async (name, args) => {
    if (name === 'browser_navigate') urls[current] = args.url;
    else if (name === 'browser_tabs') {
      if (args.action === 'list') return urls.map((url, index) => `- ${index}:${index === current ? ' (current)' : ''} [Tab](${url})`).join('\n');
      if (args.action === 'new') assert.fail('Connecting must not create another tab.');
      if (args.action === 'select') current = args.index;
      if (args.action === 'close') {
        urls.splice(current, 1);
        current = Math.min(current, urls.length - 1);
      }
    } else assert.fail(`Unexpected tool: ${name}`);
  };
  return browser;
}

test('connecting repeatedly reuses the welcome tab and stop removes only that temporary tab', async () => {
  const urls = ['https://example.com', welcome];
  const browser = browserWithTabs(urls, 1);
  await browser.connect();
  await browser.connect();
  assert.deepEqual(urls, ['https://example.com', build]);
  await browser.close();
  assert.deepEqual(urls, ['https://example.com']);
});

test('an existing Build tab is selected and retained when the connection stops', async () => {
  for (const urls of [[welcome, `${build}/existing`], [`${build}/existing`, welcome]]) {
    const browser = browserWithTabs(urls, urls.indexOf(welcome));
    assert.equal((await browser.connect()).url, `${build}/existing`);
    await browser.close();
    assert.deepEqual(urls, [`${build}/existing`]);
  }
});

test('a user-selected blank tab is reused and retained', async () => {
  const urls = ['about:blank'];
  const browser = browserWithTabs(urls);
  await browser.connect();
  await browser.close();
  assert.deepEqual(urls, [build]);
});

test('reconnecting to a selected project preserves that project', async () => {
  const urls = [`${build}/other`, `${build}/selected`];
  const browser = browserWithTabs(urls, 1);
  assert.equal((await browser.connect()).url, `${build}/selected`);
  await browser.close();
  assert.equal(urls.length, 2);
});
