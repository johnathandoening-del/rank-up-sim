/* Rank Up! — client NET module
 * Bridges the deterministic engine + action model to the room server:
 *   • receives the room's shared SEED, both players' classes / names / Δ Decks and the room's rules, and starts
 *     the identical game on every client (index.html startOnlineGame / ruInstallOnlineSeats)
 *   • forwards each LOCAL player input (the action model's ruOnLocalAction hook) to the room
 *   • applies each RELAYED input from the room, IN ORDER, as the seat that made it. An input is applied only
 *     once this client's game has reached the exact state it was made in (its state fingerprint) — so a client
 *     that is a few milliseconds behind in the same deterministic flow catches up first instead of diverging.
 * Room seats 'player1' / 'player2' are engine seats 'player' / 'ai' (storage slots only — both are humans).
 * The engine's rules are never touched here (transport only). */
(function(){
  if (window.RUNet) return;
  var ws = null;
  var state = { connected:false, room:null, seat:null, seed:null, name:null, active:false, applied:0, sent:0, lastSeq:0,
                clientId:null, lastConnect:null, reconnectTimer:null, reconnectTries:0, intentionalClose:false,
                mySeat:null, name0:null, name1:null, spectator:false, desync:false };

  // Stable per-tab id so a dropped/reloaded tab reclaims its SAME seat, while a second live tab from the same
  // browser profile can still join as the other player instead of stealing the first seat.
  function clientId(){
    if (state.clientId) return state.clientId;
    var browserId = null, tabId = null;
    try { browserId = localStorage.getItem('ru_browser_id') || localStorage.getItem('ru_client_id'); } catch(e){}
    if (!browserId) {
      browserId = 'b-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    }
    try { localStorage.setItem('ru_browser_id', browserId); } catch(e){}
    try { tabId = sessionStorage.getItem('ru_tab_client_id'); } catch(e){}
    if (!tabId) {
      tabId = 't-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
      try { sessionStorage.setItem('ru_tab_client_id', tabId); } catch(e){}
    }
    state.clientId = String(browserId + '|' + tabId).slice(0, 64);
    return state.clientId;
  }

  function log2(m){ try { (window.log ? window.log : console.log)('[net] ' + m, 'info'); } catch(e){ try{ console.log('[net]', m); }catch(_){} } }
  function setStatus(text, cls){ try { var e = document.getElementById('online-status'); if (e) { e.textContent = text; e.className = 'online-status' + (cls ? ' ' + cls : ''); } } catch(_){} }
  function showLeave(on){ try { var b = document.getElementById('online-leave-btn'); if (b) b.style.display = on ? '' : 'none'; var j = document.getElementById('online-join-btn'); if (j) j.disabled = !!on; } catch(_){} }

  // Room seat <-> engine seat.
  function engineSeat(roomSeat){ return roomSeat === 'player2' ? 'ai' : (roomSeat === 'player1' ? 'player' : null); }
  function roomSeat(engineSeatId){ return engineSeatId === 'ai' ? 'player2' : (engineSeatId === 'player' ? 'player1' : null); }

  function oppName(){
    // The OTHER seat's player name (for rematch prompts).
    return (state.mySeat === 1) ? (state.name0 || 'your opponent') : (state.name1 || 'your opponent');
  }
  function backToMenu(){
    try{ var gs=document.getElementById('game-screen'),ts=document.getElementById('title-screen'); if(gs)gs.classList.remove('active'); if(ts)ts.classList.add('active'); if(typeof refreshAIPick==='function')refreshAIPick(); }catch(e){}
  }
  function postDeclineModal(){
    // Opponent declined / cancelled a rematch (or we cancelled). Offer the two off-ramps: keep playing (a new
    // solo game vs a local AI, with YOUR own class) or leave to the menu. Either way this device leaves the room.
    try { if (typeof closeModal === 'function') closeModal(); } catch(e){}
    if (typeof openModal !== 'function') return;
    openModal('No rematch',
      '<div class="wbanner"><p>' + oppName() + ' isn’t up for a rematch.</p><p>Play on against a local AI, or leave the room?</p></div>',
      [{ label:'Play vs AI', cls:'mb-skill', fn:function(){ try{closeModal();}catch(e){} window.RUNet.leave(); if(typeof startGame==='function') startGame(); }},
       { label:'Leave to Menu', fn:function(){ try{closeModal();}catch(e){} window.RUNet.leave(); backToMenu(); }}]);
    try { if (window.ruTagViewModal) ruTagViewModal(); } catch(e){}
  }
  window.ruNetPostDecline = postDeclineModal;

  // ── inbound inputs: applied strictly in room order, each once this client has caught up to it ──
  var inbox = [], pumpTimer = null, waitSince = 0;
  var CATCH_UP_MS = 8000;
  // Diagnostics: the last inputs this screen sent and applied, each with the game fingerprint around it — what a
  // desync report needs (window.ruNetHistory()).
  var hist = [];
  function histPush(e){ hist.push(e); if (hist.length > 200) hist.shift(); return e; }
  function brief(a){ try { var c = Object.assign({}, a); delete c.sig; return JSON.stringify(c).slice(0, 160); } catch(e){ return String(a && a.t); } }
  function sigNow(){ try { return window.ruStateSig ? ruStateSig() : ''; } catch(e){ return ''; } }
  window.ruNetHistory = function(){ return hist.slice(); };
  function inboxBusy(){ return inbox.length > 0; }
  window.ruInboxBusy = inboxBusy;
  function enqueue(a){ inbox.push(a); pump(); }
  function clearInbox(){ inbox = []; waitSince = 0; if (pumpTimer) { clearTimeout(pumpTimer); pumpTimer = null; } }
  function pump(){
    if (pumpTimer) { clearTimeout(pumpTimer); pumpTimer = null; }
    while (inbox.length) {
      if (typeof G === 'undefined' || !G || !G._netMode) { clearInbox(); return; }
      var a = inbox[0];
      var ready = window.ruCanApplyNow ? window.ruCanApplyNow(a) : true;
      if (!ready) {
        if (!waitSince) waitSince = Date.now();
        if (Date.now() - waitSince < CATCH_UP_MS) { pumpTimer = setTimeout(pump, 30); return; }
        // The game never reached the state this input was made in: the two games have diverged.
        if (!state.desync) {
          state.desync = true;
          console.error('[net] state mismatch — applying input out of step', a, { mine: window.ruStateSig && ruStateSig(), theirs: a.sig });
          setStatus('Sync problem detected — the two games may differ. Leaving and rejoining the room will rebuild this game from the match log.', 'err');
        }
      }
      waitSince = 0;
      inbox.shift();
      var before = sigNow();
      try { window.ruApplyAction(a); state.applied++; } catch(e){ console.error('[net] apply failed', e, a); }
      histPush({ dir:'in', a: brief(a), made: a.sig, before: before, after: sigNow(), ready: ready });
    }
  }

  function startNetGame(cfg){
    // Every client builds the byte-identical game from the same seed + both seats' classes, names, Δ Decks and the
    // room's rules; only which seat this device plays (cfg.mySeat) differs. initGame reads RU_NET_CONFIG.
    try { if (typeof closeModal === 'function') closeModal(); } catch(e){}   // dismiss any game-over / rematch-waiting modal before the fresh game builds
    // The game decides whether it can build this match at all. If it can't, no half-built match is shown: this
    // client leaves the room, returns to the menu and says why (the other clients do exactly the same).
    var problem = (typeof window.ruNetSetupProblem === 'function') ? window.ruNetSetupProblem(cfg) : null;
    if (problem) {
      console.error('[net] match not started:', problem);
      try { if (typeof G !== 'undefined' && G && G.turn) G.gameOver = true; } catch(e){}
      try { var gs = document.getElementById('game-screen'), ts = document.getElementById('title-screen'); if (gs) gs.classList.remove('active'); if (ts) ts.classList.add('active'); } catch(e){}
      window.RUNet.leave();
      setStatus(problem, 'err');
      return false;
    }
    clearInbox();
    state.seed = cfg.seed; state.mySeat = cfg.spectator ? null : cfg.mySeat; state.name0 = cfg.name0; state.name1 = cfg.name1;
    state.active = true; state.spectator = !!cfg.spectator; state.applied = 0; state.lastSeq = 0; state.desync = false;
    window.RU_NET_CONFIG = {
      seed: cfg.seed, mySeat: cfg.mySeat, spectator: !!cfg.spectator,
      seat0Class: cfg.seat0Class, seat1Class: cfg.seat1Class, firstSeat: cfg.firstSeat,
      name0: cfg.name0, name1: cfg.name1,
      allowEvolutions: cfg.allowEvolutions !== false,
      deltaDecks: { player: cfg.seat0DeltaDeck || [], ai: cfg.seat1DeltaDeck || [] },
      areaSupports: { player: cfg.seat0AreaSupport || null, ai: cfg.seat1AreaSupport || null }
    };
    try { if (typeof startGame === 'function') startGame(); }
    finally { window.RU_NET_CONFIG = null; }
    if (cfg.spectator) setStatus('Spectating room "' + (state.room || '') + '" — read-only.', 'ok');
    else log2('game started — seed ' + cfg.seed + ', you are ' + (cfg.mySeat === 1 ? (cfg.name1 || 'Player 2') : (cfg.name0 || 'Player 1')) + ' (Player ' + (cfg.mySeat + 1) + ').');
  }

  // Reconnect / spectate catch-up: build the identical base game, then replay every logged input in order (each as
  // the seat that made it, through the same catch-up queue) to reproduce the exact live state.
  function resumeNetGame(cfg){
    if (startNetGame(cfg) === false) return;
    var lg = cfg.log || [];
    lg.forEach(function(e){
      var seq = Number(e.seq || 0);
      var a = Object.assign({}, e.action, { s: engineSeat(e.from) });
      if (seq) state.lastSeq = Math.max(state.lastSeq, seq);
      enqueue(a);
    });
    setStatus(cfg.spectator ? ('Spectating room "' + (state.room || '') + '" — read-only.') : 'Reconnected — caught up to the live game.', 'ok');
    log2('resumed: replaying ' + lg.length + ' input(s).');
  }

  function handle(msg){
    switch (msg.type) {
      case 'joined':
        state.room = msg.room; state.seat = msg.seat; state.mySeat = msg.spectator ? null : msg.seatIdx;
        if (msg.spectator) { setStatus('Watching room "' + msg.room + '" — waiting for the match to start…', 'ok'); break; }
        log2('joined room ' + msg.room + ' as Player ' + (msg.seatIdx + 1) + ' — waiting for opponent…');
        setStatus('In room "' + msg.room + '" as Player ' + (msg.seatIdx + 1) + '. Waiting for an opponent to join…', 'ok');
        break;
      case 'loadout-request':
        // The room is about to start a match: confirm what this player has picked right now.
        if (!state.spectator && ws && ws.readyState === 1) { try { ws.send(JSON.stringify(Object.assign({ type:'loadout' }, currentLoadout()))); } catch(e){} }
        break;
      case 'start':
        log2('match starting…');
        setStatus('Opponent found — starting match!', 'ok');
        startNetGame(msg);
        break;
      case 'resume':
        // We (re)joined mid-game: rebuild the identical base game, then replay the room's input log in order.
        log2('catching up (' + ((msg.log && msg.log.length) || 0) + ' inputs)…');
        setStatus('Catching up to the live game…', 'ok');
        resumeNetGame(msg);
        break;
      case 'action': {
        // Each relayed input is applied AS the seat the room says made it (the room's stamp is authoritative).
        var seq = Number(msg.seq || 0);
        if (seq && seq <= state.lastSeq) return;
        if (seq) state.lastSeq = seq;
        var a = Object.assign({}, msg.action, { s: engineSeat(msg.from) });
        if (!a.s) return;
        enqueue(a);
        break;
      }
      case 'peer':
        log2('peer ' + msg.event + ' (' + (msg.name || msg.seat || '') + ')');
        if (msg.event === 'disconnect') {
          setStatus((msg.name || 'Your opponent') + ' disconnected — waiting up to ' + Math.round((msg.graceMs||90000)/1000) + 's for them to reconnect…', 'err');
          try { if (typeof log === 'function') log((msg.name || 'Your opponent') + ' disconnected — holding the game for a reconnect…', 'imp'); } catch(e){}
        } else if (msg.event === 'resume') {
          setStatus((msg.name || 'Your opponent') + ' reconnected — resuming.', 'ok');
          try { if (typeof log === 'function') log((msg.name || 'Your opponent') + ' reconnected.', 'imp'); } catch(e){}
        } else if (msg.event === 'join' && !state.active) {
          setStatus((msg.name || 'An opponent') + ' joined — starting…', 'ok');
        }
        break;
      case 'reset':
        // The opponent left for good — the room reset to a clean waiting state. Return to the lobby so a fresh
        // match can start; the seat this client gets may change, so we re-sync on the next 'joined' / 'start'.
        state.active = false; state.mySeat = null; state.lastSeq = 0; state.applied = 0; clearInbox();
        if (state.reconnectTimer) { clearTimeout(state.reconnectTimer); state.reconnectTimer = null; }
        try { if (typeof G !== 'undefined' && G && G._netMode) G.gameOver = true; } catch(e){}
        try { if (typeof closeModal === 'function') { closeModal(); closeModal(); } var pk = document.getElementById('picker-modal'); if (pk) pk.classList.remove('open'); } catch(e){}
        setStatus('Your opponent left — match ended. You are back in the room; a new opponent can join, or change the code.', 'err');
        backToMenu();
        break;
      case 'rematch-vote':
        // The opponent asked for a rematch. If the local game-over screen offers Rematch, clicking it starts the
        // fresh game for both (the room deals a new 'start').
        log2((msg.name || 'Opponent') + ' wants a rematch.');
        setStatus((msg.name || 'Your opponent') + ' wants a rematch — accept to play again.', 'ok');
        break;
      case 'rematch-declined':
        log2((msg.name || 'Opponent') + ' declined the rematch.');
        postDeclineModal();
        break;
      case 'stats':
        // Updated ratings after a match — surface each player's record in the log.
        try {
          (msg.players || []).forEach(function(p){ log2(p.name + ': ' + p.elo + ' Elo (' + p.wins + 'W-' + p.losses + 'L' + (p.draws ? '-' + p.draws + 'D' : '') + ')'); });
        } catch(e){}
        break;
      case 'error':
        log2('room error: ' + msg.msg);
        setStatus(msg.msg || 'Room error.', 'err');
        showLeave(false);
        // Stale client (a deploy happened after this page loaded) — offer a one-click refresh.
        if (msg.code === 'stale' && typeof openModal === 'function') {
          try { openModal('Update available',
            '<div class="wbanner"><p>' + (msg.msg || 'A new version is available.') + '</p></div>',
            [{ label:'Refresh now', cls:'mb-skill', fn:function(){ try{ location.reload(true); }catch(e){ location.reload(); } }}, { label:'Later', fn:function(){ try{closeModal();}catch(e){} }}]);
            if (window.ruTagViewModal) ruTagViewModal(); } catch(e){}
        }
        break;
    }
  }

  // Auto-reconnect after an unexpected drop: retry the same room every few seconds until the server's grace
  // window (~90s) — each attempt re-joins with our clientId, so the server resumes us with the input log.
  function scheduleReconnect(){
    if (state.reconnectTimer || !state.active || state.intentionalClose) return;
    state.reconnectTimer = setTimeout(function attempt(){
      state.reconnectTimer = null;
      if (!state.active || state.intentionalClose) return;
      if (state.connected) return;
      state.reconnectTries++;
      if (state.reconnectTries > 40) { setStatus('Could not reconnect — the match may have ended. Rejoin the room to try again.', 'err'); state.active = false; showLeave(false); return; }
      log2('reconnect attempt ' + state.reconnectTries + '…');
      setStatus('Connection lost — reconnecting (' + state.reconnectTries + ')…', 'err');
      try { var lc = state.lastConnect || {}; window.RUNet.connect(lc.url, lc.room, lc.name, { cls: lc.cls, spectator: lc.spectator, _resume: true }); } catch(e){}
      state.reconnectTimer = setTimeout(attempt, 3000);
    }, 1500);
  }

  // This player's match loadout — class, Δ Deck (first 3), Area Support, Allow Evolutions — read from the menu
  // NOW. Sent on join and again whenever the room confirms loadouts before a match starts.
  function currentLoadout(preferCls){
    var cls = preferCls || (typeof pCls !== 'undefined' && pCls) || 'light';
    var evo = (typeof evolutionsAllowed === 'function') ? !!evolutionsAllowed() : true;
    var dd = (Array.isArray(window.RU_PLAYER_DELTA_DECK) ? window.RU_PLAYER_DELTA_DECK.slice(0,3) : []);   // the format's only rule: at most 3
    return { cls: cls, deltaDeck: dd, areaSupport: window.RU_PLAYER_AREA_SUPPORT || null, evo: evo };
  }

  window.RUNet = {
    connect: function(url, room, name, o){
      o = o || {};
      var myClass = o.cls || (typeof pCls !== 'undefined' && pCls) || 'light';
      state.name = name || 'Guest';
      state.intentionalClose = false;
      state.lastConnect = { url: url, room: room, name: state.name, cls: myClass, spectator: !!o.spectator };   // remembered for auto-reconnect
      var wsUrl = url || ('ws://' + (location.hostname || 'localhost') + ':8833');
      if (ws) { try { var old = ws; ws = null; old.close(); } catch(e){} }
      ws = new WebSocket(wsUrl);
      var thisWs = ws;
      // Free-tier hosts sleep after ~15 min idle and take up to a minute to wake — the WS connect can look
      // dead meanwhile, so show a "waking up" status and let the socket keep trying.
      if (!o._resume) setStatus('Connecting to the server… (a free-tier server can take up to a minute to wake up)');
      ws.onopen = function(){ state.connected = true; if (state.reconnectTimer) { clearTimeout(state.reconnectTimer); state.reconnectTimer = null; } state.reconnectTries = 0;
        log2('connected → ' + wsUrl + '; joining "' + room + '"' + (o.spectator ? ' as a spectator' : ' as ' + myClass)); if (!o._resume) setStatus('Connected. Joining room "' + room + '"…'); showLeave(true);
        // Our Δ Deck + Area Support go to the room so every client builds both players' evolutions identically;
        // `evo` is this player's Allow-Evolutions choice (the room uses the host's — Player 1's — for the match).
        var lo = currentLoadout(o.cls);
        // clientId lets the server give us back our SAME seat on reconnect; build lets it reject a stale client.
        ws.send(JSON.stringify({ type:'join', room:room, name:state.name, cls:lo.cls, deltaDeck:lo.deltaDeck, areaSupport:lo.areaSupport, evo:lo.evo, build: state.loadedBuild || null, clientId: clientId(), spectator: !!o.spectator })); };
      ws.onmessage = function(ev){ if (thisWs !== ws) return; try { handle(JSON.parse(ev.data)); } catch(e){ console.error('[net] bad msg', e); } };
      ws.onclose = function(){ if (thisWs !== ws) return;   // superseded by a newer socket (reconnect) — ignore
        state.connected = false; log2('disconnected');
        // Unexpected drop while a match is live → try to reconnect to the same room (the server holds our seat and
        // replays the log so we resume). A deliberate leave (intentionalClose) or a non-active state just tidies up.
        if (state.active && !state.intentionalClose) { setStatus('Connection lost — reconnecting…', 'err'); scheduleReconnect(); }
        else { state.active = false; showLeave(false); }
      };
      ws.onerror = function(){ log2('socket error'); if (!state.active) { setStatus('Could not reach the server at ' + wsUrl + '. If it was asleep, wait a few seconds and try again.', 'err'); showLeave(false); } };
      // forward this device's inputs to the room (the action model never calls this while applying a relayed input)
      window.ruOnLocalAction = function(a){ if (state.active && !state.spectator && ws && ws.readyState === 1) { ws.send(JSON.stringify({ type:'action', action:a })); state.sent++;
        var e = histPush({ dir:'out', a: brief(a), made: a.sig }); setTimeout(function(){ e.after = sigNow(); }, 0); } };
    },
    state: function(){ return JSON.parse(JSON.stringify(state)); },
    isActive: function(){ return !!state.active; },
    oppName: function(){ return oppName(); },
    // Vote to rematch (true) or decline/cancel (false). When BOTH seats vote true the server deals a fresh
    // identically-seeded game (a new 'start') and both clients rebuild in the same room.
    rematch: function(vote){ try { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type:'rematch', vote: !!vote })); } catch(e){} },
    // Report the finished match's winner (engine seat 'player' | 'ai', or 'draw') as a room seat so the server
    // updates ratings. Both players report the same result; the server records it once. Spectators don't report.
    reportResult: function(winner){ try { if (!state.spectator && ws && ws.readyState === 1) ws.send(JSON.stringify({ type:'result', winner: winner === 'draw' ? 'draw' : roomSeat(winner) })); } catch(e){} },
    // Leave the match for good: the room frees this seat at once (no reconnect grace) and tells the other player.
    leave: function(){ try { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type:'leave' })); } catch(e){} window.RUNet.disconnect(); showLeave(false); setStatus('You left the room.'); },
    disconnect: function(){ state.intentionalClose = true; state.active = false; clearInbox(); if (state.reconnectTimer) { clearTimeout(state.reconnectTimer); state.reconnectTimer = null; } if (ws) { var w0 = ws; ws = null; try { w0.close(); } catch(e){} } }
  };

  // ── Lobby glue (title-screen "Play Online" panel) ──
  // Where's the room server? Deployed, the room server also serves this page, so it's same-origin
  // (wss://host). In local dev the game is served by python on :8832 while the WS server runs on :8833.
  function defaultWsUrl(){
    try {
      if (location.port === '8832') return 'ws://' + location.hostname + ':8833';   // local dev split
      var proto = (location.protocol === 'https:') ? 'wss:' : 'ws:';
      return proto + '//' + location.host;                                          // same-origin (deployed / node-served)
    } catch(e){ return 'ws://localhost:8833'; }
  }
  // Pre-fill the server field with the right default once the DOM is ready.
  function initServerField(){ try { var s = document.getElementById('online-server'); if (s && (!s.value || s.value.indexOf('localhost') !== -1)) s.value = defaultWsUrl(); } catch(e){} }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initServerField); else initServerField();

  // The http(s) origin of the room server (for /health), derived from the WS URL.
  function httpBase(){
    try {
      var w = defaultWsUrl();
      return w.replace(/^ws/, 'http').replace(/\/$/, '');
    } catch(e){ return ''; }
  }
  // On load: hit /health once. This (1) captures the build we loaded under, so the server can reject us if a
  // deploy lands before we join (else we'd desync), and (2) starts WAKING a sleeping free-tier server early,
  // so the first Play-Online click connects fast. A keep-alive ping every 10 min stops the server sleeping
  // mid-session while anyone has the page open. All best-effort — failures are ignored (offline/localhost).
  function pingHealth(){
    try {
      var base = httpBase(); if (!base) return;
      fetch(base + '/health?cb=' + Date.now(), { cache:'no-store' })
        .then(function(r){ return r.ok ? r.json() : null; })
        .then(function(j){ if (j && j.build) state.loadedBuild = j.build; })
        .catch(function(){});
    } catch(e){}
  }
  function initHealth(){ pingHealth(); try { setInterval(pingHealth, 10*60*1000); } catch(e){} }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initHealth); else initHealth();

  window.ruJoinOnline = function(){
    var nameEl = document.getElementById('online-name'), roomEl = document.getElementById('online-room'), srvEl = document.getElementById('online-server');
    var name = (nameEl && nameEl.value.trim()) || 'Guest';
    var room = (roomEl && roomEl.value.trim()) || '';
    var url  = (srvEl && srvEl.value.trim()) || defaultWsUrl();
    var cls  = (typeof pCls !== 'undefined' && pCls) || null;
    if (!cls) { setStatus('Pick your Combat-Class above first.', 'err'); return; }
    if (!room) { setStatus('Enter a room code (any word) and share it with your friend.', 'err'); return; }
    // Your Δ Deck must be legal before you join — the match is built from it on BOTH players' screens.
    try {
      if (typeof evolutionsAllowed === 'function' && evolutionsAllowed() && typeof window.legalDeltaDeck === 'function') {
        var lg = window.legalDeltaDeck(window.RU_PLAYER_DELTA_DECK);
        if (lg && !lg.ok) { setStatus('Your Δ Deck is not legal: ' + (lg.msg || 'fix it in the Δ Deck builder') + ' — or untick Allow Evolutions.', 'err'); return; }
      }
    } catch(e){}
    setStatus('Connecting…');
    try { window.RUNet.connect(url, room.toUpperCase(), name, { cls: cls }); }
    catch(e){ setStatus('Connection failed: ' + (e && e.message ? e.message : e), 'err'); }
  };
  window.ruSpectateOnline = function(){
    var roomEl = document.getElementById('online-room'), srvEl = document.getElementById('online-server');
    var room = (roomEl && roomEl.value.trim()) || '';
    var url  = (srvEl && srvEl.value.trim()) || defaultWsUrl();
    if (!room) { setStatus('Enter the room code you want to watch.', 'err'); return; }
    setStatus('Connecting to watch room "' + room.toUpperCase() + '"…');
    try { window.RUNet.connect(url, room.toUpperCase(), (document.getElementById('online-name')||{}).value || 'Spectator', { cls: (typeof pCls!=='undefined'&&pCls)||'light', spectator: true }); }
    catch(e){ setStatus('Connection failed: ' + (e && e.message ? e.message : e), 'err'); }
  };
  window.ruLeaveOnline = function(){ try { window.RUNet.leave(); } catch(e){} showLeave(false); setStatus('Left the room.'); };

  // Ratings board — fetch /leaderboard and show it in a modal.
  window.ruLeaderboard = function(){
    var base = httpBase(); if (!base) { setStatus('Leaderboard unavailable.', 'err'); return; }
    setStatus('Loading leaderboard…');
    fetch(base + '/leaderboard?cb=' + Date.now(), { cache:'no-store' })
      .then(function(r){ return r.json(); })
      .then(function(j){
        var rows = (j && j.leaderboard) || [];
        setStatus(rows.length ? '' : 'No games recorded yet — play an online match to appear here.');
        if (typeof openModal !== 'function') return;
        var body = '<div class="wbanner" style="max-height:60vh;overflow:auto;"><table style="width:100%;font-size:.8rem;border-collapse:collapse;">' +
          '<tr style="color:var(--text-dim);text-align:left;"><th style="padding:.2rem .4rem;">#</th><th>Player</th><th>Elo</th><th>W</th><th>L</th><th>D</th></tr>' +
          (rows.length ? rows.map(function(p,i){ return '<tr><td style="padding:.2rem .4rem;">' + (i+1) + '</td><td>' + esc(p.name) + '</td><td><b>' + p.elo + '</b></td><td>' + p.wins + '</td><td>' + p.losses + '</td><td>' + (p.draws||0) + '</td></tr>'; }).join('')
                        : '<tr><td colspan="6" style="padding:.6rem;color:var(--text-dim);">No games recorded yet.</td></tr>') +
          '</table></div>';
        openModal('🏆 Leaderboard', body, [{ label:'Close', cls:'mb-skill', fn:function(){ try{closeModal();}catch(e){} }}]);
        try { if (window.ruTagViewModal) ruTagViewModal(); } catch(e){}
      })
      .catch(function(){ setStatus('Could not load the leaderboard (is the server awake?).', 'err'); });
  };
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]; }); }
})();
