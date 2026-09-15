# Maintaining this second brain

This folder is the engineering on-ramp. User docs stay in `README.md` / `docs/`.

**A feature is not done until `.brain/` matches HEAD.** Prefer updating these files in the same change as the code.

| File | Read when | Write when |
|---|---|---|
| `PROJECT.md` | What the app is, commands, non-goals | Product / stack / deploy change |
| `ARCHITECTURE.md` | Boundaries, data, audio, export | Layer, invariant, or schema-flow change |
| `CONVENTIONS.md` | Placement of code and tests | Only a convention that will be repeated |
| `CURRENT.md` | What works at HEAD | End of every user-visible feature |
| `TODO.md` | Known debt | Add holes you find; delete items you close |
| `LEARNINGS.md` | Alignment, Safari, queues, zip | After a non-obvious bug or near-miss |
| `DECISIONS.md` | Choices not to re-litigate | When you make or reverse a decision |
| `log/` | Recent work | Append `YYYY-MM-DD-<slug>.md` per landed feature |

Keep entries high-signal. Do not restate filenames or README quickstart. If unsure, write `uncertain:` — do not invent.

Repo-root `AGENTS.md` points here and repeats the product rails. Treat either file as the contract.
