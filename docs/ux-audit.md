# UX standards audit

Scope: every existing page template, shared UI, loading/error boundary, automotive and home-service variant. Provider-hosted Stripe/Google/GitHub screens are external and are not restyled by this app.

## Enforced design system

- Margins, padding and layout gaps use multiples of 8px. Device safe-area spacing rounds up to the grid where CSS stepped math is supported.
- Desktop shop navigation uses a persistent sidebar with Home, Customers, Work, Schedule and Settings. Mobile keeps four core destinations in the bottom bar (Home, Customers, Work and Visits), with Settings available from the persistent header. Accessible labels retain the full destination names. Admin navigation has five items; support navigation has three. Sign-out is a utility in Settings/Admin help.
- Core work pages have homepage shortcuts; Work opens the job list directly; Jobs, Estimates and Invoices have a shared three-stage navigation. Business settings and payments are within three homepage clicks. Customer rows link directly to vehicles, so vehicle edit/save can be reached in three clicks. Existing destructive-action confirmations intentionally add a confirmation step; they are preserved rather than weakened to meet a click budget.
- Text/status/link/hover colors in light and dark themes must reach 4.5:1. Body, input, caption and navigation text use 16px. Prose is capped at 65ch; structured tables are independently scrollable.
- Forms use one column and persistent labels above text inputs. Checkbox/radio labels provide a minimum 48px effective hit area.
- Every settled interactive page has one primary action. The existing control is enhanced, never cloned, preserving its form association, validation, pending state and focus. Entering an editing form makes its safe submit action primary. List screens retain their explicit New action while their secondary search controls stay in place. Destructive actions are excluded from the sticky primary area and keep secondary/danger styling and existing confirmation.
- The primary action stays in the bottom half on mobile, above the bottom navigation bar with an 8px gap. The content scroll area reserves room so pinned controls do not cover fields or other actions. Read-only pages get a meaningful print or navigation action. Noninteractive loading placeholders do not invent a CTA.
- All interactive controls have a 48×48px minimum effective hit area and visible borders/backgrounds. Adjacent targets have at least 8px separation. Hover feedback uses 80ms transitions; keyboard focus and reduced-motion treatment are explicit.
- With public signup enabled, `/` leads new visitors to `/pricing`, then `/sign-up` and `/start` for the commercial subscription flow (revision November 5, 2026). With signup closed, `/` redirects to sign-in or the workspace. Workspace information follows a left-aligned hierarchy; Z-pattern marketing blocks are not applicable to these forms/data pages.

## Verification

CSS regression tests calculate contrast from actual light/dark tokens, check every authored spacing declaration and cap hover duration. Browser measurements at the top and bottom of reviewed routes inspect target dimensions/gaps, input labels/type size, single-column field placement, navigation counts, viewport fit and sticky action geometry. Existing invite/reset/public-estimate/public-invoice flows include UX checks. Additional browser coverage visits the main public, shop and admin screens, both customer/vehicle details, a dark-theme state, and core click paths. The existing home-service flow remains enabled.

Phone and desktop screenshots are saved by the browser suite. This audit checks application code and Chromium phone/desktop renderings; real iOS Safari, assistive-technology user testing and every possible data/error combination still require device/manual verification. No claim of complete WCAG certification is made.

## Page inventory

| Page | Review coverage |
| --- | --- |
| `/admin/help` | Shared layout, spacing, forms, targets and CTA review |
| `/admin` | Shared layout, spacing, forms, targets and CTA review |
| `/admin/policies` | Shared layout, spacing, forms, targets and CTA review |
| `/admin/release` | Shared layout, spacing, forms, targets and CTA review |
| `/admin/tenants/[id]` | Shared layout, spacing, forms, targets and CTA review |
| `/admin/webhooks/[id]` | Shared layout, spacing, forms, targets and CTA review |
| `/admin/webhooks` | Shared layout, spacing, forms, targets and CTA review |
| `/admin/sign-in` | Shared layout, spacing, forms, targets and CTA review |
| `/app/customers/[customerId]` | Shared layout, spacing, forms, targets and CTA review |
| `/app/customers/[customerId]/vehicles/[vehicleId]` | Shared layout, spacing, forms, targets and CTA review |
| `/app/customers/new` | Focused customer creation |
| `/app/opportunities` | Dedicated Money Finder workspace |
| `/app/customers` | Shared layout, spacing, forms, targets and CTA review |
| `/app/estimates` | Shared layout, spacing, forms, targets and CTA review |
| `/app/invoices` | Shared layout, spacing, forms, targets and CTA review |
| `/app/jobs` | Shared layout, spacing, forms, targets and CTA review |
| `/app/new` | Compatibility redirect to new job editor |
| `/app` | Shared layout, spacing, forms, targets and CTA review |
| `/app/revenue/[attributionId]` | Shared layout, spacing, forms, targets and CTA review |
| `/app/revenue` | Shared layout, spacing, forms, targets and CTA review |
| `/app/schedule` | Shared layout, spacing, forms, targets and CTA review |
| `/app/settings/business` | Shared layout, spacing, forms, targets and CTA review |
| `/app/settings/export` | Shared layout, spacing, forms, targets and CTA review |
| `/app/settings` | Shared layout, spacing, forms, targets and CTA review |
| `/app/settings/payments` | Shared layout, spacing, forms, targets and CTA review |
| `/app/settings/support-access` | Shared layout, spacing, forms, targets and CTA review |
| `/app/settings/team` | Shared layout, spacing, forms, targets and CTA review |
| `/app/work` | Compatibility redirect to Jobs |
| `/dev/inbox` | Shared layout, spacing, forms, targets and CTA review |
| `/estimate/[token]` | Shared layout, spacing, forms, targets and CTA review |
| `/forgot-password` | Shared layout, spacing, forms, targets and CTA review |
| `/invite/[token]` | Shared layout, spacing, forms, targets and CTA review |
| `/invoice/[token]` | Shared layout, spacing, forms, targets and CTA review |
| `/no-access` | Shared layout, spacing, forms, targets and CTA review |
| `/` | Redirect only |
| `/reset-password` | Shared layout, spacing, forms, targets and CTA review |
| `/sign-in` | Shared layout, spacing, forms, targets and CTA review |
| `/verify` | Shared layout, spacing, forms, targets and CTA review |

