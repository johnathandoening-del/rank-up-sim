# Rank Up! — Full Stacked Audit (Game Report)

**Files audited:** `index.html` (23,231 lines / 1.4 MB), `data.js` (315 lines), `styles.css` (303 lines)
**Audit type:** Read-only. No code was changed. Every finding below was verified against the live file (Node `--check` for parse errors, a headless load of the page for runtime state, and structural bracket counting for the fatal bug).

**Ground rule honored throughout:** every "Solution" below is a **removal or a rewrite of existing bad code**. Not one solution adds a new override, wrapper, guard, watchdog, shim, or `ru###`-style script. See the *No-Patch Compliance Check* at the bottom, where every solution is re-verified against that rule.

---

## Executive summary

The single most important fact: **the game does not run at all right now.** A one-character-class mistake on `index.html:749` leaves a function call with an unbalanced `(` and `{`. Because a syntax error voids an entire `<script>` block, the whole 12,500-line engine block (lines 125–12621) is discarded by the browser. I confirmed at runtime that `startGame`, `initGame`, `G`, `el`, `log`, and every other engine symbol are `undefined`; only `data.js` (a separate file) loads. Clicking "Start" does nothing.

Everything else in this report is the *reason that one broken line was so easy to introduce and so catastrophic*: the codebase is built as a tower of ~52 stacked override scripts (`ru136`…`ru174` plus versioned `L1…L35` wrap-chains) layered on top of a base engine that no longer owns its own final behavior. That structure is the actual disease. The line-749 break is one symptom; the 2-player-vs-3-player targeting gaps and the timer-based "don't-freeze" band-aids are others.

Findings are ordered most-severe first.

---

## SEVERITY 0 — The game is completely non-functional

### Issue 1) Fatal syntax error on `index.html:749` kills the entire engine script; nothing loads

The `Protect` Action-Card "E2" handler opens `window.cChoose(who, p.hand, …, function(pk){ … })` and, inside it, a second nested `window.cChoose(…, function(pk2){ … })`. The **inner** call and its callback are closed correctly, but the **outer** callback `function(pk){` and the **outer** `cChoose(` call are never closed. The line ends `…,'heal');}});}` when it needs `…,'heal');}});});}`.

**Verification (not a guess):**
- Structural bracket count of line 749 alone = **net +1 `(` and +1 `{`**. Its sibling lines 746, 747, 748, 750 all balance to net 0.
- Node `--check` on the extracted engine block reports `SyntaxError: missing ) after argument list` at that line.
- Live page probe: `typeof startGame`, `typeof initGame`, `typeof el`, `typeof G` all return `undefined`; `typeof CM` / `typeof AC` (from `data.js`) return `object`. So `data.js` loaded and the inline engine block did not.
- I made a throwaway balanced copy (in a scratch dir, not the real file): inserting the missing `)}` makes the **entire** 125–12621 block parse clean. I then syntax-checked all 53 inline `<script>` blocks: **only this one fails.**

Cause) A manual edit to the `Protect` E2 handler added the nested second `cChoose` (the "choose 1 Deadzone card to Drop" step) and dropped the outer callback's closing `})`. Because the engine is one giant inline `<script>`, a single dropped bracket anywhere silently deletes the whole engine at parse time — the browser reports at most a downstream `ReferenceError` (here, `startGame is not defined` from the un-guarded single-elim bracket block at line 14087), which hides the true cause.

Solution) **Rewrite line 749 so its brackets balance** — close the outer callback and outer `cChoose` call before the `else if` block's closing brace, exactly matching the shape of the already-correct single-`cChoose` siblings (e.g. line 746 `Reveal`). No new code is added; the existing malformed statement is rewritten to net-zero brackets. This is the correct fix specifically because the balanced-copy test proved this one line is the *sole* parse error in the engine — repairing it restores the entire engine in one edit, with nothing else touched. (A structural follow-up that would prevent a recurrence — splitting the engine out of one monolithic inline block — is Issue 19.)

---

## SEVERITY 1 — Architecture: the patch tower (the "bad code" you're sensing)

