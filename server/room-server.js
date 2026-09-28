/* Rank Up! — lockstep-relay ROOM SERVER (Phase 1)
 *
 * DELIBERATELY GAME-AGNOSTIC. It knows about rooms, seats, a shared seed, and an ordered stream of
 * opaque "action" messages. It does NOT know what a class / card / turn is — so adding game content
 * never touches this file (online-plan invariant #2). Rules live only in the client engine.
 *
 * Protocol (JSON over WebSocket):
 *   client -> server: {type:'join', room, name}
 *                     {type:'action', action}         // action is an opaque payload from the client
 *                     {type:'ping'}
 *   server -> client: {type:'joined', room, seat, seed, players}
 *                     {type:'peer', event:'join'|'leave', seat, name, players}
 *                     {type:'action', from, seat, seq, action}   // relayed in total order
 *                     {type:'error', msg}
 *                     {type:'pong'}
 */
'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8833;
const CLIENT_ROOT = path.join(__dirname, '..');        // this server also serves the game files (single deploy)
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json', '.ttf':'font/ttf', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.md':'text/markdown; charset=utf-8' };
const SEATS = ['player', 'ai', 'ai2'];           // seat assignment by join order (matches the client engine's seat ids)
const rooms = new Map();                          // code -> { seed, seq, sockets:Set, seatBySocket:Map, nameBySocket:Map }

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

