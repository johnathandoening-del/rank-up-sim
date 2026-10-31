# Phantom 0 Post-Attack Resolution

Date: 2026-10-31

## Rule

Phantom 0 activates and pays its top-Deck-to-Drop cost during the defense window. Its effect waits until that attack and all resulting Casualty Draws and their effects finish. It then reads its controller's current Casualty Count and selects that many cards, capped by the attacker's remaining hand size, to send from the attacker's hand to their Deadzone. A nonpositive count sends no cards.

## Direct Source Changes

- Replaced the human reactive skill's immediate effect with a deferred continuation using the existing deterministic settle scheduler.
- Removed the bot's immediate post-damage implementation. The bot now pays before damage and uses the same deferred resolver.
- Captured the actual attacker, defender and counterattack frame so multiplayer targets stay correct and an interrupted attack waits for its own queue to resume.
- The activated skill survives the defending Phantom 0 being defeated. Turn/phase defeat timing and the -7 Casualty floor are unchanged.

## Verification

These are constructed real-engine regression positions, not natural full games.

- Full declared attacks for all 14 seat/mode combinations across Standard, Royale, Tag and Team: no attacker hand cards move before Casualty Draws finish; the owner then selects using the final count.
- Bot defense in Standard, Tag and Team uses the same delayed timing.
- Defeated Flank Phantom 0 resolves with negative, zero and positive starting counts.
- Counterattack interrupt and restored Casualty queue complete before Phantom 0 resolves.
- Existing counterattack/Cease and card-rule regression suites pass.
- Four-client Team relay: 250 inputs, zero splits and zero engine errors.

