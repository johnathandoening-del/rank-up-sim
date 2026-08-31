# Playthrough — Light vs Inferno, Distinguished‑4

**Me:** Light (control) · **Opponent:** Inferno (aggro), Distinguished‑4 (66/100) · **Both start 15 MP** · Coin flip: **I go first.**

Every state below was read live from the engine — no invented moves. I explain the *why* before each action. **Result up front: I won on turn 3 by Morale‑zero.**

---

## Deck plan (strategy going in)

Light is a **benevolent control** deck — it doesn't race, it **out‑lasts**. Key pieces:
- **Light 0** — innate damage immunity.
- **Light 6** — *negate all Morale Damage from attacks involving this card* → a rank that can't be chipped. My **wall**.
- **Light 8** — bigger body + Bank ramp (can't attack the turn its skill is *used*, but can attack if you only promote into it).
- **Light 3 / Light 2 / Protect** — a reactive attack‑negate, a Bank‑fed extra attack, and flank protection.
- **Area — Shining Justice:** Light Numerals in my Deadzone gain +1 NP.

**Win plan:** climb **0→3→6→8**, park an unbreakable wall, and grind Inferno's Morale down with **addon swings** while its aggression bounces off. Crucially — Inferno's *casualty draws trigger its Action‑Card cascade* (heals + counter‑damage), so I plan to **maximize Morale damage while minimizing casualty draws** on each hit.

**Opening hand:** Light 2, Light 3, Light 6, Light 8, Protect — the whole ladder. Perfect. Keep it.

---

## Turn 1 (me) — Exchange 1

- **Draw:** none (first player, turn 1). **Rank Zone: Light 0 [N0 R0].**
- **Rule learned live:** on turn 1 you *must* switchdraw every Action Card until none remain (the AI does the same). So **Protect was force‑shuffled** — I drew Plus (also an Action → switchdrawn), then **Numeral 2**. Final hand: Light 2, Light 6, Light 8, Numeral 2. *(My "hold Protect" instinct was actually illegal turn 1 — good to know.)*
- **Promotion — Light 0 → Light 3.** *Why:* starts the 0→3→6→8 climb, upgrades a dead N0 into an N3 body, and demotes Light 0 to **Bank** as fuel (Bank feeds Light 2's extra attack, Light 8's invest, and Amalgamation). **MP → 16.**
- **Rally — hold.** I *could* chump‑flank Numeral 2, but its defensive value this turn is ~0 (D4 Inferno can't profitably swing a turn‑1 N1–N3 into my N3), so committing a body for zero EV just forfeits flexibility. My real wall (Light 6) arrives next turn.
- **Battle:** first player can't attack turn 1. **Pass.**

## Turn 1 (Inferno) — Exchange 1
- Switchdrew 1 Action Card; **promoted to Inferno 2 [N2 R1]**; no flank; **did not attack** — correct: its N2 loses into my N3. Board: Inferno 2 alone. Both 16 MP.

---

## Turn 2 (me) — Exchange 2

Drew Repair + a 2nd Light 3. Hand: Light 6, Light 8, Light 2, Numeral 2, Repair, Light 3.

- **Promotion — Light 3 → Light 6** (the morale‑immune **wall**). The turn‑1 no‑attack rule is over, so Light 6 both walls *and* attacks. **MP → 18.**
- **Rally — flank the spare Light 3 [N3].** *Why:* I'm ahead on board, Inferno can't punish a N3 flank (its N2 loses into it), and a Light‑class flank adds grind pressure *and* becomes Shining Justice fuel if it ever dies. **MP → 19.**
- **Battle — the key decision: *how* to attack.** Inferno's casualty cascade can backfire, so I compared:
  - Two separate swings (Light 6, then Light 3): ~5 Morale + **3** casualty draws.
  - **Light 6 with Light 3 as an addon → N9:** **7 Morale + only 2** casualty draws.
  The addon deals *more* Morale (faster clock) and *fewer* casualties (less cascade). Light 6 is R2 (<3), so the addon is legal.
  - **Result:** *"Light 6 +3 Addon (NP:9) vs Inferno 2 — AI lose 7 MP (16 → 9)."*
  - **Cascade (the double‑edge, live):** Inferno's casualty draw hit **Strike**, whose E2 fired **−2 MP + 1 casualty back on me** — I drew **Light 7 into my own Deadzone** (which for Light is *fuel*, not a loss). Net after cascade: **me 17 / cas 1 (Deadzone: Light 7); Inferno 8 / cas 1.** Minimizing casualties paid off — only Strike fired, not a bigger cascade.

## Turn 2 (Inferno) — Exchange 2
- Promoted to **Inferno 3 [N3]** (→ 9 MP), then made an aggressive trade: **swung its N3 into my Light 3 flank — a tie**, both lose 3 MP (me 17→14, Inferno 9→6), my Light 3 dies to my Deadzone. A mediocre D4 line: it paid 3 MP to kill a chump and *handed me a 2nd Light card in my Deadzone*. After: **me 14 / cas 2 (Deadzone: Light 7, Light 3); Inferno 6 / cas 1.**

---

## Turn 3 (me) — Exchange 3 — the finish

Drew a 2nd Numeral 2 + Neo Rank Star. **Position: me 14 MP + Light 6 wall; Inferno 6 MP, lone Inferno 3.** One hit from dead.

- **Decision: press for the kill.** When this far ahead against a cornered aggro deck, you end the variance now rather than gift it extra turns to draw an out. I chose the aggressive line over the safe grind — and I flag the tension honestly below.
- **Promotion — Light 6 → Light 8** (bigger body; the wall's immunity is irrelevant since Inferno can't reach my rank's NP anyway). **MP → 17.**
- **Rally — flank a junk Numeral 2** as addon material (Light 8 is R3, flank R0, gap ≥2 → addon legal).
- **Battle — Light 8 + Numeral 2 addon → N10 into Inferno 3:** *"AI lose 7 MP (6 → −1). You may win by Morale zero."*
  - **Cascade near‑save (live):** Inferno's 3 casualty draws turned up **Reverse**, E2 **+1 MP → exactly 0**, and redirected future casualties to me. The kill was foiled by 1 MP — *exactly the casualty‑cascade risk I'd flagged.*
  - **But 0 is lethal.** End‑of‑phase check: **"Match Result: Win — You win (AI: Morale reached 0)."**

**Final:** me **17 MP / cas 2**, Inferno **0 MP / cas 3**. Win in 3 turns.

---

## What actually decided it, and honest self‑assessment

**The engine that won:** the **addon** — twice. Folding a flank into the rank's attack let me hit for 7 Morale each time while adding only 2 casualty draws, which (a) raced Inferno's Morale down fast and (b) *starved its casualty cascade*. Against Inferno, casualties are the opponent's lifeline (Reverse literally healed it to 0), so every casualty I *didn't* deal was a comeback I denied. The climb to a safe wall meant Inferno never landed a meaningful hit — its only "success" (the flank tie) just fed my Deadzone.

**Where I'd grade the play:** strong — I climbed efficiently, read Inferno's incentives correctly (it can't attack into my rank), and made the right *shape* of attack (addon, not spread) for the matchup. **The one genuinely debatable call was Turn 3:** the Light‑8 kill needed 3 casualty draws, and the cascade nearly saved Inferno with Reverse. The *purest* control line was Light‑6‑addon for 5 Morale + only **2** casualties (Inferno to ~1, cleaner, keeps the wall) and finish next turn. I chose speed; it won, but the near‑save validates the casualty‑minimization principle I'd set for myself — I slightly violated my own rule and it *almost* cost the kill. A genius plays the 2‑casualty line there.

**Placement (one game, honest):** this was **Distinguished‑level decision‑making** for this matchup — but it's a single game with a *dream draw* (the full ladder in hand) into Light's best matchup (a fair‑Morale aggro deck that can't break a Light 6 wall). I won't over‑rank myself on one smooth game against a favorable matchup; the Turn‑3 wobble is exactly the kind of variance‑management a top player wouldn't leave to chance. Call it a clean, well‑reasoned Distinguished win with one instructive imperfection.
