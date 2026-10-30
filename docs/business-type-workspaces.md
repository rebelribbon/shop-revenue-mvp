# Business-type workspaces

Development branch: `feat/business-type-workspaces`. This extends the shared CRM; it does not replace the automotive branch or release to production.

## Setup

The owner selects Automotive repair, HVAC, Plumbing, Home improvement/remodeling, Handyman, or Other home services in Business profile. An owner setup prompt links there until the choice is saved. Existing businesses default to automotive. Changing the choice preserves customers, vehicles, service assets, jobs and frozen documents; existing records remain accessible.

The setting controls the default workspace, terminology and job targets. It is not a permission boundary, automatic industry classification, or a separate customer database.

## Home-service workflow

1. Create a customer.
2. Add a property with its service address and private access/service notes. Add equipment, optionally linked to a property, with manufacturer, model, serial number and installation date.
3. Search customers by service address, ZIP, asset name or equipment serial number.
4. Open a job from the property/equipment record. Price materials and labor, record internal costs and estimated/actual hours, and inspect job margin.
5. Publish the existing frozen estimate. The public snapshot includes the selected service address/equipment label, approved pricing and terms. It excludes internal cost rates, actual hours, serial numbers and private access notes. Address edits do not rewrite frozen estimates.
6. Use the existing customer authorization, invoice, payment ledger and Stripe Connect flow. Home-service jobs require no vehicle, VIN, plate or odometer.
7. Schedule appointments against properties/equipment, and create jobs from those appointments. General open-estimate, unpaid-invoice and customer-level declined-work follow-up supports home-service work. Service-due follow-up supports vehicle, property and equipment dates. Future bookings and recent fully paid work suppress only the matching work target.

Properties/equipment use the existing tenant-scoped asset table. Composite foreign keys prevent cross-tenant and cross-customer parent links and document targets. Archiving a property also archives its equipment; history and issued documents are preserved. Owner exports include assets. Support remains read-only through existing action enforcement.

## Verification

New database tests exercise owner-only mode changes, mode switching without deletion, tenant/customer isolation including direct database writes, asset archival, home-service costing, frozen addresses, signature/decline capture, invoice payment and public-data privacy. A browser test exercises HVAC setup through property/equipment creation, material costing and published estimates on phone and desktop. Existing automotive tests remain enabled.

## Scope limits

This is a shared home-service foundation, not a complete dispatch or construction-management suite. Technician routing, automatic recurring maintenance interval calculations, permits, progress billing, subcontractor purchasing and trade-specific compliance are not implemented by this branch. Automated texting and data imports remain excluded. Production credentials and launch evidence remain pending; this branch does not bypass the release gates.

## Database changes

Forward-only Drizzle migration 0020 adds the business type and generalizes the existing asset table for properties/equipment. It adds nullable service-asset references alongside vehicle references for estimates, invoices and appointments; estimates/invoices must have exactly one work target. Existing automotive rows are unchanged. Public authorization keeps its existing validation and evidence behavior, using customer timeline events when the work has no vehicle.


## Home-service maintenance follow-up

Properties and equipment have optional next-service dates, descriptions and expected selling prices. These are staff/owner-entered plans, not inferred service histories or automatically recurring appointments. Money Finder shows due work from 14 days ahead through 90 days overdue, excludes do-not-contact customers and archived assets, and preserves unknown prices as unknown.

Service-due links carry the exact service asset into appointments and jobs. Composite tenant/customer foreign keys and server validation prevent switching the source to another unit. Scheduling suppresses only the matching asset; fully paid recent work resolves only the matching asset. Clearing the plan removes the date, description and expected price together. Equipment appointments display their parent property's full service address.

Migration 0021 adds typed service-plan columns to the existing tenant-scoped asset table and a service-asset reference on recovery items. The preview and production databases are unchanged until a deployment migration is authorized and run.
