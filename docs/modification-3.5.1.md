# Modification 3.5.1 — Platform administrator foundation

## 1. Pre-implementation findings
See `modification-3.5.1-audit.md`. Existing platform_admins contained **zero** identities. The old guard lacked MFA/revocation; legacy /admin pages relied on a layout guard, including a service-role user-directory read. The old is_platform_admin() predicate bypassed tenant RLS for platform identities. No restaurant roles were repurposed.

## 2. Security architecture
Supabase Auth remains the sole password/session provider. Platform authorization is checked afresh through getUser() and a parameterless authenticated database RPC. The RPC uses the request identity and signed JWT supplied by the Data API; no caller-supplied actor, role, restaurant or target authorization arguments. Errors deny access. No middleware-only authorization or cross-request privilege cache.

## 3. Identity model
Reuse public.platform_admins(user_id,created_at), adding created_by, is_active (default false), revoked_at. user_id references Auth; no password/PIN duplication. No production account was provisioned. A separate authorized operator must identify the legitimate existing verified Auth user and follow section 7.

## 4. Schema changes
One migration: `20261008111047_platform_admin_foundation.sql`. Adds admin lifecycle columns, platform_audit_logs, private trigger functions, restricted status/provisioning functions and audit triggers. Existing restaurant/order/payment/staff objects are unchanged except retirement of their old optional generic platform RLS bypass. No restaurant records or sessions removed/reset. The migration was generated with the Supabase CLI; its local timestamp was aligned to the version assigned by hosted apply_migration.

## 5. RLS and RPC permissions
Both platform tables have RLS, no client policies, and no anon/authenticated/service_role table grants. No ordinary client can read/edit authorization or audit records. platform_set_admin(uuid,boolean) is SECURITY INVOKER and unavailable to PUBLIC/anon/authenticated/service_role: use a trusted SQL operator. platform_admin_status() is SECURITY DEFINER with empty search_path, qualified object references, and EXECUTE only for authenticated (plus owner). It reports only the caller's access state. Private trigger functions are inaccessible to API roles. is_platform_admin() now always returns false as a compatibility SECURITY INVOKER predicate: platform access never grants generic cross-tenant restaurant APIs. Old /admin pages independently guard then redirect, executing no legacy data queries.

## 6. MFA enforcement
Access requires: verified non-anonymous/non-banned Auth user, active unrevoked platform row, unexpired JWT, matching existing auth.sessions row with valid not_after, **JWT AAL2 AND session AAL2**, plus a verified MFA factor still present. getUser() independently validates the current Auth identity. Supabase TOTP enrollment/challenge UI uses the provider's APIs; QR/secret/code remain in component memory and are not logged or stored by the application. Enrollment alone grants no authority. Missing MFA fails closed. No MFA reset/recovery bypass is provided.

