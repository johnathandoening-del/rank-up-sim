# Rank Up! — Behavior & 1v1v1 Audit (Report 2)

**Scope:** an audit (no fixes) of the specific behaviors you listed, plus related issues found while checking them. Each item is marked **CONFIRMED** (reproduced), **NOT REPRODUCED** (checked, works correctly), or **NUANCED** (partly true / by-design / needs tuning). Evidence is code `file:line` + runtime probes (I loaded the game and drove it directly).

**Method note:** runtime checks were done in a served copy of the live `index.html`, driving real functions (`startGame`, `skillEntries`, `tryPromote`, `oppOf`/`oppList`, `syncAreaVisuals`, etc.) and inspecting state — not by reading code alone.

---

## ✅ FIXES APPLIED (this pass — remove/replace only, no patches)

Every confirmed/actionable item below was fixed by **rewriting the wrong code**, then verified at runtime (I drove the real functions in a served copy across the relevant modes and AI engines). All 50 inline `<script>` blocks still parse; an AI-vs-AI match runs clean (no console errors) through combat/promotion/casualties.

| # | Fix | Where (index.html) | Runtime verification |
|---|-----|--------------------|----------------------|
| 1 / 10 | **AI2 particles + number-roll FX now cover ai2.** The hardcoded 2-seat `zones`/`tracked()` lists were rewritten to build from `G.sideOrder` + `sideMeta`/`sideZoneId`. Also fixed a latent bug: the scanner used `window.G` (always `undefined` — G is a lexical global), so it silently fell back to 2 seats; switched to a `typeof G` guard (also fixed `deadCount` and `clsColorOf`). | `deadCount`/particle scanner (~22075–22146); odometer `tracked()` (~22207) | In a 1v1v1 game, a card injected into `ai2-field` gets tagged `ru-field-in` by the live scanner; replicated `tracked()`/`buildZones` yield `ai2-field`/`ai2-mp`/`ai2-delta`. |
| 2 | **Fission split never gives a non-Extension side a Rear Flank.** `splitToBattlefield` only uses `rear-flank` when the side is Extension; a non-Extension side's overflow Numeral goes to the **Bank**. | `splitToBattlefield` (~15576) | Fission side splitting from a flank → `rearFlank:null`, overflow in Bank; Extension side → rear flank populated, Bank empty. |
| 3 / 3b | **Field-source skills can no longer be used from Hand.** Fission 9's `check` now validates the zone (like Phantom 1). Same latent bug fixed in **Fission 2, Phantom 4, Maximum 0** (all `source:'field'` with a `check` that ignored the zone, so `sourceOK` — which defers entirely to `check` — bypassed the source rule). | Fission 9 (~15602), Fission 2 (~15353), Phantom 4 (~18498), Maximum 0 (~19969) | `check(...,'hand')` → false for all four; `check(...,'rank'/'left-flank'/…)` → passes the zone gate. |
| 4 | **Chief Flank rank cap enforced for chiefs too** (a flank can never exceed the Rank Zone's Rank — a Rank² Rank Zone can't Chief a Rank³). Fixed in the player path (`doRelieve`, removed the `!isChief` exemption) **and both AI engines** (`_aiBase` legacy, `botRally` ru135). | `doRelieve` (~3182), `_aiBase` (~4255), `botRally` (~13107) | Both engines: Rank² Rank Zone → chief **blocked**; Rank³ Rank Zone → chief **works** (with a botRally probe proving the pass ran). |
| 5 | **AI can place a card on top of Fission 0.** The immunity guard's fragile "block unless phase==='promotion'" was rewritten to "block only during main/standby/battle" (the only phases skills/Action Cards run) — so promotion works whether it fires in `promotion` OR `rally`, while real removals are still blocked. (Confirmed the "redundant promotions" was an audit artifact — the live `aiDo` chain fires exactly one promotion.) | `guardRankZone` (~22958) | Immunity holds during battle; `_aiBase` **and** `ru135 botPromote` both promote onto Fission 0 during `rally`; real `aiDo('promotion')` = 1 promotion, no double. |
| 6 | **AI stops considering skills it can't pay for.** Added `skillAffordable` (mirrors the existing `actionAffordable`) and wired it into both AI skill passes (`aiUseSkillsForPhase`, `ruSmartSkillPass`). Deliberately conservative (skips optional steps, count-only, unknown steps free) so it never wrongly excludes a usable skill. | `skillAffordable` (~10812), `aiUseSkillsForPhase` (~10993), `ruSmartSkillPass` (~13094) | Inferno 9 (1 hand + 2 bank) and Blizzard 9 (3 mill + 2 hand + 1 bank) return affordable/unaffordable correctly across resource combos. |
| 9 | **Class name in the header updates on class switch.** Removed the cache-once `data-base-label`; the base label is now derived from the current text each render (stripping any ` — ELIMINATED` suffix). | `updEliminatedVisuals` (~4817) | Stale cache + new class text → header shows the new class; eliminate/restore toggles the suffix correctly. |
| 11 | **1v1v1 "target an opponent" lets you pick which opponent.** `oppOf` now honors the in-flight `SF.ctx._targetOppSide` (so direct `other()` calls inside effect fns respect the pick too, not just runStep's `opp` param) — tied to `SF`'s lifecycle so it auto-clears with no turn-order leak. Extended the existing skill opponent-chooser to Action Cards (`RU_ACTION_CHOOSE`: Reveal, Spy, Studious Star, Neo Battle Star) via `playActionBase`. | `oppOf` (~343), `RU_ACTION_CHOOSE`/resolver (~3446), `playActionBase` (~6573) | `oppOf`/`other` honor a chosen `ai2` and ignore cross-actor/cleared state; Reveal opens a **both-opponents** modal; choosing "AI 2" sets the target so the effect resolves onto `ai2`. |

**Not fixed (by design — not defects):** #7 (difficulty ladder exists and is per-seat) and #8 (negamax planner + per-class weighting exist) were **NOT REPRODUCED** — they're tuning/perception, not bugs, so there was nothing to remove/replace.

---

## Summary table

| # | Your claim | Verdict |
|---|---|---|
| 1 | AI2 cards missing particles/animations in 1v1v1 | **CONFIRMED** |
| 2 | AI gets a Rear Flank without being Extension-class | **CONFIRMED (AI-side re-audit)** — via Fission 9 split |
| 3 | Fission 9 usable from Hand (not Field) | **CONFIRMED (player + AI)** |
| 4 | AI Chief-Flanks a Rank³ with only a Rank² Rank Zone | **CONFIRMED (AI-side re-audit)** |
| 5 | AI can't place a card on top of Fission 0 | **PARTIAL / FRAGILE (AI-side re-audit)** |

> **⚠️ Verdicts for #2, #4, #5 were corrected after your follow-up.** My first pass tested the **player/generic** code paths and marked them NOT REPRODUCED. Re-running against the **AI** paths (`botRally`, `botPromote`, the Fission-split helper, `skillEntries` for an AI seat) — and using your specific setups (Classless-9 Rank Zone, Fission-9 split) — reproduced them. See the **"AI-SIDE RE-AUDIT"** section below.
| 6 | AI fires skills it isn't capable of using | **NUANCED** (partly true) |
| 7 | AI difficulty levels aren't actually different | **NOT REPRODUCED** (mechanism exists) |
| 8 | AIs don't use real strategy/synergy | **NUANCED** (infrastructure exists; tuning) |
| 9 | Class name in top header doesn't update after switching class | **CONFIRMED** |
| 10 | AI2 doesn't get the Area-Card animation | **NUANCED** (overlay works; particles don't) |
| 11 | "Target opponent" in 1v1v1 auto-targets one seat, can't pick AI2 | **CONFIRMED** |

