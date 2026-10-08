# Phrase labels and time left

New phrases are unnamed. Birth-order `Phrase N` named a gap out of song order, so the booth no longer assigns it. Where a preparer or singer picks a phrase, the label is the typed name, or the start time if the name is empty.

- An unnamed phrase stores `name: ""`. `phraseLabel` is the trimmed name, else `formatPhraseClock` (`0:30.0`), not stored. A stored `Phrase N` stays until **Clear name**. No auto-strip. No schema bump.
- **Clear name** sits beside Name only when a name is set. It calls `updatePhrase` with an empty name for that phrase only.
- List, matrix, review, section from/to, and stem notes use the phrase label. Play chips are trimmed lyric, else the label, never blank. The singer's big line is lyric, else typed name, else blank — never a clock. Stem `p` indexes stay song position.
- Phrase length (`phraseLengthLabel`, `8.4 s`) sits under `Phrase i of n` on the shared stage (Sing and Play) and stays through Hear / Keep / Scrap.
- Time left (`timeLeftFraction`) is a pie on Record only: empty in the head start, filling while the sentence sounds, full in the tail. Play has no pie. Idle Record stays flat red. The dock reserves 22px so the armed lamp glow is not clipped.
