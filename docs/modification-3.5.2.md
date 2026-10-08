# Modification 3.5.2 — read-only platform intelligence

## 1. Pre-implementation audit
See [the audit](modification-3.5.2-audit.md), written before application edits. Baseline: `cf2f1ffe496957a57dbc0998d8714c1b48de93de`. Rollback branch `rollback/pre-3-5-2` was created at that commit. Reviewed existing schemas, RLS, 3.5.1 authorization/login/MFA/status, legacy admin redirects, operational reporting and ordering requirements. Confirmed GitHub `MyPenguin19/qrtest`, production branch `claude/thaliq-saas-prd-qluyf1`, Supabase `pixhngrbhiziwapxmqjd`, and Vercel project `prj_Dxlm3W74xT2OpbETkcgbJIbP7tX9` in `mypenguin19s-projects`. Production public Supabase URL matches that project. No production fixture data was created.

## 2. Data-access architecture
Dynamic server pages render overview, directory, restaurant detail and analytics. A server-only DAL exposes three fixed operations using the ordinary authenticated Supabase client. Three narrow database RPCs aggregate data; private helpers centralize periods, facts, trends and authorization. No generic query endpoint, service-client reporting, per-restaurant request loop, or client-side privileged query was added. GET filter submissions/navigation refresh the report; no polling or persisted reporting cache.

## 3. Security model
Every DAL operation calls existing `requirePlatformAdmin()`. Every RPC independently calls the existing `platform_admin_status()` through a private guard: valid current identity/session, active nonrevoked administrator and verified AAL2 remain required. Invalid detail IDs are checked after authorization. SECURITY DEFINER functions use qualified objects and an empty search path. Only authenticated receives public RPC execute; ordinary users still fail the internal authorization check. Private schema access remains denied to API roles. `is_platform_admin()` remains false; no tenant RLS bypass or policy edits. Response headers are private/no-store and pages dynamic. UI errors are generic; no SQL internals, customer tokens, staff PINs, signed URLs or credentials are returned. Existing authorization/audit infrastructure is reused; an RPC denial raised as an exception can roll back an audit insertion, so this release does not promise durable logging of every failed RPC.

## 4. Database changes
Applied additive migration `20261008212741_platform_intelligence.sql` to the intended hosted project. The local filename matches the server-assigned migration version. Adds private reporting helpers and public `platform_overview`, `platform_restaurants`, `platform_restaurant_detail`; each reporting RPC has a 10-second function statement-timeout setting. Adds indexes `orders_created_at_idx`, `orders_restaurant_created_at_idx`, `restaurants_created_at_id_idx`. No tables, roles, enums, business rows, RLS policies, payment logic or authentication architecture changed. The prior application remains compatible. No dependency changes.

## 5. Files changed
- `next.config.ts`: private/no-store headers for platform routes.
- `src/lib/platform-reporting.ts`: fixed server-only report operations/types.
- `src/lib/platform-report-options.ts`: normalized options, URL and formatting helpers.
- `src/components/platform/report-ui.tsx`: navigation, filters, KPIs, accessible lightweight charts and definitions.
- `src/app/platform/page.tsx`: real overview.
- `src/app/platform/restaurants/page.tsx`: searchable/filterable directory and pagination.
- `src/app/platform/restaurants/[restaurantId]/page.tsx`: read-only restaurant intelligence.
- `src/app/platform/analytics/page.tsx`: growth, activation, engagement and configuration.
- `src/app/platform/error.tsx`, `loading.tsx`, `not-found.tsx`: generic retry, loading and missing-record states.
- `supabase/migrations/20261008212741_platform_intelligence.sql`: additive database reporting layer.
- `tests/platform-admin.test.cjs`: retained authorization tests plus DAL/options/error checks.
- `tests/dining-lifecycle.test.cjs`: includes new migration in regression harness.
- `tests/platform-reporting-db.test.cjs`: reporting and database authorization fixtures.
- `tests/browser/platform-adapters.tsx`, `platform-fixture.tsx`, `platform-flow.cjs`: local component fixtures/checks.
- `docs/modification-3.5.2-audit.md`, `docs/modification-3.5.2.md`: audit and release evidence.

