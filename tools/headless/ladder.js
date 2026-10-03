'use strict';
/* Run a series of arena matchups one after another (each with mirrored deals) and keep every result in one JSON file —
 * for measuring a strength curve or calibrating the tiers, unattended.
 *   node tools/headless/ladder.js <plan.json> <results.json> [deals=28] [workers=14]
 * plan.json: [{ "name": "...", "A": {policy}, "B": {policy} }, ...]   (policies as for arena.js)
 * A matchup already in results.json (same name) is skipped, so an interrupted series resumes where it stopped. */
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const [planFile, outFile, dealsArg, wArg] = process.argv.slice(2);
const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
const deals = String(dealsArg || 28), workers = String(wArg || 14);
const load = () => { try { return JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch (e) { return []; } };
for (const m of plan) {
  const done = load();
  if (done.some((r) => r.name === m.name)) { console.log(`skip ${m.name} (done)`); continue; }
  const tmp = path.join(os.tmpdir(), `ladder-${process.pid}-${Date.now()}.json`);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, 'arena.js'), deals, JSON.stringify(m.A), JSON.stringify(m.B), workers],
    { env: Object.assign({}, process.env, { ARENA_OUT: tmp }), encoding: 'utf8', maxBuffer: 1 << 26 });
  let res = null; try { res = JSON.parse(fs.readFileSync(tmp, 'utf8')); fs.unlinkSync(tmp); } catch (e) {}
  const c = res ? res.counts : null;
  const entry = { name: m.name, A: m.A, B: m.B, counts: c, aShare: res ? res.aShare : null, sec: Math.round((Date.now() - t0) / 1000),
    errors: res ? res.results.flatMap((x) => x.errors || []).slice(0, 3) : [String(r.stderr || '').slice(0, 300)],
    games: res ? res.results.map((x) => ({ w: x.winner, cls: x.cls, aSeat: x.aSeat, t: x.turns, reason: x.reason })) : [] };
  const all = load(); all.push(entry); fs.writeFileSync(outFile, JSON.stringify(all, null, 1));
  console.log(`${m.name}: A ${c && c.A} B ${c && c.B} draw ${c && c.draw} unfinished ${c && c.unfinished} → A ${entry.aShare != null ? (100 * entry.aShare).toFixed(1) + '%' : '-'} (${entry.sec} s)`);
}
