# Authorization and tax review remediation

Base reviewed: upstream main `733ac0686337751c50d4f87b75ae378c356da094`. Findings supplied by the founder from an independent ZIP review. That reviewer reported 384 passing database/application tests; those results are not evidence for this change.

## Behavior

- Every customer line starts undecided. Each needs an explicit Approve or Decline decision, checked again by the server and database. The older database signing entry point is removed.
- Publishing requires the jurisdiction's approved `estimate_authorization` policy, frozen into the estimate. Unsigned links with missing or retired policies cannot render or accept signatures. Signed historical records retain their actual consent and evidence; unsigned legacy estimates must be republished. No production policy is auto-approved or seeded.
- New signing archives the frozen snapshot fingerprint, every decision, name, drawn signature strokes, IP, browser/device user agent, request ID, timestamp, policy ID/version/hash/text, and PDF bytes/hash in the existing append-only authorization record. The PDF embeds machine-readable evidence. Customer downloads require the live bearer link; tenant downloads require a signed-in shop and RLS. Earlier evidence is not recreated or backdated.
- Parts/materials and labor have explicit taxable overrides. Owner business settings supply the tax rate and initial line-type choices. Tax is calculated only on approved taxable lines, consistently in estimate totals, signing totals and invoices. Frozen legacy lines without a tax flag keep their original tax basis. Published estimates require a revision and new signature for a different tax treatment.
- Public estimate/invoice requests use durable keyed counters: reads 300/IP and 1,200/token per 15 minutes; signing 30/IP and 10/token per 15 minutes. Reads fail closed with 429 or 503. Counter storage retains keyed hashes, not bearer tokens. Trusted hosting must replace inbound forwarded IP headers; token limits also apply across IPs.
- `/dev/inbox` is restricted to local/test, not hosted previews. Local seed credentials and README now describe email/password authentication.

## Tax review

Source checked October 31, 2026: [Texas Comptroller, Motor Vehicle Repairs, Remodels and Maintenance](https://comptroller.texas.gov/taxes/publications/94-113.php), publication 94-113 (04/2026). For separated repair invoices, parts are taxable and repair labor is not. Lump-sum contracts, accessories, component sales, warranties and other trades can differ. The defaults are editable starting choices, not a tax engine or CPA sign-off. Confirm actual shop treatment and local rate with the shop's accountant before first use. Do not silently rewrite existing approved estimates or invoices.

## Remaining launch evidence

Actual counsel-approved Texas policies must be entered and approved through the two-admin policy manager. A test fixture policy exists only in local/test, visibly labelled as test wording. PDF generation alone is not legal enforceability certification.

Main branch protection remains a launch blocker. Earlier setup was blocked by the private repository's GitHub plan. Required protection is PR review plus passing `test` and `e2e` checks; formatting and a clean test run cannot substitute for enforcement. No repository visibility or billing changes are authorized by this remediation.

Independent review and the existing production authentication, payments, backups, operational and design-partner launch evidence remain required. This branch is not authorization to onboard a live shop or promote production.
