# M7 Money Finder

Money Finder reads current tenant records on each request. It stores follow-up preferences and evidence, not cached opportunity amounts or recovered-revenue claims. M5 automated messaging and M6 imports remain removed by the October 27 scope revision.

## Eligibility

- Declined work: actual signed declines, plus shop-entered postponed work, within 18 months; open recommendations grouped by customer and vehicle. Known pretax prices are summed only when every grouped line has a known price. An unknown price stays unknown.
- Open estimates: latest unsigned, unrevoked version at least two days old; expired versions remain eligible for 60 days and carry a renew-first notice. Signed decisions are excluded. Publishing a supplement marks open recommendations from the superseded quote versions as re-quoted.
- Unpaid invoices: issued at least three days ago, positive current balance including tax, unvoided, and no shop-recorded open dispute. The dispute control is bookkeeping for follow-up eligibility; it does not create, resolve, or synchronize a Stripe dispute. Shops must record reported disputes here.
- Not back in 6+ months: actual fully paid, unvoided invoices establish the latest visit, between 6 and 24 calendar months ago. Visit dates use the invoice issue date, so paying an old balance today cannot fabricate a recent visit. No fabricated visits or imported history. Customers with declined/open/unpaid items, a future appointment, or a lapsed contact within 90 days are excluded. The average of up to five recent paid invoices is labeled estimated and excluded from the known-dollar banner.
- Service due: a date entered by the shop, from 90 days overdue to 14 days ahead. Future vehicle appointments and recent fully paid invoices suppress it. No mileage-based service schedule is inferred. The category stays hidden until a vehicle has a service date.

Archived customers, do-not-contact customers, and archived vehicles are excluded. Snoozes last 30 or 90 shop-local calendar days and resurface through the live query. Dismissal requires a reason; restoring a declined group reopens only recommendations dismissed with that group. Paid, voided, signed, superseded or otherwise ineligible source records drop out naturally.

## Manual workflow and attribution groundwork

Owner and staff can record contact method/notes, responses, snoozes and dismissals. Phone and email links open the user's chosen app; Shop Revenue sends no messages. Contact history is written to customer activity and the audit log. Support remains read-only.

Starting a job or appointment creates a stable tenant-scoped recovery identity before navigation. Server-side validation rejects substituted tenants, customers or vehicles. Job revisions preserve the original source; frozen estimate versions and appointments retain that identity. Creating the appointment records booked state. These are origin links for M8, not proof of recovered revenue. Enter actual work, prices and costs in the job editor; no quote is invented from a follow-up alert. Recommendation outcomes can be updated from the vehicle record.

## Storage and security

Forward migrations 0015–0017 add recommendations, recovery workflow, service fields, do-not-contact, origin links and shop-recorded invoice dispute holds. Signed-decline backfill uses actual authorization line decisions; superseded versions backfill as quoted. New authorization inserts capture unselected lines atomically through a tenant-constrained trigger policy. Both new tenant tables force RLS. All new foreign keys include business identity. Public estimate/invoice responses do not expose recovery or internal cost data.

## Verification

The implementation includes domain/database rules, generated isolation coverage for both new tables, a 20,000-customer live-query benchmark, source propagation to frozen estimates and appointments, and phone/desktop browser coverage for real entered work, snoozing, manual contact and source-linked job creation. CI gates preview migrations and deployment on database and browser success. Preview uses the existing stable alias so its auth and payment callback configuration remains valid. Production is unchanged.

M8 recovered revenue and M9 launch hardening remain separate. Production email/reset delivery and the outstanding provider fault-observation limits documented in M4 are not certified by these tests.

Before deployment, the development project's advisory baseline included seven Graphile Worker search-path warnings and disabled leaked-password protection, plus existing unindexed foreign keys. These belong to the launch-hardening review; M7 does not change authentication policy or third-party worker internals. References: [function search paths](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), [foreign-key indexes](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys). New recommendation/recovery reference keys receive covering indexes in 0017.
