# Timed Matches

Enable Time is optional and off by default, in local and online matches.

Time uses the existing stat-bar styling beside Morale, Casualty and Hand. Per Turn appears only on the active player's row and follows the turn. Per Player is always visible on every player's row; inactive clocks are at 35% opacity and the active clock uses normal stat opacity. Per Game is a single shared clock spanning every player row, with no inactive dimming. The same rules apply in radial multi-seat layouts and each online player's own perspective.

| Type | Presets | Expiry |
| --- | --- | --- |
| Per Turn | 3, 5, 7 minutes | End the current turn, clearing unfinished prompts. |
| Per Player | 5, 7, 10 minutes | The player whose cumulative time expires loses. |
| Per Game | 7, 15, 21, 35 minutes | Stop the match with No Result until winner scoring is specified. No ratings are awarded. |

An unmet Advantageous attack requirement at Per Turn expiry opens a final 15-second attack-or-forfeit window. No legal attack, or no declaration within that window, means forfeiture. A declaration satisfies it even if the attack is stopped or negated. Once declared, the encounter resolves and the turn ends.

Each Per Turn budget resets at a turn handoff. Per Player budgets persist and only the turn player's clock runs. Per Game runs continuously. Online clocks pause while either player is disconnected or rebuilding the match after rejoining. Reconnecting never replenishes a budget.

The room creator chooses timing when joining the room. Joining players cannot change it, including enabling timing in an untimed room. Spectators receive the room's rules and live clock but cannot change either.

## Implementation

- `match-clock.js`: shared arithmetic, validated presets, grace, pause and progress transitions.
- `time-controls.js`: lobby controls, clock display, local clock and engine expiry handling.
- `server/room-server.js`: authoritative online clock and ordered timeout events, preserved in reconnect logs.
- `net.js`: clock synchronization and server-confirmed inputs in timed online matches. Untimed input behavior is unchanged.
- Engine lifecycle calls timing directly; no timer wrappers are installed around game functions.

## Verification

- `node tools/headless/time-regressions.js`: all presets, cumulative time, pauses, expiry in every phase, outstanding prompts, attack requirements and stopped attacks.
- `node tools/time-network-regressions.js`: real WebSockets with an isolated server and an injected test clock; no production time override. Covers creator rules, server echo/order, spectator isolation, expiry, stale inputs, disconnection and replay.
- `/tools/time-browser-regression.html`: actual lobby controls, P1/P2/spectator games, switchdraw and End Turn buttons, synchronized engine state and clock handoff.

Per Game winner scoring intentionally remains unimplemented pending the four-condition scoring rules.
