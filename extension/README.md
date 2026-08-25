# JobRadar Assist (browser extension)

Autofills job application forms on **Greenhouse, Lever, and Ashby** from the
data you already keep in the JobRadar app. It outlines every field it filled
and **never submits** — you review, attach your resume, and click Submit
yourself. No credentials, nothing leaves your browser.

## Install (Chrome / Edge / Brave)

1. Download or clone this repository.
2. Open `chrome://extensions` (or `edge://extensions`).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and pick this `extension/` folder.

## Use

1. Open the JobRadar app once while the extension is installed — it syncs your
   contact details, links, skills, and Apply-kit answers into the extension.
2. Open any job's application page (the "Open posting" link from the app).
3. Fields fill automatically a moment after the page loads (blue outline =
   filled by JobRadar). Click the extension icon → **Fill form on this page**
   to re-run, e.g. after moving to the next step of a multi-page form.
3. Review everything, attach your resume PDF, answer anything it could not,
   and submit.

## What it deliberately does not do

- Never clicks Submit, never auto-applies.
- Never overwrites a field you already typed in.
- Only fills a dropdown when your saved answer clearly starts with yes/no.
- Runs only on Greenhouse/Lever/Ashby application pages and the JobRadar app.
