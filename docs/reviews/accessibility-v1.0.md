# Accessibility review, v1.0

Date: 2026-11-16. Status: automated checks pass. **Nobody has used HQ with a
screen reader or by keyboard alone from start to finish.** The roadmap's
v1.0 gate should be read as still open until that is done.

Target: WCAG 2.1, level AA.

## What is checked on every merge

The browser tests open each screen in a real browser and run axe against
it, with the WCAG 2.0 and 2.1 A and AA rules. A screen with any finding
fails the build.

| Screens | Test |
| --- | --- |
| Sign-in, setup, dashboard, settings, light and dark | `test/e2e/shell.test.ts` |
| Clients, a client, pipeline, an opportunity | `test/e2e/crm.test.ts` |
| Projects, a project, tasks, the board, a task | `test/e2e/projects.test.ts` |
| Proposals, a draft, a sent version | `test/e2e/proposals.test.ts` |
| Time, Money, a project's money, an invoice | `test/e2e/finance.test.ts` |
| The portal: accept, home, a project, a proposal, sign-in, light and dark | `test/e2e/portal.test.ts` |
| People, audit history, knowledge base, an article, reports | `test/e2e/platform.test.ts` |

Colour contrast in both themes is also checked from the theme files
themselves (`test/integration/theme-contrast.test.ts`).

## What was built in

- Every page has one `h1`, a title, a skip link, and landmarks.
- Every form field has a visible label, and labels are unique on a page.
- Everything works without a pointer. The board's drag and drop has a menu
  on each card that does the same thing.
- Everything works with scripts off: pages are rendered on the server and
  forms are plain posts.
- Messages after a save are in a live region.
- Tables have header cells with scope. Wide tables scroll inside a region
  that can be focused.
- Dark mode follows the device or a setting, with no script.

## What automated checks cannot tell

axe finds perhaps a third to a half of real problems. Not yet checked by a
person:

1. Reading order and announcements with a screen reader (NVDA, VoiceOver).
2. A full pass by keyboard only, watching where focus goes after each save.
3. Zoom to 200% and 400%, and a narrow phone screen, on every page.
4. Whether error messages are understood without seeing where they appear.
5. The PDFs. Proposals and invoices are generated without tags, so a screen
   reader gets their text in order but no structure. The same content is on
   the page they are downloaded from.
