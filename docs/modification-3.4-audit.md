# Modification 3.4 — audit before changes

Baseline/rollback: `b84bab2f40ea91ce1f643c0f56c39a2ac614da93`, local branch `rollback/pre-3-4`. Repository clean at start. Hosted Supabase project `pixhngrbhiziwapxmqjd` has all seven expected migrations through `20261008012015_secure_staff_console`; no duplicate active visits found.

## Findings

1. `/staff/orders` fetches null-table-session orders in pending/accepted/preparing/ready/**served** indefinitely. Six hosted unassociated orders (#4, #5, #7, #8, #11, #18) are Served, have no customer-session/submission identifiers and no direct paid order receipt. Their original type cannot be established from stored data; calling them pickup or reattaching them to current visits would invent history.
2. The current order entry/RPC supports submissions without a table. There is no explicit order-type column. New atomic submission metadata can distinguish known modern submissions from unclassified legacy records, but cannot prove a missing session was never present. Use honest labels; keep all unfinished unassociated work visible, with no age cutoff.
3. Owner Overview sums non-cancelled submitted order totals as revenue. This counts unpaid meals and differs from authoritative payment records. Legacy payments can lack confirmation timestamps. Pending count is based on statuses without checking closed visits. Active Tables uses physical table status instead of active visits. Queries ignore errors and can display false zero metrics.
4. Overview uses server-local midnight; no restaurant timezone column exists. User explicitly selected `America/New_York`. Define local calendar days including DST. Keep receipts separate from fulfillment and document legacy timestamp handling.
5. Owner Orders limits history to the newest 50 orders without pagination; older records exist but cannot be reached through that page. It does not label missing table associations clearly.
6. Owner Tables and Staff use the same `getDiningTables`/`diningTableView` active-session projection. Order-round statuses, payment receipt/closure and session revocation use the 3.3 atomic server-only RPCs. Preserve these.
7. Round buttons use small sizing, and completed details lack explicit Served labeling. Payment selector says Card without saying external terminal; success immediately clears the card without a receipt message. Improve text/feedback only.
8. Vercel connector read failed with scoped 403; use authenticated CLI with explicit project/team to verify deployed commit. Live browser acceptance is not assumed from the reported staff sign-in demonstration.

## Plan and risks

- Filter primary unassociated work to unfinished fulfillment only; label source uncertainty, retain unfinished paid anomalies, and leave Served/Completed records in paginated Owner history. No reassociation or deletion.
- Share explicit fulfillment classification and active-visit metrics. Derive day revenue only from successful payment rows, using confirmation time and clearly documented legacy creation-time fallback. Handle numeric amounts in cents and do not count pending/failed attempts.
- Use New York business-day boundaries, exact counts and paginated reads so Supabase row limits do not truncate totals. Fail visibly on query errors.
- Keep one active visit per table, atomic transitions, idempotency, identity/tenant/branch checks and all customer flows unchanged.
- Add focused regression tests; run existing auth/lifecycle/payment/isolation suites, native PostgreSQL races, component checks, lint/TypeScript/build.
- Inspect deployment, push/release the tested commit within this request's deployment scope. If live browser access is unavailable, mark A–H UNVERIFIED and provide exact manual steps; do not declare full production acceptance.
- Prefer no database migration; no changes to historical records or existing 3.3 migrations.
