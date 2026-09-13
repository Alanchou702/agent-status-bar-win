const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { aggregateStatus, stateOf } = require('../out/shared/status.js');
const { statusFor } = require('../out/main/statusLight.js');
const { deriveCodexState, queryCodexThread, queryCodexActivity } = require('../out/main/scanner/codexScanner.js');
const { analyzeClaudeTranscript, deriveClaudeState } = require('../out/main/scanner/claudeScanner.js');
const { parseCreditResponse } = require('../out/main/scanner/creditScanner.js');
const { parsePsOutput, isClaudeProcess, isCodexProcess } = require('../out/main/scanner/processEnumerator.js');
const { normalizeConfig, loadConfig, saveConfig } = require('../out/main/config.js');
const { Monitor } = require('../out/main/monitor.js');
const now = Date.now();
const snap = (state, extra = {}) => ({ client: 'codex', state, scannedAt: now, ...extra });
const summary = (...snapshots) => ({ snapshots, scannedAt: now });
const activity = extra => ({ latest: now, taskStart: 0, taskClose: 0, escalatedExec: 0, approvalRequest: 0, execTool: 0, userInputRequest: 0, userInputResult: 0, interrupt: 0, anyTurnActivity: 0, anyToolCall: 0, anyToolResult: 0, turnFollowUp: 0, turnComplete: 0, ...extra });
const derive = (extra, present = true) => deriveCodexState(activity(extra), present, now, 30000, 5000);
function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-bar-test-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }

