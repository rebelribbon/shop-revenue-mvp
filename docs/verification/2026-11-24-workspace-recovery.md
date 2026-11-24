# Workspace outage and mobile recovery — November 24, 2026

Production commit `58282f584747620e26580c72a4d6b2c20768463f` selected
`app.business.inspection_media_requirements`, but production's Drizzle journal
stopped at migration 0056. Both `/automotive` and the legacy workspace failed
while loading the business profile. The connection-only health query still
returned success.

Applied the existing migration `0057_inspection_media_requirements.sql` to the
production database and recorded its exact SHA-256 and journal timestamp.
Verified the affected business reads the new default `{photos:false,videos:false}`,
the app role can select the column, the journal matches the repository, and
schema-owner role membership matches its original permissions. Existing work
and media requirements are preserved; photos and videos remain optional by default.

The health probe now validates the actual business-profile selection with
`LIMIT 0`, through the runtime app role, without fetching tenant records. A
missing business column makes deployment smoke fail. The production build also
requires this schema check in both release profiles, and the deployment workflow
applies migrations after its backup check and before building the candidate.
Automotive route failures
return a noncached HTML 503 with a retry link; framework authentication redirects
still propagate normally. This prevents an empty error response being offered
as a file download.

The legacy mobile header uses 48px icon controls, an overlaid task badge capped
at `99+`, and its shop-name home link for the Automotive destination. The extra
Automotive shortcut remains on desktop. Desktop search can shrink to fit the
available width. Error navigation says “Return to workspace.”

Validation: TypeScript and scoped ESLint passed. Seven recovery/UX tests passed,
including HTML failure output, redirect preservation, schema-check failure cleanup,
spacing and contrast. Seventeen release-gate tests cover required schema checks
and migration/build/smoke/promotion order.
Browser measurements of a fixture using the actual global stylesheet, a long
shop name and 125 tasks showed no horizontal overflow at 340 CSS pixels or
1363 CSS pixels. All phone header controls and the recovery action remained
48px tall. This is Chromium layout coverage, not real-device Safari verification
or an authenticated production workflow test. The live sign-in page was checked;
an authenticated session was unavailable in the browser.

Publication status: the owner approved deployment on November 24. Next.js and
eslint-config-next are updated to 16.4.5 with a consistent lockfile. The full
production build passes with local public-auth placeholders, including
TypeScript and all 72 prerendered pages. Three existing dynamic-filesystem
tracing warnings remain in local media storage. Production uses Supabase media
storage. The fixes are being published through the connected production
repository; the live release will require migration 0058 and schema readiness
before promotion. See the companion estimate/authorization verification note.