### Issue 2) The engine's real behavior is defined by ~52 stacked override scripts, not by the base functions

`index.html` contains 37 `<script id="ru###-…-fix">` blocks plus ~15 other trailing override blocks. They don't *edit* the base engine — they run after it and reassign globals on top of it: `window.endPhase`, `window.renderAll`, `window.openPicker`, `window._ruCombatPlan`, `resolveAtk`, etc. To know what any given function actually does, you must read the base definition and then every later block that reassigns it, in load order.

Cause) Behavior was changed over time by appending a new script that overwrites the previous version rather than editing the original. Each fix is additive, so the file only grows and the "current" behavior of any symbol is whatever the last block to touch it left behind.

Solution) **Collapse each overridden symbol back into a single canonical definition and delete the override blocks.** For every function that is reassigned by a `ru###` block, fold that block's logic into the one base definition and remove the block. This is pure removal/rewrite — the end state is one authoritative `endPhase`, one `renderAll`, one `resolveAtk`, with the 52 stacked blocks gone. It is the right fix specifically because the tower is *why* Issue 1 was invisible and *why* the 2→3-player work (Issues 7–14) is scattered and half-done: there is no single place that owns each behavior.

### Issue 3) Versioned wrap-chains nest a single function dozens of layers deep

- `beginPhase`: `beginPhaseBase` → `beginPhaseL1` → … → `beginPhaseL35` (35 chained layers, each calling the previous).
- `startGame`: `startGameBase` → `startGameL1` → … → `startGameL6`.
- `aiDo`: `aiDoBase` → `aiDoL1` → … → `aiDoL5`, plus `_aiBase`.
- `resolveAtk` wraps `resolveAtkL27`.

Each layer is `var prev = fn; fn = function(){ …; prev(); }`. `endPhase` alone is wrapped 4 separate times (lines 19787, 20211, 21159, 21710).

Cause) Same additive-edit habit as Issue 2, applied to the phase/turn/AI spine. Every feature increment added another `L{n}` wrapper instead of modifying the phase handler.

Solution) **Flatten each wrap-chain into one function and delete the intermediate `L{n}` layers.** Merge the bodies of `beginPhaseBase…L35` into a single `beginPhase`, `startGameBase…L6` into one `startGame`, `aiDoBase…L5`/`_aiBase` into one `aiDo`, then remove the now-unused wrappers. Rewrite + removal only. Chosen because a 35-deep call stack for one phase transition is both unreadable and a latent performance/stack-safety problem, and the depth serves no purpose once the layers are merged.

### Issue 4) `window._ruCombatPlan` is defined twice; the first full definition is dead code

`window._ruCombatPlan` is assigned a complete implementation at line 22086 ("BOUNDED COMBAT MINIMAX v13.6.0", ~90 lines) and then **reassigned** a second complete implementation at line 22584 ("recursive depth-N planner"). The second wins at load; the first block never runs.

Cause) A newer planner was written as a new top-level assignment instead of replacing the old one, leaving both in the file.

Solution) **Delete the dead first definition (the v13.6.0 block at 22086).** Removal only. Correct because it is provably unreachable — the later top-level assignment overwrites it unconditionally at load — so removing it changes nothing at runtime while eliminating ~90 lines of misleading code that reads as if it were the AI's combat brain.

### Issue 5) ~756 `window.*` globals with no module boundaries

`grep` counts 756 `window.X =` assignments. State, helpers, UI, AI, and mode logic all share one flat global namespace, which is what makes silent reassignment (Issues 2–4) and ID/name collisions (Issue 18) possible without any error.

Cause) No module system; the whole program is inline `<script>` blocks that communicate only through `window`.

Solution) **Rewrite the engine into scoped modules (or at least a small number of namespaced objects) and remove the flat `window.*` surface.** Existing functions move into modules with explicit exports; the hundreds of bare globals are deleted. Removal/reorganization of existing code, no new behavior. This is the fix specifically because a flat 756-symbol global space is the structural precondition for "a later line silently redefines an earlier one," which is the root enabler of Issues 2, 3, 4, and 18.

