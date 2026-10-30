# UX standards audit

Scope: every existing page template, shared UI, loading/error boundary, automotive and home-service variant. Provider-hosted Stripe/Google/GitHub screens are external and are not restyled by this app.

## Enforced design system

- Margins, padding and layout gaps use multiples of 8px. Device safe-area spacing rounds up to the grid where CSS stepped math is supported.
- Shop navigation has five destinations: Money, Customers, Work, Schedule and Settings. Bottom navigation uses the same destinations, with Home, Clients, Visits and Setup as shorter visible labels. Accessible labels retain the full destination names. Admin navigation has five items; support navigation has three. Sign-out is a utility in Settings/Admin help.
- Core work pages have homepage shortcuts; the Work hub reaches jobs, estimates, invoices and revenue in two clicks. Business settings and payments are within three homepage clicks. Customer rows link directly to vehicles, so vehicle edit/save can be reached in three clicks. Existing destructive-action confirmations intentionally add a confirmation step; they are preserved rather than weakened to meet a click budget.
- Text/status/link/hover colors in light and dark themes must reach 4.5:1. Body, input, caption and navigation text use 16px. Prose is capped at 65ch; structured tables are independently scrollable.
- Forms use one column and persistent labels above text inputs. Checkbox/radio labels provide a minimum 48px effective hit area.
- Every settled interactive page has one primary action. The existing control is enhanced, never cloned, preserving its form association, validation, pending state and focus. Entering a form makes its safe submit action primary. Destructive actions are excluded from the sticky primary area and keep secondary/danger styling and existing confirmation.
- The primary action stays in the bottom half on mobile, above the five-item bottom bar with an 8px gap. The content scroll area reserves room so pinned controls do not cover fields or other actions. Read-only pages get a meaningful print or navigation action. Noninteractive loading placeholders do not invent a CTA.
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
| `/app/customers` | Shared layout, spacing, forms, targets and CTA review |
| `/app/estimates` | Shared layout, spacing, forms, targets and CTA review |
| `/app/invoices` | Shared layout, spacing, forms, targets and CTA review |
| `/app/jobs` | Shared layout, spacing, forms, targets and CTA review |
| `/app/new` | Shared layout, spacing, forms, targets and CTA review |
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
| `/app/work` | Shared layout, spacing, forms, targets and CTA review |
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
