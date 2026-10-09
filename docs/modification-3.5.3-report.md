# Modification 3.5.3 — Platform controls, hardening and audit logs

## 1. Pre-implementation findings
See [the pre-edit audit](modification-3.5.3-audit.md). Baseline/rollback: `c16d3e2891e8b5ae2209ef391b134f1e9d7a8e8c`, local branch `rollback/pre-3-5-3`. Existing 3.5.1 current identity/session/admin/AAL2 guard and 3.5.2 reporting are reused. Owner-editable restaurant status is unsuitable as the sole platform suspension boundary. Subscription schema exists but hosted subscriptions and billing transactions both contain zero rows and there is no implemented billing backend. Existing table guards, atomic fulfillment/payment/closure, PIN sessions, tenant RLS and immutable audit infrastructure are retained.

## 2. Changes implemented
Added separately protected platform account state, explicit confirmed suspension/reactivation, ten-minute fresh TOTP requirement, concurrency/version checks, retry deduplication, atomic success auditing, denial/failure telemetry, audit browsing and platform controls summary. Restaurant directory distinguishes platform account state from restaurant operating status. Detail adds historical submitted-order count, configuration readiness, account reason/actor/time and unresolved-activity counters. Customer menu and owner/staff screens show generic account notices without internal reasons. No tenant was suspended during development or release.

### Suspension safety policy
Suspension is refused while any of these exist: nonclosed table visit; pending/accepted/preparing/ready order; pending payment; positive bill without paid status and sufficient paid receipt; positive noncancelled order lacking a sufficient paid direct receipt or settled associated bill. This conservatively includes ambiguous legacy Served/Completed debt. Staff/owner must finish legitimate work using existing operations, then the administrator explicitly retries. There is no automatic deferred job, financial reconciliation, payment override or unpaid closure.

Once suspended, database triggers block new orders, new/reopened visits, new waiter requests and new payment attempts, including service-role/direct inserts. Existing history and configuration remain accessible. Each new-work write holds a shared restaurant lock; account changes hold an exclusive lock, ensuring no order can silently cross the suspension boundary. Reactivation changes only private platform account state, never business hours, branch flags, menus or restaurant status. Configuration readiness, operating status, platform account access and billing remain separate concepts. Accounts without a control row are active; legacy owner-editable restaurant status remains separately visible and effective.

## 3. Files changed
Application:
- `src/app/actions/platform-controls.ts`: independently guarded account action, fixed RPC, cache invalidation.
- `src/lib/platform-controls.ts`: guarded account/audit/summary reads and types.
- `src/lib/account-availability.ts`: public-safe account boolean, fails closed on query error.
- `src/components/platform/account-control.tsx`: explicit reason/confirmation, pending/result state, safety/MFA notices.
- `src/components/account-notice.tsx`: generic owner/staff notice.
- `src/components/platform/report-ui.tsx`: Audit Logs and Platform Controls navigation.
- `src/app/platform/audit/page.tsx`: paginated/filterable immutable history.
- `src/app/platform/controls/page.tsx`: actual administrator/account counts, safeguards and known limitations.
- `src/app/platform/restaurants/page.tsx`, `restaurants/[restaurantId]/page.tsx`: distinct account/operational status and controls.
- `src/lib/platform-reporting.ts`: directory account-status type.
- `src/app/dashboard/layout.tsx`, `src/app/staff/orders/page.tsx`: account notice only.
- `src/app/menu/[restaurant]/[branch]/page.tsx`, `[table]/page.tsx`: generic unavailable state. Closed signed table URLs retain the preexisting Thank You state before this check.

Database: migration named below. Tests: `tests/dining-lifecycle.test.cjs`, `tests/platform-reporting-db.test.cjs`, `tests/platform-admin.test.cjs`, `tests/browser/platform-adapters.tsx`, `platform-fixture.tsx`, `platform-flow.cjs`. Documents: this report and `docs/modification-3.5.3-audit.md`. No new dependencies.

