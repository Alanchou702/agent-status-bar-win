# Agent 状态栏 for Windows

Windows 系统托盘应用，用于监控 AI 编程助手（Claude Code & OpenAI Codex）的运行状态，并通过托盘图标、桌面指示灯和系统通知展示代理状态。

## 功能特性

- **系统托盘监控** — 实时显示 Claude Code 和 Codex 在 Windows 任务栏托盘中的状态
- **桌面指示灯** — 可拖拽的彩色指示灯，一眼看出代理活动状态（绿色=工作中，蓝色=运行中，灰色=空闲，红色=等待审批）
- **托盘图标状态**
  - 灰色圆圈：空闲
  - 蓝色圆圈：运行中
  - 绿色闪烁：工作中
  - 红色闪烁：等待审批
- **系统通知** — 代理开始工作、等待输入、需要审批或完成时发送 OS 级别通知
- **积分追踪** — 在托盘菜单中显示 Claude API 剩余积分（5小时额度和每周额度）
- **防睡眠** — 代理活跃工作时阻止 Windows 进入睡眠
- **开机自启** — 随 Windows 自动启动
- **守护模式** (`--watch`) — 轻量级无头监控，检测到代理启动时自动拉起主程序
- **状态模拟** — 内置模拟功能，可测试托盘图标和通知效果

## 截图

| 托盘图标 | 桌面指示灯 |
|----------|------------|
| 灰色空闲 | 灰色灯光 |
| 蓝色运行中 | 蓝色灯光 |
| 绿色忙碌（闪烁） | 绿色灯光（闪烁） |
| 红色审批中（闪烁） | 红色灯光（闪烁） |

## 安装

### 从源码运行

```bash
npm install
npm start
```

### 构建安装包

```bash
npm run dist
```

打包后的安装程序位于 `release/` 目录。

## 系统要求

- Windows 10/11
- 已安装 [Claude Code](https://github.com/anthropic-ai/claude-code) 或 [OpenAI Codex](https://github.com/openai/codex)
- Node.js 20+

## 工作原理

1. **进程枚举** — 通过 PowerShell (`Win32_Process`) 检测正在运行的 `claude.exe` 和 `codex.exe` 进程
2. **Claude 扫描** — 读取 `~/.claude/sessions/` 下的会话 JSON 文件，并检查转录日志中的审批状态
3. **Codex 扫描** — 查询 `~/.codex/logs_2.sqlite` 以从事件日志判断活动状态
4. **积分查询** — 使用存储的访问令牌从 Anthropic OAuth API 获取使用数据
5. **状态聚合** — 将两个代理的状态合并为统一状态，显示在托盘和桌面指示灯中

## 配置

设置保存在 `%APPDATA%\agent-status-bar\config.json`。主要选项：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `scanIntervalSec` | 3 | 扫描代理状态的间隔（秒） |
| `keepAwakeEnabled` | true | 代理忙碌时阻止系统睡眠 |
| `openAtLogin` | true | Windows 登录时自动启动 |
| `claudeBusyFreshnessMs` | 30000 | 会话更新多近才算忙碌（毫秒） |
| `codexTurnActivityFreshnessMs` | 30000 | Codex 活动时间的相同阈值 |
| `codexThreadLookupWindowSec` | 7200 | 查找 Codex 线程的时间范围（2小时） |
| `credit.enabled` | true | 启用积分显示 |
| `credit.endpoint` | Anthropic OAuth 地址 | 积分 API 端点 |
| `light.enabled` | true | 显示桌面指示灯 |
| `light.x`, `light.y` | 右上角 | 桌面指示灯位置（拖动后自动保存） |

## 开发

```bash
# 类型检查
npx tsc --noEmit

# 开发模式运行
npm start

# 编译 TypeScript
npm run build
```

## 项目结构

```
src/
├── shared/
│   └── types.ts          # 共享数据模型
├── main/
│   ├── main.ts           # 应用入口
│   ├── tray.ts           # 系统托盘图标和菜单
│   ├── statusLight.ts    # 状态聚合逻辑
│   ├── desktopLight.ts   # 桌面指示灯窗口
│   ├── notifications.ts  # 系统通知
│   ├── keepAwake.ts      # Windows 电源管理
│   ├── config.ts         # 配置文件处理
│   ├── watch.ts          # 无头守护模式
│   └── scanner/
│       ├── scanAll.ts    # 完整扫描编排器
│       ├── processEnumerator.ts  # PowerShell 进程扫描
│       ├── claudeScanner.ts      # Claude 会话分析
│       ├── codexScanner.ts       # Codex 数据库查询
│       └── creditScanner.ts      # API 积分追踪
└── cli/
    └── scanOnce.ts       # 一次性扫描（调试用）
```

## 许可证

MIT