---

## AI-SIDE RE-AUDIT (your follow-up)

You were right that several of these live on the **AI** side, not the player side. The AI uses different code than the player: `botPromote`/`botRally`/`ruSmartSkillPass` (the `ru135` engine — drives **ai2**, and **ai** in 1v1v1 / AI-vs-AI), and the legacy `_aiBase` chain (drives **ai** in 1v1 / Gauntlet / Tournament). I re-tested against those. Runtime results below (I drove the real AI engine, not the player UI).

### #4 — AI Chief-Flanks a Rank³ over a Rank² Rank Zone — **CONFIRMED**
**Runtime (1v1v1, `ru135` `botRally`):** set the AI's Rank Zone to a **Rank² Classless 9** (rank 2, NP 9), gave it a Rank² flank and a **Rank³ 8** in hand, ran `botRally`. Result: the AI Chief-Flanked it — log **`★ AI Chief Flanks Deck 6 → Deck 8 (Left)`**, with `rankZoneRank: 2` and the Rank³ card now in the flank. Exactly your example.

**Root cause (shared by player and AI):** Chief Flank only checks **NP ≤ Rank-Zone NP**, never **rank**.
- Player `tryFlank` ([~3182](index.html)): `if(!isChief && newRank>rRP){reject}` — the `!isChief` **skips** the rank check for Chief Flanks.
- `botRally` Chief-Flank ([~13090](index.html)): filters `r3` by `c.numeral<=rNP` only; it never compares the flank's rank to the Rank Zone's rank.