## 6. Exact metric definitions
| Metric | Source / definition |
| --- | --- |
| Total restaurants | Existing restaurant IDs, never branch count. Includes disabled/suspended and test-like names; no reliable test classification or deleted-tenant ledger exists. |
| New restaurants | Existing restaurants with created_at in the selected half-open period. |
| Submitted orders | All persisted orders by created_at, including cancelled, preserving the existing count definition. Pending is a persisted submission, not a draft. Cancelled count shown separately. |
| Qualifying activity | Noncancelled submitted orders. Active restaurants are distinct tenant IDs with at least one such order in the period. |
| First/last activity | Earliest/latest qualifying order timestamp before the report end. Legacy orders lacking table-session association still count for their existing tenant. |
| Activation rate | Ever-activated current restaurants / all current restaurants. Zero denominator is unavailable. |
| First activations | Restaurants whose first qualifying order falls in the selected period. |
| New-cohort activation | New restaurants with a qualifying first order before report end / all new restaurants in the period. |
| Signup-to-first-order delay | Mean hours among activated current restaurants with first order >= signup. Invalid legacy timestamp sequences excluded and counted explicitly. |
| Repeat-active | Qualifying activity both in selected period and preceding N full UTC calendar days. Current period includes partial today, so windows are not equal elapsed duration. |
| No recent activity | No qualifying order in selected period, including never-ordered tenants. |
| Orders per active restaurant | Qualifying order count / distinct active restaurants; unavailable for zero active restaurants. |
| Configuration totals | Independent source counts for tables, menu items and operational staff (staff/waiter/kitchen/cashier). Includes inactive configured records; excludes Owner/Manager from operational staff count. |
| Active visits | Existing table sessions with status other than closed, through table/branch ownership; not physical-table flags. |
| Daily trends | Zero-filled daily signups, submitted orders, distinct active restaurants, and cumulative currently existing tenants. Daily distinct counts must not be summed into period distinct counts. |
| Customer order value | Sum of noncancelled submitted order totals for the restaurant/period; not receipts. |
| Staff-recorded external receipts | Paid payments with confirmation_source=staff_reported, timed by confirmed_at with explicitly counted created_at fallback. Pending/failed excluded; legacy unknown-source paid records counted separately. |

No platform monetary aggregate, MRR, ARR, provider-verified revenue or billing conversion. Restaurant monetary numbers are stored numeric units; configured currency is unavailable, so no currency is invented. Last submitted order, completed-order history event, visit, recorded receipt and menu record-update timestamps are separately labeled. Completed can include a manual unpaid close; menu updated_at does not prove a meaningful content edit.

## 7. Readiness and activity indicators
Ready for counter ordering means active restaurant, active branch and available menu item under a category belonging to that restaurant. No-table restaurants can be ready. Dine-in additionally requires an active table on an active branch. Staff setup is reported, not invented as a customer submission prerequisite. Precedence: Setup incomplete, Receiving orders (qualifying selected-period activity), Inactive after prior activity (last qualifying activity older than central 14-day threshold), otherwise Ready for orders. Indicators are derived, not persisted account/billing status.

Directory filters: all; created in period; qualifying activity in period; no qualifying activity in period; setup incomplete; ready with no qualifying activity in period. Inactivity attention threshold is centralized in `platform_private.inactivity_days()`; changing it requires a reviewed additive migration. Low sales are not a speculative health score. Table configuration means a usable QR destination, not proof a QR was printed/scanned.

## 8. Reporting timezone
Platform uses visibly labeled UTC: [UTC midnight N-1 days ago, request time), N=1/7/30/90. Today is partial. Restaurant Owner reporting remains America/New_York. There is no authoritative restaurant timezone column; detail reports unavailable. Dates display UTC consistently.

