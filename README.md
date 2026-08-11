# Agent Status Bar for Windows

A Windows system tray application that monitors the status of AI coding agents (Claude Code & OpenAI Codex) and displays their state with a tray icon, desktop light, and system notifications.

## Features

- **System Tray Monitor** — Real-time status of Claude Code and Codex in the Windows taskbar tray
- **Desktop Light Widget** — Draggable colored light that shows agent activity at a glance (green = busy, blue = running, gray = idle, red = waiting approval)
- **Tray Icon States**
  - Gray circle: idle
  - Blue circle: running
  - Green blinking: busy (working)
  - Red blinking: waiting for approval
- **Notifications** — OS-level notifications when agents become busy, wait for input, need approval, or finish
- **Credit Tracker** — Shows remaining Claude API credits (5-hour and weekly quotas) in the tray menu
- **Keep Awake** — Prevents Windows from sleeping while an agent is actively working
- **Auto-start at Login** — Launches with Windows automatically
- **Watch Mode** (`--watch`) — Lightweight headless monitor that launches the main app when it detects agents starting
- **Simulate State** — Test tray icons and notifications with built-in simulation

## Screenshots

| Tray Icon | Desktop Light |
|-----------|---------------|
| Gray idle | Gray light |
| Blue running | Blue light |
| Green busy (blinking) | Green light (blinking) |
| Red approval (blinking) | Red light (blinking) |

## Installation

### From Source

```bash
npm install
npm start
```

### Build Distributable

```bash
npm run dist
```

The packaged installer will be in the `release/` directory.

## Requirements

- Windows 10/11
- [Claude Code](https://github.com/anthropic-ai/claude-code) or [OpenAI Codex](https://github.com/openai/codex) installed
- Node.js 20+

## How It Works

1. **Process Enumeration** — Uses PowerShell (`Win32_Process`) to detect running `claude.exe` and `codex.exe` processes
2. **Claude Scanning** — Reads session JSON files from `~/.claude/sessions/` and checks transcript logs for approval states
3. **Codex Scanning** — Queries `~/.codex/logs_2.sqlite` to determine activity state from the event log
4. **Credit Query** — Fetches usage data from Anthropic's OAuth API using the stored access token
5. **State Aggregation** — Combines both agents into a unified status displayed in the tray and desktop light

## Configuration

Settings are stored in `%APPDATA%\agent-status-bar\config.json`. Key options:

| Setting | Default | Description |
|---------|---------|-------------|
| `scanIntervalSec` | 3 | How often to rescan agent state (seconds) |
| `keepAwakeEnabled` | true | Prevent system sleep while agent is busy |
| `openAtLogin` | true | Auto-start on Windows login |
| `claudeBusyFreshnessMs` | 30000 | How recent a session update must be to count as busy |
| `codexTurnActivityFreshnessMs` | 30000 | Same for Codex activity timestamps |
| `codexThreadLookupWindowSec` | 7200 | How far back to look for Codex threads (2 hours) |
| `credit.enabled` | true | Enable credit usage display |
| `credit.endpoint` | Anthropic OAuth URL | Credit API endpoint |
| `light.enabled` | true | Show desktop light widget |
| `light.x`, `light.y` | top-right | Desktop light position (auto-saved on drag) |

## Development

```bash
# Type check
npx tsc --noEmit

# Run in development mode
npm start

# Build TypeScript
npm run build
```

## Architecture

```
src/
├── shared/
│   └── types.ts          # Shared data models
├── main/
│   ├── main.ts           # App entry point
│   ├── tray.ts           # System tray icon & menu
│   ├── statusLight.ts    # Status aggregation logic
│   ├── desktopLight.ts   # Desktop light window
│   ├── notifications.ts  # OS notification system
│   ├── keepAwake.ts      # Windows power management
│   ├── config.ts         # Config file handling
│   ├── watch.ts          # Headless watch mode
│   └── scanner/
│       ├── scanAll.ts    # Full scan orchestrator
│       ├── processEnumerator.ts  # PowerShell process scan
│       ├── claudeScanner.ts      # Claude session analysis
│       ├── codexScanner.ts       # Codex DB query
│       └── creditScanner.ts      # API credit tracking
└── cli/
    └── scanOnce.ts       # Headless one-shot scan (debugging)
```

## License

MIT
