const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createPanelWindow, updatePanel, destroyPanel } = require('../out/main/panel.js');
const { createLightWindow, updateLight, destroyLight } = require('../out/main/desktopLight.js');
const { STATUS, aggregateStatus, stateOf } = require('../out/shared/status.js');
const { statusFor } = require('../out/main/statusLight.js');
const { scanInWorker } = require('../out/main/scanner/scanService.js');
const { normalizeConfig } = require('../out/main/config.js');
const output = path.join(__dirname, '..', 'artifacts');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'electron-test-profile'));
const now = Date.now();
const settings = { scanIntervalSec: 3, keepAwakeEnabled: true, notificationsEnabled: true, soundEnabled: true, openAtLogin: false, lightEnabled: true, creditEnabled: true };
let state;
function makeState(kind = 'busy') {
  const summary = { scannedAt: now, snapshots: [
    { client: 'claude', state: 'busy', detail: 'working', scannedAt: now, claude: { title: '重构状态面板', cwd: 'F:\\agent-status-bar-win-main' }, credits: { available: true, fiveHourRemainingPercent: 73, weeklyRemainingPercent: 86 } },
    { client: 'codex', state: kind === 'approval' ? 'busy' : 'running', detail: kind === 'approval' ? 'waiting for approval' : 'idle', scannedAt: now, codex: { title: '检查回归测试', cwd: 'F:\\agent-status-bar-win-main' } },
  ] };
  return { summary, status: aggregateStatus(summary), agents: summary.snapshots.map(s => ({ client: s.client, status: STATUS[stateOf(s)] })),
    events: [{ id: 2, client: 'claude', state: 'busy', label: '工作中', at: now }, { id: 1, client: 'codex', state: 'done', label: '任务完成', at: now - 70000 }],
    sessions: [
      { id: 'codex-a', title: '检查回归测试', cwd: 'F:/agent-status-bar-win-main', source: '主会话', status: STATUS[kind === 'approval' ? 'approval' : 'running'], activityAt: now },
      { id: 'codex-b', title: '构建 Windows 版本', cwd: 'F:/build', source: '子会话', status: STATUS.busy, activityAt: now-1000 },
      { id: 'codex-history', title: '历史会话', cwd: 'F:/archive', source: '主会话', status: STATUS.idle, activityAt: now-86400000 },
    ], settings, paused: false, scanning: false, simulated: true, error: null };
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  try {
    state = makeState();
    const win = createPanelWindow(path.join(__dirname, '..', 'resources'), {
      state: () => state,
      action: action => {
        if (action === 'toggle-monitoring') {
          state.paused = !state.paused; state.status = aggregateStatus(state.summary, state.paused); updatePanel(state);
        }
      },
      settings: value => { state.settings = value; updatePanel(state); },
    });
    const errors = [];
    win.webContents.on('console-message', (_e, details) => { if (details.level === 'error') errors.push(details.message); });
    await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
    win.showInactive();
    const run = code => win.webContents.executeJavaScript(code);
    async function capture(name) {
      await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      fs.writeFileSync(path.join(output, name), (await win.webContents.capturePage()).toPNG());
    }
    async function waitFor(code) {
      for (let i = 0; i < 50; i++) { if (await run(code)) return; await delay(50); }
      throw new Error('UI assertion timed out: ' + code);
    }
    await waitFor("document.getElementById('status-label').textContent === '工作中'");
    assert.equal(await run("typeof require"), 'undefined');
    assert.equal(await run("document.querySelectorAll('.agent-card').length"), 2);
    assert.equal(await run("document.querySelectorAll('.timeline-row').length"), 2);
    assert.equal(await run("document.querySelectorAll('.session-row').length"), 2);
    await run("document.getElementById('session-filter').value='all'; document.getElementById('session-filter').dispatchEvent(new Event('change'))");
    assert.equal(await run("document.querySelectorAll('.session-row').length"), 3);
    await run("document.getElementById('session-search').value='构建'; document.getElementById('session-search').dispatchEvent(new Event('input'))");
    assert.equal(await run("document.querySelector('.session-row').dataset.threadId"), 'codex-b');
    await run("document.getElementById('session-search').value=''; document.getElementById('session-search').dispatchEvent(new Event('input')); document.getElementById('session-filter').value='active'; document.getElementById('session-filter').dispatchEvent(new Event('change'))");
    await capture('overview.png');
    await run("document.getElementById('pause').click()");
    await waitFor("document.getElementById('status-label').textContent === '监控已暂停'");
    assert.equal(await run("document.getElementById('refresh').disabled"), true);
    await run("document.getElementById('pause').click()");
    await waitFor("document.getElementById('status-label').textContent === '工作中'");
    await run("document.getElementById('settings-open').click()");
    await waitFor("!document.getElementById('settings').hidden");
    await run("document.querySelector('[name=scanIntervalSec]').value = 7; document.querySelector('[name=scanIntervalSec]').dispatchEvent(new Event('input', {bubbles:true})); document.getElementById('settings-form').requestSubmit()");
    await waitFor("document.getElementById('save-message').textContent.includes('已保存')");
    assert.equal(state.settings.scanIntervalSec, 7);
    await capture('settings.png');
    await run("document.getElementById('activity-tab').click()");
    await capture('activity.png');
    state = makeState('approval'); updatePanel(state);
    await run("document.getElementById('overview-tab').click()");
    await waitFor("document.getElementById('status-label').textContent === '等待审批'");
    await capture('approval.png');
    // Session titles must remain text, including HTML-shaped input.
    state.summary.snapshots[0].claude.title = '<img src=x onerror=alert(1)>'; updatePanel(state);
    await waitFor("document.querySelector('.agent-detail').textContent.includes('<img')");
    assert.equal(await run("document.querySelectorAll('.agent-detail img').length"), 0);
    state.summary.snapshots[0].claude.title = '重构状态面板'; updatePanel(state);
    win.setSize(340, 520);
    assert.equal(await run("document.documentElement.scrollWidth > window.innerWidth"), false);
    await capture('compact.png');
    const light = createLightWindow(path.join(__dirname, '..', 'resources', 'light.html'), 24, 24, () => {});
    updateLight(statusFor(state.summary));
    await new Promise(resolve => light.webContents.once('did-finish-load', resolve));
    await delay(200);
    assert.equal(await light.webContents.executeJavaScript("document.querySelectorAll('.floating-agent').length"), 2);
    fs.writeFileSync(path.join(output, 'light.png'), (await light.webContents.capturePage()).toPNG());
    const lightRun = code => light.webContents.executeJavaScript(code);
    async function lightWait(code) {
      for(let i=0;i<50;i++){if(await lightRun(code))return; await delay(40);}
      throw new Error('Float assertion timed out: '+code);
    }
    const compactBounds = light.getBounds();
    assert.ok(Math.abs(compactBounds.width-360)<=2);
    assert.ok(Math.abs(compactBounds.height-52)<=2);
    await lightRun("document.documentElement.dispatchEvent(new PointerEvent('pointerenter'))");
    await delay(500);
    assert.ok(Math.abs(light.getBounds().width - compactBounds.width) <= 2,'hover must not expand the fixed float');
    assert.equal(await lightRun("document.querySelector('.panel').inert"),true);
    assert.equal(await lightRun("document.querySelector('#floating-claude .floating-state').textContent"),'工作中');
    assert.equal(await lightRun("document.querySelector('#floating-codex .floating-state').textContent"),'等待审批');
    fs.writeFileSync(path.join(output, 'fixed-floating.png'), (await light.webContents.capturePage()).toPNG());
    // Real Windows process enumeration and worker/SQLite runtime, without quota requests.
    const scan = await scanInWorker(normalizeConfig({ credit: { enabled: false } }));
    assert.ok(scan.summary.snapshots.some(s=>s.client==='claude'));
    assert.ok(scan.summary.snapshots.some(s=>s.client==='codex'));
    const packed = path.join(__dirname, '..', 'release', 'win-unpacked', 'resources', 'app.asar');
    if (fs.existsSync(packed)) {
      const packedScan = require(path.join(packed, 'out', 'main', 'scanner', 'scanService.js')).scanInWorker;
      const packedResult = await packedScan(normalizeConfig({ credit: { enabled: false } }));
      assert.ok(packedResult.summary.snapshots.some(s=>s.client==='codex'));
      console.log('Packaged ASAR worker scan passed');
    }

    const result = { passed: true, checks: ['isolated preload', 'initial IPC state', 'two agents', 'real event rendering', 'pause/resume', 'settings save', 'approval priority', 'HTML escaping', 'compact layout', 'desktop light', 'Windows background scan', 'multi-session filtering', 'session search', 'fixed floating status'], scan: {sessionCount:scan.summary.snapshots.filter(s=>s.codex).length, states:scan.summary.snapshots.reduce((counts,s)=>(counts[s.state]=(counts[s.state]||0)+1,counts),{})}, consoleErrors: errors };
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'ui-smoke.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    destroyLight(); destroyPanel(); app.exit(0);
  } catch (error) { console.error(error); fs.writeFileSync(path.join(output, 'ui-error.txt'), String(error.stack)); app.exit(1); }
});
setTimeout(() => { console.error('UI test deadline exceeded'); app.exit(1); }, 60000).unref();
