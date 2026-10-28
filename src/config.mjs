import os from 'node:os';
import path from 'node:path';

export function dataDirectory() {
  const override = process.env.STUDIO_SUBAGENT_DATA_DIR;
  if (override) {
    if (!path.isAbsolute(override)) throw new Error('STUDIO_SUBAGENT_DATA_DIR must be an absolute path.');
    return path.normalize(override);
  }
  let base;
  if (process.platform === 'win32') base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  else if (process.platform === 'darwin') base = path.join(os.homedir(), 'Library', 'Application Support');
  else base = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
  return path.join(base, 'studio-subagent');
}
