/* Rank Up! — client NET module (Phase 1)
 * Bridges the deterministic engine + action model to the room server:
 *   • receives the room's shared SEED and starts an identically-seeded game
 *   • forwards each LOCAL player action (via the action model's ruOnLocalAction hook) to the room
 *   • applies each RELAYED action from the room via ruApplyAction (which suppresses re-forwarding)
 * Turn-based + one shared game → optimistic local apply + relay keeps both clients in lockstep.
 * The engine's rules are never touched here (transport only). */
(function(){
  if (window.RUNet) return;
  var ws = null;
  var state = { connected:false, room:null, seat:null, seed:null, name:null, active:false, applied:0, sent:0 };
  var opts = { pCls:'light', aCls:'inferno' };

  function log2(m){ try { (window.log ? window.log : console.log)('[net] ' + m, 'info'); } catch(e){ try{ console.log('[net]', m); }catch(_){} } }
  function setStatus(text, cls){ try { var e = document.getElementById('online-status'); if (e) { e.textContent = text; e.className = 'online-status' + (cls ? ' ' + cls : ''); } } catch(_){} }
  function showLeave(on){ try { var b = document.getElementById('online-leave-btn'); if (b) b.style.display = on ? '' : 'none'; var j = document.getElementById('online-join-btn'); if (j) j.disabled = !!on; } catch(_){} }

  function oppName(){
    // The name of the OTHER seat (for rematch prompts). mySeat 0 → seat1's name, else seat0's.
    try { return (state.mySeat === 1) ? (state.name0 || 'your opponent') : (state.name1 || 'your opponent'); } catch(e){ return 'your opponent'; }
  }
  function postDeclineModal(){
    // Opponent declined / cancelled a rematch (or we cancelled). Offer the two off-ramps the user asked for:
    // keep playing (vs a local AI bot) or leave to the menu. Leaving disconnects from the room.
    try { if (typeof closeModal === 'function') closeModal(); } catch(e){}
    if (typeof openModal !== 'function') return;
    openModal('No rematch',
      '<div class="wbanner"><p>' + oppName() + ' isn’t up for a rematch.</p><p>Play on against a local AI, or leave the room?</p></div>',
      [{ label:'Play vs AI', cls:'mb-skill', fn:function(){ try{closeModal();}catch(e){} window.RUNet.disconnect(); try{ if(typeof G!=='undefined'&&G)G._netMode=false; }catch(e){} if(typeof startGame==='function') startGame(); }},
       { label:'Leave to Menu', fn:function(){ try{closeModal();}catch(e){} window.RUNet.disconnect(); try{ var gs=document.getElementById('game-screen'),ts=document.getElementById('title-screen'); if(gs)gs.classList.remove('active'); if(ts)ts.classList.add('active'); if(typeof refreshAIPick==='function')refreshAIPick(); }catch(e){} }}]);
  }
  window.ruNetPostDecline = postDeclineModal;

  function startNetGame(cfg){
    // SHARED-IDENTITY: every client builds the byte-identical game from the same seed + both classes;
    // only mySeat (which seat this client drives) differs. initGame reads RU_NET_CONFIG.
    try { if (typeof closeModal === 'function') closeModal(); } catch(e){}   // dismiss any game-over / rematch-waiting modal before the fresh game builds
    state.seed = cfg.seed; state.mySeat = cfg.mySeat; state.name0 = cfg.name0; state.name1 = cfg.name1; state.active = true;
    window.RU_NET_CONFIG = { seed: cfg.seed, mySeat: cfg.mySeat, seat0Class: cfg.seat0Class, seat1Class: cfg.seat1Class, firstSeat: cfg.firstSeat,
      seat0DeltaDeck: cfg.seat0DeltaDeck || [], seat1DeltaDeck: cfg.seat1DeltaDeck || [] };
    if (typeof startGame === 'function') startGame();
    window.RU_NET_CONFIG = null;
    // Stash the two synced Δ Decks on G so installDeltaDecks (which runs ~80ms later, after RU_NET_CONFIG is
    // cleared) builds identical evolutions for BOTH seats on every client, keyed by canonical seat index.
    try { if (typeof G !== 'undefined' && G) G._netDeltaDecks = { player: cfg.seat0DeltaDeck || [], ai: cfg.seat1DeltaDeck || [] }; } catch(e){}
    // Attach the real player names to the seat data so the HUD shows them (and they follow the POV swap).
    // Also flag THIS device's own seat object so logs/prompts can say "You"/"your" for the local player and
    // the name for everyone else — the flag rides on the seat OBJECT, so it stays correct through the POV
    // foreign-apply swap (the object moves between the 'player'/'ai' labels, the flag moves with it).
    try {
      if (typeof G !== 'undefined' && G) {
        if (G.player) G.player._netName = cfg.name0 || 'Player 1';
        if (G.ai) G.ai._netName = cfg.name1 || 'Player 2';
        if (G.player) G.player._isLocalHuman = false;
        if (G.ai) G.ai._isLocalHuman = false;
        if (G._localSeat && G[G._localSeat]) G[G._localSeat]._isLocalHuman = true;
        if (typeof renderAll === 'function') renderAll();
      }
    } catch(e){}
    log2('game started — seed ' + cfg.seed + ', you are seat ' + (cfg.mySeat + 1) + ' (' + (typeof G !== 'undefined' && G ? G._localSeat : '?') + '), controlling the bottom board.');
  }

  function handle(msg){
    switch (msg.type) {
      case 'joined':
        state.room = msg.room; state.seat = msg.seat; state.mySeat = msg.seatIdx;
        log2('joined room ' + msg.room + ' as seat ' + (msg.seatIdx + 1) + ' — waiting for opponent…');
        setStatus('In room "' + msg.room + '" as Player ' + (msg.seatIdx + 1) + '. Waiting for an opponent to join…', 'ok');
        break;
      case 'start':
        log2('match starting…');
        setStatus('Opponent found — starting match!', 'ok');
        startNetGame(msg);
        break;
      case 'action':
        // apply-by-tag (shared-identity): the acting seat comes from the server (msg.from). A 'player'
        // action applies normally; an 'ai' action applies via the perspective swap. Same rule on every
        // client → identical result → lockstep.
        try {
          if (msg.from === 'ai') window.ruApplyForeignAction(msg.action);
          else window.ruApplyAction(msg.action);
          state.applied++;
        } catch(e){ console.error('[net] apply failed', e, msg); }
        break;
      case 'peer':
        log2('peer ' + msg.event + ' (seat ' + msg.seat + ', ' + (msg.players ? msg.players.length : '?') + ' in room)');
        break;
      case 'reset':
        // Opponent left (no reconnect in v1) — the room reset to a clean waiting state. Return to the
        // lobby so a fresh match can start; the seat this client will get may change, so we re-sync on the
        // next 'joined'/'start'.
        state.active = false; state.mySeat = null;
        setStatus('Your opponent left — match ended. You are back in the room; a new opponent can join, or change the code.', 'err');
        try { var gs = document.getElementById('game-screen'), ts = document.getElementById('title-screen'); if (gs) gs.classList.remove('active'); if (ts) ts.classList.add('active'); } catch(e){}
        break;
      case 'rematch-vote':
        // The opponent asked for a rematch. Surface it; if the local game-over modal offers a Rematch
        // button, the player just clicks it and both restart (server deals a fresh 'start').
        log2((msg.name || 'Opponent') + ' wants a rematch.');
        setStatus((msg.name || 'Your opponent') + ' wants a rematch — accept to play again.', 'ok');
        break;
      case 'rematch-declined':
        log2((msg.name || 'Opponent') + ' declined the rematch.');
        postDeclineModal();
        break;
      case 'error':
        log2('room error: ' + msg.msg);
        setStatus(msg.msg || 'Room error.', 'err');
        showLeave(false);
        break;
    }
  }

  window.RUNet = {
    connect: function(url, room, name, o){
      o = o || {};
      // this client's chosen class: explicit opt, else the menu selection (pCls), else light
      var myClass = o.cls || (typeof pCls !== 'undefined' && pCls) || 'light';
      opts.cls = myClass;
      state.name = name || 'guest';
      var wsUrl = url || ('ws://' + (location.hostname || 'localhost') + ':8833');
      ws = new WebSocket(wsUrl);
      ws.onopen = function(){ state.connected = true; log2('connected → ' + wsUrl + '; joining "' + room + '" as ' + myClass); setStatus('Connected. Joining room "' + room + '"…'); showLeave(true);
        // Send our Δ Deck so the server can relay both players' decks — evolutions must be identical on every
        // client or an Amalgamation Rank Up desyncs (each side would build different evolution cards).
        var dd = (Array.isArray(window.RU_PLAYER_DELTA_DECK) ? window.RU_PLAYER_DELTA_DECK.slice(0,3) : []);
        ws.send(JSON.stringify({ type:'join', room:room, name:state.name, cls:myClass, deltaDeck:dd })); };
      ws.onmessage = function(ev){ try { handle(JSON.parse(ev.data)); } catch(e){ console.error('[net] bad msg', e); } };
      ws.onclose = function(){ state.connected = false; state.active = false; log2('disconnected'); if (!state.active) showLeave(false); };
      ws.onerror = function(){ log2('socket error'); setStatus('Could not reach the server at ' + wsUrl + '. Is it running?', 'err'); showLeave(false); };
      // forward local player actions to the room (skipped automatically while applying a relayed action, since ruApplyAction sets G._replaying)
      window.ruOnLocalAction = function(a){ if (state.active && ws && ws.readyState === 1) { ws.send(JSON.stringify({ type:'action', action:a })); state.sent++; } };
    },
    state: function(){ return JSON.parse(JSON.stringify(state)); },
    isActive: function(){ return !!state.active; },
    oppName: function(){ return oppName(); },
    // Vote to rematch (true) or decline/cancel (false). When BOTH seats vote true the server deals a fresh
    // identically-seeded game (a new 'start') and both clients rebuild in the same room.
    rematch: function(vote){ try { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type:'rematch', vote: !!vote })); } catch(e){} },
    disconnect: function(){ if (ws) try { ws.close(); } catch(e){} }
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

  window.ruJoinOnline = function(){
    var nameEl = document.getElementById('online-name'), roomEl = document.getElementById('online-room'), srvEl = document.getElementById('online-server');
    var name = (nameEl && nameEl.value.trim()) || 'Guest';
    var room = (roomEl && roomEl.value.trim()) || '';
    var url  = (srvEl && srvEl.value.trim()) || defaultWsUrl();
    var cls  = (typeof pCls !== 'undefined' && pCls) || null;
    if (!cls) { setStatus('Pick your Combat-Class above first.', 'err'); return; }
    if (!room) { setStatus('Enter a room code (any word) and share it with your friend.', 'err'); return; }
    setStatus('Connecting…');
    try { window.RUNet.connect(url, room.toUpperCase(), name, { cls: cls }); }
    catch(e){ setStatus('Connection failed: ' + (e && e.message ? e.message : e), 'err'); }
  };
  window.ruLeaveOnline = function(){ try { window.RUNet.disconnect(); } catch(e){} showLeave(false); setStatus('Left the room.'); };
})();
