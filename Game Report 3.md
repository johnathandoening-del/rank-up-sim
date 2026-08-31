# Rank Up! — Report 3: AOE Targeting, Deadzone Shells, Defeat Routing & Flank Casualties

**Scope:** a deep-dive audit (NO fixes applied) of four areas you flagged:
1. "All-battlefield" / AOE skills & effects that only hit one opponent in 1v1v1 (Multiply and every other such card).
2. Every card that drops from the Deadzone — shells-vs-specific rule; negative-Deadzone handling; Rank³⁺ auto-discard.
3. Battle defeats that sometimes land in the Discard instead of the Deadzone.
4. Flank-Zone defeats and the Rank-Difference Casualty-Draw rule.

**Method:** I read the card source of truth (`data.js` for 13 classes + classless + all Action Cards; `index.html` lines 9261–9284 for the Fission/Extension numerals that `data.js` omits), then verified the **live** behaviour by driving the real functions in a served copy (`SDEFS`/`ACDEFS` effect fns, `dzAdd`, `takeFromDeadzone`, `resolveAtk`, `casDraw`). Where a card is redefined by a later override block, I judged the **live** (post-override) definition, not the base — several base defs are superseded (e.g. Multiply is fixed by an override; the runtime wrapper hides it).

**Golden rule for every fix below:** remove/replace the wrong code and route it through ONE canonical helper. No new override layers, no per-card duct tape.

---

## ✅ EXECUTED (Option A) — all remove/replace, verified at runtime

Everything below was implemented and driven in a served copy. All 50 inline script blocks parse; an AI-vs-AI match ran to exchange 5 with combat/casualties and **zero console errors**.

| Task | Fix (remove/replace) | Runtime verification |
|------|----------------------|----------------------|
| **3 & 4** | Rewrote **`dzAdd`**: when the Deadzone is 0+ the card physically enters it; when it's **negative** (fewer than 0 cards / shells owed) the card cannot sit there — it cancels a shell (`cas++`) and goes to the **Discard**, or, for a **Rank³⁺**, the owner chooses hand vs Discard (`RUr3DeadToDiscard` — modal for human, auto-keep-to-hand for a bot). Invariant `deadzone.length == max(0, cas)` preserved. Task 4's real fix is at the defeat sites (attacker-flank now routed through `dzAdd`, so it lands in the Deadzone when `cas ≥ 0` instead of always the Discard). | `cas≥0` → Deadzone; `cas<0` non-Rank³ → Discard; Rank³ (AI) → hand; Rank³ (human) → choice modal, `cas −2→−1`; invariant holds. Flank defeat: `cas≥0`→Deadzone, `cas<0`→Discard, both + rankDiff draws. |
| **5** | Extracted canonical **`applyDefeatCasualty(loserWho,loserZone,loserCard,extraDraws)`**; `destroyDef`/`destroyAtt` route through it. Flank/Rear/Delta = defeated card → Deadzone + **rankDiff** Deck-pull draws; Rank-Zone = 1+rankDiff (unchanged); attacker-flank now → Deadzone (was Discard). Protect/Zero-2/Restorative-3 flags now apply to Flank/Delta draws too. | Flank defeat (rankDiff 2): flank→Deadzone + 2 draws (cas +3). Attacker-flank: →Deadzone (not Discard) + draws. Delta: evo→Deadzone + elements→Drop + 2 draws. Rank-Zone: 3 draws, card survives. |
| **2** | **Light 7** (`useLight7`) and **Maximum 11 Skill 2**: deleted the hardcoded `deadzone.length<N` blocks + fixed-count pickers; routed the generic "drop N from Deadzone" through the shell-enabled **`takeFromDeadzone`**. | Both PROCEED with an empty Deadzone — the drop shells `cas` to −2 (no block), other costs paid. |
| **1** | Looped every AOE gap through `ruEachOpp`/`oppList`: **Inferno 3, Inferno 4** (deferred End-Phase MP), **Restorative 1, MAX Star, Shaded Star, Burning Star (E2)**. Also fixed **`takeFromDeadzone`**'s hardcoded `who==='ai'` → `!isHumanSeat(who)` so **ai2** (and a bot 'player' in AI-vs-AI) auto-picks instead of stalling on the human picker — benefits every opponent-Deadzone-drop card. | 1v1v1: Inferno 3 → both opponents −3 MP; Restorative 1 → both draw + +2 MP; MAX Star → both opponents drop 1; Shaded Star → min across ALL boards (NP 9→11 via ai2's 2); Burning Star → each opponent −MP by own Deadzone. |

