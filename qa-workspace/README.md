# Shopify QA Workspace

You give it a Shopify preview link and a Figma design. Claude tests the site in a real browser, checks and
reproduces bugs, takes marked screenshots, and gives you:

- a **Word QA report** in `reports/latest/`
- **bug cards on your Figma "QA - Bug Reports" page**, or ready-made images to drag into Figma
- a **final QA summary** in the chat

You don't need to know programming or Git.

---

## How to start (every time)

1. **Open the folder in VS Code**
   *File → Open Folder…* → choose **`qa-workspace`**. Open this folder itself, not the folder above it, so Claude
   picks up the QA rules.
2. **Start Claude.** Open the terminal (*Terminal → New Terminal*), type `claude` and press Enter.
   You can also use the Claude Code panel in VS Code.
3. **Fill in the task.** Open `QA_CONFIG.md` and fill in the fields: project name, preview URL, Figma link, and so on.
   Put any requirement or ticket text in `input/requirements/`.
4. **If the store has a password,** copy `input/credentials.example.json` to `input/credentials.local.json` and
   type the password into it.
5. **Type `/start-qa` and press Enter.**
   You can also skip step 3 and paste the details straight into the chat:

   ```
   /start-qa
   PROJECT NAME: Summer Launch PDP
   PREVIEW URL: https://mystore.myshopify.com/products/sandal?preview_theme_id=1234567
   FIGMA: https://www.figma.com/design/AbC123/Summer?node-id=10-200
   REQUIREMENT: input/requirements/JIRA-512.txt
   UPDATE FIGMA: yes
   ```
6. **Answer Claude's questions.** It asks only for what's missing. It shows you the test plan first, then works
   through each phase and keeps you updated.
7. **At the end,** Claude runs `/qa-finish` itself. If you stopped earlier, type `/qa-finish` to get the report and
   the Figma cards.

**First time on this computer only:** open the terminal in this folder and run `npm install`.
Then run `node scripts/qa.js doctor` and check that everything shows OK.

---

## Where things go

| Folder | What's in it |
|---|---|
| `QA_CONFIG.md` | The task sheet you fill in |
| `input/requirements/` | Jira/ticket text and acceptance criteria that you add |
| `input/screenshots/`, `input/notes/` | Your own screenshots and notes (optional) |
| `input/source-code/` | Optional copy of the developer's code. Claude can only read it; editing is blocked |
| `input/credentials.local.json` | Store password or test login. It never goes into any report |
| `evidence/screenshots/` | Screenshots from the site, one folder per run |
| `evidence/marked/` | The same screenshots with a red box around the bug |
| `evidence/comparison/` | The site and the Figma design side by side |
| `test-results/` | Claude's working notes for each run: test plan, scenarios and the bug list |
| `reports/latest/` | **The newest Word report** |
| `reports/archive/` | Older reports |
| `figma-package/` | Bug-card images to drag into Figma, used only if Claude can't edit the file |
| `QA_INSTRUCTIONS.md` | The full QA rulebook Claude follows. You don't need to edit it |

---

## Things to know

- **Nothing on the website is changed.** Claude acts as a customer. It will add to cart, but it never places an
  order or changes anything in the Shopify admin, and it asks before submitting forms that send real emails or
  create accounts.
- **Figma:** Claude writes only on the page called **QA - Bug Reports**, and asks you first. Your original designs
  are never edited. Your Figma account needs edit access to that file: a "Dev" or "View" seat can't edit, and in that
  case you get a folder of bug-card images to drag in by hand.
- **Browsers:** testing uses Google Chrome, on desktop and emulated phones and tablets. To also test Safari and
  Firefox engines, run `npx playwright install webkit firefox` once. Real iPhones and Android devices are not covered
  and are listed as not tested in the report.
- **NOT VERIFIED** means Claude could not check it for sure, for example because it needs a real payment, an email
  inbox or a physical device. Those items are listed at the end of the report so you can check them by hand.
- **No Git.** This workspace never creates repositories, commits or pushes. The `.gitignore` is there only so that
  if someone ever puts this folder in Git, passwords, screenshots and reports stay out of it.

---

## Useful things to type to Claude

- `/start-qa` — run a full QA pass
- `/qa-finish` — create the Word report and Figma cards, and show the summary
- "Re-test BUG-003 on mobile"
- "Only test the cart drawer this time"
- "Show me the marked screenshot for BUG-002"
- "Regenerate the report"
