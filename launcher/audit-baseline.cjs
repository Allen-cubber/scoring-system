// Read the current implementation and exercise a disposable copy only.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const root = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scoring-audit-'));
const port = 31318;
const base = `http://127.0.0.1:${port}`;
fs.writeFileSync(path.join(dir, 'index.js'), fs.readFileSync(path.join(root, 'index.js'), 'utf8').replace('const PORT = 3000;', `const PORT = ${port};`));
fs.copyFileSync(path.join(root, 'database.js'), path.join(dir, 'database.js'));
fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'junction');
let log = '';
const server = spawn(process.execPath, ['index.js'], { cwd: dir, windowsHide: true });
server.stdout.on('data', x => { log += x; });
server.stderr.on('data', x => { log += x; });
const report = { fixture: dir, productionDatabaseTouched: false };
async function request(route, body) {
  const start = performance.now();
  const response = await fetch(base + route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000)
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data, ms: performance.now() - start };
}
async function create(route, body) {
  const r = await request(route, body);
  assert.equal(r.status, 201);
  return r.data.data.id;
}
async function query(sql) {
  const db = new sqlite3.Database(path.join(dir, 'scoring.db'));
  try { return await new Promise((resolve, reject) => db.all(sql, (e, rows) => e ? reject(e) : resolve(rows))); }
  finally { await new Promise(resolve => db.close(resolve)); }
}
async function batch(player, items, value) {
  const t = performance.now();
  const responses = await Promise.all(Array.from({ length: 100 }, (_, n) => request('/api/scores', {
    playerId: player, judgeId: `test-${n}`, scores: items.map(itemId => ({ itemId, score: value }))
  })));
  const times = responses.map(x => x.ms).sort((a, b) => a - b);
  return { requests: responses.length, success: responses.filter(x => x.status === 201).length, elapsedMs: Math.round(performance.now() - t), p95Ms: Math.round(times[94]), maxMs: Math.round(times[99]) };
}
(async () => {
  try {
    for (let i = 0; i < 60; i++) {
      try { if ((await request('/api/scoring-sets')).status === 200) break; } catch { }
      await new Promise(r => setTimeout(r, 100));
    }
    const player = await create('/api/players', { name: '并发测试选手' });
    report.startBeforeSelectingSet = (await request(`/api/live/start/${player}`, {})).status;
    const set = await create('/api/scoring-sets', { name: '测试组 A' });
    const items = [];
    for (const name of ['技术', '表现']) items.push(await create(`/api/scoring-sets/${set}/items`, { name, max_score: 10 }));
    await request(`/api/live/set-active/${set}`, {});
    await request(`/api/live/start/${player}`, {});
    report.initialSubmissions = await batch(player, items, 8);
    report.updatedSubmissions = await batch(player, items, 9);
    report.persisted = await query('SELECT COUNT(*) AS rows, COUNT(DISTINCT judge_id) AS judges, SUM(score) AS sum FROM scores');
    assert.equal(report.initialSubmissions.success, 100);
    assert.equal(report.updatedSubmissions.success, 100);
    assert.deepEqual(report.persisted, [{ rows: 200, judges: 100, sum: 1800 }]);
    report.negativeScoreStatus = (await request('/api/scores', { playerId: player, judgeId: 'invalid-range', scores: items.map(itemId => ({ itemId, score: -50 })) })).status;
    const otherSet = await create('/api/scoring-sets', { name: '测试组 B' });
    const otherItem = await create(`/api/scoring-sets/${otherSet}/items`, { name: '其他项目', max_score: 10 });
    await request(`/api/live/set-active/${otherSet}`, {});
    report.crossGroupSubmitStatus = (await request('/api/scores', { playerId: player, judgeId: 'test-0', scores: [{ itemId: otherItem, score: 8 }] })).status;
    report.originalGroupRowsForJudgeAfterSwitch = await query(`SELECT COUNT(*) AS rows FROM scores s JOIN scoring_items i ON i.id=s.item_id WHERE s.judge_id='test-0' AND i.set_id=${set}`);
    report.scope = 'Local HTTP only; no phone, Wi-Fi, long-duration or power-loss tests.';
    fs.writeFileSync(path.join(root, 'launcher', 'baseline-audit.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    server.kill();
    fs.writeFileSync(path.join(dir, 'server.log'), log);
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
