# Spec Revision — Defer Automated Customer Texting

Date: 2026-10-25
Status: Approved by product owner
Applies to: Design Partner MVP Build Specification v1.1

## Decision

Automated customer texting is deferred from the Design Partner MVP.

The application will not send automated SMS messages, reminders, outreach, follow-up sequences, opt-out messages, or other customer-facing text messages during the MVP phase.

Twilio is not part of the MVP implementation.

## Customer contact workflow for MVP

Shop owners and staff will contact customers directly using their existing phone or messaging tools outside Shop Revenue.

Shop Revenue may surface the customer, phone number, reason for follow-up, opportunity, appointment, or recommended action, but the actual outbound contact is performed manually by the shop.

## Scope impact

The original M5 business-texting milestone is deferred and is not required for MVP acceptance.

Features depending on customer outreach, including Money Finder workflows, should provide manual contact actions and tracking rather than automated SMS delivery.

No texting provider integration should be added unless this revision is superseded by a later approved revision.

## Unchanged requirements

Customer phone numbers remain part of customer records and search.

Consent and legal-policy requirements remain relevant if automated messaging is introduced in a future release.

This revision does not change M2 customer and vehicle memory, M3 estimates and authorization, M4 invoices and payments, M6 import, M7 Money Finder discovery, M8 recovered revenue, or M9 hardening except where those milestones previously assumed automated SMS delivery.