**Bots CHOOSE the Rank³⁺ destination (no more auto-keep):** `RUr3DeadToDiscard` used to hardcode "AI always keeps to hand" (and mis-gated on `p!==G.player`, which would have popped a modal for a bot-controlled 'player' in AI-vs-AI). Replaced with a real board-state evaluation: hand-value (skilled card, on-class, hand room, affordable to replay) vs Drop-value (Drop-recursion deck, duplicate already held, crowded hand), then gated by the bot's **difficulty roll** — a correct roll takes the higher-value option, a wrong one takes the other, so stronger tiers make the smarter call more often. Verified: the bot keeps a strong skilled Rank³ but **sends a Basic Rank³ duplicate to Discard** when the hand is full / MP is short / the deck leans on the Drop; a forced wrong roll flips an otherwise-good Hand call. Humans still get the modal. Seat is resolved via `isHumanSeat`, so AI-vs-AI never stalls.

**Rank³⁺ hand-choice is now UNIVERSAL (follow-up):** `dzAdd` is the single entry point for "a card enters the Deadzone", but ~72 helper functions across the file duplicated the send with a raw `side.deadzone.push(card); side.cas++`, bypassing it — so they neither honoured the invariant nor offered the Rank³⁺ choice when negative. All 72 were routed through `dzAdd` (script-driven, exact-pattern replace; `dzAdd` itself and 3 area-card-activation sites excluded), and the casualty-draw `step()` now routes its `cas<0` branch through `dzAdd` too. Result: a Rank³⁺ sent to a negative Deadzone from **any** location — deck casualty draw, battle defeat, or a skill/effect send from hand/Bank/field — offers **Return to Hand / To Discard** (verified: human modal on a deck casualty draw → card lands in hand, invariant intact; AI auto-keeps to hand). AI-vs-AI regression clean, invariant `deadzone.length == max(0,cas)` held throughout.

**Note on negative-Deadzone accounting (corrected):** a negative Deadzone means it physically holds **fewer than 0** cards, so nothing can sit in it. A card sent to a negative Deadzone cancels a shell (`cas++`) and is routed onward — to the **Discard**, or, for a **Rank³⁺**, the owner's choice of **hand vs Discard**. When the Deadzone is 0+, the card physically enters it. This keeps the invariant **`deadzone.length == max(0, cas)`** at all times (verified). So Task 4's real fix is: a defeated card lands in the Deadzone when `cas ≥ 0` (previously an attacking flank went to the Discard unconditionally); it only reaches the Discard when the Deadzone is genuinely negative — which is correct.

---

## Non-patch guiding principle for all four areas

Every one of these bugs is the **same disease** you've been killing: one rule is re-implemented by hand in dozens of card fns, each slightly wrong. The cure is identical each time — **make one canonical helper the single source of truth, then delete the hand-rolled copies:**

