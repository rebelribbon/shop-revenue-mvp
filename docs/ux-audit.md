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
- The app has no marketing landing page: `/` redirects to sign-in or the workspace. Workspace information follows a left-aligned hierarchy; Z-pattern marketing blocks are not applicable to these forms/data pages.

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