### Issue 6) Core helpers are re-implemented 10–34 times, once per patch closure

Because each `ru###` block is its own IIFE with no access to the engine's scope, it re-declares the helpers it needs. Counts: `safeLog` ×34, `side` ×32, `np` ×30, `other` ×25 (`renderSafe`), `oppOf`/`opp` ~24, `rp` ×23, `moveTo` ×22, `isNum` ×20, and dozens more. These copies drift: some `np()` read `currentNP`, others read `numeral`; some `oppOf` are 2-player-hardcoded, others delegate (Issue 7).

Cause) The patch-tower structure forces every block to carry its own private copy of the utility belt.

Solution) **Define each helper once in the engine and delete every duplicate copy from the override blocks.** As the `ru###` blocks are folded in (Issue 2), their private `np`/`side`/`oppOf`/etc. re-declarations are removed and the calls resolve to the single canonical helper. Removal only. Right fix because duplicated helpers that silently disagree (e.g. two `np()` reading different fields) are a class of correctness bug that cannot be fixed by editing "the" helper — there isn't one — until the copies are removed.

---

## SEVERITY 1 — 2-player logic never fully generalized to 1v1v1 (3-way)

> Context: turn *rotation* was already generalized (`endTurnCore`, `index.html:3027`, rotates `G.sideOrder` and skips eliminated seats correctly). What was **not** generalized is *targeting* — the notion of "the opponent." In a 3-way match there are two opponents, and most of the engine still assumes exactly one.

### Issue 7) `window.oppOf` is never defined, so every "opponent" lookup silently collapses to 2-player

Many helpers are written defensively as `function oppOf(w){ return window.oppOf ? window.oppOf(w) : (w==='player'?'ai':'player'); }` (lines 9109, 10029, 10472, 11084, …). But **`window.oppOf` is never assigned anywhere in the file.** So every one of these *always* takes the fallback branch. Consequences in 3-way mode: `oppOf('player') → 'ai'` (never `'ai2'`), `oppOf('ai2') → 'player'`. The `ai2` seat is invisible to all opponent-directed effects.

Cause) The intended central resolver (`window.oppOf`) was planned — the delegating call sites were written to use it — but it was never implemented, leaving 2-player fallbacks live everywhere.

Solution) **Rewrite the opponent helpers into one canonical, `sideOrder`-aware resolver and delete the scattered 2-player copies.** There is already a correct local implementation to promote: `index.html:8142` computes the next non-eliminated seat from `G.sideOrder`, and `index.html:8151` returns *all* other seats. Make those the single source of truth, remove the ~24 private `oppOf`/`opp` re-declarations, and drop the dead `window.oppOf ? … : …` ternaries down to a plain call. Removal + rewrite. This is the specific fix because the bug isn't "oppOf returns the wrong value" — it's "the real oppOf was never wired in," so the cure is to delete the fakes and expose the real one, not to add anything.

### Issue 8) `other(who)` is hardcoded 2-player and used in ~104 places

`function other(who){ return who==='player'?'ai':'player'; }` (line 4660) is the most-used opponent helper (≈104 call sites). In 3-way it returns `'player'` for both `'ai'` and `'ai2'`, and never returns `'ai2'` at all.

Cause) Written for the original 1v1 engine and never revisited when the third seat was added.

Solution) **Rewrite `other()` to resolve against `G.sideOrder` (single canonical helper from Issue 7) and remove the hardcoded body.** Each of the 104 call sites is then re-examined: those that mean "the single defending seat of the current attack" pass that seat explicitly; those that mean "all other seats" call the plural helper. Rewrite of one function plus targeted correction of its callers — no wrapper added. Correct because a 2-value function fundamentally cannot express "which of two opponents," so the function itself must be replaced, not shimmed.

### Issue 9) There is no "all opponents" helper at all, so table-wide effects hit only one seat

