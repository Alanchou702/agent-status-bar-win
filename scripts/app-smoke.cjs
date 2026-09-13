const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const root = path.join(__dirname, '..');
const output = path.join(root, 'artifacts');
const isolated = path.join(output, 'app-smoke-config');
process.env.AGENT_BAR_CONFIG_DIR = isolated;
fs.mkdirSync(isolated, { recursive: true });
app.setPath('userData', path.join(isolated, 'profile'));
app.getAppPath = () => root;
const second = process.argv.includes('--second');
if (!second) fs.writeFileSync(path.join(isolated, 'config.json'), JSON.stringify({ openAtLogin: false, light: { enabled: false }, credit: { enabled: false }, notificationsEnabled: false, keepAwakeEnabled: false }));
require('../out/main/main.js');
if (!second) app.whenReady().then(async () => {
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  try {
    let win;
    for (let i = 0; i < 100; i++) {
      win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('panel.html'));
      if (win && !win.webContents.isLoading()) break;
      await delay(100);
    }
    assert.ok(win, 'main creates panel');
    win.showInactive();
    const run = code => win.webContents.executeJavaScript(code);
    let state;
    for (let i = 0; i < 150; i++) {
      state = await run('window.agentBar.getState()');
      if (state.summary.scannedAt) break;
      await delay(100);
    }
    assert.ok(state.summary.scannedAt, 'main scan completes');
    assert.equal(state.error, null);
    await run("window.agentBar.action('toggle-monitoring')");
    state = await run('window.agentBar.getState()'); assert.equal(state.paused, true);
    const next = { ...state.settings, scanIntervalSec: 5, lightEnabled: true };
    await run('window.agentBar.saveSettings(' + JSON.stringify(next) + ')');
    const saved = JSON.parse(fs.readFileSync(path.join(isolated, 'config.json'), 'utf8'));
    assert.equal(saved.scanIntervalSec, 5); assert.equal(saved.light.enabled, true);
    assert.equal(BrowserWindow.getAllWindows().length, 2);
    const invalid = { ...next, scanIntervalSec: 0 };
    assert.equal(await run('window.agentBar.saveSettings(' + JSON.stringify(invalid) + ').then(() => false, () => true)'), true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(isolated, 'config.json'), 'utf8')).scanIntervalSec, 5);
    const child = spawn(process.execPath, [__filename, '--second'], { windowsHide: true, stdio: 'ignore', env: process.env });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    assert.equal(code, 0); assert.equal(win.isDestroyed(), false, 'second launch must not quit the existing app');
    await run("window.agentBar.action('toggle-monitoring')");
    state = await run('window.agentBar.getState()'); assert.equal(state.paused, false);
    fs.writeFileSync(path.join(output, 'app-smoke.json'), JSON.stringify({ passed: true, checks: ['production boot', 'production background scan', 'pause and resume', 'settings persisted', 'invalid settings rejected', 'light toggled', 'second launch preserves first instance'] }, null, 2));
    console.log('Production app smoke: 7 checks passed');
    app.quit();
  } catch (error) { console.error(error); fs.writeFileSync(path.join(output, 'app-smoke-error.txt'), String(error.stack)); app.exit(1); }
});
setTimeout(() => { console.error('Production smoke deadline exceeded'); app.exit(1); }, 55000).unref();
