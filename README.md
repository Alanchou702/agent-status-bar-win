# Agent Signal Bar for Windows · 0.4.0

Electron + TypeScript monitoring for local Claude Code and Codex agents.

Open `release/AgentStatusBar 0.4.0.exe`, or run `npm install` and `npm start`. Use `npm.cmd` in PowerShell if script execution is restricted.

## New in 0.4

- Discover all unarchived Codex sessions and newly logging threads.
- Independent activity and notification tracking per thread; attention priority across sessions.
- Search and filter sessions by status, title, project, or thread ID.
- Hover over the compact desktop indicator to expand it into the full panel; leave to collapse with a smooth transition.
- Drag without opening the panel; preserve filters and unsaved settings across collapse.

## Development

```sh
npm run typecheck
npm test
npm run test:ui
npm run dist
```

43 regression tests, 19 Electron UI checks, and 7 production-entry checks. UI tests use isolated settings; generated screenshots are disposable artifacts.

Detection uses local logs and bounded rollout tails, not an official event subscription or the GUI open-tab list. It cannot guarantee exact thread-to-process association. See [the Chinese guide](README_zh.md) for scope, configuration, and limitations, and [the change record](REFACTOR.md).

MIT. Original author: zhuhuibin.