Searches for any plural opponent helper (`opponentsOf`, `others`, `otherSides`, `activeSides`, …) return nothing. Card and Area text that says "all other players" / "opponents lose MP" is implemented with singular `oppOf`/`other`, so in 3-way it applies to one seat only. (Where authors hand-rolled `G.sideOrder.forEach`, e.g. The Lowlands at line 9148, it works — but that pattern is inconsistent and easy to forget, which is exactly how the singular-only effects slipped through.)

Cause) The data model ("the opponent" is one value) predates multi-opponent effects; no plural primitive was ever introduced, so authors reached for the singular one.

Solution) **Promote the existing correct plural helper (`index.html:8151`, "all seats except `w`") to a single engine-level function and rewrite every "all other players" effect to iterate it; remove the singular calls in those effects.** No new subsystem — one already-written helper is exposed and the mis-written call sites are corrected. Chosen because the correct primitive already exists locally; the work is deleting the wrong calls and routing through the right one.

### Issue 10) Reactive Safeguard/Divide/Retaliation defenses only fire for player→AI attacks

`resolveAtk` (line 4200) computes `var relevant = (dWho==='ai' && aWho==='player')` and only runs the AI's reactive Safeguard check, Protect-flank application, Divide, and retaliation when that is true. So: an attack **on `ai2`** triggers no reactive defense; an attack **by `ai` on `ai2`** (or vice-versa) triggers none; and in AI-vs-AI watch mode reactive Safeguards never fire.

Cause) The reactive-defense layer was written for the one direction that mattered in 1v1 (human attacks AI) and never generalized to arbitrary attacker/defender pairs.

Solution) **Rewrite the `relevant` gate to key off the *defender's controller* rather than the literal pair `('ai','player')`.** The reactive block should run whenever the defending seat is AI-controlled (any AI seat) and be reachable for AI-vs-AI. This is an edit to the existing condition and the existing reactive block, not a new handler. Correct because the current condition encodes a 2-player assumption directly in a boolean; only rewriting that boolean (and the `G.ai`-specific reads beneath it) restores symmetry.

### Issue 11) `ai` and `ai2` are driven by two different AI engines

`aiDo` (line 4220) routes any bot turn that isn't `'ai'` to `window.ru135RunBotSide`, while `'ai'` continues through the sophisticated legacy `_aiBase`/`aiDo L1–L5` chain. The in-code comment admits it: the legacy chain "is hardcoded to literally `G.ai`/`G.turn==='ai'` throughout … A 3rd seat can't run through it safely." So in a 1v1v1 match the two AI opponents think with different brains and play at different strengths.

Cause) The strong legacy AI was too entangled with `G.ai` to reuse for a third seat, so a separate, simpler bot driver was used for `ai2` instead of generalizing the original.

Solution) **Rewrite the legacy `_aiBase`/`aiDo` chain to be seat-parameterized (operate on a passed `who`, not literal `G.ai`) and delete the second `ru135RunBotSide` code path**, so all AI seats share one engine. This is the seat-generalization the comment says was skipped, done by editing the existing AI to take a seat argument and removing the duplicate driver — no third code path added. Correct because "two AIs of different strength at the same table" is a fairness/consistency defect that only disappears when both seats run the same generalized code.

### Issue 12) Per-turn resets touch `G.player` and `G.ai` but skip `G.ai2`

Example: `beginPhaseL4` (line 2440) clears `_flanksSafeThisTurn` on `G.player` and `G.ai` only. Similar `if(G.player)…if(G.ai)…` pairs recur. In 3-way, `ai2`'s per-turn flags are never reset, so state (e.g. "flanks safe this turn") leaks across turns for that seat.

Cause) Reset code was written as an explicit two-seat list before `ai2` existed.

Solution) **Rewrite these explicit two-seat resets to iterate `G.sideOrder`** (the same list the rest of `endTurnCore` already uses). Each `G.player`/`G.ai` pair becomes one loop over all seats; the hardcoded pair is removed. Rewrite only. Correct because the values themselves are fine — only the *set of seats* they're applied to is wrong, and that set must come from `sideOrder`.

### Issue 13) `AREA_VIS_STATE` is initialized as a 2-seat literal

