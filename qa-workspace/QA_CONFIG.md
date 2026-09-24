# QA Task Sheet

Fill this in (or paste the same fields into the chat) before each QA task, then type `/start-qa`.
Leave optional lines empty. **Do not put passwords here** — they go in `input/credentials.local.json`.

```
PROJECT NAME:
PREVIEW URL:
FIGMA:                 (Figma link to the file/page/frame, e.g. https://www.figma.com/design/AbC123/Store?node-id=12-345)
REQUIREMENT:           (optional: Jira ticket / acceptance criteria, or a file name in input/requirements/)
PAGES IN SCOPE:        (optional: e.g. Home, PDP /products/xyz, Cart drawer)
SOURCE CODE:           (optional: only if a developer gave you a folder)
TEST CREDENTIALS:      (optional: write "see credentials file" — never the password itself)
SPECIAL INSTRUCTIONS:  (optional: e.g. "focus on mobile", "test discount code QA10", "skip footer")
UPDATE FIGMA:          (yes / no — yes = write bug cards onto the "QA - Bug Reports" page)
TESTER NAME:           (shown on the report)
```

## Credentials (only if needed)

Copy `input/credentials.example.json` to `input/credentials.local.json` and fill in what applies:

- `storePassword` — the storefront password (for password-protected stores/previews)
- `customerEmail` / `customerPassword` — a **test** customer account, for login/account testing

This file is never copied into reports, and it is listed in `.gitignore`.
