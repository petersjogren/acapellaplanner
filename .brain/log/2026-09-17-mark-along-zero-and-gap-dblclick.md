# 2026-09-17 — Mark-along opens at 0; double-click fills gaps

Play ghost auto-opens a phrase at 0 when that time is free, so the first New phrase tap commits `[0, tap]`. Stop without a tap commits `[0, now]` if ≥ 50 ms. Double-click unused space fills a gap. No schema bump.