The loophole is **Classless 7–9**: they're Rank² but have NP 7–9, so a Rank² Rank Zone can satisfy "NP ≤ Rank-Zone NP" for a Rank³ (NP 7–9) flank. If the intended rule is "a Rank³ flank requires a Rank³ Rank Zone," the fix is to enforce **flank rank ≤ Rank-Zone rank even for Chief Flanks** (in both `tryFlank` and `botRally`). *(This one reproduces for the human too — the player UI has the same gap — but you'll see the AI do it far more often since it auto-rallies.)*

### #2 / #3 — Fission-class AI gets a Rear Flank — **CONFIRMED**
**Runtime (1v1v1, Fission AI):** called the Fission-9 split helper (`splitToBattlefieldRBP23`) for a Fission-class AI with the source card on a **flank** (not the Rank Zone). Result: `rearFlankSetForFission: true`, `rearFlankCard: "F c"`, `isExtension: false` — a **non-Extension side got a card in its Rear Flank**.

**Root cause:** `splitToBattlefield` ([~15559](index.html)) chooses zones by source location:
```js
const slots = sourceZone==='rank' ? ['rank','left-flank','right-flank']
                                  : ['left-flank','right-flank','rear-flank'];
tri.forEach((c,i)=> setZone(p, slots[i], c));   // writes into 'rear-flank'
```
When Fission 9 splits from a non-rank source, the 3rd Numeral is placed in **`rear-flank`** with no class check — even though the Rear Flank Zone is supposed to be **Extension-only** (`updRearFlank` hides it for non-Extension sides via `isExtensionSide = class==='extension'`). So a Fission side ends up with a rear-flank card that the zone-renderer won't even show — a stuck/invisible card. (Applies to the human too if they run Fission 9 this way; you notice it on the AI because the AI fires it automatically.)

### #3b — Fission 9 usable from Hand — **CONFIRMED (AI too)**
**Runtime (1v1v1, Fission AI):** `skillEntries('ai','main')` with a Fission 9 in the AI's **hand** returned an entry with **`zone:'hand'`**, `offeredFromHand: true`, while `SDEFS['Fission 9'].source === 'field'`. So the AI's skill picker (`ruSmartSkillPass` → `skillEntries`) will consider and fire Fission 9 **from hand**. Same root cause as the player-side #3: `skillEntries`' `sourceOK` isn't rejecting a `field`-source skill held in hand, and Fission 9's own `check(w,card)` doesn't take/inspect `fieldZone` (unlike Phantom 1, which does).

### #5 — AI can't place a card on top of Fission 0 — **PARTIAL / FRAGILE**
Not a clean reproduction, but the failure **mechanism is real and firing**:
- **Runtime (1v1v1 `botPromote`):** promotion **succeeded** (Fission 3 → Rank Zone) — but the immunity guard log **`Fission 0 cannot be removed from the Rank Zone…` fired anyway** during the promotion.
- **Runtime (2-player `_aiBase`):** the AI ran **three conflicting promotions in one turn** — logs: `AI promotes to Fission 3` / `AI promotes to Numeral 1` / `AI v12 promotes to Fission 3` — the phase had **advanced to `rally`** partway through, and the guard **fired** (`Fission 0 cannot be removed…`).

**Why this is the bug:** the `ru174` Fission-0 immunity works by blocking any `rankZone` reassignment **unless `G.phase==='promotion'`**. But there are **multiple redundant AI promotion implementations** running in sequence (base `_aiBase`, a "legal promotion" path, and `tryV12Promotion`), and by the time the later ones run, the phase has moved to `rally` — so the guard **blocks** their `rankZone` write. In my runs an earlier implementation had already placed the card so it netted out, but this is precisely the timing-dependent path where, in a different order, the promotion onto Fission 0 gets **blocked** and the card fails to seat — matching your report. **Two defects here:** (a) the guard's phase-gate is fragile against promotions that run outside `promotion` phase; (b) the AI has redundant promotion logic firing 2–3 times per turn (visible in the logs), which is its own bug.

