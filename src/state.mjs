export const COMPOSER = 'div[role="textbox"][aria-label="Describe an app and let Gemini do the rest"], textarea[placeholder="Make changes, add new features, ask for anything"]';

export function appId(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !['aistudio.google.com', 'ai.studio'].includes(parsed.hostname) || !/^\/apps(?:\/|$)/.test(parsed.pathname)) {
    throw new Error('Select an AI Studio Build tab in the Playwright Extension first.');
  }
  return parsed.pathname;
}

// Executes in the selected page. Keep this function self-contained.
export function readBuildState() {
  const visible = node => !!node && node.getBoundingClientRect().width > 0 && getComputedStyle(node).visibility !== 'hidden';
  const headers = [...document.querySelectorAll('.turn-header')].filter(visible);
  const responses = [...document.querySelectorAll('ms-console-assistant-response')].filter(visible);
  const response = responses.at(-1)?.innerText?.trim() || '';
  const header = headers.at(-1)?.innerText?.replace(/\s+/g, ' ').trim() || '';
  const alerts = [...document.querySelectorAll('[role="alert"]')].filter(visible).map(node => node.innerText).join('\n');
  const errorPattern = /quota exceeded|exceeded (?:your )?quota|out of free generations|something went wrong|failed to (?:generate|run code assistant)|permission denied|resource_exhausted/i;
  const composer = [...document.querySelectorAll('div[role="textbox"][aria-label="Describe an app and let Gemini do the rest"], textarea[placeholder="Make changes, add new features, ask for anything"]')].find(visible);
  return {
    url: location.href,
    title: document.title.replace(/ \| Google AI Studio$/, ''),
    header,
    assistantCount: headers.length,
    running: /\bRunning for\b/i.test(header),
    finished: /\bRan for\b/i.test(header),
    response: response.slice(-40000),
    failure: errorPattern.test(alerts) ? alerts : errorPattern.test(response.slice(-1800)) ? response.slice(-1800) : null,
    draft: composer ? (composer.value ?? composer.innerText ?? '') : null,
    messages: [...document.querySelectorAll('.bubble.user')].map(node => node.innerText?.trim()).filter(Boolean),
    files: [...document.querySelectorAll('ms-console-assistant-response button[aria-label^="Open "]')].map(node => node.getAttribute('aria-label').slice(5)),
  };
}

export function updateJob(job, state, now = Date.now()) {
  if (job.appPath && appId(state.url) !== job.appPath) {
    return { ...job, status: 'needs_attention', reason: 'The selected tab changed. Return to the job URL; do not submit again.' };
  }
  const accepted = job.accepted || state.messages.some(message => message.includes(job.marker));
  if (!accepted) return { ...job, status: 'submission_unknown', reason: 'Submission is not confirmed. Inspect the tab before taking any further action.' };
  if (!state.messages.at(-1)?.includes(job.marker)) {
    return { ...job, status: 'needs_attention', reason: 'A different task was sent in this project. Inspect the conversation before collecting.' };
  }
  const next = { ...job, accepted: true, appPath: appId(state.url), url: state.url, reason: null };
  if (state.failure) return { ...next, status: 'failed', reason: state.failure };
  if (state.assistantCount <= job.baselineAssistantCount || state.running || !state.finished || !state.response) {
    return { ...next, status: 'running', response: state.response, stableSince: null };
  }
  const stableSince = job.response === state.response && job.stableSince ? job.stableSince : now;
  return { ...next, response: state.response, stableSince, status: now - stableSince >= 1500 ? 'completed' : 'running' };
}