function roomPlayers(room) {
  return [...room.sockets].map(s => ({ seat: room.seatBySocket.get(s), name: room.nameBySocket.get(s) || '?' }));
}
function send(ws, obj) { try { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch (_) {} }
function broadcast(room, obj, except) { for (const s of room.sockets) if (s !== except) send(s, obj); }

const server = http.createServer((req, res) => {
  if (req.url === '/health' || (req.url || '').split('?')[0] === '/health') {   // health endpoint (cloud host ping, keep-warm, client build capture)
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

wss.on('connection', (ws, req) => {
  ws._room = null;
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
      let room = rooms.get(code);
      if (!room) { room = { seed: newSeed(), seq: 0, started: false, sockets: new Set(), seatBySocket: new Map(), nameBySocket: new Map(), clsBySocket: new Map(), ddBySocket: new Map() }; rooms.set(code, room); }
      if (room.sockets.size >= 2) { send(ws, { type: 'error', msg: 'Room full.' }); return; }   // 2-player for v1
      // Lowest free seat index (robust to leaves), NOT size — avoids seat collisions after a reload.
      const usedSeats = new Set([...room.sockets].map(s => s._seatIdx));
      let seatIdx = 0; while (usedSeats.has(seatIdx)) seatIdx++;
      const seat = SEATS[seatIdx];
      room.sockets.add(ws); room.seatBySocket.set(ws, seat); room.nameBySocket.set(ws, String(msg.name || 'guest').slice(0, 24));
      room.clsBySocket.set(ws, String(msg.cls || 'light'));
      // The Δ Deck is per-player state that must be identical on every client (like the class), or an
      // Amalgamation Rank Up desyncs — each side would build different evolution cards. Relay it as opaque data.
      room.ddBySocket.set(ws, Array.isArray(msg.deltaDeck) ? msg.deltaDeck.slice(0, 3).map(x => String(x).slice(0, 64)) : []);
      ws._room = code; ws._seatIdx = seatIdx;
      send(ws, { type: 'joined', room: code, seat, seatIdx, players: roomPlayers(room) });
      broadcast(room, { type: 'peer', event: 'join', seat, name: room.nameBySocket.get(ws), players: roomPlayers(room) }, ws);
      console.log(`[join] room=${code} seat=${seat} name=${room.nameBySocket.get(ws)} cls=${room.clsBySocket.get(ws)} (${room.sockets.size} in room)`);

      // SHARED-IDENTITY start: once both seats are filled, hand every client the SAME setup — one seed,
      // both classes (by canonical seat index), and a canonical first seat derived from the seed. Each
      // client then builds a byte-identical game and controls only its own seatIdx.
      if (room.sockets.size === 2 && !room.started) {
        room.started = true;
        const socks = [...room.sockets];
        const bySeat = {}; socks.forEach(s => { bySeat[s._seatIdx] = s; });
        const seat0Class = room.clsBySocket.get(bySeat[0]);
        const seat1Class = room.clsBySocket.get(bySeat[1]);
        const name0 = room.nameBySocket.get(bySeat[0]);
        const name1 = room.nameBySocket.get(bySeat[1]);
        const seat0DeltaDeck = room.ddBySocket.get(bySeat[0]) || [];
        const seat1DeltaDeck = room.ddBySocket.get(bySeat[1]) || [];
        const firstSeat = room.seed % 2;
        socks.forEach(s => send(s, { type: 'start', seed: room.seed, seat0Class, seat1Class, name0, name1, seat0DeltaDeck, seat1DeltaDeck, firstSeat, mySeat: s._seatIdx }));
        console.log(`[start] room=${code} seed=${room.seed} classes=[${seat0Class},${seat1Class}] firstSeat=${firstSeat}`);
      }
      return;
    }

    const room = ws._room && rooms.get(ws._room);
    if (!room) { send(ws, { type: 'error', msg: 'Join a room first.' }); return; }

    if (msg.type === 'action') {
      // Total order: stamp a monotonic seq and relay to the OTHER clients. The sender already applied
      // optimistically (turn-based: one actor at a time), so we do NOT echo back to the sender.
      const seq = ++room.seq;
      const seat = room.seatBySocket.get(ws);
      broadcast(room, { type: 'action', from: seat, seat, seq, action: msg.action }, ws);
      return;
    }

    // Rematch is a ROOM-LIFECYCLE concern (like join/leave), NOT a game rule — the server stays
    // game-agnostic. When EVERY current player has voted yes, deal a fresh identically-seeded game to the
    // same seats/classes (a new 'start', exactly like the first). A 'no' (decline/cancel) clears the tally
    // and tells the others, who then choose to wait, leave, or drop to local AI on their own client.
    if (msg.type === 'rematch') {
      const seat = room.seatBySocket.get(ws);
      const name = room.nameBySocket.get(ws);
      room.rematchVotes = room.rematchVotes || new Set();
      if (msg.vote === false) {
        room.rematchVotes.clear();
        broadcast(room, { type: 'rematch-declined', seat, name }, ws);
        console.log(`[rematch] room=${ws._room} seat=${seat} declined`);
        return;
      }
      room.rematchVotes.add(ws);
      broadcast(room, { type: 'rematch-vote', seat, name, votes: room.rematchVotes.size, need: room.sockets.size }, ws);
      if (room.rematchVotes.size >= room.sockets.size && room.sockets.size >= 2) {
        room.rematchVotes.clear();
        room.seed = newSeed(); room.seq = 0; room.started = true;
        const socks = [...room.sockets];
        const bySeat = {}; socks.forEach(s => { bySeat[s._seatIdx] = s; });
        const seat0Class = room.clsBySocket.get(bySeat[0]);
        const seat1Class = room.clsBySocket.get(bySeat[1]);
        const name0 = room.nameBySocket.get(bySeat[0]);
        const name1 = room.nameBySocket.get(bySeat[1]);
        const seat0DeltaDeck = room.ddBySocket.get(bySeat[0]) || [];
        const seat1DeltaDeck = room.ddBySocket.get(bySeat[1]) || [];
        const firstSeat = room.seed % 2;
        socks.forEach(s => send(s, { type: 'start', seed: room.seed, seat0Class, seat1Class, name0, name1, seat0DeltaDeck, seat1DeltaDeck, firstSeat, mySeat: s._seatIdx, rematch: true }));
        console.log(`[rematch] room=${ws._room} all agreed -> new game seed=${room.seed}`);
      }
      return;
    }
    if (msg.type === 'ping') { send(ws, { type: 'pong', t: msg.t }); return; }
  });

  ws.on('close', () => {
    const code = ws._room; const room = code && rooms.get(code);
    if (!room) return;
    const seat = room.seatBySocket.get(ws);
    const name = room.nameBySocket.get(ws);
    room.sockets.delete(ws); room.seatBySocket.delete(ws); room.nameBySocket.delete(ws); room.clsBySocket.delete(ws); room.ddBySocket.delete(ws);
    if (room.sockets.size === 0) { rooms.delete(code); console.log(`[gc] room ${code} emptied`); return; }
    // A player left an in-progress or forming match. With no reconnect (v1), reset the room to a clean
    // WAITING state — new seed, clear started, re-seat the remaining player(s) as 0,1,… — so a fresh
    // opponent can start a clean game (this fixes the "room stalls / start never fires" bug after reloads).
    room.started = false; room.seed = newSeed(); room.seq = 0;
    if (room.rematchVotes) room.rematchVotes.clear();
    let i = 0; for (const s of room.sockets) { s._seatIdx = i; room.seatBySocket.set(s, SEATS[i]); i++; }
    broadcast(room, { type: 'peer', event: 'leave', seat, name, players: roomPlayers(room) });
    broadcast(room, { type: 'reset', reason: 'opponent-left' });
    console.log(`[leave] room=${code} seat=${seat} → reset; ${room.sockets.size} waiting`);
  });
});

server.listen(PORT, () => console.log(`Rank Up! room server listening on http://localhost:${PORT}  (ws://localhost:${PORT})`));