**Scope check across modes:** the shared roots hit every mode — `splitToBattlefield` and `skillEntries` are shared (all modes); `botRally`/`botPromote` cover **ai2, 1v1v1, AI-vs-AI**; `_aiBase` covers **1v1, Gauntlet, Tournament** ('ai' seat). The redundant-promotion behavior was seen on the `_aiBase` (2-player) path specifically.

---

## CONFIRMED bugs

### 1) AI2 cards have no particles/animations in 1v1v1
**Root cause:** the card-FX scanner that spawns per-card particles/summon effects is hardcoded to two seats. The `zones` list it iterates ([index.html ~22083](index.html)) is:
```js
var zones=[{id:'hand-cards',kind:'hand'},
  {id:'pl-field',side:'player'},{id:'ai-field',side:'ai'},
  {id:'pl-delta',side:'player'},{id:'ai-delta',side:'ai'}];
```
There is **no `ai2-field` or `ai2-delta`** entry, so the scanner never watches AI2's board — its cards never trigger the particle/animation FX. Additionally, `ruAreaFX`'s particle "rain" direction is `((side==='player')?-10:innerHeight+10)` — a 2-way top/bottom split with no handling for AI2's rotated seat in the triangle.

**Fix direction (when you want it):** drive the scanner from `G.sideOrder` (and the seats' real zone element ids via `sideZoneId`) instead of the hardcoded 2-entry list — same generalization already applied to the game-logic sweeps.

### 3) Fission 9 is usable from Hand (source not enforced)
`SDEFS['Fission 9']` is declared `source:'field'` ([~15593](index.html)), but its `check` takes only `(w,card)` and **never inspects the zone** — unlike e.g. Phantom 1, whose check does `if(!battlefieldSource(fieldZone))… return false`.

**Runtime proof:** with a Fission 9 in hand and `G.phase='main'`, `skillEntries('player','main')` returned an entry for it with `zone:'hand'`, i.e. it was **offered from hand** even though its source is `field`. So `sourceOK(def,e,who)` inside `skillEntries` ([~10498](index.html)) is not rejecting a `field`-source skill sitting in hand. This is likely **systemic** — any `source:'field'` skill whose own `check` doesn't re-verify the zone could be offered from the wrong location.

### 9) Class name in the top header doesn't update after switching class
**Runtime proof:** started a match as **Light** → header read `YOU · Light`; returned to menu, picked **Shadow**, started again → header **still read `YOU · Light`** (should be `YOU · Shadow`).

**Root cause:** `updEliminatedVisuals()` ([~4817](index.html)) caches the header text once and never refreshes it:
```js
const base=nameEl.getAttribute('data-base-label')||nameEl.textContent;
if(!nameEl.getAttribute('data-base-label'))nameEl.setAttribute('data-base-label',base);
nameEl.textContent=dead?base+' — ELIMINATED':base;
```
`data-base-label` is written on the **first** render and reused forever. `initGame` correctly sets `pl-name` to the new class (`YOU · <class>`, [~486](index.html)), but the next render calls `updEliminatedVisuals`, which overwrites it back to the stale cached label. It's a classic "cache-once, never-invalidate" bug — the cache must be cleared on new-match start.

### 11) "Target an opponent" auto-picks one seat in 1v1v1 (no choice)
Most opponent-directed card effects resolve their target as a **single** seat via `o = side(other(w))`, where `other(w)` → `oppOf(w)` → *the next living seat in turn order* (see the dozens of handlers in `applyE2`/skill code, e.g. [~770–812](index.html)). There is no UI to choose **which** of the two opponents to hit.

**Runtime proof (a 1v1v1 game):** `oppOf('player')` returned a single seat while `oppList('player')` returned **both** `['ai','ai2']` — confirming two valid opponents exist but singular effects only ever act on the one `oppOf` picks.

Nuance on your wording: it isn't *always* AI1 — `oppOf` returns whichever seat is **next in the shuffled turn order**, so it's frequently (but not always) AI1. The real defect is the **absence of a target choice**. (A minority of effects that route through `chooseFieldTarget` — which iterates `sideOrder` — *do* let you pick across seats; the many `o = other(w)` ones do not.) This is the natural follow-on to the Issue-9 plural work: singular *targeted* effects still need a per-effect "choose which opponent" pass for 1v1v1.

---

## NOT REPRODUCED — *player/generic paths only* (superseded for #2/#4/#5 by the AI-SIDE RE-AUDIT above)

> The three entries below record what the **player/generic** paths do. For **#2, #4, #5 the AI paths DO reproduce the bugs** — see the AI-SIDE RE-AUDIT section above, which is the authoritative verdict. Kept here to show the player-vs-AI divergence.

### 2) AI Rear Flank without Extension — *(player path only; AI path CONFIRMED above via Fission 9 split)*
The Rear-Flank zone is gated on the side's **class**, not on having an Extension card:
```js
function isExtensionSide(w){ var p=side(w); return p && p.class==='extension'; }   // ~ (isExtensionSidePA10)
```
`updRearFlank(who)` returns early and hides the zone if `!isExtensionSide(who)` ([~4955](index.html)), and the AI rally (`botRally`) only ever fills **left/right** flanks and Chief-Flanks left/right — it never assigns a rear flank. I found no code path where a non-Extension AI is given a rear flank. If you've seen it, it would have to be a specific skill assigning `rearFlank` to a non-Extension side's data — I didn't find one, but a targeted repro (which class/skill) would let me pin it.

### 4) AI Chief-Flanks a Rank³ with only a Rank² Rank Zone — *(SUPERSEDED — CONFIRMED on the AI side above; my first analysis below missed the Classless-9 NP loophole)*
> Correction: `botRally`'s Chief-Flank filter checks `numeral<=rNP` but **not** rank, and a Rank² Classless-9 Rank Zone (NP 9) passes that for a Rank³ 8 (NP 8). Reproduced at runtime — see AI-SIDE RE-AUDIT. The original (wrong) reasoning is kept below for transparency:

`botRally` ([~13072](index.html)) enforces the rank rules:
- Regular flanks: filtered by `c.numeral<=rNP && (c.rank||0)<3 && (c.rank||0)<=rRP`.
- Chief Flank: candidate `r3` filtered by `(c.rank||0)===3 && c.numeral<=rNP`, and the replaced slot must be `rank>=2 && numeral>=big.numeral-3`.

Because a Rank³ card is numeral 7–9 and the filter requires `numeral<=rNP` (Rank-Zone NP), the AI **cannot** Chief-Flank a Rank³ while its Rank Zone is a Rank² (numeral 4–6 → NP too low). The player-side `tryFlank`/Chief-Flank code enforces the same "flank NP ≤ Rank Zone NP" rule. Appears correct.

### 5) Card promoted onto Fission 0 goes to Bank / Fission 0 stays — *(player path works; AI path is FRAGILE — see re-audit above)*
> The **player** `tryPromote` works cleanly (below). The **AI** paths are the concern: the immunity guard fires mid-promotion and the AI runs redundant promotions — see AI-SIDE RE-AUDIT #5.

**Runtime proof (player path):** with Fission 0 in the Rank Zone during the promotion phase, `tryPromote(Fission 3)` returned `true`, the Rank Zone became **Fission 3** (correct), the promoted card did **not** go to the Bank, and Fission 0 did **not** remain. The `ru174` Fission-0 removal-immunity guard is deliberately phase-gated (`!(G.phase==='promotion')`) so promotion is allowed. The player promotion path works.

**Caveat:** `ru174`'s own comment notes "at least 4 separate AI promotion-decision implementations." I verified the player path and the shared `tryPromote`; I did not exhaustively drive every AI promotion path. If you saw this with a specific AI/mode, that path is where to look — the phase-gate is the thing to check (a promotion that runs while `G.phase !== 'promotion'` would trip the immunity and produce exactly your symptom).

---

## NUANCED (partly true / by-design / tuning)

### 6) AI fires skills it isn't capable of using
Partly real. `skillEntries(who,phase)` ([~10498](index.html)) filters candidates by **type / phase / not-already-used / source** — but **not by cost affordability**. So the AI's `ruSmartSkillPass` scores and attempts skills without first checking it can pay their cost; it relies on `autoRunSkill` (and each skill's own cost logic) to bail out. That means it can *attempt* skills it can't fund (wasted consideration, possible log noise), though it shouldn't complete an illegal one if `autoRunSkill` rejects cleanly. Whether an unaffordable attempt is silently dropped or leaves a partial effect depends on each skill's cost path — worth a focused check per class if you're seeing bad behavior. It is **not** true that there's no gating at all (source/phase/used are enforced).