| Area | Canonical helper (exists / to formalize) | What gets deleted |
|------|------------------------------------------|-------------------|
| 1 — AOE | `ruEachOpp(w,fn)` / `oppList(w)` / `G.sideOrder` (already exist) | every `o = other(w)` / single-`o` loop in an all/both/opponents effect |
| 2 — Deadzone drop | `takeFromDeadzone()` + the `pick_deadzone`/`take_deadzone` step handlers (already shell-correct) | the hardcoded `deadzone.length < N → cancel` blocks in custom fns |
| 3 & 4 — enter Deadzone | `dzAdd(p,c)` (one function, line 615 — already the single entry point) | its `if(cas<0) discard` branch |
| 5 — defeat casualty | a canonical `applyDefeatCasualty(dWho,dZone,rankDiff,card)` (to extract from `resolveAtkBase.destroyDef`) | scattered defeat/casualty logic in `resolveAtk` wrappers |

---

## TASK 1 — "All-battlefield" / AOE effects only hitting one opponent in 1v1v1

**The rule.** A card whose text says **"all battlefield / both sides / all Numerals / all opponents / all other players / all players / opponents (plural)"** must, in 1v1v1, affect **every** living opponent (or every side). A card that says **"opponent" / "opponent's" (singular)** is a *single*-target effect and belongs to the Report-2 #11 opponent-choice system, NOT here.

**Canonical resolvers already exist and are already used by the correctly-converted cards:** `ruEachOpp(w,fn)` (runs fn for every living opponent), `oppList(w)` (array of all living opponents), and `G.sideOrder` (all seats). The prior 1v1v1 pass converted *some* cards; the rest were missed.