## Transient boundaries

`app/loading.tsx` keeps a noninteractive busy state. `app/error.tsx`, `global-error.tsx` and `not-found.tsx` use the same spacing, typography, contrast and safe recovery-action treatment. HTTP route handlers return data or redirects and have no page layout.

## Workflow structure

Home shows today's scheduled visits, links to recent work needing attention, and Money Finder follow-up counts. Money Finder lives at `/app/opportunities`; old `/app?category=...` filter links redirect with their filters preserved. Recovered revenue is linked from that workspace.

Work opens the Jobs list. Creating or editing a job is an explicit mode; saving opens its review page, where publishing the fixed customer estimate is the next step. Estimates show compact decisions and open their documents on request. The latest authorized estimate continues to a preselected invoice form, or to the existing invoice. Invoices keep payment and correction controls inside an explicit disclosure. Confirmation and payment safeguards remain in their existing server actions.

Customer lists lead to a readable customer overview. Vehicles/properties, history/notes and contact editing have separate sections. Vehicle records separate overview, service/notes and editing. Schedule separates its daily list from appointment creation. The existing New and Work URLs remain compatibility redirects.

Core paths: Home → New job → Save → Publish (three actions after entering the fields); Home → Work → New job → Save; Home → Customers → Add customer → Save; Home → Invoices → View invoice & payments → Record payment. Customer and asset context is carried into new work rather than re-entered. This restructuring changes presentation and routing, not authorization, frozen document evidence, payment behavior or tenant isolation.

## Fast navigation and scanning

The workspace header provides Quick Find on every shop page. Ctrl/Command+K opens a native modal with customer/vehicle/property/equipment search and five direct workspace shortcuts. Native modal behavior, explicit Tab wrapping, Escape and focus restoration keep keyboard navigation inside the search panel. Search is a GET to the existing tenant-protected customer search; no new public data endpoint is added. Only the modal's submit action is primary while it is open; background actions remain inactive.

Customer results use responsive rows with contact links, linked vehicles and direct edit actions. Jobs use compact whole-row links that show the customer, quoted price and update date. This preserves the record/edit paths while making the lists easier to scan. Home removes repeated branding and explanatory copy so daily work starts higher on the screen.

## Industry-specific workspace copy

The saved business type controls new-work labels and empty states on Home, Customers, repair/jobs, estimates and Money Finder. Automotive uses Repair jobs, Repairs, vehicles and parts; home services retain jobs, properties, equipment and materials. The active industry is visible on Home and the desktop sidebar. Saved records keep their original targets when a shop changes industry; no historical data is deleted or relabelled. Saving the business profile invalidates the workspace layout after the transaction commits, including successful idempotent retries. Browser coverage follows in-app links when switching HVAC back to automotive and verifies the vehicle form, parts controls, automotive search hint and industry-specific page copy. Existing 8px spacing, contrast, touch sizes, navigation counts and single-primary-action checks remain enabled.

## Unified job lifecycle

The saved job is the operational hub before and after billing. Its current estimate decision, approved and declined lines, work progress, invoice and net payment ledger appear together with a visible timestamped timeline. Job rows show separate customer/work/payment statuses and a workflow-stage filter. Issuing or sharing an invoice never completes work or records money. Early billing remains supported, with an explicit warning when completion is not recorded. Work progress is an append-only, audited shop event tied to an exact authorized estimate version; supplements require new authorization and earlier events remain visible. Job detail links resolve the stable ID directly rather than relying on the recent-100 list. Invoice and estimate pages link back to the job.