## 4. Database migration and hosted checks
Applied **`20261009022449_platform_controls.sql`** to **pixhngrbhiziwapxmqjd**, after the nine prior migrations. Supabase CLI generated the local file; its timestamp was aligned to the server-assigned version after successful application. Adds one private RLS-protected controls table, audit state/reason/request fields and indexes, narrow control/audit/summary RPCs, public-safe availability boolean, enforcement triggers, directory account-status field and reviewed helper hardening. Check constraints are expanded, not removed. No existing business record is changed, no existing audit event deleted, and no tenant RLS policy is broadened.

Hosted post-migration verification: controls table **0 rows**, account suspension/reactivation events **0**, **1 active administrator**, **2 restaurants**, **37 orders**, generic `is_platform_admin()` bypass **false**. ACL inspection confirms new privileged RPCs are authenticated-only with empty search paths; anonymous and service-role direct execution denied. The public availability function returns only a boolean. Auth-trigger direct execution is revoked for all API roles. Private table/schema grants and immutable audit protection remain in force. These are trusted operator SQL/metadata checks, not authenticated browser acceptance.

## 5. Security changes
All platform reads/actions independently reuse the existing guard; their RPCs repeat current authorization. No email-only, user_metadata, PIN-cookie or client-supplied actor grants authority. Sensitive RPCs also verify a TOTP entry in the current live session's `auth.mfa_amr_claims` updated within ten minutes. Access-token refresh alone does not satisfy this check. Supabase Auth owns this table; the migration does not change Auth state. Administrator/session row locks coordinate mutations with revocation. Reason input is restricted to `security_review`, `operational_request`, `review_resolved`; arbitrary secrets/request payloads cannot be stored as reasons. Request IDs coordinate retries and are never authorization claims.

Reviewed legacy SECURITY DEFINER functions:
- `handle_new_auth_user`: revoke PUBLIC/anon/authenticated/service_role direct EXECUTE; Auth trigger still runs and onboarding regression passes. Qualified profiles reference and empty search path.
- `is_restaurant_member`, `is_restaurant_manager`: preserve legitimate RLS callers; explicitly require current uid and qualified scoped membership query; empty search path. Grant only known API roles, not PUBLIC.
- `branch_restaurant_id`, `table_restaurant_id`: return tenant IDs only for the caller's restaurant membership, closing arbitrary-ID lookup. Preserve RLS call compatibility; pin search path and qualify objects.
- `owns_storage_object_restaurant`: retain storage-policy execute and validated UUID-path manager check; pin search path/qualified helper.
- `increment_coupon_usage`: already restricted; unchanged.

