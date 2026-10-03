/* Rank Up! — lockstep-relay ROOM SERVER
 *
 * DELIBERATELY GAME-AGNOSTIC. It knows about rooms, seats, a shared seed, and an ordered stream of
 * opaque "action" messages. It does NOT know what a class / card / turn is — so adding game content
 * never touches this file (online-plan invariant #2). Rules live only in the client engine.
 *
 * Protocol (JSON over WebSocket):
 *   client -> server: {type:'join', room, name, cls, deltaDeck, areaSupport, evo, build, clientId, spectator}
 *                     {type:'action', action}         // opaque payload from the client
 *                     {type:'rematch', vote}
 *                     {type:'loadout', cls, deltaDeck, areaSupport, evo}   // answer to loadout-request
 *                     {type:'ping'}
 *   server -> client: {type:'joined', room, seat, seatIdx, players}
 *                     {type:'start'|'resume', seed, seat0Class, seat1Class, name0, name1,
 *                                    seat0DeltaDeck, seat1DeltaDeck, seat0AreaSupport, seat1AreaSupport,
 *                                    allowEvolutions, firstSeat, mySeat, spectator?, log?}
 *                     {type:'peer', event:'join'|'leave'|'disconnect'|'resume', seat, name, players, graceMs?}
 *                     {type:'action', from, seat, seq, action}   // relayed in total order (also stored for catch-up)
 *                     {type:'rematch-vote'|'rematch-declined', seat, name}
 *                     {type:'loadout-request'}       // "confirm your current class / Δ Deck / Area Support" before a start
 *                     {type:'reset', reason}
 *                     {type:'error', code?, msg}  {type:'pong'}
 */
'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8833;
const CLIENT_ROOT = path.join(__dirname, '..');        // this server also serves the game files (single deploy)
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json', '.ttf':'font/ttf', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.md':'text/markdown; charset=utf-8' };
const SEATS = ['player1', 'player2'];            // room seats (both human); the client maps them to engine seats 'player' / 'ai'
const GRACE_MS = 90 * 1000;                      // how long a seat is held for a dropped player to reconnect
const rooms = new Map();                          // code -> room

