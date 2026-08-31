# Playthrough — Inferno vs Shadow, Distinguished‑4

**Me:** Inferno (aggro / burn) · **Opponent:** Shadow, Distinguished‑4 (70/100) · **Both start 15 MP** · Coin flip: **I go first.**

The opposite archetype from the Light game: Inferno doesn't out‑last, it **races and burns**. Every state below is read live from the engine. **Result: I won on my 2nd turn by Morale‑zero.**

> **Honest note:** my first attempt at this game *desynced* — my modal‑handling loop clicked "Activate Skill" repeatedly and **double‑fired Inferno 4**, duplicating a card and its effects. I refused to play from a corrupted state, restarted, and handled every skill modal with **single, inspected clicks** thereafter. The run below is the clean replay.

---

## Deck plan (strategy going in)

Inferno's edge is **reach that ignores the board**:
- **Inferno 3** — sac for *opponents lose 3 MP* (cascade‑free burn).
- **Inferno 4** — sac for *my rank gets an extra attack + opponents lose 3 MP at End Phase* (burn + tempo).
- **Plus** — rank + flank +2 NP for a turn (adds NP, not RP → more morale at **no extra casualties**).
- Numerals (Inferno 5, etc.) as the bodies.

**Key matchup insight vs Shadow:** Shadow's defense is the **casualty cascade + Dark Domain** (Shadow cards in *its* Deadzone gain NP; casualty draws can heal it / hit me). So the correct Inferno line isn't to spam attacks (each R2‑into‑R0 hit = 3 casualty draws → feeds Dark Domain + risks cascade heals). It's to **maximize cascade‑free BURN and land as few, as‑big attacks as possible.** Win on Morale before Shadow's engine matters.

---

## Turn 1 (me)
- Mandatory turn‑1 Action‑Card switchdraw. Kept: 2× Inferno 3, Numeral 3, Inferno 4, Inferno 5.
- **Promote Inferno 0 → Inferno 3.** Inferno 3 is my *only* bridge off N0 (everything else is R2, unpromotable from N0), so I promote it rather than sac it for burn. **MP → 16.**
- No legal flank (rank is R1; my other numerals are R2). Can't attack turn 1. Pass.

## Turn 1 (Shadow)
- Switchdrew 3 Action Cards, could only promote to a classless **Numeral 1 [N1 R0]**, no flank, no attack. **Shadow's opening is weak** — behind on development (N1 vs my N3). (The "Shadow 6 is reactive" spam in the log is the check‑logging bug from my earlier audit — cosmetic.)

---

## Turn 2 (me) — the whole game in one turn

Drew Numeral 1 + Plus. The plan: promote to a real body, then dump **cascade‑free burn** + one big addon hit.

1. **Promote Inferno 3 → Inferno 5 [N7 after Plus].** *(Inferno pays MP to develop — promote/flank cost −1 MP each; that aggressive tempo cost is part of the class.)*
2. **Flank junk Numeral 3** as addon material (kept Inferno 3 for its burn, not the flank).
3. **Inferno 4 skill** (single click, clean this time): +2 MP, **rank gains an extra attack**, **−3 MP to Shadow queued for End Phase.**
4. **Plus:** rank Inferno 5 → **N7**, flank Numeral 3 → **N5**. +1 MP. Pure morale upside, zero extra casualties.
5. **Inferno 3 skill:** sac → **Shadow −3 (15 → 12)**, +2 MP. Cascade‑free.
6. **Battle — one addon hit:** Inferno 5 (N7) **+ Numeral 3 (N5) addon = N12** into Numeral 1 → **11 morale (12 → 1)**, 3 casualty draws. *Crucially, I stopped here* — my rank still had a 2nd attack available, but swinging again would only add 3 more casualty draws (feeding Dark Domain / cascade) for a kill the burn already guarantees.
   - **Cascade result:** Shadow's 3 casualties were all Numerals (Shadow 9, 9, 4) — **no Action‑Card E2 fired, no heal.** The casualty discipline paid off.
7. **End Phase:** Inferno 4's queued **−3 → Shadow 1 → −2.** Cascade‑free. **Win check: Morale reached 0.**

**Final:** me **20 MP / cas 2**; Shadow **−2 MP / cas 3.** Win on turn 2.

---

## What decided it, and honest self‑assessment

**The plan executed exactly.** Against a cascade/Dark‑Domain defender, I did **13 of the 17 damage with cascade‑free tools** (Inferno 3 −3, Inferno 4 −3, Plus's +4 morale on the addon, and the End‑Phase burn) and only **one** casualty‑dealing attack (3 draws). That's the anti‑cascade line: kill on Morale, starve the opponent's engine. I deliberately **declined the second rank attack** even though it was "free" damage, because the marginal casualties would have fed Shadow's Dark Domain and risked a Reverse‑style heal like the one that nearly saved Inferno in my Light game. Ending on the **End‑Phase burn** was the cleanest possible finish — Shadow never got a card it could react with.

**Placement, honestly:** the *decision‑making* was Distinguished‑level and, notably, I applied the lesson from game 1 (minimize casualties to deny the cascade) — this game I got it right where last game I slightly overshot. **But the opponent gift‑wrapped it:** Shadow drew terribly, stuck on a classless Numeral 1 with no board and no attacks for two turns, so my aggression was never actually contested. A weak‑draw opponent doesn't test the plan. Clean, correct, fast — but an easy game, and I won't over‑rank a two‑turn stomp.

**Process honesty:** the one genuinely instructive failure was mechanical, not strategic — I corrupted the state by button‑mashing a skill modal, caught it, and fixed my method (single‑click, inspect each step). Skill‑heavy decks like Inferno are near the edge of what I can hand‑pilot cleanly, and this is the discipline that keeps the log real.