Sharing is manual and recorded only on the shop's explicit confirmation. Replacing a link invalidates its previous sharing confirmation. Customer estimates explain signature versus payment; invoices expose only the existing public snapshot and ledger. A checkout being open/processing is not payment confirmation. Refund/dispute review remains separate from recorded money, work completion and Stripe bank payouts.

Invoice terms explicitly choose due on receipt or a calendar due date. Defaults use the shop timezone; date-only display never converts the calendar date into a local UTC timestamp. Native date controls are constrained to the form width. Existing geometry, contrast, 16px inputs, single-column forms, 8px spacing and one-primary-action audits remain enabled for the new controls, workflow states and a 320px invoice-date form. Chromium checks do not certify real iOS Safari behavior.


## October 31 owner usability pass

Main owner destinations are Home, Customers, Jobs, Visits and Money, with Settings in the header. At 320px, Home remains available through the labelled shop-name link while four bottom destinations retain their full labels and touch spacing. Money has Overview, Follow-ups and Follow-up sales sections. Jobs show a single status sentence and next action; scope, payments, changes, costs and history are disclosures. New job/visit customer pickers support search and inline creation without nested forms. Visits show an arbitrary selected week. Native sharing opens compose/share apps and never asserts delivery. Financial cards distinguish recorded collections, total owed, logged expenses, cash left and quote-based profit. The new owner browser scenario includes negative numeric editing, common jobs/defaults, customer search, future visits, expenses and console error checks; it also runs in development mode. Existing 8px, contrast, labels, geometry, confirmation and single-primary-action checks remain in force.

The development-mode scenario exposed the thumb-bar enhancer selecting streamed client form buttons before those forms hydrated. Client action scopes now expose a React-owned hydration-ready flag; the enhancer waits for that flag and observes its transition before selecting their controls. This preserves a single real form button and its validation without mutating pending server markup, adding timing delays or suppressing hydration warnings. The scenario continues to fail on React hydration/form warnings.

Client form controls are natively disabled by a layout-free fieldset until the same readiness flag is true. This also prevents a select or typed value from being accepted before its React handler is attached, then lost when hydration installs the controlled state.

Each resolved server page also renders through HydratedMain. Its readiness boundary protects native GET filters and links while the page hydrates; a layout-level boundary could become ready before its streamed page. Server children remain server-rendered.

## Online payment setup clarity — November 7

Online payments always shows the owner's Connect Stripe option. A platform that
is not ready has an explicit disabled connection button, an adjacent explanation
that Shop Revenue must finish activation, and a Check setup status action that
refreshes the authenticated page. The page does not direct shop owners into
Shop Revenue's private platform settings or label an unconnected shop as taking
live payments. Once available, three short steps explain signing in or creating
a Stripe account and authorizing the connection. Connected shops get one Manage
Stripe or Finish Stripe setup action, with status reconciliation separate.
Phone and desktop regression coverage checks the pending state, visible controls,
refresh, return to Settings, geometry, contrast and browser errors.


## November 8 customer and RO navigation

The current workspace has exactly five main destinations on phones and desktop: Appointments, Tasks, Customers, ROs (Jobs for service businesses), and Reports. Quick Find follows the same destinations. Settings and the home link remain header utilities. Payment and document actions are reached from an identified job; global payment and quick-sale creation shortcuts and customer-file creation are removed from the owner navigation. Existing stored files and financial records are retained.

Customer profiles have five sections: overview, job/RO history, activity history, vehicles/assets and details. The job history tab and its filters retain `view=jobs`, and display the same stable reference as the job page. Appointments can be started from the calendar and from a customer with that customer selected. Reports include shop-timezone appointment outcomes and new-customer/lead-source activity alongside financial reports; existing owner-only data protections apply.

The public CRM preview evaluates request search parameters so customers, reports and appointment navigation render their requested screens in production builds. The mobile navigation keeps five icon-and-label targets with 8px gaps, including at 320px. Customer creation remains in the directory header to allow the last row to scroll clear. Floating customer actions retain their viewport width rather than inheriting a full-width grid button rule. Browser audits distinguish header actions from pinned actions while retaining hit-area, gap, overflow and contrast checks.

## Customer and RO section hierarchy

Customer search and the directory have separate labelled, bordered panels. Directory entries form individual cards with consistent identity, asset and contact placement. Customer overviews separate active work, activity and vehicles/assets; secondary portal, referral and review controls live under Customer options. Existing controls and permissions are preserved.

RO lists group the current results into Needs attention, In progress and Closed work. Each group has a heading, count and status cue; each RO card keeps its reference, customer, status and price or balance in fixed positions. Search and filters remain in their own panel, and Board remains available. Job workflow and navigation have visible boundaries. The public pricing preview separately bounds RO details, parts/labor and the price summary. Responsive grids become a single column on phones, with the existing bottom-navigation clearance retained. Browser coverage checks panel separation, customer search, state grouping, correct-customer navigation and price recalculation on phone and desktop.
