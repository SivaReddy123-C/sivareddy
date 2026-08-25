# JobRadar — an honest job-search platform (working title)

> Free for students while they job-hunt. When you land a job, you can pay it
> forward to fund the next student. Open books, open source, no dark patterns.

**My bio/portfolio moved to [PROFILE.md](PROFILE.md).**

## Why this exists

Job seekers — especially students in India who have often already paid lakhs
for training — get looted twice: once by "placement guarantee" schemes, and
again by a job market full of postings that will never hire anyone, with no
feedback and no accountability. Every incumbent job platform makes money on
the listing side, so nobody fixes it.

This project takes the other side:

1. **Find real jobs** — aggregate postings from official, public ATS APIs
   (Greenhouse, Lever, Ashby, SmartRecruiters). No scraping, no LinkedIn
   automation, no stored credentials.
2. **Flag ghost jobs** — score every posting on published, explainable
   signals (staleness, repost churn, evergreen "talent pool" titles, missing
   salary/location/description) so students stop wasting hours on postings
   that were never real.
3. **Track outcomes** — applied / replied / ghosted / interviewed / hired.
   Aggregated outcomes become an employer response scorecard nobody else
   will publish.

## Principles (the non-negotiables)

- **Pay-it-forward funding.** Free while job-hunting. One optional, one-time
  contribution after you're hired funds the next student. Never required,
  never nagged.
- **Open ledger.** Contributions in, costs out — published publicly, ugly
  months included.
- **Open source.** This repo is the product. Anyone can audit what it does
  or run it themselves.
- **Explainable flags.** Every ghost-risk score lists its exact reasons.
  If we flag a company's posting, the company can see why too.
- **No credential custody.** We never ask for or store anyone's LinkedIn or
  job-portal passwords. Anything acting on a user's behalf runs on the
  user's own machine, with the user confirming each submission.
- **Honest limits.** We cannot get anyone an interview, and mass-applying
  does not work. The product optimizes for outcomes, not application counts.

## Status

**Phase 0** (this code): `jobradar/` — the ATS aggregator + ghost-job scorer.
It is the seed of the dataset and the first public good: run it, publish
what it finds.

Roadmap: resume builder → application tracker with receipts →
assisted apply (client-side, human-confirmed) → employer response scorecard.

## Quick start

```bash
cd jobradar
npm install
npm run probe          # verify which seed-list company boards answer (network required)
npm run fetch          # pull all boards, snapshot, score
npm run report         # ghost-risk distribution + worst offenders
npm run report -- --india   # India-located postings only
npm test               # unit tests (no network needed)
```

The seed list (`jobradar/data/companies.seed.json`) ships **unverified** —
board tokens change and honesty beats pretending. Run `npm run probe`, fix
or remove what fails, and set `"verified": true` on what answers. PRs adding
verified India-relevant boards are the most useful contribution right now.

## How ghost scoring works

Each posting gets 0–100 from published weights (see `jobradar/src/ghost.ts`):
open ≥90 days (+40) or ≥45 days (+20) · evergreen/talent-pool title (+40) ·
reposted under multiple job ids (+25) · thin description (+15) · no salary
info (+10) · no location (+10). Bands: <25 low, <50 medium, <75 high,
≥75 critical. Signals sharpen as the snapshot history grows — the store
tracks when each role was first seen and every job id it has cycled through.

These are heuristics, stated as such. A high score means "spend your time
elsewhere first", not "this company is lying".

## Target

India first: final-year students and freshers in tech, plus India-located
roles at global companies on these ATS platforms. Expand later, not sooner.