test('approval takes priority over busy, and all visuals agree', () => {
  const s = summary(snap('busy'), snap('busy', { detail: 'waiting for approval' }));
  assert.equal(aggregateStatus(s).state, 'approval');
  assert.equal(statusFor(s).state, 'approval');
  assert.deepEqual(statusFor(s).frames, ['tray-red.ico']);
});
test('input gets its own attention state and paused overrides it', () => {
  const s = summary(snap('busy', { detail: 'waiting for your input' }));
  assert.equal(aggregateStatus(s).state, 'input');
  assert.equal(statusFor(s, true).state, 'paused');
});
test('idle differs from running and stale delete flags do not show deleting', () => {
  assert.notDeepEqual(statusFor(summary(snap('idle'))).frames, statusFor(summary(snap('running'))).frames);
  assert.equal(stateOf(snap('running', { deleting: true })), 'running');
});
test('Codex without a process or database is idle; a live unreadable process is unknown', () => {
  assert.equal(deriveCodexState(null, false, now, 30000, 5000).state, 'idle');
  assert.equal(deriveCodexState(null, true, now, 30000, 5000).state, 'unknown');
});
test('approval stops after the tool returns', () => {
  assert.equal(derive({ approvalRequest: now - 1000, taskStart: now - 2000 }).detail, 'waiting for approval');
  assert.equal(derive({ approvalRequest: now - 1000, execTool: now - 500, taskStart: now - 2000 }).detail, 'working');
});
test('user input result and interruption clear attention', () => {
  assert.equal(derive({ userInputRequest: now - 1000 }).detail, 'waiting for your input');
  assert.notEqual(derive({ userInputRequest: now - 1000, userInputResult: now - 500 }).detail, 'waiting for your input');
  assert.notEqual(derive({ taskStart: now - 2000, interrupt: now - 500 }).state, 'busy');
});
test('new tool call supersedes old completion, absent processes do not remain active', () => {
  assert.equal(derive({ turnComplete: now - 2000, anyToolCall: now - 500 }).state, 'busy');
  assert.equal(derive({ anyToolCall: now - 500 }, false).state, 'idle');
});
test('completion is transient, only the latest turn can complete', () => {
  assert.equal(derive({ turnComplete: now - 1000 }).done, true);
  assert.notEqual(derive({ turnComplete: now - 8000 }).done, true);
  assert.notEqual(derive({ turnComplete: now - 1000, taskStart: now - 500 }).done, true);
});
function transcript(t, records, status = 'busy') {
  const dir = temp(t); fs.mkdirSync(path.join(dir, 'project'));
  fs.writeFileSync(path.join(dir, 'project', 'session.jsonl'), records.map(r => typeof r === 'string' ? r : JSON.stringify(r)).join('\n'));
  return { dir, session: { pid: 42, sessionId: 'session', cwd: 'project', startedAt: now - 5000, updatedAt: now, status } };
}
const tool = (name, id = 'tool-1') => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name, id }] } });
test('Claude reads message.content objects without treating every tool as approval', t => {
  const { dir, session } = transcript(t, [tool('Delete')]);
  const info = analyzeClaudeTranscript(dir, session, 5000, now);
  assert.equal(info.lastToolName, 'Delete'); assert.equal(info.waitingApproval, false);
});
test('Claude tool results clear pending Delete flags even with a partial JSON tail', t => {
  const { dir, session } = transcript(t, [tool('Delete'), { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1' }] } }, '{partial']);
  assert.equal(analyzeClaudeTranscript(dir, session, 5000, now).lastToolName, null);
});
test('Claude completion event supersedes earlier tool call', t => {
  const { dir, session } = transcript(t, [tool('Delete'), { type: 'system', subtype: 'turn_duration', timestamp: new Date(now - 1000).toISOString() }]);
  const result = deriveClaudeState([session], new Set([42]), now, 30000, dir, 5000);
  assert.equal(result.done, true); assert.equal(result.state, 'running'); assert.equal(result.deleting, false);
});
test('Claude aggregates live sessions instead of hiding a busy older session', t => {
  const { dir, session } = transcript(t, [tool('Read')]);
  const idle = { ...session, pid: 43, sessionId: 'idle', status: 'idle', updatedAt: now + 100 };
  const result = deriveClaudeState([idle, session], new Set([42, 43]), now, 30000, dir, 5000);
  assert.equal(result.state, 'busy'); assert.equal(result.session.pid, 42);
});
test('Claude AskUserQuestion is displayed as waiting for input', t => {
  const { dir, session } = transcript(t, [tool('AskUserQuestion')]);
  assert.equal(deriveClaudeState([session], new Set([42]), now, 30000, dir, 5000).detail, 'waiting for your input');
});
test('OAuth nested usage is converted to remaining percentages, malformed values stay unavailable', () => {
  const result = parseCreditResponse({ five_hour: { utilization: 27, resets_at: '2026-09-12T12:00:00Z' }, seven_day: { utilization: 104 } });
  assert.equal(result.fiveHourRemainingPercent, 73); assert.equal(result.weeklyRemainingPercent, 0);
  assert.equal(result.fiveHourResetAt, Date.parse('2026-09-12T12:00:00Z'));
  assert.equal(parseCreditResponse({ five_hour: { utilization: '27' } }).available, false);
});
test('config validation repairs corrupt nested settings and bounds poll intervals', () => {
  const config = normalizeConfig({ scanIntervalSec: -1, light: null, credit: null, paths: null, openAtLogin: 'yes' });
  assert.equal(config.scanIntervalSec, 3); assert.equal(config.light.enabled, true);
  assert.equal(normalizeConfig({ scanIntervalSec: 100 }).scanIntervalSec, 60);
});
test('config persists atomically and preserves credential path overrides', t => {
  const dir = temp(t); const previous = process.env.AGENT_BAR_CONFIG_DIR;
  process.env.AGENT_BAR_CONFIG_DIR = dir;
  t.after(() => { if (previous === undefined) delete process.env.AGENT_BAR_CONFIG_DIR; else process.env.AGENT_BAR_CONFIG_DIR = previous; });
  const config = normalizeConfig({ credit: { credentialsPath: 'custom.json' } }); saveConfig(config);
  assert.equal(loadConfig().credit.credentialsPath, 'custom.json');
  assert.deepEqual(fs.readdirSync(dir), ['config.json']);
});
test('process parse errors are visible, empty and single-row output are supported', () => {
  assert.throws(() => parsePsOutput('not json'));
  assert.deepEqual(parsePsOutput(''), []);
  assert.equal(parsePsOutput('{"ProcessId":1,"Name":"codex.exe"}').length, 1);
  assert.equal(isClaudeProcess({ pid: 1, name: 'node.exe', cmd: 'node C:\\npm\\@anthropic-ai\\claude-code\\cli.js' }), true);
  assert.equal(isCodexProcess({ pid: 1, name: 'codex.exe', cmd: '' }), true);
});
test('Codex metadata comes from the same thread as activity', t => {
  const file = path.join(temp(t), 'state.sqlite'); const db = new DatabaseSync(file);
  db.exec("CREATE TABLE threads(id TEXT, title TEXT, cwd TEXT, updated_at INTEGER); INSERT INTO threads VALUES('active','Active','A',1),('other','Other','B',2)"); db.close();
  assert.equal(queryCodexThread(file, 'active').title, 'Active');
  assert.equal(queryCodexThread(file, 'missing'), null);
});
test('Codex SQL reads only selected thread and respects lookup window', t => {
  const file = path.join(temp(t), 'logs.sqlite'); const db = new DatabaseSync(file);
  db.exec('CREATE TABLE logs(id INTEGER PRIMARY KEY, thread_id TEXT, ts INTEGER, ts_nanos INTEGER, target TEXT, feedback_log_body TEXT)');
  const insert = db.prepare('INSERT INTO logs(thread_id,ts,ts_nanos,target,feedback_log_body) VALUES(?,?,?,?,?)');
  insert.run('active', Math.floor(now / 1000), 0, 'codex_core::stream_events_utils', ':handle_output_item_done: ToolCall: exec_command {}');
  insert.run('old', Math.floor(now / 1000) - 100000, 0, 'other', ''); db.close();
  const result = queryCodexActivity(file, 7200);
  assert.equal(result.threadId, 'active'); assert.ok(result.activity.anyToolCall > 0);
});
function fixture(t, scan, credits = async () => ({ available: false })) {
  const published = [], powers = [], notifications = [];
  const config = normalizeConfig({ credit: { enabled: true } });
  const monitor = new Monitor(config, { scan, credits, publish: x => published.push(x), keepAwake: x => powers.push(x), transition: x => notifications.push(x) });
  t.after(() => monitor.stop()); return { monitor, published, powers, notifications, config };
}
function result(s) { return { summary: s, anyBusy: s.snapshots.some(s => s.state === 'busy'), anyRunning: true }; }
test('monitor publishes state without waiting for a slow quota request', async t => {
  let release; const credit = new Promise(resolve => { release = resolve; });
  const { monitor } = fixture(t, async () => result(summary(snap('busy'))), () => credit);
  await monitor.refresh(); assert.equal(monitor.getState().status.state, 'busy');
  release({ available: false });
});
test('monitor does not fabricate activity or completion notifications on startup and repeated polls', async t => {
  let s = summary(snap('idle'));
  const { monitor, notifications } = fixture(t, async () => result(s));
  await monitor.refresh(); assert.equal(monitor.getState().events.length, 0); assert.equal(notifications.length, 0);
  s = summary(snap('busy')); await monitor.refresh(); await monitor.refresh();
  assert.equal(monitor.getState().events.length, 1);
  s = summary(snap('running', { done: true })); await monitor.refresh();
  assert.equal(notifications.length, 1); assert.equal(notifications[0].state, 'done');
});
test('pause discards in-flight scans and releases the power blocker', async t => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const { monitor, powers } = fixture(t, () => pending);
  const scan = monitor.refresh(); monitor.togglePaused();
  release(result(summary(snap('busy')))); await scan;
  assert.equal(monitor.getState().paused, true); assert.equal(monitor.getState().summary.scannedAt, 0);
  assert.equal(powers.at(-1), false);
});
test('scan failure clears stale busy state and concurrent refresh is coalesced', async t => {
  let calls = 0;
  const { monitor, powers } = fixture(t, async () => { calls++; throw new Error('test scan failure'); });
  await Promise.all([monitor.refresh(), monitor.refresh()]);
  assert.equal(calls, 1); assert.equal(monitor.getState().status.state, 'unknown'); assert.equal(powers.at(-1), false);
});
test('simulation does not create real activity or notifications', async t => {
  const { monitor, notifications } = fixture(t, async () => result(summary(snap('idle'))));
  await monitor.refresh(); monitor.simulate('approval');
  assert.equal(monitor.getState().simulated, true); assert.equal(monitor.getState().status.state, 'approval');
  assert.equal(monitor.getState().events.length, 0); assert.equal(notifications.length, 0);
});
test('Codex approval acknowledgements clear the pending request, waiting does not time out after 30 seconds', () => {
  assert.equal(derive({ latest: now - 60000, escalatedExec: now - 60000 }).detail, 'waiting for approval');
  assert.notEqual(derive({ escalatedExec: now - 1000, approvalResponse: now - 500 }).detail, 'waiting for approval');
  assert.equal(derive({ latest: now - 60000, userInputRequest: now - 60000 }).detail, 'waiting for your input');
});
test('Claude old completed turns stay idle even if the session file still says busy', t => {
  const { dir, session } = transcript(t, [{ type: 'system', subtype: 'turn_duration', timestamp: new Date(now - 20000).toISOString() }]);
  const result = deriveClaudeState([session], new Set([42]), now, 30000, dir, 5000);
  assert.equal(result.state, 'running'); assert.equal(result.done, false);
});
test('portable login startup uses the persistent launcher instead of the temporary extracted EXE', () => {
  const { loginTarget } = require('../out/main/startup.js');
  assert.deepEqual(loginTarget(true, 'TEMP/app.exe', 'TEMP', 'F:/AgentStatusBar.exe'), { path: 'F:/AgentStatusBar.exe', args: [] });
  assert.deepEqual(loginTarget(false, 'electron.exe', 'F:/project'), { path: 'electron.exe', args: ['F:/project'] });
});
const { queryCodexActivities, queryCodexThreads } = require('../out/main/scanner/codexScanner.js');
const { codexSessionSnapshots } = require('../out/main/scanner/codexSessions.js');
const { parseCodexRollout } = require('../out/main/scanner/codexRollout.js');
const { notificationKey } = require('../out/main/notifications.js');
const { expandedBounds } = require('../out/main/floatingGeometry.js');
const multiConfig = { codexTurnActivityFreshnessMs: 30000, taskCompleteFreshnessMs: 5000 };
const thread = (id, extra = {}) => ({ threadId: id, title: id, cwd: 'project-' + id, updatedAt: now, ...extra });
const codexSnap = (id, state, extra = {}) => snap(state, { codex: thread(id), ...extra });
const eventRecord = (type, at = now - 1000) => ({ timestamp: new Date(at).toISOString(), type: 'event_msg', payload: { type } });
const callRecord = (name, id, at, args = {}) => ({ timestamp: new Date(at).toISOString(), type: 'response_item', payload: { type: 'function_call', name, call_id: id, arguments: JSON.stringify(args) } });
const outputRecord = (id, at, output = '{}') => ({ timestamp: new Date(at).toISOString(), type: 'response_item', payload: { type: 'function_call_output', call_id: id, output } });
const rollout = records => parseCodexRollout(records.map(r => JSON.stringify(r)).join('\n'));

test('batch query returns all concurrent threads, including quieter approval requests', t => {
  const file = path.join(temp(t), 'logs.sqlite'); const db = new DatabaseSync(file);
  db.exec('CREATE TABLE logs(id INTEGER PRIMARY KEY, thread_id TEXT, ts INTEGER, ts_nanos INTEGER, target TEXT, feedback_log_body TEXT)');
  const insert = db.prepare('INSERT INTO logs(thread_id,ts,ts_nanos,target,feedback_log_body) VALUES(?,?,?,?,?)');
  insert.run('approval', Math.floor(now/1000)-50, 0, 'codex_core::session', 'waiting for approval');
  insert.run('busy', Math.floor(now/1000), 0, 'codex_core::stream_events_utils', ':handle_output_item_done: ToolCall: exec_command {}');
  insert.run('closed', Math.floor(now/1000)-2, 0, 'codex_core::session::turn', ':run_turn: post sampling token usage needs_follow_up=false');
  db.close();
  const rows = queryCodexActivities(file, 7200, now);
  assert.equal(rows.length, 3); assert.ok(rows.find(r=>r.threadId==='approval').activity.approvalRequest);
  const snapshots = codexSessionSnapshots([], rows, true, now, multiConfig, () => null);
  assert.equal(aggregateStatus(summary(...snapshots)).state, 'approval');
  assert.equal(snapshots.find(s=>s.codex.threadId==='closed').done, true);
});
test('metadata includes older threads and excludes archived sessions from monitoring', t => {
  const file = path.join(temp(t),'state.sqlite'); const db = new DatabaseSync(file);
  db.exec("CREATE TABLE threads(id TEXT,title TEXT,cwd TEXT,updated_at INTEGER,archived INTEGER,rollout_path TEXT); INSERT INTO threads VALUES('old','Old','A',1,0,''),('archived','Archived','B',2,1,'')"); db.close();
  const rows = queryCodexThreads(file); assert.equal(rows.length, 2);
  const snapshots = codexSessionSnapshots(rows, [{threadId:'archived',activity:activity({approvalRequest:now})}], true, now, multiConfig, () => null);
  assert.equal(snapshots.length, 1); assert.equal(snapshots[0].codex.threadId,'old'); assert.equal(snapshots[0].state,'idle');
});
test('long silent turns and waits are discovered beyond the SQL window', () => {
  const started = now - 3*3600000;
  const longTurn = rollout([eventRecord('task_started', started)]);
  const snapshots = codexSessionSnapshots([thread('long', {rolloutPath:'long'})], [], true, now, multiConfig, () => longTurn, started-1000);
  assert.equal(snapshots[0].state,'busy');
  const waiting = rollout([eventRecord('task_started',started),callRecord('request_user_input','question',started+100)]);
  const waits = codexSessionSnapshots([thread('wait')], [], true, now, multiConfig, () => waiting, started-1000);
  assert.equal(waits[0].detail,'waiting for your input');
});
test('old unfinished records do not become busy under a newly started Codex process', () => {
  const old = rollout([eventRecord('task_started', now - 86400000)]);
  const snapshots = codexSessionSnapshots([thread('old')], [], true, now, multiConfig, () => old, now-60000);
  assert.equal(snapshots[0].state,'idle');
});
test('another tool output cannot dismiss a pending question', () => {
  const parsed = rollout([eventRecord('task_started'),callRecord('request_user_input','q',now-900),callRecord('exec_command','exec',now-800),outputRecord('exec',now-700)]);
  assert.equal(codexSessionSnapshots([thread('a')], [], true, now, multiConfig, () => parsed)[0].detail,'waiting for your input');
});
test('async question acknowledgement preserves waiting until a user answer', () => {
  const records = [eventRecord('task_started'),callRecord('request_user_input_async','q',now-900),outputRecord('q',now-800,'{"accepted":true}')];
  assert.ok(rollout(records).activity.userInputRequest);
  assert.equal(rollout([...records,eventRecord('user_message',now-700)]).activity.userInputRequest,0);
});
test('a matching result clears the question and task completion clears outstanding calls', () => {
  const records = [eventRecord('task_started'),callRecord('request_user_input','q',now-900)];
  assert.equal(rollout([...records,outputRecord('q',now-800)]).activity.userInputRequest,0);
  const completed = rollout([...records,eventRecord('task_complete',now-700)]);
  assert.equal(completed.openTurn,false); assert.equal(completed.pendingTool,false);
  assert.equal(codexSessionSnapshots([thread('a')], [], true, now, multiConfig, () => completed)[0].done,true);
});
test('interruption closes only its own session; another session keeps working', () => {
  const closed = rollout([eventRecord('task_started'),eventRecord('turn_aborted',now-500)]);
  const working = rollout([eventRecord('task_started')]);
  const snapshots = codexSessionSnapshots([thread('a',{rolloutPath:'a'}),thread('b',{rolloutPath:'b'})], [], true, now, multiConfig, file => file==='a'?closed:working);
  assert.notEqual(snapshots[0].state,'busy'); assert.equal(snapshots[1].state,'busy');
});
test('missing metadata does not suppress newly logging sessions', () => {
  const snapshots = codexSessionSnapshots([], [{threadId:'new',activity:activity({taskStart:now-100})}],true,now,multiConfig,()=>null);
  assert.equal(snapshots[0].codex.threadId,'new'); assert.equal(snapshots[0].state,'busy');
});
test('partial JSON and unrelated text never become permission prompts', () => {
  const text = JSON.stringify(callRecord('exec_command','x',now-100,{command:'print("waiting for approval")'}))+'\n{"type":';
  const parsed = parseCodexRollout(text); assert.equal(parsed.activity.approvalRequest,0); assert.ok(parsed.pendingTool);
});
test('process termination clears all active sessions without fabricating completion', () => {
  const parsed = rollout([eventRecord('task_started')]);
  const rows = codexSessionSnapshots([thread('a'),thread('b')],[],false,now,multiConfig,()=>parsed);
  assert.ok(rows.every(s=>s.state==='idle'&&!s.done));
});
test('multi-session activity is stable across ordering changes and not deduplicated by client', async t => {
  let rows = [codexSnap('a','busy'),codexSnap('b','busy')];
  const {monitor,notifications} = fixture(t,async()=>result(summary(...rows)));
  await monitor.refresh(); const baseline=monitor.getState().events.length;
  rows.reverse(); await monitor.refresh(); assert.equal(monitor.getState().events.length,baseline);
  rows=[codexSnap('a','running',{done:true}),codexSnap('b','running',{done:true})];
  await monitor.refresh(); assert.equal(notifications.length,2);
  assert.deepEqual(new Set(notifications.map(e=>e.sessionId)),new Set(['a','b']));
  assert.equal(monitor.getState().agents.filter(a=>a.client==='codex').length,1);
  assert.equal(monitor.getState().sessions.length,2);
});
test('newly discovered waiting sessions notify without being hidden by an existing waiting session', async t => {
  let rows=[codexSnap('a','busy',{detail:'waiting for approval'})];
  const {monitor,notifications} = fixture(t,async()=>result(summary(...rows)));
  await monitor.refresh(); rows.push(codexSnap('b','busy',{detail:'waiting for approval'})); await monitor.refresh();
  assert.equal(notifications.length,1); assert.equal(notifications[0].sessionId,'b');
});
test('removed or archived sessions disappear without synthetic completion events', async t => {
  let rows=[codexSnap('a','busy'),codexSnap('b','busy')];
  const {monitor,notifications} = fixture(t,async()=>result(summary(...rows)));
  await monitor.refresh(); const count=monitor.getState().events.length;
  rows=[rows[1]]; await monitor.refresh(); assert.equal(monitor.getState().sessions.length,1);
  assert.equal(monitor.getState().events.length,count); assert.equal(notifications.length,0);
});
test('notification cooldown keys are independent for two Codex sessions', () => {
  assert.notEqual(notificationKey('codex','idle','a'),notificationKey('codex','idle','b'));
});
test('expanded float stays on the original display and returns a valid edge anchor', () => {
  const bounds = expandedBounds({x:-190,y:900,width:184,height:60},{x:-1920,y:0,width:1920,height:1040});
  assert.deepEqual(bounds,{x:-410,y:430,width:410,height:610});
  const small=expandedBounds({x:100,y:100,width:184,height:60},{x:0,y:0,width:320,height:480});
  assert.deepEqual(small,{x:0,y:0,width:320,height:480});
});
