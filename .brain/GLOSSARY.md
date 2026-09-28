# Glossary

Domain terms that aren't self-evident from their code name. Add an entry when a
grilling session or a design discussion coins a term that will show up again in
code, commits, or docs. Keep entries short; link to `DECISIONS.md` for the "why".

## Sing-through (a.k.a. multi-phrase Record)

A **per-press**, default-**off** toggle on the Sing booth's Record control. When
on, one Record press keeps recording across a **run** (below) of phrases
instead of stopping at the current phrase's play-window end. See
`DECISIONS.md` → "Sing-through / multi-phrase Record" for the full design.

## Run (a.k.a. span)

An **unbroken, adjacent** sequence of phrases sung in one continuous
sing-through pass — e.g. phrases 2, 3, 4 with no gap or skip. Represented on
disk as `Take.spanPhraseIds`, an ordered list whose first element is the
take's own `phraseId`. Not to be confused with a **Section**
(`fromPhraseId`/`toPhraseId`, a *feel* grouping for click/tempo) — a run is a
*performance* grouping tied to one recorded `Take`, has no tempo semantics,
and doesn't need to line up with section boundaries.

## Spanning take

A `Take` whose `spanPhraseIds` covers more than one phrase. Credits every
covered phrase's completion cell independently; Keep/Scrap/rating apply to
the whole take atomically (no partial-keep of one phrase inside the run).
Per-phrase Hear-back seeks into the one shared audio blob by that phrase's
offset from the run's start, the same way `latencyCompMs` already skips into
a buffer.
