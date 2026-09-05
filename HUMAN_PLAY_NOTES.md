# Rank Up! — Human Play Notes (for the AI rebuild)

Live online match, real player (Kychi) vs Claude, on the deployed build. Recording the human's
move-by-move play to inform the bot rebuild (see `ai-sim.js` + the AI-rebuild plan). The point: current
bots play badly; capture how a strong human actually sequences a turn — promotion timing, flank/rank
value trades, MP economy, when to attack vs. build, card-hold decisions.

---

## Game 1 — Shadow (human, goes first) vs Shadow (bot/Claude)

**Human opening (Exchange 1):**
- Promoted **Shadow 2** into the Rank Zone (rank 0 → rank-1 numeral).
- Ended the turn at **17 MP** (started 15 → +2 during the turn). Likely a Shadow start-of-game/effect MP gain or a promote bonus — flag to confirm.
- No flanks yet; held the rest of hand.
- Read: conservative, value-first opening — establish rank, bank MP, don't overcommit turn 1.

**Human turn 2 (Exchange 2) — aggressive tempo swing:**
- Rank-up chain: **Shadow 2 → Shadow 5** (climbed to a rank-2 numeral, NP 5).
- **Double flank**: Shadow 4 on the **left** AND Shadow 4 on the **right** — built a full front line in one turn.
- MP **17 → 23** (+6 more banked even while spending).
- **Attacked** my lone Shadow 1 left flank and destroyed it (→ my Deadzone); dealt me **~10 MP** of damage (my 16 → 6).
- Read: punished my weak, unsupported flank immediately, and did it while STILL climbing rank + banking MP. Bots almost never combine "rank up + full board + punish + economy" in one turn — they do one thing. **Key lesson: a strong turn is multi-objective (tempo + board + damage + economy at once), and it targets the opponent's weakest committed piece.**

**RULE learned mid-game (promotion legality — bots must respect this):** To promote a numeral onto your Rank Zone it must be **NP +1 to +3** over the current rank numeral, at **Rank ±0 or +1** — OR the exact same card — OR the same NP at Rank +1. (Log: _"Cannot promote: Shadow 6 (NP6,R2) → current (NP2,R1). Need NP +1–3 (R±0/+1), or exact same card, or same NP with Rank +1."_) → **Implication for the human's skill:** their Shadow 2 → Shadow 5 was a legal +3 jump — they promoted the MAXIMUM allowed step (NP +3) in one go, climbing rank as fast as the rules permit. A good bot should prefer the largest legal promotion step it can afford, not a timid +1. Also: you get rank-LOCKED if your hand has no numeral in the +1–3 NP window over your current rank (my problem this turn: NP1/NP6/NP7 vs a Shadow 2 rank → nothing legal to promote). So hand composition / drawing toward the promotion window matters.

**ANTI-PATTERN (bot mistake to eliminate) — "reflexive development":** While rank-locked + low MP, the bot (me) flanked a **Numeral 1 (NP1, R0)** just to "do something." It was strictly bad: (a) threatens nothing — NP1 loses every attack; (b) defends nothing real — the rank wasn't in kill range; (c) hands the opponent a free kill + a Casualty; (d) burns a card and a flank slot. → **Rebuild rule:** before committing a card, the eval must answer *does this create a real threat, win/trade a combat, or protect something that's actually threatened?* If none → **hold and pass** (dig toward the promotion window) or play a **disruption/area** card instead. "Develop for development's sake" with a sub-rank-NP piece is negative value. (Also: a chump-blocker only helps vs. a lethal attack on a key piece; a lone NP1 vs. a 3-attacker board barely matters.)

**TECHNIQUES the human taught (bots must know these):**
- **+M flank → Stand Down = free MP.** A card with a positive **M** value gives that MP when you PLAY it (e.g. as a flank). So even a card you don't want on the board: flank it to bank the +M, then **Stand Down** to clear the slot. Net = MP gained from an otherwise-dead card. → The bot's flank eval must include "does playing this net MP via its M value?", and it should recognize the flank-for-MP-then-stand-down line.
- **Switchdraw to fish.** Action cards you can't use this turn can be **switchdrawn** (shuffle back + redraw) to dig toward what you need (e.g. a numeral in your promotion window). Don't sit on dead action cards — cycle them. → Bot should switchdraw unusable Action cards to improve draw quality, especially when rank-locked.

## Game 2 — Maximum (bot/Claude) vs classless-heavy (human)
- **Human strategy = MP ECONOMY / stockpile.** By Exchange 2 the human sat at a token board (Numeral 1 rank, no flanks) but banked **MP 15 → 26** with **3 cards in the Deadzone** — i.e. repeatedly **flanked +M cards then Stood Down** to convert cards into MP, holding a minimal but cheap board. Read: they're building a huge MP reserve behind a low-commitment front, almost certainly to fund a big MP-dump play later (Maximum-style rank-MAX / a costed skill / an Ultimate). → **Bot archetype to model:** the "economy" plan — trade board tempo for MP when the opponent isn't pressuring, then cash it in. A bot must (a) recognize when it's safe to bank vs. must contest, and (b) value +M-flank→stand-down as an MP engine.
- **My reply (avoiding the earlier blunder):** rank-locked again (no NP+1–3 numeral over my Numeral 2), and my +M cards were all high-NP Maximums I can't flank at NP2 — so instead of wasting a card on a dead flank, I played **Higher Ground (Area, M+9)** for **+9 MP (16→25)** plus a board effect. Kept economy pace without the negative-value play. _(Lesson applied: only commit a card if it nets MP, threatens, or defends.)_

_(subsequent turns appended below as observed)_
