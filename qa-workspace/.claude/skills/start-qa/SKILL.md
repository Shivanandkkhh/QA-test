---
name: start-qa
description: Start a full Shopify QA run (plan, explore, Figma comparison, functional, edge-case and responsive testing, bug validation, Word report and Figma bug cards) using the task in QA_CONFIG.md or the details given in chat.
---

# Start a QA run

1. Read `QA_INSTRUCTIONS.md` completely, then `QA_CONFIG.md` and everything in `input/`.
   The task details may also be in the tester's message; the message wins if they differ.
2. Required: PROJECT NAME, PREVIEW URL, FIGMA link. If one is missing, ask for **only** that.
   Don't ask for source code or credentials unless testing actually needs them
   (e.g. the store is password-protected → ask them to fill `input/credentials.local.json`).
3. `node scripts/qa.js doctor`, then `node scripts/qa.js new-run "<PROJECT NAME>"`, and fill `run.json`.
4. Work through Phases 1–7 from `QA_INSTRUCTIONS.md` in order. Keep `scenarios.json`, `bugs.json` and
   `observations.json` up to date as you go, and run `node scripts/qa.js validate` after adding bugs.
   Give the tester a one-line progress update when each phase starts.
5. When testing is done, follow the `qa-finish` skill (report, Figma, final summary).

Arguments passed to this skill (if any) are extra instructions from the tester: $ARGUMENTS