## 9. Pagination and query strategy
Directory defaults to 25, allows 50; page must be 1..1,000,000. Exact matching total is independent of page length and is not capped at 50 or 1,000. Literal case-insensitive search of name/slug/verified owner email is limited to 100 characters; customer data is not searched. Unverified/missing owner email is unavailable. Sorts: newest, oldest, activity, submitted orders, name, all with stable UUID ties. Independent set-based aggregates prevent join multiplication. Input allowlists/parameters prevent arbitrary SQL/scope injection. Detail scopes aggregation to a supplied ID only after administrator authorization.

## 10. Performance
Three indexes support time and tenant filtering. Database aggregates avoid transmitting order history or all tenants to the browser; daily trends have at most 90 buckets. Exact first/last activity and configuration totals still inspect relevant history. There is no materialized reporting warehouse; large datasets and deep offset pages warrant future measurement, not a claim of unlimited scale. Local native PostgreSQL benchmark: 1,051 restaurants/21,020 orders, main facts aggregate 7.284 ms execution, 0.027 ms planning. Disposable fixtures rolled back. Hosted read-only plan at current small scale: 10.660 ms execution, 0.113 ms planning, 1,883 shared hits, no disk/temp writes. These are measured samples, not an SLA. Reports may run multiple SQL statements under normal read-committed behavior; concurrent writes can change results between statements/requests.

## 11. Automated tests
Final implementation checks passed:
- Node application/SQL fixture suite: 104 passed, 0 failed, 0 skipped.
- Native PostgreSQL lifecycle/security/concurrency suite: 55 passed.
- Native PostgreSQL reporting/security suite: 8 passed.
- Local platform component/browser checks: 17 passed (all four pages at 390/768/1280 widths, long text/no horizontal overflow, filters/pagination, zero data, retry/loading, exact chart values).
- Existing local payment/session browser checks: 11 passed.
- Production webpack build, TypeScript, ESLint and whitespace checks passed.
- Client chunk scan: no SUPABASE_SERVICE_ROLE_KEY identifier found; no service credential introduced in these modules.

The native SQL runs also execute cases covered in the application suite; counts are not unique scenario totals. SQL fixtures cover zero/one/multiple tenants, multiple branches, cancelled/historical/legacy orders, UTC boundaries, distinct counts/activation, absent contact, independent aggregates, active/closed visits, receipt sources, all sorts/filters and pagination over 1,051 tenants. Auth coverage includes anonymous/ordinary restaurant principals, PIN context, missing MFA, revoked administrators, permitted verified admin, forged IDs and private helper denial. Existing lifecycle tests retain QR sessions, multiple rounds, fulfillment, external receipt confirmation/automatic closure, PIN auth and tenant/branch isolation. Test data is local only; local browser fixtures are not hosted acceptance.

## 12. Hosted database verification
After migration, read-only checks confirmed all three RPC ACLs/security configuration, denied private schema access, unchanged false generic RLS bypass and all three indexes. Anonymous-context calls to all three RPCs fail with insufficient privilege. The sole active platform administrator remains active. Operator-side reconciliation found: 2 restaurants both ways; 37 submitted orders in the selected 30-day window both ways and in daily trend sum; 2 distinct active tenants both ways; 8 menu items both ways; 0 active visits. Counts reflect verification time, not permanent expected totals. These are trusted database-operator checks, not proof of an authenticated hosted browser request. No administrator was revoked, and no restaurant/payment/order/session data was mutated.

## 13. Live acceptance — UNVERIFIED
Prior successful 3.5.1 hosted MFA login is user-reported. All current A–J hosted scenarios remain UNVERIFIED because hosted browser access was restricted. Automatic approval review rejected opening the hosted platform URL because the earlier administrative restriction remains in effect; no alternate browser/HTTP bypass was attempted.

