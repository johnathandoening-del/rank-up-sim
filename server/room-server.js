/* Rank Up! — lockstep-relay ROOM SERVER
 *
 * DELIBERATELY GAME-AGNOSTIC. It knows about rooms, seats, a shared seed, and an ordered stream of
 * opaque "action" messages. It does NOT know what a class / card / turn is — so adding game content
 * never touches this file (online-plan invariant #2). Rules live only in the client engine.
 *
 * Protocol (JSON over WebSocket):
 *   client -> server: {type:'join', room, name, cls, deltaDeck, build, clientId}
 *                     {type:'action', action}         // opaque payload from the client
 *                     {type:'rematch', vote}
 *                     {type:'ping'}
 *   server -> client: {type:'joined', room, seat, seatIdx, players}
 *                     {type:'start'|'resume', seed, seat0Class, seat1Class, name0, name1,
 *                                    seat0DeltaDeck, seat1DeltaDeck, firstSeat, mySeat, log?}
 *                     {type:'peer', event:'join'|'leave'|'disconnect'|'resume', seat, name, players, graceMs?}
 *                     {type:'action', from, seat, seq, action}   // relayed in total order (also stored for catch-up)
 *                     {type:'rematch-vote'|'rematch-declined', seat, name}
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
const SEATS = ['player', 'ai', 'ai2'];           // seat id by index (matches the client engine's seat ids)
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

function newRoom() {
  return {
    seed: newSeed(), seq: 0, started: false,
    log: [],                                   // ordered {from, action} for reconnect catch-up
    seatSocket: [null, null],                  // live ws per seat index (null = empty or disconnected)
    seatMeta:   [null, null],                  // {clientId,name,cls,dd} per seat index (persists across a drop)
    seatGrace:  [null, null],                  // reconnect grace timer per seat index
    rematchVotes: new Set()                    // seat indexes that voted yes
  };
}
function liveSockets(room){ return room.seatSocket.filter(function(s){ return s && s.readyState === 1; }); }
function broadcast(room, obj, exceptWs){ room.seatSocket.forEach(function(s){ if (s && s !== exceptWs) send(s, obj); }); }
function roomPlayers(room){
  var out = [];
  for (var i=0;i<2;i++){ if (room.seatMeta[i]) out.push({ seat: SEATS[i], name: room.seatMeta[i].name, connected: !!(room.seatSocket[i] && room.seatSocket[i].readyState===1) }); }
  return out;
}
// Everyone needed to start present (both seats hold a live socket)?
function bothConnected(room){ return !!(room.seatSocket[0] && room.seatSocket[0].readyState===1 && room.seatSocket[1] && room.seatSocket[1].readyState===1); }

function buildSetup(room, type, includeLog){
  var m0 = room.seatMeta[0] || {}, m1 = room.seatMeta[1] || {};
  var payload = {
    type: type,
    seed: room.seed,
    seat0Class: m0.cls || 'light', seat1Class: m1.cls || 'light',
    name0: m0.name || 'Player 1', name1: m1.name || 'Player 2',
    seat0DeltaDeck: m0.dd || [], seat1DeltaDeck: m1.dd || [],
    firstSeat: room.seed % 2
  };
  if (includeLog) payload.log = room.log.map(function(e){ return { from: e.from, action: e.action }; });
  return payload;
}
function startMatch(room, code){
  room.started = true; room.seq = 0; room.log = [];
  room.seatSocket.forEach(function(s, idx){ if (s) send(s, Object.assign(buildSetup(room, 'start', false), { mySeat: idx })); });
  console.log(`[start] room=${code} seed=${room.seed} classes=[${(room.seatMeta[0]||{}).cls},${(room.seatMeta[1]||{}).cls}] firstSeat=${room.seed%2}`);
}

const server = http.createServer((req, res) => {
  if ((req.url || '').split('?')[0] === '/health') {   // cloud host ping, keep-warm, client build capture
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ ok: true, service: 'rank-up-room-server', rooms: rooms.size, build: SERVER_BUILD }));
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
    res.writeHead(200, { 'content-type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws._room = null; ws._seatIdx = null; ws._clientId = null;

  ws.on('message', (buf) => {
    let msg; try { msg = JSON.parse(buf.toString()); } catch (_) { return; }

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

      const meta = { clientId: clientId, name: String(msg.name || 'guest').slice(0, 24), cls: String(msg.cls || 'light'),
                     dd: Array.isArray(msg.deltaDeck) ? msg.deltaDeck.slice(0, 3).map(x => String(x).slice(0, 64)) : [] };

      // ── RECONNECT: this clientId already owns a seat here (held open during grace, or a live reload) ──
      let seatIdx = -1;
      for (let i = 0; i < 2; i++) { if (room.seatMeta[i] && room.seatMeta[i].clientId === clientId) { seatIdx = i; break; } }
      if (seatIdx !== -1) {
        if (room.seatGrace[seatIdx]) { clearTimeout(room.seatGrace[seatIdx]); room.seatGrace[seatIdx] = null; }
        try { const old = room.seatSocket[seatIdx]; if (old && old !== ws) old.close(); } catch(_){}
        // keep class/deltaDeck from the ORIGINAL claim (mid-game they can't change); refresh only the name/socket
        room.seatMeta[seatIdx].name = meta.name;
        room.seatSocket[seatIdx] = ws;
        ws._room = code; ws._seatIdx = seatIdx; ws._clientId = clientId;
        send(ws, { type: 'joined', room: code, seat: SEATS[seatIdx], seatIdx, players: roomPlayers(room), resuming: room.started });
        if (room.started) {
          // Hand back the full setup + action log so this client rebuilds to the CURRENT state (lockstep catch-up).
          send(ws, Object.assign(buildSetup(room, 'resume', true), { mySeat: seatIdx }));
          broadcast(room, { type: 'peer', event: 'resume', seat: SEATS[seatIdx], name: meta.name, players: roomPlayers(room) }, ws);
          console.log(`[resume] room=${code} seat=${SEATS[seatIdx]} name=${meta.name} (log=${room.log.length})`);
        } else if (bothConnected(room)) {
          startMatch(room, code);
        }
        return;
      }

      // ── NEW seat: take the lowest index that is empty (no meta) ──
      seatIdx = -1;
      for (let i = 0; i < 2; i++) { if (!room.seatMeta[i]) { seatIdx = i; break; } }
      if (seatIdx === -1) { send(ws, { type: 'error', msg: 'Room full.' }); return; }   // 2-player for v1

      room.seatMeta[seatIdx] = meta;
      room.seatSocket[seatIdx] = ws;
      ws._room = code; ws._seatIdx = seatIdx; ws._clientId = clientId;
      send(ws, { type: 'joined', room: code, seat: SEATS[seatIdx], seatIdx, players: roomPlayers(room) });
      broadcast(room, { type: 'peer', event: 'join', seat: SEATS[seatIdx], name: meta.name, players: roomPlayers(room) }, ws);
      console.log(`[join] room=${code} seat=${SEATS[seatIdx]} name=${meta.name} cls=${meta.cls}`);

      if (bothConnected(room) && !room.started) startMatch(room, code);
      return;
    }

    const room = ws._room && rooms.get(ws._room);
    if (!room) { send(ws, { type: 'error', msg: 'Join a room first.' }); return; }

    if (msg.type === 'action') {
      // Total order: stamp a monotonic seq, STORE for reconnect catch-up, and relay to the other clients.
      const seq = ++room.seq;
      const seat = SEATS[ws._seatIdx];
      room.log.push({ from: seat, action: msg.action });
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
      room.rematchVotes.add(ws._seatIdx);
      broadcast(room, { type: 'rematch-vote', seat, name }, ws);
      if (room.rematchVotes.size >= 2 && bothConnected(room)) {
        room.rematchVotes.clear();
        room.seed = newSeed();
        room.seatSocket.forEach(function(s, idx){ if (s) send(s, Object.assign(buildSetup(room, 'start', false), { mySeat: idx, rematch: true })); });
        room.started = true; room.seq = 0; room.log = [];
        console.log(`[rematch] room=${ws._room} all agreed -> new game seed=${room.seed}`);
      }
      return;
    }
    if (msg.type === 'ping') { send(ws, { type: 'pong', t: msg.t }); return; }
  });

  ws.on('close', () => {
    const code = ws._room; const room = code && rooms.get(code);
    if (!room) return;
    const idx = ws._seatIdx;
    if (idx == null || room.seatSocket[idx] !== ws) return;   // already replaced by a reconnect
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
  room.seatMeta[idx] = null; room.seatSocket[idx] = null;
  const anyLeft = room.seatMeta[0] || room.seatMeta[1] || liveSockets(room).length;
  if (!anyLeft) { rooms.delete(code); console.log(`[gc] room ${code} emptied`); return; }
  // Reset for a clean new match and compact the remaining player down to seat 0.
  room.started = false; room.seed = newSeed(); room.seq = 0; room.log = []; room.rematchVotes.clear();
  const survivorSocket = room.seatSocket[0] || room.seatSocket[1];
  const survivorMeta = room.seatMeta[0] || room.seatMeta[1];
  room.seatSocket = [survivorSocket || null, null];
  room.seatMeta = [survivorMeta || null, null];
  room.seatGrace = [null, null];
  if (survivorSocket) { survivorSocket._seatIdx = 0; }
  broadcast(room, { type: 'peer', event: 'leave', players: roomPlayers(room) });
  broadcast(room, { type: 'reset', reason: 'opponent-left' });
  console.log(`[leave] room=${code} → reset; ${liveSockets(room).length} waiting`);
}

server.listen(PORT, () => console.log(`Rank Up! room server listening on http://localhost:${PORT}  (ws://localhost:${PORT})`));