### Remaining advisor findings / configuration gate
After migration: 6 intentional RLS/no-policy information findings (including the new private controls table), 6 anonymous SECURITY DEFINER warnings (5 reviewed policy helpers plus public-safe availability), 14 authenticated SECURITY DEFINER warnings (reviewed helpers and independently guarded RPCs), and leaked-password protection disabled. Direct Auth-trigger exposure is removed. Counts alone are not a security assessment; the restricted semantics and negative tests matter. See [RLS advisor](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [anonymous function advisor](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), and [authenticated function advisor](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

**Leaked-password protection is NOT enabled by this release.** The trusted Supabase operator should open project pixhngrbhiziwapxmqjd → Authentication → password/email-provider security settings, enable prevention of leaked passwords and save. Supabase documents this as Pro-plan-and-above functionality; if unavailable, review plan eligibility without automatically purchasing an upgrade. Verify the saved setting and rerun the security advisor until `auth_leaked_password_protection` no longer appears. In an authorized disposable Auth test, verify a known compromised password is rejected and a strong unique password works; never use or log a real user's password. [Official password-security instructions](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## 6. Platform controls
Navigation: Overview, Restaurants, Analytics, Audit Logs, Platform Controls, Sign Out. Controls summary exposes real active-admin and suspended-account counts and the current request's MFA freshness. It explicitly does not claim uptime/system health or enabled leaked-password protection. Provisioning/recovery stays with the trusted operator. Billing not configured; no subscription controls, tenant deletion, impersonation, arbitrary feature switches, menu editing or financial overrides were introduced.

## 7. Audit implementation
Existing append-only table is reused. New successful events record generated event UUID, UTC timestamp, server-derived actor UUID, target restaurant, action, previous/new state, safe reason classification, result and correlation UUID. Existing operator provisioning/revocation events gain before/after state and a fixed trusted-operator reason; old records retain unavailable fields honestly. No foreign-key cascade deletes audit identity/history.

Account state change and success event commit in one RPC transaction. Failure to write the success event rolls back the state; a safe failed event is attempted outside that exception subtransaction. Denials return normal result codes so telemetry commits. Same actor/request replay does not duplicate an event; conflicting request reuse and unchanged state cause no new mutation. Stale versions are rejected. Infrastructure/audit-store outage may prevent telemetry delivery, but cannot yield a successful unaudited state change. Malformed typed RPC arguments rejected before function execution cannot be logged by the function. Anonymous calls lack execute permission and do not manufacture an actor.

Audit UI supports UTC inclusive From/exclusive Until, action, restaurant UUID, administrator UUID, pages of 25/50 and deterministic timestamp/ID ordering. Exact totals have no 1,000-event cap; page input is bounded. Arbitrary metadata is not returned: only fixed outcome code and safe state fields. API roles cannot directly SELECT/INSERT/UPDATE/DELETE/TRUNCATE audit or control state. Immutable triggers additionally deny audit editing/deletion/truncation. Trusted database owners remain outside the application threat boundary.

## 8. Automated test results
- **111 application tests passed**, zero failures/skips.
- **55 native PostgreSQL lifecycle/security/concurrency tests passed**.
- **14 native PostgreSQL reporting/control/security tests passed**.
- **26 local platform browser checks passed**: six pages at mobile/tablet/desktop widths, no overflow, filters/pagination, empty/error/loading states, explicit confirmation/result, unresolved-work button state and audit filtering.
- **11 existing local payment/session browser checks passed**.
- Production webpack build, TypeScript, ESLint and Git whitespace checks passed.

Native SQL suites repeat some application cases; totals are not unique scenarios. Targeted checks cover stale/absent MFA, revoked/expired/forged identity, direct RPC denial, confirmation/reason validation, version conflicts, repeated requests, atomic audit failure rollback, immutable history, account-settings separation, owner inability to unsuspend, another restaurant continuing normally, new visit/order rejection, settled receipt preservation, legacy-debt refusal, >50 audit entries/filtering and tenant-scoped helper/RLS behavior. Independent native connections verify concurrent same-key requests, opposite state requests, order-before-suspension refusal and suspension-before-order rejection. Existing QR/shared visits/multiple rounds/PIN/revocation/fulfillment/payment/closure/old-token/new-visit regressions remain intact. Local browser fixtures use synthetic adapters, never production data.

## 9. Live acceptance — UNVERIFIED
**A–K are UNVERIFIED.** The earlier administrative browser restriction remains; automatic approval review had rejected hosted access and no alternate HTTP/browser route was used to bypass it. No explicit authorization identifying a live restaurant to suspend was supplied, so neither existing restaurant was used for a mutation test. READY/build/database checks do not prove live acceptance.

Manual checklist, using separately authorized test identities/tenant:
- **A:** Sign in as provisioned platform administrator and verify TOTP. Confirm protected overview and controls load. Reverify TOTP within ten minutes of account changes.
- **B–C:** Open both existing test restaurants; compare identity, historical orders, active visits, readiness and recorded receipt data with authoritative records.
- **D:** Obtain explicit permission for the exact controlled tenant. Resolve all listed blockers through legitimate operations. Record baseline menu/table/order/receipt counts, select a reason and confirm Suspend. Expect Suspended, version advancement, actor/time/reason and one success audit.
- **E:** Try both table QR and general-menu ordering, then a direct supported submission request for that tenant. Expect generic unavailable/denial, no new visit/order/payment, and preserved historical reads.
- **F:** Submit an authorized test order at the other restaurant; verify isolation and normal operation.
- **G–H:** Reverify MFA if needed, confirm Reactivate, rescan and order. Account access resumes only if existing operating/menu settings permit. Hours and existing history are unchanged.
- **I:** Filter Audit Logs to tenant/admin/date. Confirm one suspend and one reactivate success, correct before/after state and reasons; retries do not duplicate success.
- **J:** Anonymous, Owner, Manager, PIN-only staff, unprovisioned and revoked identities must fail all platform routes/actions/direct RPCs. Never revoke the sole administrator without trusted recovery ready.
- **K:** Complete the detailed 3.4 A–H manual scenarios: shared QR visit, rounds, Ready/Served, pending/failed/abandoned payment staying open, confirmed external receipt auto-closing, Available table, old URL ended state, fresh rescan and tenant/branch isolation.

Record evidence and clean up only explicitly authorized test data through existing supported operations. Do not manufacture real financial receipts or silently reconcile legacy debts.

## 10. Known limitations
Conservative legacy debt can make suspension unavailable; this is intentional until separately authorized reconciliation, not a reason to override guards. No drain-mode suspension or emergency forced shutdown. History/configuration access remains available to authorized restaurant staff/owners; suspension is not identity deletion. Old owner-editable status values remain independent. Recent-MFA integration depends on the inspected Supabase Auth session/AMR schema and requires live verification; schema failures deny access. New privileged RPCs are narrow, but exact aggregate/deep-offset audit performance still needs larger hosted-scale observation. Audit security events are not an infrastructure monitoring system; outages can prevent failed-attempt telemetry. No provider billing, subscription lifecycle, currency inference or visual redesign. Leaked-password protection and hosted acceptance remain release gates.

## 11. Deployment
Implementation commit and Vercel status pending publication; to be recorded in a documentation-only follow-up. Intended branch: MyPenguin19/qrtest `claude/thaliq-saas-prd-qluyf1`. Production target: qrtest-beryl.vercel.app, project prj_Dxlm3W74xT2OpbETkcgbJIbP7tX9, team mypenguin19s-projects. Immediately before migration, authenticated Vercel configuration confirmed production NEXT_PUBLIC_SUPABASE_URL=https://pixhngrbhiziwapxmqjd.supabase.co. No secrets printed. Baseline branch head was rechecked before release. Runtime error scans/drains are not verified.

## 12. Rollback
Known-good baseline `c16d3e2891e8b5ae2209ef391b134f1e9d7a8e8c`, local `rollback/pre-3-5-3`; Vercel `dpl_A6QUCQba3gxLDhY6W1eUEsoAGoox` (qrtest-egjtbjcv0-mypenguin19s-projects.vercel.app). Authorized operator can restore that deployment or revert this application's changes on the deployment branch. Verify exact alias/commit afterward; Vercel rollback may pause auto-assignment until a later promotion. Leave additive database controls, enforcement and audit records installed. An old application cannot override platform account state; any necessary reactivation requires authorized current control RPC/MFA or a separately reviewed trusted-operator recovery, never blanket deletion of controls. Do not undo safety by dropping audit/trigger tables or restoring broad helper access. Preserve all orders/payments/visits created after release.

## 13. Readiness recommendation for 4.0
Functional implementation and local automated verification pass, but 3.5.3 is **not fully accepted for production operation** until hosted A–K, current-session fresh MFA, configuration hardening and remaining advisor review are documented. Do not start 4.0 automatically. The operator controls remain conservative where legacy data cannot prove settlement.
