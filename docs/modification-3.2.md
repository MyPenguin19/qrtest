# Modification 3.2 — table operations

## Implementation

The primary Staff / Orders page renders one card per active table visit. Existing order rounds are preserved with timestamps, item quantities, variants and instructions. New and Ready rounds are prominent, completed rounds collapse, and View Tab expands history. Available tables have no historical items. Non-table orders retain their existing order-card path.

The existing server-side table query remains tenant/branch scoped and now returns the required round/item data. Closed visits are excluded from the embedded query and from the view-model. Tables sort by payment attention, new work, ready work, quiet open visit, then available.

Fulfillment stays **per order round**, not per item. The existing status action moves pending/accepted/preparing straight to ready, followed by the existing served action. No enum change or new fulfillment RPC is introduced. Serving a round never closes the session. Existing authentication, cashier/owner closure authorization, kitchen redirect, waiter requests and cashier routes remain.

The obsolete staff Request Bill button is removed. Existing manual payment controls can start from an open visit and prepare their bill internally. Close Tab reuses 3.1 manual closure, with explicit confirmation and external-payment versus unpaid-clear reasons. Staff-reported payment never becomes provider verification. Counter intent and the running total belong to the same table card.

## Recovery bookkeeping

The hosted database was behind production commit 38f1c34. All three missing lifecycle migrations were applied, in order, through the Supabase migration tool. All 11 dining functions now exist with expected signatures and service-only grants. The original 24 orders and 26 items match their pre-migration fingerprints; the five prior payments also match. Later live activity changed active-table/session/bill state, so full before/after state equality is not claimed.

The seven original schema files were already applied as one hosted baseline. Their exact content was verified in the stored migration SQL. They are retained under `supabase/baseline`; the canonical consolidated baseline and three applied migration versions now match hosted history under `supabase/migrations`. No migration SQL content was changed and no new 3.2 schema migration was added.

## Executed checks

- 54 automated tests passed: 28 lifecycle database tests, 6 view-model tests and 20 server-action/page tests.
- 9 headless Chrome component checks passed against local fixtures, including same-card additional rounds, collapsed completed work, Ready → Served, View Tab history, counter intent and manual closure.
- TypeScript, ESLint, production build and diff whitespace checks passed.
- Hosted SQL audit verified the existing active data, migration history, required RPC signatures and preservation of original order/item/payment records.

The T1 Coke ×2 served + Burger ×1 new fixture totals 17.00 and stays one card. Additional Latte submissions remain independent rounds. Priority, multi-table isolation, closed/new-party separation, duplicate submission and stale status actions are covered. Browser adapters are not the deployed application or provider integration.

## Acceptance remains pending

Browser tools cannot access the deployed app because the admin-enforced browser policy cannot be verified. This restriction was not bypassed. Consequently, deployed customer → application → hosted Supabase tests and the full owner/staff regression checklist have not been executed by the agent. Local checks and read-only hosted SQL do not substitute for them.

Do not label 3.2 accepted or begin 3.3 until the staged deployment is exercised against hosted Supabase: QR scan, two devices, new order rounds, round fulfillment, running total, counter intent, ignored Pay Now, manual closure, old-device rejection, fresh party, menu management/availability, QR generation, authentication and tenant isolation. Online card payment stays unavailable as requested.