### 1A. Already CORRECT (loops all opponents / all sides — no change needed)
Verified live:
- **Deckstructive 3** ("All other players mill 3") — loops.
- **Deckstructive 4** ("All players draw 3; opponents drop Action Cards") — loops.
- **Negative 7** ("all other players' Battlefields −3 NP/−1 RP") — loops.
- **Negative 9** ("All opponent Battlefield Numerals lose NP; All players add 1 from Deadzone") — loops.
- **Restorative 7** ("All other players drop 1 Deadzone, draw 1, +3 Morale") — loops.
- **Phantom 1** ("all other players send last Deck card to Deadzone") — loops.
- **Multiply** ("ALL Numerals both sides doubled") — fixed by the override at **index.html ~14405** which iterates `G.sideOrder` → `fieldEntries(side)`. (The base def at ~6459 uses a single `o`; the override supersedes it. The runtime Obelus-negation wrapper hides this, so `toString()` looks single — don't trust the wrapper; the override is live.)
- **Shining Star** ("All Light Numerals +2 NP; all Malevolent −1 NP") — uses `allFieldEntries()` (every side). Correct.

### 1B. Self-only (correctly NOT touching opponents — no change needed)
Multi-Star, Rank Star, Battle Star, Plus, Neo Rank Star (E1), Maximum 4 ("all Numerals on **your** Battlefield"), Maximum 6, Boost, etc. Their "all" refers to **your** board.

### 1C. CONFIRMED GAPS — worded all/both/plural but implemented single-opponent
These are the fixes:

| Card | Text (the AOE clause) | Live implementation | Fix |
|------|-----------------------|---------------------|-----|
| **Inferno 3** | "Your **opponents** lose 3 MP" | `o.mp -= 3` (single `o`) | `ruEachOpp(w,(s,op)=>op.mp-=3)` |
| **Inferno 4** | "**opponents** lose 3 MP" (end of Damage Step) | single-opponent deferred MP loss | loop all opponents for the deferred loss |
| **Restorative 1** | "**All other players** draw 1 and gain 2 Morale" | `draw(oppOf(w),1); o.mp+=2` (single) | `ruEachOpp(w,(s,op)=>{draw(s,1);op.mp+=2;})` |
| **MAX Star** (E1 & E2) | "**Both players** drop 1 from Deadzone" | drops from self + hardcoded `'ai'` (E1 legacy ~5192) / self + `w==='player'?'ai':'player'` (E2 step) — **misses ai2** | drop from self + `oppList(w)` via `takeFromDeadzone` per side |
| **Shaded Star** (E1) | "NP equal to **lowest card on Battlefield**" | reads only one opponent's zones for the min | include all opponents' boards in the min (`oppList`) |
| **Burning Star** (E2) | "**Opponents** lose MP equal to cards in **their** Deadzone" | single opponent (`applyE2` uses `acOpp`) | loop all opponents |

### 1D. Correctly single-target (belongs to #11 opponent-choice, NOT AOE) — for the record
Text says "opponent"/"opponent's" (singular): **Inferno 9, Negative 2, Negative 5, Neo Battle Star, Phantom 3, Blizzard 2, Astute 1/3/5, Light 7 (opp-drop), Zero 4/6.** These should let you *choose* the opponent in 1v1v1 (Report-2 #11 mechanism), not hit all. Several are already in `RU_SKILL_CHOOSE`; the audit note is that the FULL set should be reconciled against this list.

### 1E. Two systemic sub-surfaces to sweep the same way
- **Death-Draw (E2) casualty family in `applyE2` (index.html ~765–820):** `oppCas() = casDraw(acOpp(who))` resolves ONE opponent (`ow = acOpp(who)`). Cards whose E2 says "**opponent** takes N Casualty Draws" (Plus, Battle Star, Multiply, Multi-Star, Neo Rank/Battle Star, Haunting Star, Shining Star, Strike, Drop Star, Minus Star, Subtract, …) are single-opponent. The ones worded **plural** (Burning Star, MAX Star E2, Halcyon Star "all other players") need the loop; the singular ones belong to #11.
- **Area Cards (`AREA_TEXT` / `ADEFS`):** many say "all players / all other players / opponents" — Wildfire ("all players lose MP"; "opponents' Rank & Flank to Deadzone; all other players lose 10 MP"), The Lowlands ("all other players' Numerals switch to negative"), Dark Domain ("all opponent Numerals treated as Rank 0"), Drawbridge, Higher Ground, Seven Heaven, Dreadnaught Airship, Morbid Cemetery. These are a **separate loop-conversion pass** (`ADEFS` effect fns), same `ruEachOpp`/`sideOrder` treatment. Flagged here; can be its own workstream.

**No-patch plan for Task 1:** for each 1C/1E gap, replace the single-opponent resolution (`o`, `other(w)`, `oppOf(w)`, `acOpp(who)`) with a loop over `ruEachOpp(w,…)` / `oppList(w)` / `G.sideOrder`. These helpers already exist and are already used by the 1A cards — so this is finishing an in-progress conversion, not inventing a mechanism. No new code paths.

---

## TASK 2 — Deadzone drops: shells (going negative) vs specific-card requirements

**Your rule, restated precisely:**
- **Generic drop** — "drop N **card(s)** from Deadzone" with NO type/name → the Deadzone may go **negative** (down to the −7 floor). Missing cards become **shells**; the skill must still be usable with an empty/short Deadzone.
- **Specific drop** — "drop/send N **[Restorative / Phantom / Haste / Numeral / Rank² / etc.]** from Deadzone" → must have the **real matching cards**; shells/unrelated types are NOT allowed, and if none qualify the skill correctly cannot be used.
- **Add/recur from Deadzone** ("add … to hand", "Flank with … from Deadzone") → always needs a real card (you can't add a shell to hand).

### 2A. The machinery is ALREADY mostly correct
- The generic step handler `pick_deadzone` (index.html **~5710–5745**) computes `generic = !step.filter && step.to==='discard'` and, when generic, **allows the shortfall** (`p.cas = max(-7, cas − picks − shortfall)`) instead of cancelling. ✔ shells work.
- `take_deadzone` → `takeFromDeadzone()` (**~569–603**) offers real cards **plus selectable shell placeholders** (`dzPickWithShells`) and floors at −7. ✔ shells work.
- **Filtered** steps (`step.filter` present) correctly require real cards and cancel if none. ✔ specific works.

Verified CORRECT this way (need no change): **Shadow 7, Deckstructive 7, Astute 7, Blizzard 6 (self-cost), Restorative 7 (self-drop), Repair, Neo Rank Star, Neo Battle Star (self-drop), Neo Draw Star, Neo Flank Star (self-drop), MAX Star (self-drop mechanics)** — all generic, all shell-correctly handled. And the **specific** cards correctly require real cards: **Phantom 6** (`filter: phantom & numeral & rank≤2`, cancels with a proper "no Rank² or lower Phantom Numeral" message), **Fission 7** (filter: numeral), **Halcyon Star** (filter: 3 Restorative Numerals), **Track Star** (filter: Haste Numeral), **Reanimate** (filter: Rank² Numeral ≤6), **Revive, Motivate, Haunting Star, Haste 7, Restorative 3** — all correctly gated.

### 2B. CONFIRMED BUGS — generic drops that HARDCODE a block (bypass the shell machinery)
A whole-file scan of every `SDEFS`/`ACDEFS` effect fn for a Deadzone-count block found exactly **two** offenders — custom hand-written skill fns that never route through the shell machinery:

| Card | Location | Offending code | Why it's wrong |
|------|----------|----------------|----------------|
| **Light 7** | `useLight7`, index.html **~17598** | `if(!p.hand.length \|\| !p.bank.length \|\| deadPool(w,null).length < 2){ …cancel… }` and `chooseMany(w,'…exactly 2 Deadzone cards…', deadPool, 2, …)` | "Drop 2 from your Deadzone" is **generic** → should shell down to −7. Instead it hard-blocks with <2 real cards. (Your exact example.) Affects human **and** AI — the AI runs the same fn via `autoRunSkill`. |
| **Maximum 11 (Skill 2)** | Skill-2 effect fn | `if(p.hand.length<2 \|\| p.deadzone.length<2){ …"needs 2 hand cards and 2 Deadzone cards"… cancel }` | "Drop 2 from Deadzone" is **generic** → should shell. Instead it hard-blocks. |

The **opponent-side** generic drops ("opponent drops 1 from Deadzone" — Light 7, Blizzard 6, Restorative 7's "all other players") use `chooseOne(ow, oppDeadPool, …)` and simply drop **nothing** when the opponent's Deadzone is empty, instead of shelling the opponent negative. Minor, but same rule — a generic opponent-drop should also be allowed to push the opponent below 0. (Lower priority than the two hard-blocks.)

### 2C. No reverse bug
No card was found that WRONGLY lets a **specific** drop use shells — the filtered steps and the filtered custom fns (Phantom 6 etc.) all require real matching cards. So the fix is one-directional: unblock the generic ones.

**No-patch plan for Task 2:**
1. **Light 7 (`useLight7`) and Maximum 11 Skill 2:** delete the hardcoded `deadzone.length < N` block and the fixed-count `chooseMany(…, deadPool, N)`; replace the Deadzone-drop portion with a call to the canonical **`takeFromDeadzone(w, N, label, 'discard', cb)`** (the same helper Repair/Neo Rank Star use), which already offers shells + the −7 floor + the Rank³⁺ hand-choice. This removes the hand-rolled logic entirely.
2. **Opponent-side generic drops** (optional, same rule): replace the `chooseOne(ow, oppDeadPool, …)`-then-nothing with `takeFromDeadzone(oppSeat, N, …, 'discard')` so the opponent can also go negative.
3. **Codify the classification so it can't drift:** the rule is already encoded as `!step.filter` (generic) vs `step.filter` (specific) in the step handler. The only cards that escape it are custom fns — after step 1, every Deadzone drop flows through `takeFromDeadzone`/`pick_deadzone`, so "generic ⇒ shells, specific ⇒ real cards" holds uniformly with no per-card exceptions.

---

## TASK 3 — Rank³⁺ sent to a NEGATIVE Deadzone auto-discards (should offer a choice)

**Root cause — a single line.** `dzAdd(p,c)` (index.html **~615**) is the one function that puts a card *into* the Deadzone:
```js
function dzAdd(p,c){ if((p.cas||0)<0){ p.discard.push(c); } else { p.deadzone.push(c); } p.cas=(p.cas||0)+1; }
```
When `cas < 0` (shells owed), **any** incoming card — including a **Rank³⁺** — is silently pushed to the **Discard**, with **no prompt**. Verified at runtime: with `cas = −2`, a Rank³ card sent via `dzAdd` → Discard, `cas → −1`, no modal.

The choice UI you want **already exists** for the *other* direction: `_resolveDeadDest` (**~605**) and `window.RUr3DeadToDiscard` (**~21902**) both pop a "Return to Hand / To Discard" modal when a Rank³⁺ card *leaves* the Deadzone. `dzAdd` just never calls it on the *entering* side.

**No-patch plan for Task 3:** rewrite `dzAdd` so that when a card enters while `cas < 0`, a **Rank³⁺** card triggers the existing choice (reuse `RUr3DeadToDiscard`'s modal for the human; auto-keep-to-hand for the AI, exactly as that helper already does), instead of the blind `discard`. This is a rewrite of the one `dzAdd` line + delegation to the existing helper — not a new patch.

---

## TASK 4 — Battle defeats sometimes land in the Discard instead of the Deadzone

**Two roots — both send a battle-defeated card to the Discard:**

**Root 1 — attacker-flank defeat (`destroyAtt`, index.html ~3670).** When *your* Flank/Rear card **attacks and loses** (defender NP > attacker NP), the else-branch runs `zSet(AP,aZone,null); AP.discard.push(att)` — the defeated attacker goes to the **Discard**, never the Deadzone. A *defending* flank that loses goes to the Deadzone (via `dzAdd`), but an *attacking* flank that loses goes to the Discard. That attacker-vs-defender asymmetry is the most likely "**sometimes** it's the Discard" you saw. **This shares the Task 5 fix site** — the canonical `applyDefeatCasualty` helper routes attacker defeats to the Deadzone too.

**Root 2 — negative Deadzone (`dzAdd`, ~615).** Even a *defending* flank defeat, sent to the Deadzone via `dzAdd(DP, def)` (**~3669**), routes to the **Discard** when the defender's `cas < 0` (shells out). Verified: `cas = −2`, non-Rank³ card via `dzAdd` → Discard; `cas ≥ 0` → Deadzone (`cas 0 → 1`). So a flank defeat lands in the Discard specifically while that side's Deadzone is currently negative.

**Design decision this fix must settle (flagged for you):** today `dzAdd` maintains the invariant `deadzone.length == max(0, cas)` — real cards live in the Deadzone only while `cas ≥ 0`; below 0 the board shows **shells** (`shellsOut = max(0,−cas)`) and incoming cards fill the Discard. Making a defeated card **physically enter the Deadzone while `cas < 0`** (what you want) means a real card "pays off" a shell: `deadzone.push(c); cas++`. That breaks the `length == max(0,cas)` invariant during the negative window, and `dzDrop`/shell accounting + the −7 win-condition floor read `cas`. So the fix is a small `dzAdd` rewrite, but it needs a **decision on the accounting**:
- **Option A (recommended):** a card entering a negative Deadzone physically enters the Deadzone and cancels one shell (`deadzone.push(c); cas++`). Reconcile `dzDrop`/`shellsOut` to treat `cas` as *net* and derive shells as `max(0, −cas)` independent of `deadzone.length`. Defeated cards are then always physically present (your Task 4), and the Rank³ choice (Task 3) is offered before the push.
- **Option B:** keep the shell/discard accounting but make **defeats specifically** exempt — pass a `fromDefeat` flag so a defeated card always enters the Deadzone even at `cas < 0`, while unrelated "sent to Deadzone" effects keep current behaviour.

Both are non-patch (rewrite `dzAdd` + its 2–3 call-site helpers `dzDrop`/`shellsOut`). I recommend A for consistency, but it touches the win-condition math, so I want your ✔ before writing it.

**No-patch plan for Task 4:** rewrite `dzAdd` (and the sibling `dzDrop`) so a card entering a negative Deadzone **enters the Deadzone** (Option A) rather than the Discard, with the Rank³⁺ choice from Task 3 layered in. Single function, single source of truth — every defeat, cost, and casualty already funnels through `dzAdd`, so fixing it fixes all of them at once.

---

## TASK 5 — Extend the Rank-Difference Casualty rule to Flank & Delta Zone defeats

**Corrected per your clarification.** The Rank-Difference casualty rule currently fires ONLY on Rank-Zone defeats; you want it on **Flank Zone, Rear Flank, and Delta (Amalgamation) Zone defeats too.** The intended rule:

> A defeated Flank/Rear/Delta card (a) goes to its owner's Deadzone as the **mandatory (first) casualty** — it *is* the mandatory Deadzone card, so it stands in for the "+1 mandatory" Deck-pull — **and** (b) triggers **`rankDiff` additional Casualty Draws** (Deck → Deadzone), where `rankDiff = max(0, winnerRP − loserRP)`.
>
> ⇒ **Flank/Delta defeat = defeated card → Deadzone + `rankDiff` Deck-pull draws.** Rank-Zone stays `1 + rankDiff` Deck pulls (card survives) — unchanged, per your instruction.

### Current behaviour — audited at EVERY defeat site
Every battle defeat funnels through two inner fns of `resolveAtkBase` (index.html **~3669–3670**) plus `defeatDelta` (**~9058**, exposed as `defeatDeltaRA3`). The `resolveAtkL4…L24` wrappers add pre/post logic (logging, skill flags, reactive windows, Recycle/Fission-8/Negative-6 interceptors) but delegate the actual defeat to these three. Verified live (flank defeat → `cas +1`, **0** Deck draws):

| Defeat site | Zone | Current code | Desired |
|---|---|---|---|
| `destroyDef` (defender loses) | **rank** | `tot = 1 + max(0,aRP−dRP)`; `casDraw(dWho)×tot`; rank card **survives** | unchanged |
| `destroyDef` | **flank / rear** | `zSet(DP,dZone,null); dzAdd(DP,def)` → Deadzone, **0 draws** | Deadzone **+ `rankDiff` draws** |
| `destroyDef` | **delta** | `defeatDelta(dWho)` → evo→Deadzone, elements→Drop, **0 draws** | **+ `rankDiff` draws** |
| `destroyAtt` (attacker loses) | **rank** | `tot = 1 + max(0,dRP−aRP)`; `casDraw(aWho)×tot` | unchanged |
| `destroyAtt` | **flank / rear** | **`zSet(AP,aZone,null); AP.discard.push(att)` → DISCARD**, 0 draws | **Deadzone** + `rankDiff` draws |
| `destroyAtt` | **delta** | `defeatDelta(aWho)`, 0 draws | **+ `rankDiff` draws** |

**Two findings:**
1. **Flank & Delta defeats take ZERO Rank-Difference draws today** — exactly the gap you want closed. (My first-draft test showing "0 draws" was reading the *base* behaviour, not a missing path — the base genuinely never applies rankDiff off the Rank Zone.)
2. **A defeated ATTACKING flank goes to the DISCARD, not the Deadzone** (`destroyAtt` else-branch). That is the "sometimes a defeated card goes to Discard not Deadzone" from **Task 4** — it happens whenever *your* Flank attacks and loses. **Task 4 and Task 5 therefore share the same fix site**, and the canonical helper fixes both.

### No-patch plan — one canonical helper for every defeat
Extract the defeat→casualty logic into **`applyDefeatCasualty(loserWho, loserZone, loserCard, rankDiff)`** and call it from `destroyDef`, `destroyAtt`, and the Delta path — replacing the six inline branches above. Encode the rule once:
```
rankDiff = max(0, effRank(winner) − effRank(loser))
if loserZone === 'rank':
    tot = applyCasFlags(1 + rankDiff)          // ds.protectCas + checkSkillFlags_casualtyCalc, as today
    casDraw(loserWho) × tot                     // rank card survives (unchanged)
else:                                          // flank / rear / delta
    dzAdd(loserWho, loserCard)                 // the card IS the mandatory casualty → Deadzone (honours Task 3/4 dzAdd fix)
    tot = applyCasFlags(rankDiff)              // rankDiff EXTRA Deck-pull draws (NOT 1+rankDiff — the card is the +1)
    casDraw(loserWho) × tot
    // Delta: elements → Drop as today
```
- **Reuses existing pieces:** `casDraw`, `effRank`, `ds.protectCas`, `checkSkillFlags_casualtyCalc` (Zero 2 / Restorative 3 / Protect / Cease). The new Flank/Delta draws automatically respect the same Casualty negation/reduction the Rank Zone already does — they can't today because there are no draws to negate.
- **Deletes** the inline `dzAdd(def)`, `AP.discard.push(att)`, and bare `defeatDelta` calls; all six rows route through the one helper — so no `resolveAtk` wrapper can diverge.
- **Fixes Task 4's attacker-flank→Discard for free** (the else-branch now `dzAdd`s to the Deadzone through the helper).
- **Special interceptors unaffected:** Recycle (card returns to Deck instead of dying → helper not called), Fission 8 (post-defeat split), Negative 6 (returns an Action Card) keep their own paths; the helper only owns the generic casualty resolution.
- **Rank-Difference source of truth:** `aRP = effRank(att)`, `dRP = effRank(def)` are already computed in `resolveAtkBase` (**~3665**) — the helper receives the already-correct `rankDiff`, so display-rank cards (Rank MAX/Ultra, Seven Heaven Rank-2 sevens, Deckstructive Rank-0 flank) are handled consistently.

---

## Cross-cutting: where the same helper fixes multiple tasks

- **`dzAdd` (~615)** is the single fulcrum for **Task 3 AND Task 4** — one rewrite, both fixed.
- **`takeFromDeadzone` (~569)** already solves **Task 2** for every card that uses it; the fix is deleting the two custom blocks (Light 7, Maximum 11) and routing them through it.
- **`ruEachOpp`/`oppList`/`sideOrder`** already solve **Task 1** for the converted cards; the fix is finishing the conversion on the 1C/1E gaps.
- **`applyDefeatCasualty` (to extract)** locks in **Task 5** (rankDiff on Flank/Delta), fixes **Task 4 Root 1** (attacker-flank→Discard), and prevents wrapper drift.

## No-patch compliance checklist (for when we execute)
- [ ] Task 1: no new targeting mechanism — reuse existing `ruEachOpp`/`oppList`/`sideOrder`; replace single-`o` loops in-place (1C + 1E gaps).
- [ ] Task 2: delete the two hardcoded Deadzone blocks (Light 7, Maximum 11 S2); route through existing `takeFromDeadzone`. No new shell logic.
- [ ] Task 3/4: rewrite the one `dzAdd` branch (+`dzDrop`/`shellsOut` reconcile) and route attacker-flank defeats through the Task-5 helper (Root 1); reuse existing Rank³ choice UI (`RUr3DeadToDiscard`). **Needs your Option A/B decision on the negative-Deadzone accounting.**
- [ ] Task 5: extract `applyDefeatCasualty(loserWho,loserZone,loserCard,rankDiff)`, call from `destroyDef`/`destroyAtt`/Delta; Flank/Rear/Delta = card→Deadzone + `rankDiff` draws, Rank-Zone unchanged. **DECIDED — no open questions.**

**One open decision before execution:** Task 4 negative-Deadzone accounting, **Option A vs B** (see Task 4). Task 5 is now fully specified; everything else is ready to remove/replace with zero patches.