// Build id = fingerprint of the served client files, computed at startup. A Render deploy restarts the process
// and recomputes it, so it changes on every deploy WITHOUT any manual version bump. Clients capture it at page
// load (via /health) and send it back on join; a mismatch means that client is running stale code (loaded
// before a deploy) and would desync — so the server tells it to refresh instead of starting a broken match.
const SERVER_BUILD = (function(){
  try {
    var parts = [];
    ['index.html', 'net.js', 'styles.css'].forEach(function(f){
      try { var st = fs.statSync(path.join(CLIENT_ROOT, f)); parts.push(f + ':' + Math.round(st.mtimeMs) + ':' + st.size); } catch(_) {}
    });
    var s = parts.join('|'); var h = 0;
    for (var i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return 'b' + (h >>> 0).toString(36);
  } catch(_) { return 'b0'; }
})();
console.log('[build] SERVER_BUILD =', SERVER_BUILD);

function newSeed() { return (Math.random() * 0xFFFFFFFF) >>> 0; }
function send(ws, obj) { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch (_) {} }

// ── Ratings + match history (trust-based, name-keyed; friends won't cheat — invariant #0). Persisted to a
// JSON file next to the server (NOT under CLIENT_ROOT, so it is never served). Elo with K=24, base 1000. ──
const STATS_PATH = path.join(__dirname, 'stats.json');
// players is a NULL-PROTOTYPE map keyed by name: a player called '__proto__' or 'constructor' gets an ordinary
// record instead of reaching (and polluting) Object.prototype for the whole server.
function nameMap(src) { const m = Object.create(null); if (src && typeof src === 'object') Object.keys(src).forEach(function(k){ m[k] = src[k]; }); return m; }
let STATS = { players: nameMap(null), history: [] };
try { const j = JSON.parse(fs.readFileSync(STATS_PATH, 'utf8')); if (j && typeof j === 'object') STATS = { players: nameMap(j.players), history: Array.isArray(j.history) ? j.history : [] }; } catch (_) {}
let statsSaveTimer = null;
function saveStats() { if (statsSaveTimer) return; statsSaveTimer = setTimeout(function(){ statsSaveTimer = null; try { fs.writeFileSync(STATS_PATH, JSON.stringify(STATS)); } catch (_) {} }, 400); }
function playerRec(name) { const k = String(name || 'guest').slice(0, 24); if (!STATS.players[k]) STATS.players[k] = { name: k, elo: 1000, wins: 0, losses: 0, draws: 0, games: 0 }; return STATS.players[k]; }
// result: the winning room seat ('player1' | 'player2') or 'draw'.
function recordResult(name0, name1, result) {
  const a = playerRec(name0), b = playerRec(name1);
  const ea = 1 / (1 + Math.pow(10, (b.elo - a.elo) / 400));
  const eb = 1 / (1 + Math.pow(10, (a.elo - b.elo) / 400));
  const winnerName = result === 'player1' ? name0 : (result === 'player2' ? name1 : null);
  let sa, sb;
  if (result === 'player1') { sa = 1; sb = 0; a.wins++; b.losses++; }
  else if (result === 'player2') { sa = 0; sb = 1; b.wins++; a.losses++; }
  else { sa = sb = 0.5; a.draws++; b.draws++; }
  a.elo = Math.round(a.elo + 24 * (sa - ea)); b.elo = Math.round(b.elo + 24 * (sb - eb));
  a.games++; b.games++;
  STATS.history.push({ t: Date.now(), a: name0, b: name1, winner: winnerName || 'draw', ae: a.elo, be: b.elo });
  if (STATS.history.length > 500) STATS.history.splice(0, STATS.history.length - 500);
  saveStats();
  return { a: a, b: b };
}
function leaderboard(limit) {
  return Object.keys(STATS.players).map(k => STATS.players[k])
    .sort((x, y) => (y.elo - x.elo) || (y.wins - x.wins))
    .slice(0, limit || 25);
}

function newRoom() {
  return {
    seed: newSeed(), seq: 0, started: false,
    log: [],                                   // ordered {from, action} for reconnect catch-up
    seatSocket: [null, null],                  // live ws per seat index (null = empty or disconnected)
    seatMeta:   [null, null],                  // {clientId,name,cls,dd,as} per seat index (persists across a drop)
    seatGrace:  [null, null],                  // reconnect grace timer per seat index
    rematchVotes: new Set(),                   // seat indexes that voted yes
    spectators: new Set()                      // read-only watchers (no seat) — get the setup + live action stream
  };
}
// Two players in one room must never share a display name (both called "Guest" read as the same player, and
// the ratings would credit the wrong one) — the second gets a numbered suffix.
function uniqueName(room, name, exceptIdx){
  const taken = new Set();
  for (let i = 0; i < 2; i++) { if (i !== exceptIdx && room.seatMeta[i]) taken.add(String(room.seatMeta[i].name).toLowerCase()); }
  if (!taken.has(String(name).toLowerCase())) return name;
  for (let n = 2; n < 100; n++) { const cand = String(name).slice(0, 20) + ' (' + n + ')'; if (!taken.has(cand.toLowerCase())) return cand; }
  return name + ' (' + Date.now() % 1000 + ')';
}
function liveSockets(room){ return room.seatSocket.filter(function(s){ return s && s.readyState === 1; }); }
function broadcast(room, obj, exceptWs){
  room.seatSocket.forEach(function(s){ if (s && s !== exceptWs) send(s, obj); });
  if (room.spectators) room.spectators.forEach(function(s){ if (s !== exceptWs) send(s, obj); });   // watchers get peer events + the live action stream
}
function roomPlayers(room){
  var out = [];
  for (var i=0;i<2;i++){ if (room.seatMeta[i]) out.push({ seat: SEATS[i], name: room.seatMeta[i].name, connected: !!(room.seatSocket[i] && room.seatSocket[i].readyState===1) }); }
  return out;
}
// Everyone needed to start present (both seats hold a live socket)?
function bothConnected(room){ return !!(room.seatSocket[0] && room.seatSocket[0].readyState===1 && room.seatSocket[1] && room.seatSocket[1].readyState===1); }
// A display name is shown inside the game's dialogs on the OTHER player's screen (built as HTML), so it carries no
// markup: < > and control characters are dropped; ' ` " & become the look-alike ’ ” + (so "O'Neil" stays readable);
// whitespace is collapsed. Empty → 'guest'. (The client applies the same cleaning.)
function cleanName(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/['`]/g, '\u2019').replace(/"/g, '\u201d').replace(/&/g, '+').trim().slice(0, 24); }
// A player's match loadout as sent by their client (join or loadout answer).
function readLoadout(msg){
  return { cls: String(msg.cls || 'light').slice(0, 32),
           dd: Array.isArray(msg.deltaDeck) ? msg.deltaDeck.slice(0, 3).map(x => String(x).slice(0, 64)) : [],
           as: msg.areaSupport ? String(msg.areaSupport).slice(0, 64) : null,
           evo: msg.evo !== false };
}
// Before EVERY match start (first start, a new opponent, a rematch) both players confirm their CURRENT loadout —
// class, Δ Deck, Area Support, Allow Evolutions — so what they picked while waiting in the room is what the
// match is built from (not what they had when they first joined). A client that doesn't answer in time
// (an older build) is started with its last known loadout.
function confirmLoadoutsThen(room, go){
  if (room.loadout) clearTimeout(room.loadout.timer);
  const pending = new Set([0, 1].filter(i => room.seatSocket[i] && room.seatSocket[i].readyState === 1));
  const lo = { pending, go, timer: null };
  lo.finish = function(){ if (room.loadout !== lo) return; clearTimeout(lo.timer); room.loadout = null; if (bothConnected(room)) go(); };
  lo.timer = setTimeout(lo.finish, 5000);
  room.loadout = lo;
  pending.forEach(i => send(room.seatSocket[i], { type: 'loadout-request' }));
}

function buildSetup(room, type, includeLog){
  var m0 = room.seatMeta[0] || {}, m1 = room.seatMeta[1] || {};
  var payload = {
    type: type,
    seed: room.seed,
    seat0Class: m0.cls || 'light', seat1Class: m1.cls || 'light',
    name0: m0.name || 'Player 1', name1: m1.name || 'Player 2',
    seat0DeltaDeck: m0.dd || [], seat1DeltaDeck: m1.dd || [],
    seat0AreaSupport: m0.as || null, seat1AreaSupport: m1.as || null,
    // Match rules are the room's, decided by the host (Player 1) — never each device's own menu settings, or the
    // two clients would build different games.
    allowEvolutions: m0.evo !== false,
    firstSeat: room.seed % 2,
    seq: room.seq || 0
  };
  if (includeLog) payload.log = room.log.map(function(e){ return { seq: e.seq || 0, from: e.from, action: e.action }; });
  return payload;
}
function startMatch(room, code){
  room.started = true; room.seq = 0; room.log = []; room.resultRecorded = false;
  room.seatSocket.forEach(function(s, idx){ if (s) send(s, Object.assign(buildSetup(room, 'start', false), { mySeat: idx })); });
  if (room.spectators) room.spectators.forEach(function(s){ send(s, Object.assign(buildSetup(room, 'resume', true), { mySeat: 0, spectator: true })); });
  console.log(`[start] room=${code} seed=${room.seed} classes=[${(room.seatMeta[0]||{}).cls},${(room.seatMeta[1]||{}).cls}] firstSeat=${room.seed%2}`);
}

const server = http.createServer((req, res) => {
  if ((req.url || '').split('?')[0] === '/health') {   // cloud host ping, keep-warm, client build capture
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ ok: true, service: 'rank-up-room-server', rooms: rooms.size, build: SERVER_BUILD }));
    return;
  }
  if ((req.url || '').split('?')[0] === '/leaderboard') {   // ratings board (read-only)
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ ok: true, leaderboard: leaderboard(25) }));
    return;
  }
  // Serve the static game files, so ONE deploy gives both the game (https://host/) and the room
  // WebSocket (wss://host). Clients connect same-origin when deployed.
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(CLIENT_ROOT, urlPath));
  if (!filePath.startsWith(CLIENT_ROOT)) { res.writeHead(403); res.end('forbidden'); return; }   // no path traversal
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return; }
    // no-cache = the browser must check for a newer copy every load, so after an update no player keeps running an
    // old game script or stylesheet beside the new page (which would mix versions and show/hide the wrong things).
    res.writeHead(200, { 'content-type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });   // every client message is tiny (an input is < 1 KB)

wss.on('connection', (ws) => {
  ws._room = null; ws._seatIdx = null; ws._clientId = null;

  // ONE connection's problem never takes the server (and every other room) down:
  //  · a protocol error on this socket (an oversized or malformed frame) is reported by ws as an 'error' event —
  //    unhandled, that event would crash the process. ws then closes the socket and 'close' below frees / holds
  //    its seat as usual;
  //  · a message that makes a handler throw is logged and dropped.
  ws.on('error', (e) => { console.warn(`[ws-error] room=${ws._room} seat=${ws._seatIdx} ${(e && e.code) || ''} ${(e && e.message) || e}`); });
  ws.on('message', (buf) => {
    try { onMessage(buf); } catch (e) { console.error(`[message-error] room=${ws._room} seat=${ws._seatIdx}`, (e && e.stack) || e); }
  });

  function onMessage(buf) {
    let msg; try { msg = JSON.parse(buf.toString()); } catch (_) { return; }
    if (!msg || typeof msg !== 'object') return;   // 'null', a number, a string: not a message

    if (msg.type === 'join') {
      // Stale-client guard: the client captured the build at page load; if it no longer matches the running
      // server, that client loaded old code (a deploy happened since) and would desync — tell it to refresh.
      if (msg.build && msg.build !== SERVER_BUILD) {
        send(ws, { type: 'error', code: 'stale', msg: 'A new version of Rank Up! is out. Refresh the page (Ctrl+F5) to update, then rejoin.' });
        return;
      }
      const code = String(msg.room || 'default').slice(0, 32).toUpperCase();
      const clientId = String(msg.clientId || ('anon-' + Math.random().toString(36).slice(2))).slice(0, 64);
      let room = rooms.get(code);
      if (!room) { room = newRoom(); rooms.set(code, room); }

      // ── SPECTATOR: no seat, read-only. Gets the current setup + full action log to build the live state, and
      // then the live action stream. Never counts toward seats / start / rematch. ──
      if (msg.spectator) {
        ws._room = code; ws._seatIdx = null; ws._spectator = true;
        room.spectators.add(ws);
        send(ws, { type: 'joined', room: code, seat: 'spectator', seatIdx: null, spectator: true, players: roomPlayers(room) });
        if (room.started) send(ws, Object.assign(buildSetup(room, 'resume', true), { mySeat: 0, spectator: true }));
        console.log(`[spectate] room=${code} (${room.spectators.size} watching, started=${room.started})`);
        return;
      }

      const meta = Object.assign({ clientId: clientId, name: cleanName(msg.name) || 'guest' }, readLoadout(msg));

      // ── RECONNECT: this clientId already owns a seat here (held open during grace, or a live reload) ──
      let seatIdx = -1;
      for (let i = 0; i < 2; i++) { if (room.seatMeta[i] && room.seatMeta[i].clientId === clientId) { seatIdx = i; break; } }
      if (seatIdx !== -1) {
        if (room.seatGrace[seatIdx]) { clearTimeout(room.seatGrace[seatIdx]); room.seatGrace[seatIdx] = null; }
        try { const old = room.seatSocket[seatIdx]; if (old && old !== ws) old.close(); } catch(_){}
        // Keep the ORIGINAL claim (class, Δ Deck, rules, name) — the running game was built from it, and both
        // clients and the ratings key on it. Only the socket is replaced.
        room.seatSocket[seatIdx] = ws;
        ws._room = code; ws._seatIdx = seatIdx; ws._clientId = clientId;
        send(ws, { type: 'joined', room: code, seat: SEATS[seatIdx], seatIdx, players: roomPlayers(room), resuming: room.started });
        if (room.started) {
          // Hand back the full setup + action log so this client rebuilds to the CURRENT state (lockstep catch-up).
          send(ws, Object.assign(buildSetup(room, 'resume', true), { mySeat: seatIdx }));
          const heldName = room.seatMeta[seatIdx].name;
          broadcast(room, { type: 'peer', event: 'resume', seat: SEATS[seatIdx], name: heldName, players: roomPlayers(room) }, ws);
          console.log(`[resume] room=${code} seat=${SEATS[seatIdx]} name=${heldName} (log=${room.log.length})`);
        } else if (bothConnected(room)) {
          confirmLoadoutsThen(room, function(){ if (!room.started) startMatch(room, code); });
        }
        return;
      }

      // ── NEW seat: take the lowest index that is empty (no meta) ──
      seatIdx = -1;
      for (let i = 0; i < 2; i++) { if (!room.seatMeta[i]) { seatIdx = i; break; } }
      if (seatIdx === -1) { send(ws, { type: 'error', msg: 'Room full.' }); return; }   // 2-player for v1

      meta.name = uniqueName(room, meta.name, seatIdx);
      room.seatMeta[seatIdx] = meta;
      room.seatSocket[seatIdx] = ws;
      ws._room = code; ws._seatIdx = seatIdx; ws._clientId = clientId;
      send(ws, { type: 'joined', room: code, seat: SEATS[seatIdx], seatIdx, players: roomPlayers(room) });
      broadcast(room, { type: 'peer', event: 'join', seat: SEATS[seatIdx], name: meta.name, players: roomPlayers(room) }, ws);
      console.log(`[join] room=${code} seat=${SEATS[seatIdx]} name=${meta.name} cls=${meta.cls}`);

      if (bothConnected(room) && !room.started) confirmLoadoutsThen(room, function(){ if (!room.started) startMatch(room, code); });
      return;
    }

    const room = ws._room && rooms.get(ws._room);
    if (!room) { send(ws, { type: 'error', msg: 'Join a room first.' }); return; }

    if (msg.type === 'action') {
      if (ws._spectator || ws._seatIdx == null || !room.started) return;
      if (room.seatSocket[ws._seatIdx] !== ws) return;
      if (!SEATS[ws._seatIdx] || !msg.action || typeof msg.action !== 'object') return;
      // Total order: stamp a monotonic seq, STORE for reconnect catch-up, and relay to the other clients.
      const seq = ++room.seq;
      const seat = SEATS[ws._seatIdx];
      room.log.push({ seq, from: seat, action: msg.action });
      if (room.log.length > 20000) room.log.splice(0, room.log.length - 20000);   // safety cap
      broadcast(room, { type: 'action', from: seat, seat, seq, action: msg.action }, ws);
      return;
    }

    // Rematch is a ROOM-LIFECYCLE concern (like join/leave), NOT a game rule. When every seat votes yes, deal a
    // fresh identically-seeded game to the same seats/classes (a new 'start'). A 'no' clears the tally.
    if (msg.type === 'rematch') {
      const seat = SEATS[ws._seatIdx];
      const name = (room.seatMeta[ws._seatIdx] || {}).name;
      if (msg.vote === false) {
        room.rematchVotes.clear();
        broadcast(room, { type: 'rematch-declined', seat, name }, ws);
        console.log(`[rematch] room=${ws._room} seat=${seat} declined`);
        return;
      }
      // A rematch is only for a FINISHED match (its result has been reported) — a vote during a live match is ignored,
      // so a stray vote can never restart a game in progress.
      if (ws._seatIdx == null || (room.started && !room.resultRecorded)) return;
      room.rematchVotes.add(ws._seatIdx);
      broadcast(room, { type: 'rematch-vote', seat, name }, ws);
      if (room.rematchVotes.size >= 2 && bothConnected(room)) {
        room.rematchVotes.clear();
        const code = ws._room;
        confirmLoadoutsThen(room, function(){
          room.seed = newSeed(); room.started = true; room.seq = 0; room.log = []; room.resultRecorded = false;
          room.seatSocket.forEach(function(s, idx){ if (s) send(s, Object.assign(buildSetup(room, 'start', false), { mySeat: idx, rematch: true })); });
          if (room.spectators) room.spectators.forEach(function(s){ send(s, Object.assign(buildSetup(room, 'resume', true), { mySeat: 0, spectator: true, rematch: true })); });
          console.log(`[rematch] room=${code} all agreed -> new game seed=${room.seed}`);
        });
      }
      return;
    }
    // Match result → update ratings/history. Both clients report the same winner (identical state); record it
    // ONCE per match (reset on each start/rematch) so Elo isn't double-counted. Spectators can't report.
    if (msg.type === 'result') {
      if (ws._spectator || !room.started || room.resultRecorded) return;
      const w = msg.winner;                               // room seat: 'player1' | 'player2' | 'draw'
      if (w !== 'player1' && w !== 'player2' && w !== 'draw') return;
      const n0 = (room.seatMeta[0] || {}).name, n1 = (room.seatMeta[1] || {}).name;
      if (!n0 || !n1) return;
      room.resultRecorded = true;
      const winnerName = w === 'player1' ? n0 : (w === 'player2' ? n1 : 'draw');
      recordResult(n0, n1, w);
      const rec = { type: 'stats', players: [playerRec(n0), playerRec(n1)] };
      room.seatSocket.forEach(function(s){ if (s) send(s, rec); });
      if (room.spectators) room.spectators.forEach(function(s){ send(s, rec); });
      console.log(`[result] room=${ws._room} winner=${winnerName} | ${n0}:${playerRec(n0).elo} ${n1}:${playerRec(n1).elo}`);
      return;
    }
    // A deliberate leave (Leave / Exit Match): free the seat now — no reconnect grace — and reset the room so the
    // other player is told immediately and returned to the lobby.
    if (msg.type === 'leave') {
      if (ws._spectator) { room.spectators.delete(ws); return; }
      const idx = ws._seatIdx;
      if (idx == null || room.seatSocket[idx] !== ws) return;
      const name = (room.seatMeta[idx] || {}).name;
      room.seatSocket[idx] = null; ws._left = true;
      console.log(`[leave] room=${ws._room} seat=${SEATS[idx]} name=${name} left deliberately`);
      freeSeat(room, ws._room, idx);
      return;
    }
    // A player's current loadout, answering a loadout-request. Only accepted while a start is being confirmed —
    // never mid-match (the running game was built from the confirmed loadout).
    if (msg.type === 'loadout') {
      const idx = ws._seatIdx;
      if (ws._spectator || idx == null || room.seatSocket[idx] !== ws || !room.seatMeta[idx] || !room.loadout) return;
      Object.assign(room.seatMeta[idx], readLoadout(msg));
      if (room.loadout.pending.delete(idx) && room.loadout.pending.size === 0) room.loadout.finish();
      return;
    }
    if (msg.type === 'ping') { send(ws, { type: 'pong', t: msg.t }); return; }
  }

  ws.on('close', () => {
    const code = ws._room; const room = code && rooms.get(code);
    if (!room) return;
    if (ws._spectator) { room.spectators.delete(ws); if (!liveSockets(room).length && !room.spectators.size && !room.seatMeta[0] && !room.seatMeta[1]) { rooms.delete(code); } return; }
    const idx = ws._seatIdx;
    if (idx == null || ws._left || room.seatSocket[idx] !== ws) return;   // already replaced by a reconnect, or left deliberately
    room.seatSocket[idx] = null;
    const seat = SEATS[idx], name = (room.seatMeta[idx] || {}).name;

    // Before the match starts, or once it's over, a leave just frees the seat (no grace needed).
    if (!room.started) { freeSeat(room, code, idx); return; }

    // Mid-game: HOLD the seat for a reconnect. Keep seed + action log intact so the returning player can catch
    // up. Tell the other player their opponent dropped and we're waiting.
    broadcast(room, { type: 'peer', event: 'disconnect', seat, name, players: roomPlayers(room), graceMs: GRACE_MS });
    console.log(`[drop] room=${code} seat=${seat} name=${name} — holding ${GRACE_MS/1000}s for reconnect`);
    if (room.seatGrace[idx]) clearTimeout(room.seatGrace[idx]);
    room.seatGrace[idx] = setTimeout(function(){
      room.seatGrace[idx] = null;
      if (room.seatSocket[idx]) return;                 // reconnected in time
      console.log(`[drop-expire] room=${code} seat=${seat} — freeing seat`);
      freeSeat(room, code, idx);
    }, GRACE_MS);
  });
});

// Free a seat and return the room to a clean WAITING state so a fresh opponent can start a new game.
function freeSeat(room, code, idx) {
  if (room.seatGrace[idx]) { clearTimeout(room.seatGrace[idx]); room.seatGrace[idx] = null; }
  const leaver = room.seatMeta[idx], leaverSeat = SEATS[idx];
  room.seatMeta[idx] = null; room.seatSocket[idx] = null;
  const anyLeft = room.seatMeta[0] || room.seatMeta[1] || liveSockets(room).length;
  if (!anyLeft) { rooms.delete(code); console.log(`[gc] room ${code} emptied`); return; }
  // Reset for a clean new match and compact the remaining player down to seat 0.
  if (room.loadout) { clearTimeout(room.loadout.timer); room.loadout = null; }
  room.started = false; room.seed = newSeed(); room.seq = 0; room.log = []; room.rematchVotes.clear();
  const survivorSocket = room.seatSocket[0] || room.seatSocket[1];
  const survivorMeta = room.seatMeta[0] || room.seatMeta[1];
  room.seatSocket = [survivorSocket || null, null];
  room.seatMeta = [survivorMeta || null, null];
  room.seatGrace = [null, null];
  if (survivorSocket) { survivorSocket._seatIdx = 0; }
  broadcast(room, { type: 'peer', event: 'leave', seat: leaverSeat, name: leaver ? leaver.name : null, players: roomPlayers(room) });
  broadcast(room, { type: 'reset', reason: 'opponent-left' });
  console.log(`[leave] room=${code} → reset; ${liveSockets(room).length} waiting`);
}

server.listen(PORT, () => console.log(`Rank Up! room server listening on http://localhost:${PORT}  (ws://localhost:${PORT})`));
