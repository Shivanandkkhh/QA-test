---
name: start-qa
description: Start a Shopify QA run using the task in QA_CONFIG.md or the details given in chat. Design QA (preview URL + Figma) runs the full flow, including Figma comparison and Figma bug cards. Preview-only QA (preview URL, no Figma) tests the site on its own and lists all bugs in the Word report.
---

# Start a QA run

1. Read `QA_INSTRUCTIONS.md` completely (especially section 0.1, "QA modes"), then `QA_CONFIG.md` and everything in `input/`.
   The task details may also be in the tester's message; the message wins if they differ.
2. Required: PROJECT NAME and PREVIEW URL. If one is missing, ask for **only** that.
   FIGMA is optional and it decides the mode:
   - Figma link given → **design** mode (Design QA).
   - No Figma link → **preview** mode (Preview-only QA). Don't ask for a Figma link.
   Don't ask for source code or credentials unless testing actually needs them
   (e.g. the store is password-protected → ask them to fill `input/credentials.local.json`).
3. `node scripts/qa.js doctor`, then `node scripts/qa.js new-run "<PROJECT NAME>" --mode design|preview`, and fill `run.json`.
4. Work through the phases from `QA_INSTRUCTIONS.md` in order: 1–7 in design mode, and 1, 2, 4, 5, 6, 7 in preview mode
   (no Figma reads or writes at all). Keep `scenarios.json`, `bugs.json` and `observations.json` up to date as you go,
   and run `node scripts/qa.js validate` after adding bugs. Tell the tester the mode at the start, and give a one-line
   progress update when each phase starts.
5. When testing is done, follow the `qa-finish` skill (report, then Figma in design mode only, then the final summary).

Arguments passed to this skill (if any) are extra instructions from the tester: $ARGUMENTS
