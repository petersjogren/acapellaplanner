# 2026-09-15 — booth wrap-up picker race

Deploy test `Need more takes reopens the part…` failed in CI looking for wrap copy while still on “Who is singing?”. Resetting booth selection when the loaded `project.id` hydrated (`undefined → id`) ran after the first PartPicker paint and wiped the S1 pick in the same tick.

Fix: reset on the route param, not loaded project id. Wrap assertions match `/a wrap for Soprano 1/` (curly apostrophe is not the failure).
