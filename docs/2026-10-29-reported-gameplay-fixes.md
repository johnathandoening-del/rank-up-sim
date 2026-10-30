# Reported Gameplay Fixes

Date: October 29, 2026.

Local tested release fingerprint:
`sha256-6f80ecca68397b132d9eca64c8c5fa03120cb55fe5ccd64f6f44eff94ff65414`.

## Corrections

1. Counterattack decisions identify the controller, source card and attacker/target/resolution stage. Board-pick candidates use the engine's actual legal-target predicate.
2. Counterattack suspends the active casualty as well as the remaining queue. Completion resumes the correct continuation or restarts an otherwise idle queue. Nested counterattacks finish in stack order, including an own-turn response to an opposing counterattack. Cancellation cannot orphan the queue.
3. Cease E2 has one implementation at the E2 dispatcher. It drops itself, then asks its owner which additional Deadzone card or Shell to drop. The conflicting class-specific Cease implementations were removed.
4. Stall E2 asks whether to use the bonus removal after drawing a Safeguard, then offers the owner's card/Shell selection. An empty Deadzone no longer silently ends the effect. Shell IDs use the game's restorable ID generator.
5. Dreadnaught Airship's entry effect uses the common Area-entry path. It works on hand entry, casualty entry and other moves into a Deadzone, once per physical entry in shared Tag Deadzones. Its temporary zeroing expires at End Phase.
6. Evolution material generation and execution reject a partner's Rank Zone. Legal partner Flanks remain usable. Max Rank Up and other separately permitted material rules are unchanged.
7. Nullify E2 uses the actual list of this turn's casualty cards, not the Deadzone length at activation. Earlier casualties are included. Tag covers its shared Deadzone; Team leaves the partner's separate Deadzone alone. Duplicate class-specific handlers and obsolete cleanup paths were removed.
8. Temporal 8 records Discard entries, including skill payments and a previously discarded card retrieved and paid again this turn. Discarded Evolution Elements retain their parent ID and return to that Evolution instead of entering the hand. Old unused Drop cards remain in Drop.
9. Amalgamation Nation's effect animation uses its own Amalgamation family glyph rather than its controller's class icon.
10. Neo Battle Star E1 explicitly selects its Deadzone payment. Its generic E2 path also selects the required cards/Shells. Tests choose non-first cards and verify that unselected cards remain.
11. Common Area movement records identify the Area by name, the actor, and whose Deadzone it entered or left. Shared Tag piles do not duplicate one physical movement. A departure and re-entry within one effect are separately recorded.

Phase-boundary win/loss timing and comeback opportunities were preserved.

## Executed Verification

- All 18 selected gameplay regression suites passed on the release sources.
- 101 existing Tag/Team rule checks passed.
- Counterattack source/target and queue tests cover every seat in standard, Royale, Tag and Team, plus nested counterattacks.
- Cease payment and self-drop tests cover all 19 classes from both seat orientations.
- Reported-effect fixtures cover Stall and Shell replay, material restrictions and actual legal assembly, Airship entry/expiry, Nullify with earlier and partner casualties, Neo Battle Star payments, Temporal 8 refunds, and named Area movement.
- Real Chromium with the production host/worker resolved the constructed counterattack window in all four modes in approximately five seconds per case. Tag and Team included a damaging counterattack and its ensuing casualty responses; the standard/Royale bot declined its target without stalling and resumed the original queue.
- Chromium displayed the owner-controlled Cease picker, Stall's optional Shell removal, and Amalgamation Nation's U+E017 effect glyph. Screenshots are in `tools/headless/data/`.
- Real room-server/four-client relay tests applied 250 inputs in Tag and 250 in Team with zero state splits and zero engine errors.
- All 58 inline scripts passed JavaScript syntax compilation; `git diff --check` passed.

These are controlled regression, browser integration and relay tests, not claims of natural full-match play or bot mastery. No finite test set guarantees that every future combination is bug-free.

## Release Boundary

This release edits the executing gameplay implementations, move generation and snapshot cleanup directly. It adds no runtime override wrappers. It does not replace `ai/brain.js` with a partially validated planner. The same gameplay corrections were incorporated into the development checkout without discarding its separate strategy work.

A page loaded before deployment still holds the previous JavaScript and pending callbacks. Refresh and start a new match to use the corrected version.
