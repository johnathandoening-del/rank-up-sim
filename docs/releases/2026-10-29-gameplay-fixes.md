# Gameplay Fix Release

Base: live source `6524f17`. This release does not replace the live bot planner
with the unfinished strategy rebuild.

- All Tag/Team bot seats inherit the selected level and Delta Deck allowance.
- Malevolent Amalgamation 1 draws for its activator and mills each enemy Deck
  by the drawn card's positive M; zero/negative M does not mill.
- Area activations are owner-only, including in a shared Tag Deadzone.
- Counterattacks pause the remaining Casualty queue, use green board selection,
  resolve attack damage, and resume the original draws. Cancel also resumes them.
- Tag's multi-opponent Morbid Cemetery/Neo Multi Star casualty effects select
  one enemy recipient; once-per-team MP handling remains unchanged.
- Stale allied opponent selections are rejected. Neo Rank Star's existing
  self-drop is covered by regression tests.

Validation: real-engine fixtures for all 14 tier assignments, both 2v2 modes,
52 Malevolent Amalgamation 1 cases, Area ownership, Counterattack interruption
and cancellation, Neo Rank Star and Tag recipient selection; the existing 101
mode-rule checks; Chromium menu starts at five levels per mode and Counterattack
board interactions. Constructed/automated tests are not natural full matches.

The full strategy rebuild remains separate: live observer-history capture,
Temporal hidden-history integrity and cooperative strategy calibration are open.
