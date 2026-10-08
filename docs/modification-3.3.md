# Modification 3.3 — Unified Staff Console

## Status and baseline

Implemented and tested locally. Two additive migrations applied to Supabase project `pixhngrbhiziwapxmqjd`. Application changes are not yet pushed/deployed.

Phase 0 audit is recorded in the project-level `qrtest-modification-3.3-audit.md`. The user confirmed the live 3.2 workflow and explicitly waived further live browser verification. Rollback code branch: `rollback/pre-3-3`, commit `ca676b456d608e43ab415b98a449b3d2d37a28dc`. No production orders, sessions, payments or staff identities were deleted/reset.

## Completed phases

0. Repository/database audit and rollback reference; user confirmed 3.2 acceptance.
1. New `staff` role added; all existing waiter/kitchen/cashier IDs and stored roles retained and treated as Staff operationally.
2. Staff management supports add, rename, branch assignment, PIN reset, activate/deactivate and revoke sessions. Owner can link Manager access to an existing verified Supabase email account; managers can manage operational staff but cannot assign/manage managers through these actions. No invitation/email service was added.
3. Name + PIN sign-in, scrypt hashes, persistent attempt limits, server-backed revocable sessions, secure cookies, expiry and idle handling.
4. Existing table-centered Orders page is now Staff Console, with restaurant/name, Active Tables, Available Tables and Sign Out. Existing table requests remain accessible in this console.
5. NEW → READY → SERVED retained, with atomic compare-and-swap and history inserts in a server-only RPC. Legacy Preparing remains compatible.
6. Every operational staff identity can record counter payment using the existing payment engine. Walk-up payment internally prepares the bill. Explicit full receipt closes the session atomically; pending/failure never closes it.
7. Current server session derives actor/restaurant/branch. Operations revalidate the session inside their database transaction; staff deactivation/reset holds the corresponding staff row lock and invalidates subsequent actions. Staff cannot use management actions or manually clear an unpaid bill. Owner/Manager retains the existing manual-close behavior.
8. Existing order history, payment actor fields, and table-session closure actor fields supply actor, restaurant/session linkage, action and timestamp. No parallel audit/reporting system.
9. Existing waiter/kitchen/cashier URLs remain as authenticated redirects to `/staff/orders`; their reusable components remain in the repository.
10. Automated/database/component tests executed; no live 3.3 browser acceptance claimed.

## Authentication details

- New/reset PIN: 6–8 digits; repeated digits and ascending/descending sequences rejected. Legacy four-digit PINs remain supported for existing employees under the same throttle. PIN reset upgrades them.
- Attempt reservations are atomic before scrypt verification: 5 attempts per staff member per 15-minute window, plus 200 per restaurant/window. Successful attempts also consume a reservation. Changing devices or application workers does not bypass these database limits.
- Cookie: 256-bit random opaque token; HttpOnly, Secure, SameSite=Lax, 12-hour maximum. Only its SHA-256 digest is stored in `staff_sessions`.
- Server-enforced 12-hour absolute expiry and 30-minute inactivity expiry. Read polling does not extend activity; actual pointer/keyboard interaction sends at most one activity update per minute. Mutations also count as activity.
- Logout revokes the current database session. PIN reset, deactivation, role/branch/account reassignment and explicit revocation invalidate sessions via `auth_version`.
- One fresh sign-in is required after code rollout because old signed cookies lacked server-enforced expiry/revocation. Staff PIN sign-in never creates a Supabase Auth manager identity.
- Public directory responses contain only restaurant display information and staff IDs/names. No hashes, PINs or session digests are returned.
- Manager accounts must already exist with a verified email. They use `/login` with full Supabase authentication. Existing dashboard restaurant-selection behavior is unchanged.

## Applied migrations

- `20261008012009_unified_staff_role.sql`: append `staff` enum value without removing historical roles.
- `20261008012015_secure_staff_console.sql`: staff credential version and optional manager-account link; RLS-protected server-only login-limiter/session tables; scoped authentication/management/operational RPCs; existing closure actor attribution.

Applied in order as separate commits. Hosted catalog verification confirmed:
- 5 existing staff records with unchanged legacy role counts (2 cashier, 2 kitchen, 1 waiter).
- All 7 new callable auth/management/operation RPCs are SECURITY INVOKER, service-role executable, and inaccessible to anon/authenticated.
- Both new tables have RLS enabled and no anon/authenticated SELECT grants.
- Automatic payment closure remains installed; duplicate active visits = 0.

