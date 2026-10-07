---
name: qa-finish
description: Finish the active QA run - validate bug data, generate the Word QA report, record bugs on the Figma "QA - Bug Reports" page in design mode (or build the fallback package), and print the final QA status.
---

# Finish the QA run

1. `node scripts/qa.js validate`. Fix every problem it reports (missing fields, missing evidence files, UI bugs without a
   marked screenshot). Re-open the marked screenshots and check that each red box covers the exact affected area.
2. Fill `run.json` → `summary`, `regressionConcerns`, `environment.notes` (e.g. Safari not tested).
3. `node scripts/qa.js report` → Word report in `reports/latest/`.
4. Figma: **only when `run.json → mode` is "design"** (section 11 of `QA_INSTRUCTIONS.md`). In preview mode, skip this
   step entirely. The Word report is the deliverable.
   - If `UPDATE FIGMA` is "yes" in `QA_CONFIG.md` or the tester confirms now → write the bug cards to the
     **QA - Bug Reports** page only. Load the figma-use skill first.
   - If writing isn't possible → `node scripts/qa.js figma-package` and explain the manual drag-and-drop step.
   - Then run `node scripts/qa.js report` again so the report reflects the Figma status.
5. Reply with the `node scripts/qa.js status` output, the report path, the Figma result (design mode only), and any
   NOT VERIFIED or BLOCKED items that need a manual step. Keep it short.

$ARGUMENTS
