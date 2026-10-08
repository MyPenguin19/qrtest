# 3.5.2 pre-implementation audit

Baseline `cf2f1ffe496957a57dbc0998d8714c1b48de93de`; rollback `rollback/pre-3-5-2` created before application edits. Reviewed 3.5.1 audit/report, guard, RPC, login/MFA/status and legacy admin redirects. User reports successful hosted privileged login; negative/revocation acceptance remains outstanding. Hosted read-only audit now finds one active platform admin, two restaurants and 36 orders. Do not revoke that sole administrator for unattended testing.

## Trusted targets
Vercel production public Supabase URL reconfirmed through authenticated configuration: https://pixhngrbhiziwapxmqjd.supabase.co. Expected GitHub branch is MyPenguin19/qrtest:claude/thaliq-saas-prd-qluyf1. Production alias qrtest-beryl.vercel.app is inspected before release. Eight migrations applied through 20261008111047_platform_admin_foundation.

## Schema, identities and scopes
restaurants.id is tenant identity; owner_id references auth.users. Owner contact can safely come only from the referenced Auth user with verified email; profiles has no authoritative email. Branches belong to restaurants; tables belong to branches; visits belong to tables. Orders have required restaurant_id/branch_id and optional table_session_id; legacy unassociated orders remain tenant-attributed and must count without fabricated table links. Staff are restaurant scoped and optionally branch scoped; operational roles are staff/waiter/kitchen/cashier, not manager.

## Metrics and source of truth
- Tenant counts/signups: restaurants.id/created_at, not branches or memberships.
- Submitted orders: all stored orders by created_at, including cancelled, matching the owner count definition. Show cancelled separately. Qualifying activity/activation excludes cancelled orders and counts distinct restaurant IDs. Pending is a valid persisted submission; no drafts are persisted.
- First/last activity: min/max qualifying orders.created_at. Signup-to-first-order delays only when first timestamp >= restaurant.created_at. Historical edits/deletion/cancellation can revise derived series; no event warehouse exists.
- Active visits: table_sessions.status <> closed via physical table and branch ownership. Never count physical status flags.
- Tables/menu/categories/staff: count each source independently before joining aggregates, avoiding multiplicative joins.
- Receipts: payments.status=paid and confirmation_source=staff_reported; time confirmed_at or explicitly labeled legacy created_at fallback. Legacy unknown-source receipts counted separately, never relabeled. No evidence of provider-verified online payments; no platform revenue.
- Last menu update: max(menu_items.updated_at), a record-update timestamp rather than proof of a meaningful menu edit. Last completed-order event uses order_status_history.created_at, not orders.updated_at.

## Readiness from actual ordering requirements
Restaurant must be active, have an active branch, and have an available item under a category belonging to that restaurant for the menu UI. Branch counter ordering is supported without a table. Therefore no-table tenants can be ready for counter orders; dine-in readiness additionally requires an active table on an active branch. PIN staff configuration is reported but not falsely made a customer submission prerequisite. No invented mandatory business settings.

## Missing/ambiguous schema
No configured currency, restaurant timezone, order-type classification, test-tenant flag, deletion/archival history or uptime telemetry. Do not infer those. Report currency/timezone unavailable, keep all existing tenants including test-like names, and do not claim historical deleted-tenant counts or system uptime. Operational enabled status and usage activity are separate. A configured active table demonstrates a usable QR destination, not proof someone downloaded/printed/scanned it.

## Query/security architecture
Keep requirePlatformAdmin plus independent database authorization inside each of three narrow read-only reporting RPCs (overview, directory, detail). Reuse platform_admin_status for current identity/session/AAL2/revocation; no generic table/SQL API and no restoration of is_platform_admin. Only authenticated receives RPC execute, and ordinary users are rejected within each RPC. Private aggregation helpers have no API-role permissions. Return safe selected columns/aggregates only, never customer records, credentials, signed URLs or PINs. Use the ordinary server Auth client, not a service client. Dynamic server pages and private/no-store platform response headers prevent public caching. No new public reporting HTTP endpoint is necessary.

## Time, filtering and pagination
UTC reporting with [UTC midnight N-1 days ago, request time) for 1/7/30/90-day choices; today is partial. Previous equal calendar window supports repeat-active comparison. Daily zero-filled buckets (max90) show actual activity/signup counts and reconstructed cumulative existing tenants. Inactivity attention threshold14days, centrally specified in SQL. Filter/sort values allowlisted, literal search by name/slug/verified owner email, deterministic UUID tiebreaker, page sizes25/50, bounded input. Server aggregates complete totals independent of page length; no silent 50/1000 record cap.

## Performance and migration
Existing indexes cover tenant/branch FKs, statuses, unique submissions and one active visit; no created_at index on orders. Add targeted created_at and restaurant_id/created_at indexes and one restaurants created_at/id index with reporting functions. No tables/data/status enums or restaurant RLS changes. Set-based aggregates avoid per-restaurant requests and sending history to browser. Exact all-time first/last/count metrics still scan relevant historical index/data; document scale and inspect plans before adding caches/materializations.

UI, server DAL, filters, SVG charts, loading/errors need no DB change. Database-side aggregation is the minimal migration needed for accurate uncapped totals without privileged per-row application fetches. Migration is additive and compatible with prior app; rollback app without removing security foundation, optionally revoke the new reporting RPCs.

## Verification strategy
SQL fixtures: zero/one/multiple tenants, multibranch, cancelled/legacy/boundary orders, activation denominator/delays, distinct counts, independent configuration sums, receipts and current visits, >1000 directory rows, search/filter/sort, absent verified email, unauthorized/MFA/revoked calls. Full earlier suites retained. TypeScript/lint/build/whitespace, native concurrency and local component checks. Hosted read-only facts/ACL/EXPLAIN checks; live A–J only if permitted, otherwise explicit manual checklist. No production order fixtures or administrator revocation without safe recovery execution.
