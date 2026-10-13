# Rank Up! AI rebuild — design and progress log

Goal: bots that genuinely think — they play the game forward in their head with the REAL rules, model the
opponent's replies, re-plan after every action, and choose the line that leads to the best future position.
No scripted text-matching, no random "mistake dice", no luck or card advantages.

## Requirements (from the user, binding)

**Lookahead N** (turns simulated forward: its own turn, the opponent's reply, …):

| Tier | N | Occasionally |
|---|---|---|
| Distinguished 4 | 7 | always 7 |
| Distinguished 3 | 5 | 6 (~1 turn in 10) |
| Distinguished 2 | 5 | always 5 |
| Distinguished 1 | 4 | 5 (~1 in 7) |
| D-Candidate 3 | 4 | 5 (~1 in 10) |
| D-Candidate 2 | 4 | always 4 |
| D-Candidate 1 | 4 | 3 (~1 in 7) |
| Talented 2 | 3 | 4 (~1 in 10) |
| Talented 1 | 3 | 2 (~1 in 7) |
| Skilled 2 | 2 | 3 (~1 in 7) |
| Skilled 1 | 2 | 1 (~1 in 5) |
| Basic | 1 | 2 (~1 in 7) |
| Maladroit | 1 | 2 (~1 in 10) |
| Inept | 1 | 2 (~1 in 15) |

**Win-rate matrix** (1v1, with AND without Evolutions): same tier 50/50 · 1 sub-tier apart 85/15 · 2 apart 90/10 ·
3 apart 95/5 · 4 apart 99.5/0.5 · 5+ apart 100/0. Bottom is steeper: Maladroit beats Inept 90/10, Basic beats
Inept 95/5, Skilled 1 beats Inept 99.5/0.5.

**100/0** means literally never: every loss in such a pairing is a defect, investigated from its replay and fixed.
A genuinely unwinnable deal is shown to the user, never hidden or faked.

**Same luck for everyone**: no peeking at hidden information (opponent hand, deck orders, future random rolls),
no better deals. **Δ**: none below Talented 2, increasing from there; Δ cards (every Δ type, not just
Amalgamations) chosen to serve the bot's plan.

**Think time**: up to ~10–20 s per phase for top tiers is fine; bots must not rush through turns.

**1v1v1 / Royale**: win rates follow pairwise strength (Plackett–Luce fitted to the matrix; e.g. D4 vs D3 vs D3 ≈ 74% D4).

**All modes**: AI vs player, AI vs AI, 1v1v1, Royale, Tournament (random brackets, real escalation), Gauntlet.
Verified finally by playing as a human in the real UI.

## Architecture (built)

1. **One real engine, many realms.** `ai/realm.js` turns any global object into a game realm: the fake DOM
   (`ai/fakedom.js`), a virtual clock (timers run when settled, in order), seeded randomness and the window stubs. The
   Node tools (`tools/headless/engine.js`, a vm context) and the browser bot worker (`ai/worker.js`, its own global)
   load the game's own scripts into it. No second copy of the rules.
2. **Inputs = moves.** Every seat is driven by the same inputs a human makes (`{t:'adv'}`, `{t:'zone',o,z}`,
   `{t:'modal',i}`, `{t:'pick',ix}`, ...), applied in the order every screen applies one: *settle -> pre-input
   checkpoint -> input* (`ai/match.js`, the worker and the bot's own simulation all do this).
3. **The bot** (`ai/brain.js`): turn search phase by phase (every phase searched, Battle included; widening passes;
   unfinished positions always completed); prompts mid-action answered best-first for itself and worst-for-it for
   others; hidden cards re-dealt per imagined world at the current point (what was seen stays). Every decision: one
   turn search FINDS the candidate actions (the best few + the best pass), then EVERY world SCORES every candidate (the
   action, the best rest of the turn in that world, N-1 more turns by each side's quick develop-and-attack planner),
   each with an even share of the effort; actions compared world by world, worlds added until the best is clearly
   ahead, and one not clearly better than passing loses to passing. The bot commits to the action only (attack mode ->
   attacker -> target) and thinks again at its next decision. Judgment noise / temperature for lower tiers. Effort is
   counted where work happens; fixed-effort mode makes strength device-independent and games replayable. 2-4 seats.
4. **Tiers** (`ai/tiers.js`): strength from judgment noise on a measured schedule (0 for Distinguished 4 .. 84 for
   Inept, evenly spaced in strength), the user's N table, worlds, width, effort per decision; Δ only from Talented 2.
5. **Live game** (`ai/host.js` + `ai/worker.js`): solo matches of every mode run under the online lockstep rules with
   every bot seat input-driven (`G._soloNet`, `G._botSeats`). The page keeps the last quiet position (a plain-data
   copy) + the inputs since; the worker restores it, replays and plans; the move returns through the input layer at a
   readable pace, once the page's own game is exactly where the bot planned.

## Verification tools

- `parity.js` — same inputs with and without painting → identical fingerprints after every input.
- `reftrace.js record|check` — proves an engine change didn't alter any game (fingerprint traces).
- `leaktest.js` — snapshot, play K inputs, rewind, replay → identical fingerprints and identical game object.
- `smoke.js` — whole games on random inputs; determinism check.
- `dupcheck.js` — random games; no card ever in two places, no Rank Zone ever empty.
- `hostsim.js` — the page/worker protocol end to end (2-4 seats): the worker must rebuild the page's exact position.
- `arena.js` / `ladder.js` — mirrored-deal matches between policies, in parallel; a series of them unattended.
- `selfplay.js` / `fit.js` — self-play data (positions + per-game Δ Decks) and evaluation fitting (split by game,
  rule-known weight signs).
- `replay.js` — one arena game played again exactly (seed, classes, seats, bots): every input, why, and its log; the
  bot's weighed candidates for chosen turns. In the browser: `RUBots.history()` / `RUBots.explain(k)`.

## Adding new content (classes, evolutions, features, modes)

The bots play the real rules through the same inputs a human makes, so most new content needs no bot code. What
does need touching:

- **New class** — every class lives in the same tables in `data.js`: `CM` (name, alignment, Area, icon — a glyph of
  `RU_Classic_Icons.ttf`), `AIPAIR`, `CLASS_COLORS` (the only colour table), `CLASS_STATS` (the bots' Evolution-deck
  choice uses it), `ND` (Numerals), `DECK_AC` (Action Cards), `AREA_TEXT`, and its class Star in `AC`. Its skills,
  Area and new Action Card effects go in `SDEFS` / `ADEFS` / `ACDEFS` (`index.html`); its menu and card colours are the
  `.t-<class>` / `.nc-<class>` rules in `styles.css`; `GAUNTLET_MAP` (`index.html`) holds its Gauntlet opponents. `CM`
  is the registry: every headless tool reads the class list from it (`tools/headless/classes.js`), so tests and arena
  deals include the new class automatically.
- **A class's rules** go in its own `<script id="<class>-class">` block built on the shared field rules
  (`<script id="field-rules">`): register with `ruHook(name, fn)` (attackResolved, beforeAttack, defend, forcedTarget,
  targetBlocked, phaseEnded, phaseBegan, beforeEnd, rankedUp, promoteBlocked, safeguard, retaliatory, e2, removed,
  entered, survives, actResolved, actResponses, actionNegated) and use `window.ruFx` (fieldTo / standDown / millN / ask /
  choose / pick / pickNP / boardPick — card targets are clicked on the board — / order / intoDeck / cedeTop / damage
  …). "Removed" (left the field for a hand, Deck, Drop or Deadzone; the Bank is not removal), "cannot be removed"
  (`ruProtect`, `noRemove` in data), per-card attack bans, MP shields, attacks that deal no damage
  (`ruNoAttackDamage`), the W-stat (`W` in data, `ruW`; a W/M/S card has `A:null` and shows W in A's place) and
  "defeated in battle" (attacked and did not win, `G._battleResult`) are all defined there once. An Area's printed
  Activation ("when sent to your Deadzone") is `ADEFS[name].onEnter(seat, card)`.
- **Numeral skills** — one point for using any Numeral skill (field rules): what stops it being used at all
  (`ruSkillLocked`: "cannot use Numeral skills this turn", Haste 7), an armed negation waiting for it (`ruSkillArmed`:
  Shining Justice, Seven Heaven — negated before its cost), its cost, its S, an opponent's Shadow 6 (after the cost,
  before the effect), then its effect. A skill a player presses (`SDEFS`) gets this from `startSkillL4` and the step
  runner: write its printed cost as cost steps (the standard types, or `{type:'async', cost:true}` for a cost with
  prompts of its own), its targets and once-per marks as `activation:true` steps, and its effect after them — never a
  cost inside an `effect` step (Shadow 6 would answer before it, a free use could not skip it). A skill that happens on
  its own (a trigger asks, a reaction answers) goes through `ruOfferSkill` / `ruUseSkill` (`ruFx.offerSkill / useSkill /
  skillLocked`) and is declared with `ruTriggeredSkills`; one that negates an Action Card by rewinding passes
  `rewinds:true` (its cost is paid in the rewound position). The random-Bank cost is the step runner's own (it never
  takes a card that cannot be removed).
- **Action Card activations** — every activation (a hand effect, or a Deadzone effect: Dead Draw / Casualty Counter /
  Sabatoric Draw) is a record from its commit to the end of its resolution, and what it DID is observed by the field
  rules for any card: the NP/RP it changed, the cards it removed, the cards that left a Deadzone, its board-pick
  targets, the Casualty Draws it caused. Cards that answer activations ("if a player activates a card that changes
  NP…", "negate…", "whenever an Action Card is negated…") register `actResponses` / `actResolved` / `actionNegated`
  and read that record — never a list of card names. Negating one (`ruActNegate`) rewinds the game in place to the
  moment its effect started. What a new Action Card's implementation must do:
  - Through `ACDEFS` steps nothing more: the commit is in `playActionBase`, and the first step that is not a cost
    (`ruIsCostStep`: costs, targeting `pick_opp_zone`, checks `guard:true`; mark others `cost:true` / `effect:true`)
    starts the effect. A step that pays a cost behind a prompt of its own is `marksEffect:true` and calls
    `ruActEffect()` once its costs are paid.
  - Hand-written (a safeguard / retaliatory / e2 hook): commit with `acCommitAction` / `commitFromHand` (they begin the
    record; an E2 begins at `applyE2`), pay the costs, then call `ruActEffect()` where the effect starts.
  - A flow that goes on after an activation ends it first: `ruActFlush(mark, next)` (as `resolveSafeguard`'s
    `onDone` and the Dead Draw queue do) or `ruActAfter(mark, next)` (the Retaliatory window).
  - Locks ("cannot use / activate Action Cards [of a type]") are `ruActLock`; every play entry checks `ruActLocked`.
- **Time** (field rules, TIME) — cards that reach into the past or the future use the game's history, never their
  own bookkeeping: `G._hist` (every turn's start: where every card was, MP, Casualty Counts — `ruTurnStart`,
  `ruTurnsOf`, `ruRestoreTo`), `G._battles` (every attack with the NP/RP it was fought at — `ruRetroBattles` re-fights a
  past Battle Phase and applies the difference now), `ruLater(kind, seat, when)` with `window.ruTimeFx[kind]` (an
  effect at the next turn / your next turn / Battle Phase / Damage Step), `ruDelayCasualties` / `ruBlockCasualties`,
  `ruAasW` (a card's A stat becomes a W stat of the same value — A: Ⅱ → W: Ⅱ, no A — while a duration or a "while this card stays in …" condition lasts), `ruMoraleLostThisTurn`,
  `ruLoseGame`. Other shared points: `ruSkillNegation` (every Numeral-skill negation goes through it, so a card can
  negate the negation), the `targeted` hook (before the Safeguard window), `drawn`, `phaseRedirect` (a second Battle
  Phase), `ruActMoveChanges` (an activation's NP/RP changes moved to another time), `ruActNegate(…, 'delay')` with
  `ruActReplay` (a declarative card's effect resolved later, its costs not paid again). A skill with a cost that may be
  skipped ("without paying its cost") and paid later keeps its cost and its effect apart (see TSK in temporal-class).
- **New card effects** — offer choices as prompts the owning seat answers (`openModal` / the picker, owned by that
  seat), never "if a bot, pick X": in solo games every bot seat is input-driven and decides through those prompts
  (`ruBotControlledSeat` shortcuts only serve the old fallback bot). A prompt button must do something (a button
  that changes nothing is a dead end for bots and players alike); unavailable options belong in the text.
- **New player action** (a new button / click that changes the game) — wrap it in the input layer (`wrap(...)` near
  `function dispatch` in `index.html`) with a `dispatch` case, give it its phase window in `OWN_WINDOWS` if it is an
  own-turn action the UI only offers in some phases, and generate it in `ai/moves.js` `candidates()` so bots can use
  it. `tools/headless/movestest.js` and `hostsim.js` check that the bots' moves apply identically page vs worker.
- **New evolution type** (not an Amalgamation) — its Rank-Up needs its own input + `moves.js` candidate (as
  `amalgRank` is), and the bots' Δ-deck choice (`randomValidDeltaDeckFor`, which draws from
  `AMALGAMATION_LIBRARY` by class alignment) has to include it. The evaluation's `delta` / `deltaNP` features count
  any card in the Δ Zone already.
- **New game mode** — add it to `ruSoloBotConfig`'s mode list (seats, tiers, turn order); 3-4 seat modes use the
  `order` / `classes` / `mode` match options (see `hostsim.js` `MODE=`).
- **After any change** run: `node tools/headless/dupcheck.js 25` (no card in two places, no empty Rank Zone),
  `parity.js 3 1200` (no-paint mode plays the same game), `hostsim.js 2 basic-1 skilled-1` and with `MODE=1v1v1` /
  `MODE=royale4` (page and bot worker stay in step), `movestest.js`; for an engine refactor that must not change
  any game, `reftrace.js record` before and `check` after. Replay any odd arena game with `replay.js`.

## Progress log

- **2026-10-03** — Diagnosis of the old bot (text-regex scoring, combat-only toy search, mistake dice, bots
  auto-passing prompts in AI-vs-AI, cheapest-first picks in skill prompts, deterministic tournaments, Gauntlet
  D-Candidate round falling back to Basic). Headless engine built: loads in ~125 ms with zero errors; full games
  run through the input layer; deterministic. No-paint mode: parity OK (identical fingerprints), ~4,000
  inputs/s per core. RNG state exposed (`ruRngState` / `ruRngRestore`) — 10 reference games / 25,000
  fingerprints unchanged. Snapshot/restore: 48/48 leak checks identical; ~0.9 ms each.
- **2026-10-03 (later)** — Old-bot baseline, 200 headless AI-vs-AI games per pairing (strong side's share of decided
  games): Dis4 vs Inept 81.8% (target 100), Dis4 vs Dis3 52.0% (85), Dis4 vs Talented1 57.3% (100), Basic vs Inept
  65.1% (95), DC2 vs DC1 55.7% (85). Move generation on the real engine (legal = the engine accepts it; probing never
  disturbs the game, 0/4946). Planner v1: per-first-move beam over whole turns, adversarial answers to the other
  player's mid-turn prompts, hidden info re-dealt per world, N-turn lookahead on top lines, plan kept until the
  visible position deviates. Fixed: null moves (start+cancel) and comparing unfinished turns with finished ones.
- **2026-10-03 (later)** — Game fix found by the bot: switchdraw accepted ANY hand card (only the dialog's buttons
  enforced the rule); doSD now allows only Action Cards, plus Area / Rank³+ on the first turn, judged from the game's
  own state (G._sdFirst), never the input's claim. Planner fixes: attack mode expanded into complete attacks; positions
  reached twice are searched once; switchdraw switches are separate decisions (each reveals a card); planned inputs
  that name a card not actually there drop the plan; adaptive paired world sampling with "don't act on noise";
  lazy position copies (only kept lines are copied); virtual time per engine step capped (a polling Casualty Draw
  step no longer spins minutes of timers). Tools: arena.js (parallel, mirrored deals), selfplay.js + fit.js
  (learned evaluation weights).
- **2026-10-03/04** — Game fix: the rank-zone keeper (moves the top Bank card into an empty Rank Zone) ran on a
  free 120 ms timer — a desync source online — now a render-time rule pass (deterministic checkpoints online, every
  render solo). Headless drops the page's display timers (animations, odometer, button refresh) which had cost ~1/3 of
  search time. Planner: prompt chains skip answers that lead round in a circle (use skill → cancel → same window);
  turn completion plays a real move when advancing is refused (must-attack after an Advantageous card); mid-action
  re-deals keep the opponent's just-played cards. Learned evaluation v1 from 42 self-play games (2,494 positions):
  held-out outcome prediction 77.6% vs 46.5% for the hand-set start. Threat features added (best attack damage each
  way, enemy cards beatable, raw Morale/Casualty/deck margins). Tier table (tiers.js) with the user's N schedule.
- **2026-10-03/04** — Phase-by-phase turn search (the old value-pruned search starved the Battle Phase: bots rarely
  attacked and games ran to deck-out). vs a random mover: 94.6% -> 100% (56/56, fixed effort 4,000); games 24 -> 7
  turns, decided by Morale / Casualties. Game fixes found by bot play: cards duplicating across zones (Subtract,
  'any'-source skills used from Drop/Deadzone, every move helper, Divide/Protect Star costs, Deckstroy), Drawbridge /
  Seven Heaven leaving an empty Rank Zone, stale prompt buttons firing, Stand Down placeholder ids, reaction windows
  reaching only one seat in 3-4 seat games. Live integration: thinking bots play every solo mode in the browser
  (Standard, Tournament, Gauntlet, AI vs AI, 1v1v1, Royale); tournaments draw random tiered fields and settle bot
  matches by the ladder's win rates; the Gauntlet climbs all 14 tiers. Measurements (fixed effort, 56 games each): 4x
  effort 58.5%; N=2 vs N=1 at equal effort 40%; temperature 0 vs 1 49%, 1 vs 3 54.5%, 3 vs 8 60.7% (the strength curve
  is shallow: the evaluation is the bottleneck). Next: a better evaluation from 2,000 self-play games, Δ card values
  from the same games, then tier calibration.
- **2026-10-03 (evening)** — Played full games against Distinguished 1 in the browser. Found and fixed by playing:
  (1) the bot followed the rest of a line chosen in ONE imagined world — knowing that world's hidden cards (it
  attacked an NP 0 Rank into NP 1 because its imagined casualty draws were good); (2) with lookahead, the first world
  could spend the whole budget, so later worlds scored only "end turn" and an attack seen in 1 world beat a pass seen
  in 5 — now candidates are found once and scored in every world (paired) and the bot re-thinks every decision;
  (3) bot inputs skipped the phase rules the human UI enforces (Plus played in the Promotion Phase to unlock bigger
  flanks; flanks in the Promotion Phase; Restorative 3 / Amalgamation at any time) — the input layer now holds every
  input to the table's windows, and bots may also Stand Down / Relieve wherever a player can; (4) `tryFlank` treated
  slot 'rear' as the Right Flank (any class) — the Extension Rear Flank is now its own placement for players and bots;
  (5) Counterstrike's "+2 NP until end of your next turn" was wiped at the end of the turn it was used. Judgment
  noise measured as the strongest strength dial (S0 vs S25 84.3%, S0 vs S60 92.7%); best (old planner, 3,000 evals)
  vs random 97.4% of 266 decided (7 losses, 11 unfinished — now recorded with seeds for replay).
- **2026-10-09** — Noise ladder on the paired planner (N 1, 1,200 per decision, 40 games each): noise 0 > 4 76.9%,
  4 > 8 76.3%, 8 > 14 78.9%, 14 > 22 65.8%, 22 > 35 63.2%, 35 > 55 55.3%, 55 > 90 56.8%, 90 vs random 51.4%; noise 0
  vs random 40-0 — about 5.4 logits from the best play to random (the old planner: ~3.4). Tiers rebuilt on it (evenly
  spaced: ~60/40 adjacent, ~89/11 five apart, ~99.5/0.5 end to end — the user's 85/15-adjacent matrix needs ~22
  logits, which the game's luck does not leave room for). Paired planner vs the previous one at equal settings: 50% (T1),
  48% (D1). Every unfinished arena game investigated (seeds now recorded): game deadlocks fixed — a Casualty Draw on an
  empty Deck froze the draw queue forever; the must-attack rule and the attack declaration disagreed about attack locks;
  the empty-Rank stand-in was treated as a card (endless Stand Down, phantom Discard/Deadzone cards; a Rank Zone left
  empty); the Haste opponent-turn window offered Haste 8 with no usable skill and its dialog a do-nothing button. Bot:
  no empty moves when the search ran out before its root, no do-nothing prompt answers, no prompt circles (use a skill
  -> cancel -> the same window), declining wins ties at prompts too. Cleanup: plan following reduced to the rest of the
  committed action; unused machinery removed.
- **2026-10-09/10** — Finishing pass (baseline for the coming classes, mode and evolution). Bot: the circle rule now
  spans the whole turn (start Restorative 3's skill -> cancel -> the same position, for ever) and an answer that just
  undoes the bot's own decision is not a choice; noise is a misjudgment of the positions judged while LOOKING for
  options plus one per option when CHOOSING (noise on every evaluation averaged away over strong tiers' worlds — D3 vs
  D2 46%); cancel counts as passing in attack mode. Engine: Amalgamation options combined every 3-subset of every slot
  (5-12 ms a call with big hands; bot decisions took minutes late in games) — now only matching Numerals; the
  must-attack rule counted Advantageous cards DROPPED AS A COST (Wildfire) as used, forcing an attack that the bot's
  search could not even see — it now reads the use record; the state fingerprint now includes attacks left, used
  skills, freezes and each side's attack record (a 0-damage attack changed the game but not the fingerprint). Tools:
  one class list read from the engine (CM) — new classes are tested automatically; the arena stops a cycling game.
  Tier ordering (2-3 tiers apart, 24 games): 67% / 65% / 63% / 79% / 88% / 79%, higher tier always ahead. Full suite
  green: parity, leak test, smoke/determinism, move generation, card integrity, page<->worker 1v1 / 1v1v1 / Royale.
- **2026-10-10** — Every class in one set of tables (data.js): Fission/Extension's data, the class icons (RU Classic
  Icons font glyphs in CM; the override list and the duplicate colour tables are gone). Celestial-class added (its block
  `celestial-class` in index.html; hooks `window.celestial*` at resolveAtkL28, ruDeclareAttack, beginPhase, tryPromote,
  ruIsLegalAttackTarget, resolveSafeguard, useRet, applyE2). New general rules it needed, usable by any card: `fromN` on a
  Numeral (must be Ranked Up from Numeral N+; Haste 9 uses it too), an Area's `canEnter`/`enterText` (its condition to be
  sent to the Deadzone), an Action Card's `check` (refused before it is committed), `G._skipStartDraw[seat]`,
  `G._drawToDrop[seat]`, a card-bound `G._durableNP` entry (`id`), and response cards (Safeguard/Retaliatory) by their own
  type instead of a hand-kept name list. Scenario tests for every Celestial rule pass; suite green with Celestial in it.
  AI vs AI watch (a lockstep match): the old watch-mode safety net still auto-clicked every dialog and auto-picked every
  picker on a timer, outside the inputs and with no owner — one seat's Area card landed in the other seat's Deadzone while
  staying in its hand — and the old bot's first-turn switchdraw ran there too; both now apply only to non-lockstep play.
  `hostsim.js` WATCH=1 runs the page<->worker check in that mode (the old behaviour stalls there with runaway timers).
  Then (user's rulings): Advantageous E2 = "Dead Draw"; "defeated in battle" = attacked and did not win (G._battleResult,
  recorded by resolveAtkBase), Rank Zone included; card targets are clicked on the board (any player's zone, the pick
  owned by G._oppZoneOwner — ruModeOwner and both deciders read it); Celestial 9 = promoted from a Rank³. Engine: "another
  attack" grants added to 1 instead of to the attacks LEFT (a card that had attacked got 2 more; 36 places, now
  atkLeft(c)+n); a Retaliatory card counted its Action slot twice (the window and its own commit); custom class glyphs
  past U+E010 (Celestial) were drawn at the small non-glyph emblem size.
- **2026-10-11** — Ochre-class (W-stat; Fullmetal parts wait for the Fullmetal evolution). The shared field rules
  block: removal tracking and "cannot be removed" (prevented at battle / Stand Down / Relieve, and any other way a card
  leaves, the field watch — a render-time engine pass — puts it back; Ochre 0 also cannot leave the Bank), attack bans,
  MP shields, the W-stat, the class hook lists and the shared effect helpers; Celestial moved onto them. An open card
  pick on the board now holds the flow like a dialog (ruPromptPending).
- **2026-10-12** — Kismet-class, on a new part of the field rules: Action Card activations. Every activation (hand or
  Deadzone effect) is a record from commit to end; what it did — NP/RP changes, removals (with their cause), cards
  taken out of a Deadzone, board-pick targets, the Casualty Draws it caused — is observed for any card, and other cards
  answer it in a response window (seat by seat). Negation rewinds the game in place (every object keeps its identity,
  so a flow that goes on afterwards — an attack, the Casualty Draws in line — goes on with the same cards); the bot
  worker rebuilds it by replay like any mid-action position. Activation locks; `phaseEnded` / `defend` / `entered`
  hooks; Area Activations (`ADEFS.onEnter`); W/M/S cards show W in A's place. Engine fixes found on the way: Cancel at
  an Action Card's first pick gave nothing back (slot and M now return); an old bot guard step counted as the card's
  effect; the settle system numbers its continuations so an activation ends after everything its flow registered.
- **2026-10-13** — Temporal-class, on a new TIME part of the field rules: the history of every turn's start (card
  positions, MP, Casualty Counts), the battle log (a past Battle Phase re-fought with changed NP/RP, the difference
  applied now), effects set for later points, held / blocked Casualty Draws, A-becomes-W overrides, every Numeral-skill
  negation through one point (Shining Justice, Seven Heaven, Shadow 6), a `targeted` window before the Safeguards, a
  second Battle Phase (`phaseRedirect`), Area Cards that leave a Deadzone (`ADEFS.onLeave`), an Action Card's effect put
  off to the next turn and replayed. The step runner's "without paying its cost" now skips every cost (it skipped a
  partial list; a Deadzone-drop cost was still paid), and "the end of the phase" is a real point (`phaseEnded`, before
  the next phase resets anything).
  Then (user rulings): "A becomes W" turns the A stat into a W stat of the same value (it had taken the card's own W —
  0 for most cards); the cards Temporal 1 drew return from wherever they went (`ruFindCard` finds a card anywhere,
  Evolution Elements included). Found by random games: a rewind that put back a Casualty Draw waiting when the rewound
  effect began left it in a line nothing was drawing — the game never settled, so the bots could not think; the line now
  resumes (`ruCasQueueResume`). Skills that happen on their own are declared (`ruTriggeredSkills`) so pressing them says
  so instead of "no implementation yet".
  Also from random games: a phase that begins again (Retroactive Star's second Battle Phase) looked like no change at all
  to the state fingerprint, so the move finder took "end turn" for a no-op and a bot could never end that turn — every
  phase that begins now counts (`G._phaseSeq` in `stateSig`).
  And: a skill or Action Card whose cost cannot be paid (7th 7 — Surge with a hand worth NP 12 of the 14 it drops)
  started anyway, opened a picker nobody could finish and froze the game. Every cost is now checked before anything
  is activated (`ruCostUnpayable`: hand / Bank / Drop / Deadzone counts, NP totals, fixed minimums worked out as the
  activating player); one that cannot be paid does not start.
  Then (user ruling: Temporal 1's return wins "in any other circumstance, unless negated"; a card that cannot be removed
  stays): skills that happen on their own were outside every skill rule — no "cannot use Numeral skills" lock, no
  Shining Justice / Seven Heaven negation, no Shadow 6 — and several pressed skills paid their cost inside the effect
  step, so Shadow 6 answered before the cost and a free use could not skip it. One point now: `ruSkillLocked` /
  `ruSkillArmed` (used by `startSkillL4` and by `ruUseSkill` / `ruOfferSkill` for the triggered ones), costs as cost
  steps (`{type:'async'}` in the step runner, `activation:true` for targets and marks), Shadow 6 once per skill at the
  first step past the activation steps. Kismet 1 / 3 / 9's answers rewind an Action Card, so Shadow 6 answers them
  first and their cost is paid in the rewound position. Found on the way: the random-Bank cost had four copies in
  the step runner's wrappers (one asked the player to choose — the cards say random) and none kept Ochre 0 in the
  Bank; one copy remains.