Manual acceptance checklist:
- A: Sign in as authorized administrator, finish MFA, compare overview values to current source records.
- B: Directory: find known restaurants, search verified email/name/slug, exercise every filter/sort and 25/50 pagination.
- C: Open known restaurant; reconcile configuration, orders, visits and recorded receipts with source records.
- D: At an authorized test restaurant, submit a controlled order; reload/Apply and confirm documented count/activity changes. No test order was created by this release.
- E: With separate ordinary Owner/Manager and PIN staff sessions, request all platform routes/status and direct report RPCs; confirm no protected data. Repeat anonymous and AAL1.
- F: Prepare trusted operator recovery, then revoke a test administrator and verify the next protected requests fail. Restore through the existing operator procedure. Do not lock out the sole administrator without recovery ready.
- G: Use two restaurant identities and verify own dashboards and guessed foreign IDs remain tenant-scoped.
- H: Test hosted desktop/tablet/mobile, long names, keyboard forms, empty/loading/error states.
- I: Compare cancelled/historical/legacy unassociated orders and closed visits to the documented definitions; verify receipts are not confused with order value.
- J: Complete outstanding 3.4 live A–H: owner/staff access, QR/shared visit and multiple rounds, fulfillment, pending/failed/abandoned payment remaining open, confirmed full external receipt auto-closing, table becoming available, customer ended-session state and tenant/branch isolation. Use the detailed 3.4 report checklist as the authority.

Deployment READY is not evidence that these scenarios passed.

## 14. Remaining security warnings
Hosted advisors retain intentional no-policy information on protected customer/staff/platform tables; existing anonymous SECURITY DEFINER warnings on six helpers; authenticated SECURITY DEFINER warnings on those helpers, existing platform_admin_status and the three new restricted reporting RPCs. Authenticated EXECUTE is intentional but each new RPC independently authorizes before reading. Existing leaked-password protection warning remains unresolved and unchanged. No unrelated ACL/auth policy changes were bundled. These warnings and live negative/revocation acceptance should be reviewed before claiming full production security acceptance.

## 15. GitHub commit
Release commit: pending publication. Destination is `MyPenguin19/qrtest:claude/thaliq-saas-prd-qluyf1`; remote head rechecked against baseline before publishing without force. This report will record the resulting implementation commit in a documentation follow-up.

## 16. Vercel deployment
Pending the GitHub release. Production target: `https://qrtest-beryl.vercel.app`, Next.js, project/team verified above. Exact deployment ID, READY state, Git SHA and production alias assignment will be recorded after inspection. Runtime error/monitoring acceptance is not inferred from build status.

## 17. Rollback
Local `rollback/pre-3-5-2` points to `cf2f1ffe496957a57dbc0998d8714c1b48de93de`. Prior known production deployment: `dpl_J5zsWNERQJHf9h9uj3sntozFr9p3` (`qrtest-rmxcy5xus-mypenguin19s-projects.vercel.app`). Authorized operator can roll back/promote that verified deployment, or revert only this release on the deployment branch. Preserve all existing data, 3.5.1 MFA/admin infrastructure and RLS. New migration is additive and can stay installed with old code. If reporting must be disabled, separately revoke authenticated EXECUTE on the three new public RPC signatures; do not disable authorization or remove audit history. Vercel rollback may suspend automatic alias assignment until a later explicit promotion; verify the target/alias afterward.

## 18. Known limitations
No configured currency/timezone, explicit test flag, deleted-tenant history, provider verification, billing metrics or infrastructure uptime source. Trends reconstruct surviving records; later cancellations/deletions can revise history. Enabled account status is not usage. Some legacy receipt dates use flagged fallback; unknown-source paid records are separate. Per-restaurant metrics are read-only; no impersonation or editing. Live authenticated/negative/revocation and full restaurant lifecycle acceptance remain outstanding. Large-scale production performance and deployment response headers need hosted acceptance, beyond local component/SQL verification.

## 19. Readiness for 3.5.3
The implementation and automated regression checks are complete; release verification is being recorded separately. Complete the outstanding hosted A–J acceptance and review remaining warnings before treating this as fully accepted production behavior. No work on 3.5.3 or 4.0 has begun.
