import * as fs from 'node:fs';
import * as path from 'node:path';

/** Return the newest matching Codex database, falling back to the configured path. */
export function resolveCodexDb(configuredPath: string, kind: 'logs' | 'state'): string {
  const dir = path.dirname(configuredPath);
  const pattern = kind === 'logs' ? /^logs(?:_\d+)?\.sqlite$/i : /^state(?:_\d+)?\.sqlite$/i;
  try {
    const candidates = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && pattern.test(entry.name))
      .map((entry) => {
        const filePath = path.join(dir, entry.name);
        return { filePath, mtime: fs.statSync(filePath).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    return candidates[0]?.filePath ?? configuredPath;
  } catch {
    return configuredPath;
  }
}
