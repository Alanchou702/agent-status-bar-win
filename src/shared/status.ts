import type { AgentSnapshot, AgentSummary } from './types.js';

export type DisplayState = 'idle' | 'running' | 'busy' | 'approval' | 'input' | 'deleting' | 'done' | 'unknown' | 'paused';
export interface StatusPresentation { state: DisplayState; label: string; description: string; color: string }
export const STATUS: Record<DisplayState, StatusPresentation> = {
  idle: { state: 'idle', label: '未运行', description: '启动 Claude Code 或 Codex 后，这里会自动显示状态。', color: '#83909f' },
  running: { state: 'running', label: '待命', description: 'Agent 已启动，正在等待下一项任务。', color: '#4275d5' },
  busy: { state: 'busy', label: '工作中', description: 'Agent 正在处理任务，你可以继续做自己的事。', color: '#22926c' },
  approval: { state: 'approval', label: '等待审批', description: '请回到 Agent 确认待审批的操作。', color: '#d04b52' },
  input: { state: 'input', label: '等待输入', description: 'Agent 需要你的回答，请回到对话继续。', color: '#bd831c' },
  deleting: { state: 'deleting', label: '删除文件中', description: 'Agent 正在执行文件删除操作。', color: '#bd831c' },
  done: { state: 'done', label: '任务完成', description: '这一轮任务已完成，可以回到 Agent 查看结果。', color: '#22926c' },
  unknown: { state: 'unknown', label: '状态不可用', description: '无法读取活动记录，请检查 Agent 或稍后刷新。', color: '#bd831c' },
  paused: { state: 'paused', label: '监控已暂停', description: '恢复监控后将重新读取状态，暂停期间不会发送通知。', color: '#83909f' },
};

export function stateOf(s: AgentSnapshot): DisplayState {
  if (s.state === 'unknown') return 'unknown';
  if (s.state === 'busy' && /approval|permission/i.test(s.detail ?? '')) return 'approval';
  if (s.state === 'busy' && /your input/i.test(s.detail ?? '')) return 'input';
  if (s.state === 'busy' && s.deleting) return 'deleting';
  if (s.state === 'busy') return 'busy';
  if (s.done) return 'done';
  return s.state;
}

const priority: DisplayState[] = ['approval', 'input', 'deleting', 'busy', 'unknown', 'done', 'running', 'idle'];
export function aggregateStatus(summary: AgentSummary, paused = false): StatusPresentation {
  if (paused) return STATUS.paused;
  const states = new Set(summary.snapshots.map(stateOf));
  return STATUS[priority.find(state => states.has(state)) ?? 'idle'];
}