References: [Supabase MFA](https://supabase.com/docs/guides/auth/auth-mfa), [TOTP enrollment](https://supabase.com/docs/guides/auth/auth-mfa/totp). Live provider configuration/enrollment has not been demonstrated in this task.

## 7. Controlled provisioning procedure
1. A trusted project operator identifies the intended existing Supabase Auth identity out of band. Confirm its exact UUID in Auth management, verified email, identity ownership and use of a strong unique password. Do not choose an account based solely on email, signup order or editable metadata.
2. That person signs in at `/platform/login`, then opens `/platform/mfa`, enrolls their authenticator and verifies a current code. They will still be denied platform access until provisioned. Do not share passwords, QR secrets or codes in chat.
3. The trusted operator signs in to the Supabase dashboard with its own protected project access and opens SQL Editor for **pixhngrbhiziwapxmqjd**. Review Auth identity and verified factor for the exact chosen UUID. Never grant SQL Editor or database credentials to restaurant users.
4. Run the parameterized operation below through the trusted postgres connection (or replace the bind variable with the reviewed UUID in SQL Editor). No placeholder identity has been executed in production:

```sql
-- :verified_auth_user_id is a bound/reviewed UUID, NOT an email.
begin;
select public.platform_set_admin(:verified_auth_user_id::uuid, true);
select user_id,is_active,revoked_at from public.platform_admins
  where user_id=:verified_auth_user_id::uuid;
select action,result,created_at from public.platform_audit_logs
  where target_id=:verified_auth_user_id::uuid order by created_at desc;
commit;
```

The function refuses unverified users or users without a verified factor. It serializes repeated operator requests. Ask the administrator to revisit `/platform` and complete MFA for the current session. Do not weaken the guard if configuration or enrollment fails.

## 8. Revocation and recovery
From the same trusted operator connection, run `select public.platform_set_admin(:verified_auth_user_id::uuid, false);`. Repeated calls are safe and produce no duplicate revocation event. The next protected request fails even with an existing AAL2 browser session; independent restaurant membership is unchanged. For accidental loss of all administrators, a trusted project operator verifies the recovery identity out of band, repairs MFA through the provider's trusted recovery process if necessary, and reprovisions using section 7. There is no public self-reactivation endpoint. Keep operator access recovery separate from application access.

## 9. Protected routes and guards
- `/platform`: verified administrator identity, active/MFA status and future-module placeholders only.
- `/platform/login`: Supabase existing-account sign-in; no admin signup.
- `/platform/mfa`: authenticated, email-verified own-account enrollment/challenge; no platform data or promotion.
- `/platform/access-denied`: generic public failure/retry instructions, no administrator information.
- `/api/platform/status`: independently guarded, generic authorized boolean, 401/403/503 denial, private/no-store.
- All old `/admin` pages independently requirePlatformAdmin then redirect to `/platform`; no layout-only trust.
No ordinary restaurant navigation changes.

## 10. Audit implementation
Stable event types: platform_admin.provisioned, platform_admin.revoked, platform_admin.authorization_changed, platform.access_denied. Admin row changes trigger audit insertion **in the same PostgreSQL transaction**; an audit failure rolls back the change. Updates/deletes/truncation of audit logs are rejected by triggers as defense in depth; table grants already deny API roles. Trusted database owners could alter triggers/schema and remain outside the application threat boundary.

Operator events record auth.uid() when available, otherwise NULL, with session_user and trusted_database_operator source. NULL is intentional: a postgres bootstrap must not falsely claim an authenticated application administrator. Retain the operator's external change record to identify the human using a shared SQL role. Audit user UUIDs have no cascading deletion, preserving history.

Status denials record only the validated caller UUID and fixed event fields, at most once per minute per identity with a transaction lock. Anonymous/Auth-service failures cannot be reliably attributed and are not logged as a made-up actor. No request payload, password, PIN, token, factor secret or payment details are logged. A denied RPC returns normally so its audit event commits. Infrastructure failure still denies access; audit delivery during an outage is not claimed guaranteed.

Future privileged mutations must perform authorization, row locking, mutation and success audit **inside one SQL transaction/RPC**, deriving actor from auth.uid(). A separate server guard followed by two independent writes is not an atomic audit pattern. No future business mutation is implemented here.

## 11. Files changed
- `src/lib/platform-admin.ts`; `src/lib/supabase/admin.ts` (server-only boundary).
- `src/app/admin/layout.tsx` and existing admin pages: overview, users, restaurants, payments, subscriptions, templates.
- New `src/app/platform/page.tsx`, `login/page.tsx`, `mfa/page.tsx`, `access-denied/page.tsx`.
- New `src/app/api/platform/status/route.ts`.
- New `src/components/platform/platform-login.tsx`, `platform-mfa.tsx`.
- Migration named in section 4.
- New `tests/platform-admin.test.cjs`; extended `tests/dining-lifecycle.test.cjs`, `tests/staff-orders.test.cjs`.
- This report and `docs/modification-3.5.1-audit.md`.

## 12. Migrations applied / hosted verification
Confirmed production NEXT_PUBLIC_SUPABASE_URL from authenticated Vercel configuration: `https://pixhngrbhiziwapxmqjd.supabase.co`. Inspected seven prior migrations; applied only platform_admin_foundation, hosted version **20261008111047**. Read-only verification confirmed both table RLS flags, denied client/service table grants, denied operator RPC for authenticated/service_role, denied anonymous status RPC, authenticated own-status RPC, all audit triggers and retired generic bypass. Hosted admin count remains **0**. No production identity, MFA factor, order, table or payment fixture was created.

## 13. Automated results
- **93 application tests passed**, zero failures/skips, including SQL-engine lifecycle suite and new guard/direct-route tests.
- **55 native PostgreSQL tests passed**, zero failures/skips, including concurrent status/payment operations and concurrent platform provision/revoke serialization.
- **11 existing local Chrome payment/session component checks passed**.
- TypeScript, ESLint (no warnings), production webpack build and Git whitespace checks passed.
- Initial test adapter lacked Next's server-only stub and old admin redirect expectations; updated for the new boundary without removing test coverage. A native assertion initially expected occupied instead of the correct order_pending state; corrected it to verify the foreign update leaves that state intact. A TypeScript run overlapping Next's generated-type cleanup failed; the sequential post-build check passed.

These are local automated tests with controlled fixtures, not hosted Auth/MFA acceptance. No tests were deleted. No new MFA browser success is claimed.

## 14. Hosted/live acceptance
**Hosted schema/permissions: verified. Hosted browser: UNVERIFIED.** Browser tooling again denied access because its admin policy could not be verified; no bypass attempted. No legitimate platform identity was supplied/provisioned, so end-to-end privileged sign-in and recovery remain unverified.

Manual checklist after controlled provisioning:
1. Anonymous/PIN-only, Owner and Manager without separate grant: `/platform`, each `/admin` URL and `/api/platform/status` must deny; editable metadata/query parameters must not change this.
2. Valid administrator at AAL1: denied/required MFA; wrong code must fail. Correct TOTP: landing shows their verified identity and MFA status, status API succeeds.
3. Revoke through SQL operator while browser remains open; refresh/direct API/old admin routes must deny. Independent restaurant dashboard permission remains intact.
4. Test inactive, expired/logged-out session, removed verified factor and unavailable Auth/database: no platform data. Repeated denial should not flood audit records.
5. Browser anon/authenticated REST access cannot read or mutate platform tables, call provisioning, or access another restaurant through platform membership. Verify append-only logs using trusted SQL.
6. Run 3.4 live A–H restaurant checklist: two devices/rounds, Ready→Served, failed/pending payment stays open, confirmed full external receipt closes once, new visit is independent, staff deactivation and tenant/branch isolation remain enforced.
7. Verify authenticator setup/sign-in on mobile/tablet, provider rate limits and recovery with the trusted operator. Do not use real customer payment data for testing.

## 15. Remaining security warnings
Six legacy SECURITY DEFINER helpers remain callable by anon/authenticated; their dependency/impact analysis is in the audit. [Supabase remediation guidance](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable). New authenticated platform_admin_status warning is expected: narrowly scoped own-identity authorization needs protected-table access, has no identity parameters, and has explicit session/MFA checks. [Authenticated function review](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

RLS-without-policy notices for platform tables are intentional deny-all boundaries, not missing public policies. [RLS notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

Leaked-password protection remains disabled and was not changed for all restaurant users. Trusted operator should review enabling it; no claim that AAL2 eliminates password risk. [Password protection guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## 16. Deployment commit and status
Publication pending at report creation. Intended repository/branch: `MyPenguin19/qrtest`, `claude/thaliq-saas-prd-qluyf1`; Vercel qrtest under mypenguin19s-projects, production alias `https://qrtest-beryl.vercel.app`. Exact release metadata will be recorded after publication. READY will establish build/alias status only, not live security acceptance.

## 17. Rollback
Local `rollback/pre-3-5-1` points to **681291ff37685574c7d1e0b5f22bc14195a3a37c**. Revert application changes or restore its prior READY deployment if required. **Keep the security migration applied**: old /admin fails closed, restaurant operations coexist. Do not restore legacy cross-tenant bypass or broad platform table grants while platform accounts exist. Revoke any provisioned platform identities through the operator function before investigating. Preserve audit and restaurant history; no database reset, truncate or destructive down-migration.

## 18. Readiness for 3.5.2
Implemented and locally tested foundation; hosted database protections verified. Initial trusted provisioning, actual MFA sign-in and live authorization/restaurant acceptance remain outstanding. **Do not declare complete live security acceptance or begin 3.5.2 automatically.** No full dashboard, directory, analytics, impersonation, cross-tenant editing, suspension or billing features were added.