`let AREA_VIS_STATE = {player:'', ai:''};` (line 4822). `ai2` is absent. It happens to self-heal (`AREA_VIS_STATE[who]||''` then assign), but the initializer still encodes the 2-player assumption and is a trap for anyone reading it as the authoritative seat list.

Cause) Declared before the third seat existed.

Solution) **Rewrite the declaration to build from `G.sideOrder`** (or an empty object populated per-seat), removing the hardcoded `{player, ai}` shape. Rewrite only, and it aligns this state object with the seat model used everywhere else.

### Issue 14) `initGame` and `initTutorialGame` are two hand-maintained copies of the `G` state literal that have already drifted

`initGame` builds `G` with `eliminated:{}, _lastWinResult:null, sideOrder` (line 431). `initTutorialGame` builds its own `G` literal (line 8262) with a hardcoded `sideOrder:['player','ai']` and **without** `eliminated` or `_lastWinResult`. Any field added to one is silently missing from the other.

Cause) Tutorial mode copy-pasted the state literal instead of calling a shared constructor, and the two copies were edited independently.

Solution) **Extract one `makeGameState(seats, opts)` from the existing literal and rewrite both `initGame` and `initTutorialGame` to call it; delete the second literal.** This is deduplication by removal — the tutorial's divergent inline object is deleted and replaced with a call to the shared builder. Correct because two independently-edited copies of the same structure *will* keep drifting; the only durable fix is to have one.

---

## SEVERITY 2 — Reliability band-aids masking underlying instability

### Issue 15) A polling watchdog force-advances the AI's Battle Phase when it hangs

`ru166-ai-battle-watchdog` (line 21750) runs `setInterval(pulse, 1200)` and, if the AI's battle phase shows no state change for 7 seconds with no open prompt, force-calls `beginPhase('end')`. This is a timer papering over a real defect: the AI battle phase can deadlock. It also only monitors `G.ai`/`G.player` and only fires for `G.turn==='ai'`, so an `ai2` stall in 3-way is not caught, and force-skipping to End Phase can drop a legitimate pending attack.

Cause) The AI battle phase has code paths that can stall (a choice that never resolves because it assumed a human clicker, or a missing `ai2` route). Rather than eliminate the stalls, a wall-clock watchdog was added to unstick them.

Solution) **Fix the stalls at their source (Issues 10, 11, and the AI-vs-AI human-prompt assumptions in Issue 16), then delete the watchdog.** The watchdog is treated as a symptom marker, not a fixture: once the battle phase can't deadlock, the `setInterval` and its block are removed. Removal only, and it is the correct end state because a 7-second timer that skips real gameplay is itself a bug (it can discard a valid attack) — it must not survive as the "fix."

### Issue 16) Multiple overlapping stall-recovery timers, plus a self-described "safety net" over unknown hang spots

Beyond Issue 15 there is: a 5,200 ms timeout in `aiDoL1` (line 4276) that calls `ruSafeAdvanceAI`; `ruSafeAdvanceAI` itself (line 10391); and `ru167-aivsai-modal-safety-net` (line 22673) whose own comment says it exists because "many individual card/skill interactions … were written assuming a human is present to click … Rather than rely on having found and patched every such spot individually, this installs one final safety net." (That block is even a near-stub — it sets a flag and defines an unused local `np`; the actual auto-resolve override lives in yet another block.) These timers can also race each other (watchdog at 7 s vs `aiDo` timeout at 5.2 s).

Cause) The engine assumes a human clicker in many card/skill flows; AI-vs-AI and the AI seats break that assumption in an unknown number of places, so several timers were layered on to force progress instead of removing the human-only assumption.

Solution) **Rewrite the shared choice primitives (`cChoose`, `openPicker`, skill/target prompts) so an AI-controlled seat resolves a choice programmatically inline, and delete all the recovery timers and the safety-net blocks.** The fix is at the decision point, not on a timer: when the acting seat has no human, the primitive returns an AI-made choice directly, so nothing can hang and nothing needs rescuing. Then `aiDoL1`'s timeout, `ru166`, `ru167`, and `ruSafeAdvanceAI` are removed. Removal + rewrite of existing primitives; no new timer or net. Correct because racing wall-clock timers are non-deterministic and can fire mid-legitimate-animation — the only robust fix is that AI choices never block in the first place.

