# 2026-09-15 — latency tone detection

Calibration never heard the probe: 80 ms / 0.35 sine plus a broadband peak (then adaptive 0.03) is a clap detector. Singers were also told to play *then* move the mic.

Now: 500 ms / 0.9 880 Hz tone, `AnalyserNode` frequency SNR vs neighbouring bins, two-frame onset, 800 ms window. Page is one tap (**Line up**), silent 300 ms warmup, auto-save. Miss → singer copy + optional typed ms. AEC still on → “this phone is blocking the tone.” Alignment math unchanged (buffer skip).