### 7) AI levels aren't actually different
The differentiation **is** implemented. There's a 14-rung ladder with explicit per-level error rates ([~22309](index.html)):
```js
var RU_LADDER_ERROR_RATE=[0.94,0.80,0.62,0.44,0.32,0.22,0.15,0.10,0.065,0.042,0.026,0.016,0.009,0.003];
window.ruQualityFor=w=>1-RU_LADDER_ERROR_RATE[ladderIndex(w)];
window.ruRollCorrect=w=>Math.random()<ruQualityFor(w);
```
plus per-level search **depth** scaling (`ruEffectiveDepthFor`). Every AI decision (promote/rally/skill/action/combat) is gated by `ruRollCorrect(w)` and depth, so a higher level statistically makes the "objectively best" call far more often. So the *mechanism* to be smarter at higher levels exists and is wired. Two honest caveats: (a) in **short** games the statistical gap can be hard to feel; (b) I did not exhaustively confirm that **each seat in 1v1v1** reads its own configured level everywhere (the UI exposes separate AI/AI2 level pickers, and `ruQualityFor(who)`/`ruLevelFor(who)` are per-seat, so it *should*). If levels feel identical in practice, that's a tuning/perception matter or a per-seat wiring gap — not an absence of the system.

### 8) AIs don't use real strategy/synergy
Infrastructure exists: a bounded **negamax combat planner** (`_ruCombatPlan`), purpose-aware `actionScore`/`skillScore`, and per-class game-plan weighting (each deck "wins in a different way"). So there *is* strategic scoring and lookahead, scaled by level. "Feels random/greedy" is most likely the low-level error rate (0.62–0.94 wrong-call rate at the bottom rungs) making low tiers deliberately weak, plus short games. This is subjective and I found no outright "no strategy at all" defect — but it's a fair candidate for tuning if even high tiers feel thin.