### Issue 17) Heavy reliance on `setTimeout`/`setInterval` for control flow (114 + 7 sites)

The turn/phase/AI/animation flow is sequenced largely by `setTimeout` (114 uses) and `setInterval` (7 uses) with magic delays (300, 650, 680, 1150, 5200, 7000 ms…). Correctness depends on these delays out-racing each other, which is inherently fragile across machines and when the tab is backgrounded.

Cause) Asynchronous UI steps (AI "thinking" pause, modal open, animation) were chained by guessing a delay rather than by completion callbacks/promises.

Solution) **Rewrite time-ordered sequences to be event/promise-driven and delete the magic-number delays** used purely for ordering (keep only genuine cosmetic pauses, and make those not affect correctness). Existing `setTimeout` chains are replaced with "run next step when the previous step actually finished." Rewrite/removal of existing timing code. Correct because delay-based ordering is the substrate that produced the timer races in Issue 16; converting to completion signals removes the race rather than tuning the numbers.

---

## SEVERITY 2 — HTML / DOM structure

### Issue 18) Duplicate element IDs

`id="ai-level-select"` and `id="ai-sublevel-select"` (and its wrapper) appear in two different UI panels — the title-screen picker (lines 253–254) and another proficiency panel (lines 10441–10444). `id="hcount"`/`id="phase-hint"` appear in the static hand label (line 106) and in two `renderHand` template strings (5095, 5101). Duplicate IDs are invalid HTML; `getElementById` returns only the first match, so if both panels are ever in the DOM together, the proficiency `onchange` handlers read/update the wrong control.

Cause) UI markup was duplicated across panels/templates with the IDs copied verbatim.

Solution) **Rewrite the duplicated markup to use unique IDs (or class + scoped lookup) and remove the collisions.** For `hcount`/`phase-hint`, have `renderHand` update the existing single element instead of re-emitting new markup that reuses the ID. Removal of the duplicate IDs, no added element. Correct because `getElementById` collisions are silent and position-dependent — only making the IDs unique removes the ambiguity.

### Issue 19) The engine and all 52 patch blocks live in one 1.4 MB HTML file, inline

The entire program (except `data.js`) is inline `<script>` in `index.html` — one 12.5k-line engine block followed by ~52 override blocks. This is what makes a single dropped bracket (Issue 1) able to delete the whole engine, and what makes the tower (Issue 2) accumulate.

Cause) Organic growth with no build step or file separation; every change appended more inline script.

Solution) **Extract the engine (and, after Issue 2's consolidation, the remaining logic) into separate `.js` files referenced with `<script src>`, and remove the giant inline block.** Splitting is pure relocation of existing code. It also localizes syntax errors — a broken file fails alone instead of taking the engine with it. Correct as the structural counterpart to Issue 1: it doesn't change behavior, it removes the "one bracket kills everything" failure mode.

---

## SEVERITY 3 — Data / content (`data.js`)

### Issue 20) Typo in Astute Numeral 5 skill text

Line 218: `'Look at the top 5 cards of target opponent's Deck. Drop 2 and place the rest **beck** in any order.'` — "beck" should be "back". Player-facing card text.

Cause) Typo.

Solution) **Rewrite the string, correcting `beck` → `back`.** Trivial text rewrite of existing data. Correct because it's a literal spelling error in visible card text.

### Issue 21) `fission` and `extension` classes have a split, partly-runtime source of truth

`CLASS_COLORS` (data.js:23) and `styles.css` (`.t-fission`, `.nc-extension`, etc.) define `fission`/`extension`, but `CM`, `ND`, `CLASS_STATS`, and `DECK_AC` in `data.js` do **not**. Those two classes are instead injected into `CM` at runtime inside the engine block (`CM.fission = …`, `CM.extension = …` at lines 9272–9273) and fleshed out by `ru147`/`ru161`. So a class's identity is spread across static data + a runtime mutation + two override scripts — and because that injection lives in the currently-dead engine block (Issue 1), these classes don't exist at all until Issue 1 is fixed.

