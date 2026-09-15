# 2026-09-15 — clap-with-click stop criteria

Clap mode saved wildly different latencies (≈19 / 90 / 650 ms) because a 12-click median+MAD run could look “stable” on click leak, a one-beat alias, or the real clap.

Now: up to 40 clicks, stop only after ≥16 closed clicks with ≥10 MAD inliers, MAD ≤ 20 ms, and Normal–Normal 95% half-width ≤ 15 ms. Pairing capped at 400 ms. Louder peak in a 160 ms window replaces click leak. Copy tells the singer to keep going until it says lined up.
