'use strict';
const $ = id => document.getElementById(id);
const api = window.agentBar;
const names = { claude: 'Claude Code', codex: 'Codex' };
let latest;
let currentView = 'overview';
let settingsDirty = false;
let savedSettingsKey = '';
let eventsKey = '';
let sessionsKey = '';
const form = $('settings-form');
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function time(at) { return at ? new Date(at).toLocaleTimeString('zh-CN', { hour12: false }) : '—'; }
function setView(view) {
  currentView = ['overview', 'activity', 'settings'].includes(view) ? view : 'overview';
  document.querySelector('.panel').classList.toggle('settings-view', currentView === 'settings');
  for (const name of ['overview', 'activity', 'settings']) $(name).hidden = name !== currentView;
  for (const name of ['overview', 'activity']) {
    $(name + '-tab').classList.toggle('selected', name === currentView);
    $(name + '-tab').setAttribute('aria-selected', String(name === currentView));
  }
  api?.action(currentView === 'settings' ? 'view:settings' : 'view:overview').catch(() => {});
}
const cards = new Map();
for (const client of ['claude', 'codex']) {
  const card = element('article', 'agent-card');
  const top = element('div', 'agent-top');
  const icon = element('img', 'agent-icon'); icon.src = client + '.png'; icon.alt = '';
  const badge = element('span', 'badge', '连接中');
  top.append(icon, element('span', 'agent-name', names[client]), badge);
  const detail = element('div', 'agent-detail', '等待首次扫描');
  card.append(top, detail);
  $('agents').append(card); cards.set(client, { badge, detail });
}
function render(data) {
  latest = data;
  const { summary, status, settings } = data;
  const initial = !summary.scannedAt;
  $('hero').dataset.state = status.state;
  $('status-label').textContent = initial && !data.paused ? '正在连接' : status.label;
  $('status-description').textContent = initial && !data.paused ? '正在读取本机 Agent 的运行状态。' : status.description;
  $('mode').textContent = data.simulated ? '状态预览' : data.paused ? '已暂停' : '本机监控';
  $('connection').textContent = data.paused ? '已暂停' : data.scanning ? '更新中' : data.error ? '连接异常' : '监控中';
  $('live-time').textContent = initial ? '首次扫描中' : time(summary.scannedAt);
  $('pause').textContent = data.paused ? '▶ 恢复监控' : 'Ⅱ 暂停监控';
  $('refresh').disabled = data.paused || data.scanning;
  $('refresh').textContent = data.scanning ? '更新中…' : '↻ 刷新';
  $('error').hidden = !data.error;
  $('error').textContent = data.error ? '扫描失败：' + data.error + ' 可点击刷新重试。' : '';
  $('demo-notice').hidden = !data.simulated;
  $('scan-warning').hidden = !summary.warnings?.length;
  $('scan-warning').textContent = (summary.warnings || []).join(' ');
  $('agent-count').textContent = initial ? '自动发现' : data.paused ? '暂停前的状态' : data.agents.filter(a => ['running', 'busy', 'approval', 'input', 'deleting', 'done'].includes(a.status.state)).length + ' 类 Agent 已启动';
  for (const client of ['claude', 'codex']) {
    const card = cards.get(client);
    const snap = summary.snapshots.find(s => s.client === client);
    const presentation = data.agents.find(s => s.client === client)?.status;
    const state = data.paused ? 'paused' : presentation?.state || 'idle';
    card.badge.textContent = data.paused ? '已暂停' : initial ? '连接中' : presentation?.label || '未运行';
    card.badge.dataset.state = state;
    const session = snap?.claude || snap?.codex;
    let detail = session?.title || session?.name || session?.cwd;
    if (!detail) detail = initial ? '等待首次扫描' : state === 'idle' ? '启动后自动连接' : state === 'paused' ? '恢复后重新读取状态' : presentation?.description || '暂无会话信息';
    if (client === 'codex' && data.sessions?.length) detail = data.sessions.length + ' 个会话 · ' + data.sessions.filter(s => ['busy','deleting'].includes(s.status.state)).length + ' 个工作中 · ' + data.sessions.filter(s => ['approval','input'].includes(s.status.state)).length + ' 个待处理';
    card.detail.textContent = detail; card.detail.title = session?.cwd ? detail + '\n' + session.cwd : detail;

  }
  renderSessions();
  const key = JSON.stringify(data.events);
  if (key !== eventsKey) {
    eventsKey = key;
    $('event-count').textContent = data.events.length;
    $('events').replaceChildren();
    if (!data.events.length) {
      const empty = element('div', 'empty');
      empty.append(element('strong', '', '还没有状态变化'), element('span', '', 'Agent 开始工作、等待操作或完成任务时，记录会出现在这里。'));
      $('events').append(empty);
    }
    for (const event of data.events) {
      const row = element('div', 'timeline-row');
      const body = element('div');
      const badge = element('span', 'badge', event.label); badge.dataset.state = event.state;
      const eventTitle = names[event.client] + (event.sessionTitle ? ' · ' + event.sessionTitle : event.sessionId ? ' · ' + event.sessionId.slice(0, 8) : '');
      const title = element('div', 'timeline-title', eventTitle); title.title = eventTitle;
      body.append(title, badge);
      row.append(element('span', 'timeline-marker'), body, element('time', 'timeline-time', time(event.at)));
      $('events').append(row);
    }
    const last = data.events[0];
    $('last-event').lastElementChild.textContent = last ? time(last.at) + ' · ' + names[last.client] + (last.sessionTitle ? ' · ' + last.sessionTitle : '') + ' ' + last.label : '状态发生变化时，活动记录会自动更新。';
  }
  const settingsKey = JSON.stringify(settings);
  if (settingsKey !== savedSettingsKey && !settingsDirty) {
    for (const [key, value] of Object.entries(settings)) {
      const input = form.elements.namedItem(key);
      if (input.type === 'checkbox') input.checked = value; else input.value = value;
    }
    savedSettingsKey = settingsKey;
  }
  const credits = summary.snapshots.find(s => s.client === 'claude')?.credits;
  $('credit-section').hidden = !settings.creditEnabled;
  $('credits').replaceChildren();
  $('credit-note').textContent = credits?.available ? '定期更新' : '';
  if (credits?.available) {
    for (const [label, value, reset] of [['5 小时', credits.fiveHourRemainingPercent, credits.fiveHourResetAt], ['每周', credits.weeklyRemainingPercent, credits.weeklyResetAt]]) {
      if (typeof value !== 'number') continue;
      const row = element('div', 'credit-row');
      const progress = element('progress'); progress.max = 100; progress.value = value; progress.setAttribute('aria-label', label + '剩余额度');
      if (reset) row.title = '重置时间：' + new Date(reset).toLocaleString('zh-CN');
      row.append(element('span', '', label), progress, element('span', '', Math.round(value) + '%')); $('credits').append(row);
    }
  } else {
    const missing = credits?.error === 'no credentials';
    $('credits').append(element('div', 'agent-detail', missing ? '登录 Claude 后显示额度；不影响状态监控。' : credits ? '额度暂不可用；不影响状态监控。' : '正在查询额度…'));
  }
  $('footnote').textContent = data.paused ? '已释放防睡眠' : settings.keepAwakeEnabled ? '工作时防睡眠 · 等待时自动释放' : '仅监控本机 Agent';
}
function renderSessions() {
  const sessions = latest?.sessions || [];
  $('codex-sessions').hidden = sessions.length === 0;
  $('session-total').textContent = sessions.length;
  const filter = $('session-filter').value;
  const query = $('session-search').value.trim().toLocaleLowerCase();
  const order = ['approval', 'input', 'deleting', 'busy', 'unknown', 'done', 'running', 'idle'];
  const visible = sessions.filter(s => (filter === 'all' || (filter === 'attention' ? ['approval','input'].includes(s.status.state) : s.status.state !== 'idle')) &&
    (!query || (s.title + ' ' + s.cwd + ' ' + s.id).toLocaleLowerCase().includes(query)))
    .sort((a,b) => order.indexOf(a.status.state) - order.indexOf(b.status.state) || b.activityAt - a.activityAt || a.id.localeCompare(b.id));
  const key = JSON.stringify([visible, latest?.paused, filter, query]);
  if (key === sessionsKey) return;
  sessionsKey = key;
  const list = $('session-list');
  const scroll = list.scrollTop;
  list.replaceChildren();
  for (const session of visible) {
    const row = element('article', 'session-row'); row.dataset.threadId = session.id;
    const heading = element('div', 'session-top');
    const title = element('strong', 'session-title', session.title); title.title = session.title;
    const badge = element('span', 'badge', latest.paused ? '已暂停' : session.status.label);
    badge.dataset.state = latest.paused ? 'paused' : session.status.state;
    heading.append(title, badge);
    const project = element('div', 'session-project', session.cwd || '未提供项目路径'); project.title = session.cwd;
    const metadata = element('div', 'session-meta', session.source + ' · ' + session.id.slice(0, 8) + ' · ' + (session.activityAt ? new Date(session.activityAt).toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '无活动时间'));
    row.append(heading, project, metadata); list.append(row);
  }
  if (!visible.length) list.append(element('div', 'session-empty', filter === 'active' && !query ? '暂无活跃会话。切换“全部会话”可查看历史记录。' : '没有匹配的会话。'));
  list.scrollTop = scroll;
  $('session-count').textContent = '显示 ' + visible.length + ' / ' + sessions.length + ' 个未归档会话';
}
$('session-search').addEventListener('input', renderSessions);
$('session-filter').addEventListener('change', renderSessions);
async function action(name) {
  try { await api?.action(name); }
  catch (error) { $('error').hidden = false; $('error').textContent = '操作失败：' + error.message; }
}
$('overview-tab').onclick = () => setView('overview');
$('activity-tab').onclick = () => setView('activity');
$('settings-open').onclick = () => setView('settings');
$('settings-back').onclick = () => setView('overview');
$('pause').onclick = () => action('toggle-monitoring');
$('refresh').onclick = () => action('refresh');
$('quit').onclick = () => action('quit');
$('close').onclick = () => action('hide');
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') action('hide');
  if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && event.target.getAttribute('role') === 'tab') {
    const view = currentView === 'overview' ? 'activity' : 'overview'; setView(view); $(view + '-tab').focus();
  }
});
form.addEventListener('input', () => { settingsDirty = true; $('save-message').textContent = '有未保存的更改'; });
form.onsubmit = async event => {
  event.preventDefault();
  if (!api) return;
  const settings = {};
  for (const key of Object.keys(latest.settings)) {
    const input = form.elements.namedItem(key);
    settings[key] = input.type === 'checkbox' ? input.checked : Number(input.value);
  }
  $('save-settings').disabled = true;
  try {
    const data = await api.saveSettings(settings); settingsDirty = false;
    render(data); $('save-message').classList.remove('failed'); $('save-message').textContent = '已保存，立即生效';
  } catch (error) {
    $('save-message').classList.add('failed'); $('save-message').textContent = '保存失败：' + error.message;
  } finally { $('save-settings').disabled = false; }
};
if (api) {
  api.onState(render); api.onView(setView);
  api.getState().then(render).catch(error => { $('error').hidden = false; $('error').textContent = '无法连接监控服务：' + error.message; });
} else {
  $('status-label').textContent = '请在应用内打开';
  $('status-description').textContent = '从项目目录运行 npm start，或打开 AgentStatusBar 应用。';
  $('connection').textContent = '未连接';
  for (const id of ['pause', 'refresh', 'quit', 'save-settings']) $(id).disabled = true;
}