### 10) AI2 Area-Card animation
Split result:
- **Area OVERLAY** (the field wash/glow when a side has an Area card in its Deadzone) — **works for AI2.** `syncAreaVisuals` iterates `G.sideOrder`, and a runtime check showed `ai2-field` gaining the `area-active` class when AI2 held an Area card.
- **Area/card PARTICLE burst** (the `ruAreaFX` scanner) — **does not cover AI2**, same root cause as #1 (the hardcoded 2-seat `zones` list). So AI2 gets the background overlay but not the particle flourish.

---

## Additional issues found during this audit (not on your list)

- **The whole particle-FX subsystem is hardcoded 2-player.** The `zones` scanner list and `ruAreaFX`'s rain-direction split both assume exactly `player`/`ai`. This is one root cause behind both #1 and #10 — fixing it once (drive from `sideOrder` + `sideZoneId`) resolves both.
- **`sourceOK` field/hand gating looks unreliable.** #3 (Fission 9 from hand) implies `skillEntries`' source check isn't reliably rejecting `field`-source skills held in hand. This is worth a systemic check: any `source:'field'` skill whose own `check` doesn't re-verify the zone (many don't) could be offered from the wrong place — Fission 9 is likely not the only one.
- **"Cache-once, never-invalidate" pattern.** #9's `data-base-label` is one instance; worth grepping for other one-time-cached UI labels/state that survive a new-match start.
- **Singular opponent targeting is systemic.** Dozens of handlers use `o = side(other(w))`. Issue-9 (plural "all opponents") was fixed, but every *singular* "target **an** opponent" effect still auto-resolves to one seat in 1v1v1 with no choice UI. This is a coherent follow-on workstream, not a one-off.

---

## Bottom line

Of your 11 items: **4 confirmed** (AI2 particles, Fission 9 from hand, class header not updating, opponent-targeting auto-pick), **3 not reproduced** (AI rear flank, Chief-Flank rank rule, Fission-0 promotion — all appear correctly handled in the paths I drove, with a noted caveat on AI-specific promotion paths), and **4 nuanced** (AI skill affordability, level differentiation, strategy depth, AI2 area overlay-vs-particles). The two clearest systemic threads are the **2-player-hardcoded particle FX** (fixes #1 and #10 together) and the **missing opponent-choice for singular targeting in 1v1v1** (#11).