Cause) The two newest classes were added via the patch tower (runtime `CM` mutation + `ru###` blocks) instead of being added to the static `data.js` tables like every other class.

Solution) **Move the full `fission`/`extension` definitions into the static `data.js` tables (`CM`, `ND`, `CLASS_STATS`, `DECK_AC`) alongside every other class, and delete the runtime `CM.fission`/`CM.extension` injection and the class-defining portions of `ru147`/`ru161`.** This makes all classes defined the same single way (static data) and removes the runtime mutation. Removal + relocation of existing definitions, no new mechanism. Correct because a class whose data is assembled from four places at load time is unmaintainable and, as shown, can vanish entirely when one unrelated block breaks.

---

## No-Patch Compliance Check (force-verified)

Every solution above was re-read against the rule "removal or rewrite only — never add a patch." Result per issue:

| # | Solution reduces to | Patch added? |
|---|---|---|
| 1 | Rewrite one malformed line to balance its brackets | No |
| 2 | Fold override blocks into base defs; delete the blocks | No — removal |
| 3 | Flatten wrap-chains into one function; delete `L{n}` layers | No — removal |
| 4 | Delete the dead duplicate `_ruCombatPlan` | No — removal |
| 5 | Reorganize globals into modules; delete flat `window.*` | No — removal/rewrite |
| 6 | Delete duplicated helpers; keep one canonical each | No — removal |
| 7 | Expose the real `sideOrder` resolver; delete 2-player copies | No — removal/rewrite |
| 8 | Rewrite `other()` off `sideOrder`; delete hardcode | No — rewrite |
| 9 | Promote existing plural helper; delete singular calls | No — removal |
| 10 | Rewrite the `relevant` boolean and its block | No — rewrite |
| 11 | Seat-parameterize existing AI; delete duplicate driver | No — removal/rewrite |
| 12 | Rewrite two-seat resets to loop `sideOrder` | No — rewrite |
| 13 | Rewrite `AREA_VIS_STATE` init off `sideOrder` | No — rewrite |
| 14 | Extract one state builder; delete the duplicate literal | No — removal |
| 15 | Fix stalls at source; delete the watchdog | No — removal |
| 16 | Rewrite choice primitives; delete all recovery timers/nets | No — removal/rewrite |
| 17 | Rewrite timing to completion-driven; delete magic delays | No — removal/rewrite |
| 18 | Rewrite markup to unique IDs; delete collisions | No — removal |
| 19 | Relocate inline engine to files; delete the inline block | No — removal |
| 20 | Rewrite the typo string | No — rewrite |
| 21 | Move class defs into static data; delete runtime injection | No — removal/rewrite |

**Confirmed: none of the 21 solutions add a patch, wrapper, guard, watchdog, shim, or `ru###`-style override. Every one removes or rewrites existing code.** In fact the through-line of the whole report is the opposite of patching — the recommended direction is to *dismantle* the existing patch tower back into canonical, single-owner code.

---

## Recommended order of work

1. **Issue 1** first and alone — it is the difference between a running and a non-running game, and it's a one-line rewrite.
2. Then the 3-way targeting cluster (**7 → 8 → 9 → 10 → 11 → 12 → 13 → 14**), because those are the incomplete conversion and depend on one shared `sideOrder` opponent resolver.
3. Then the reliability cluster (**15 → 16 → 17**), which becomes deletable once the AI-choice and targeting fixes remove the stalls the timers were masking.
4. The architectural consolidation (**2 → 3 → 4 → 5 → 6 → 19**) is the largest effort and is best done incrementally as each subsystem above is touched — every consolidation deletes patch-tower blocks rather than adding to them.
5. Data fixes (**20, 21**) and DOM IDs (**18**) can be done anytime.