No new payment engine, external auth service, customer ordering change or financial dashboard access for PIN staff.

## Files changed

Application:
- `src/app/actions/dining.ts`
- `src/app/actions/staff-auth.ts`
- `src/app/actions/staff-ops.ts`
- `src/app/actions/staff.ts`
- `src/app/dashboard/staff/page.tsx`
- `src/app/staff/orders/page.tsx`
- `src/app/staff/kitchen/page.tsx`
- `src/app/staff/waiter/page.tsx`
- `src/app/staff/cashier/page.tsx`
- `src/components/dashboard/add-staff-form.tsx`
- `src/components/dashboard/staff-login-card.tsx`
- `src/components/staff/dining-table-card.tsx`
- `src/components/staff/staff-login-form.tsx`
- `src/components/staff/staff-activity.tsx` (new)
- `src/lib/staff-pin.ts`
- `src/lib/staff-session.ts`

Database, tests and documentation:
- Both migrations listed above
- `supabase/migrations/README.md`
- `tests/dining-lifecycle.test.cjs`
- `tests/staff-orders.test.cjs`
- `tests/browser/payment-fixture.tsx`
- `tests/browser/payment-flow.cjs`
- `docs/modification-3.3.md`

## Exact verification

- `node --test tests/*.test.cjs`: **70 passed, 0 failed, 0 skipped** (42 PGlite lifecycle/security, 6 table-view, 22 server-action/page checks).
- Same lifecycle suite on fresh isolated native PostgreSQL 18, including true concurrent requests: **48 passed, 0 failed, 0 skipped**. These overlap the PGlite checks; they are not 48 additional unique scenarios.
- Existing headless Chrome component suite using localhost-only synthetic data/adapters: **11 checks passed**. Includes retained customer options/manual owner closure plus operational staff pending/failure/receipt flow. This is not live-browser verification.
- TypeScript `--noEmit`: passed.
- ESLint `src tests`: passed without errors/warnings.
- Next.js production build `--webpack`: passed.
- `git diff --check`: passed.

A: Name/PIN validation, separate device tokens, logout/replay rejection, absolute/idle expiry.
B: Nico/Maria tokens and shared visit; real concurrent updates exercised. Live push/poll rendering not rechecked.
C: Coke/Coffee/Pizza rounds under one visit, Ready/Served attribution and preserved items.
D: Counter payment without customer intent, pending attempt, explicit receipt, closed/available, one payment.
E: Deactivation, reactivation, reset, reassignment and revoke invalidate old sessions.
F: Foreign tenant/table/order/branch IDs rejected; operational credential reads blocked by RLS.
G: Concurrent status and receipt operations create one result; injected history/closure failures roll back atomically.
H: Prior dining lifecycle/pricing/order-round/customer signed URL/ended page tests plus local payment components pass. Customer files and table-session architecture unchanged.
I: PIN session cannot reach owner/admin/staff-management actions; owner-only Manager assignment, verified email requirement, deactivation/demotion membership removal tested.
J: Persistent lockout/reservation, reset-versus-login race, PIN hashing/rules, minimal directory output and RPC/table privilege tests pass.

## Remaining concerns / rollout

Application code still needs GitHub push/deployment. Database migrations are already applied and must not be reapplied. Live 3.3 browser acceptance was waived by the user and is not claimed.

Supabase advisors have the same pre-existing WARN findings before and after: 7 legacy SECURITY DEFINER helpers callable by anon/authenticated, and leaked-password protection disabled. They are not new staff-console RPCs. Broadly changing those existing RLS/storage/auth helpers was outside this modification. Review [public helper exposure](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [authenticated helper exposure](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), and [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) separately.

Advisors also report INFO for [RLS enabled with no policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) on the two new auth tables: intentional deny-by-default; only server/service role can access them. The older customer_sessions table uses the same pattern. Do not add public policies to silence those notices.

Rollback should preserve additive columns, auth/session data and role values. Do not drop new tables or downgrade new Staff identities to erase a rollout. The baseline code reference is available for comparison/recovery, but old 3.2 code cannot authenticate newly created `staff` enum accounts and does not enforce the new session controls; a rollback after adoption needs deliberate compatibility handling.
