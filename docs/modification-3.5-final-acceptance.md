# Modification 3.5 — Final acceptance and security verification

Checkpoint: October 8, 2026 America/New_York (October 9 UTC). Scope: Modifications 3.1–3.5.3; verification only. No 4.0 work started.

**Recommendation: READY FOR LIMITED TESTING ONLY.** One high-severity Manager/Owner permission defect was reproduced locally on both PostgreSQL engines and the matching production policy/grants verified read-only. Correct it through a separately reviewed migration before real restaurant onboarding. This report does not approve public production launch. UI design planning may proceed, but it must not imply security or operational acceptance.

Classifications: **VERIFIED** = directly inspected deployed metadata/schema/configuration; **PASSED LOCALLY** = automated local execution; **UNVERIFIED** = no direct acceptance evidence; **FAILED** = a reproduced expectation or security configuration check failed; **BLOCKED** = an access or task constraint prevents the action.

## 1. GitHub and deployment baseline — VERIFIED
- Local branch: `codex/table-operations-3-2`; working tree initially clean.
- Local HEAD and remote `MyPenguin19/qrtest:claude/thaliq-saas-prd-qluyf1`: `42b3efd4913d7aa5e4ed9d6934663ad209c5a818`, matching the requested 3.5.3 baseline.
- Production Vercel deployment: `dpl_6wnZREgueiKPzHnmAjsMwi15Kcv3`, target production, READY.
- Deployment URL: `https://qrtest-r1nfpv0wh-mypenguin19s-projects.vercel.app`; verified alias `https://qrtest-beryl.vercel.app`.
- Vercel `gitSource.sha` exactly matches the commit above. Project `qrtest`, ID `prj_Dxlm3W74xT2OpbETkcgbJIbP7tX9`, team `mypenguin19s-projects`, ID `team_zRNgaDpcjcYMDv7NGwbpzQ9J`.
- Production public configuration was reread: `NEXT_PUBLIC_SUPABASE_URL=https://pixhngrbhiziwapxmqjd.supabase.co`. No secret values were printed.
- No discrepancy found. Deployment metadata was inspected through the authenticated CLI; the application itself was not accessed through an alternative path around browser restrictions.

## 2. Migration status — VERIFIED
All 10 required hosted migrations match local history:

| Version | Migration |
| --- | --- |
| 20261006223057 | qrtest_initial_schema |
| 20261007213147 | dining_lifecycle_states |
| 20261007213159 | atomic_dining_lifecycle |
| 20261007213210 | optional_customer_payment |
| 20261008010236 | close_confirmed_external_payment |
| 20261008012009 | unified_staff_role |
| 20261008012015 | secure_staff_console |
| 20261008111047 | platform_admin_foundation |
| 20261008212741 | platform_intelligence |
| 20261009022449 | platform_controls |

No migration was created, reapplied or reversed. No database reset or production data mutation occurred. Hosted account-controls count remains zero, one administrator remains active, and the generic platform RLS bypass remains false.

## 3. Security audit

| Boundary | Classification / evidence |
| --- | --- |
| Platform identity and MFA | PASSED LOCALLY; existing guard and SQL checks independently validate current Auth identity/session, active nonrevoked administrator, expiry, AAL2 and verified factor. Account mutations additionally require current-session TOTP within 10 minutes. Hosted enrollment/reauthentication behavior remains UNVERIFIED. |
| Owner/Manager/PIN denial at platform routes/RPCs | PASSED LOCALLY. Hosted RPC ACLs VERIFIED: anon/service cannot invoke privileged platform RPCs; authenticated execution still requires internal authorization. No email/user_metadata grant path. |
| Generic platform bypass | VERIFIED false in hosted database; PASSED LOCALLY that platform identity alone does not grant restaurant operational RLS access. |
| Tenant/branch isolation | PASSED LOCALLY for staff/customer/restaurant paths and forged foreign IDs. Hosted role walkthrough UNVERIFIED. No cross-tenant exploit was reproduced. |
| Owner/Manager distinction | **FAILED — high severity**, detailed below. Server-action tests pass, but direct membership writes bypass that boundary. |
| PIN authentication/revocation | PASSED LOCALLY: salted PIN checks, attempt limits, token hashing, live staff/session/version/expiry checks, deactivation/reset/reassignment/logout and concurrent revocation behavior. |
| Suspension/reactivation | PASSED LOCALLY: current/fresh MFA, mandatory reason/confirmation, stale versions, retries, unresolved-work refusal and ordering races. No live restaurant was suspended. |
| Audit integrity | PASSED LOCALLY: atomic state/event transaction, failed audit insertion rollback, immutable rows, denial classifications, pagination/filtering. Hosted RLS/table ACLs VERIFIED. |
| Financial/session writes | Hosted direct authenticated updates revoked; service-only dining/staff RPC permissions VERIFIED. Atomic full receipt/closure and duplicate protection PASSED LOCALLY. |
| Customer sessions | PASSED LOCALLY: HMAC purpose and tenant/branch/table/visit binding, closed visit isolation, old URL handling and fresh QR visit. |
| Service-role exposure | No exposure found in reviewed server boundaries or current built client chunks; zero service-key identifier matches. Server-only module boundary retained. This is not a guarantee against all possible secret exposure or proof about downloaded production assets. |

### High: Manager can promote their own membership to Owner — FAILED
Source: `supabase/baseline/20260814000003_rls_policies.sql`, `restaurant_members_manage` policy. The helper `is_restaurant_manager()` accepts both Owner and Manager. The policy permits ALL operations when that helper is true, and does not constrain the assigned role. The authenticated role retains INSERT/UPDATE privileges on `restaurant_members`.

Reproduction used disposable fixtures only: create a restaurant and Manager membership; set the transaction to authenticated with that user's identity; directly update the same membership role to Owner; reread it. Expected Manager; actual **Owner**. Both PGlite and native PostgreSQL reproduce this. The narrow retained regression is `FINAL ACCEPTANCE manager must not promote self through direct membership update` in `tests/platform-reporting-db.test.cjs`.

Production policy text and authenticated INSERT/UPDATE privileges match the local cause; no production role or member record was modified. Impact is restaurant-local Owner privilege escalation, bypassing owner-only restrictions enforced by the staff-management RPC/UI. Platform-admin access and cross-tenant access are not demonstrated by this finding.

**Fix BLOCKED by this task's change policy:** correction requires database permission/policy changes and a migration. Do not patch only the UI. A follow-up should restrict direct membership role mutations while preserving owner onboarding/bootstrap and legitimate manager behavior, enforce owner-only elevation at the database boundary, review related direct staff-management policies, and pass positive/negative regressions before deployment. No fix or migration was attempted here.

### Supabase advisors — VERIFIED outstanding
Current findings: 6 RLS-enabled/no-policy information notices, 6 anonymous SECURITY DEFINER warnings, 14 authenticated SECURITY DEFINER warnings, 1 leaked-password-protection warning. Restricted audit/admin/staff/private-control tables intentionally have no client policies; grants deny direct access. Order/payment/session SELECT grants exist, with row access constrained by RLS—table privilege alone is not public data exposure. Legacy policy helpers have scoped semantics; platform RPCs independently authorize. Auth-trigger direct execute remains revoked.

The warning counts are not a clean bill of security; the Manager policy defect was not caught by those advisory categories. References: [RLS notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [anonymous privileged functions](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [authenticated privileged functions](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

### Leaked-password protection — FAILED configuration check; unchanged
The current hosted advisor explicitly reports protection disabled. No supported Auth configuration mutation tool is exposed in this session; no setting was changed or claimed enabled. Proposed operator change: enable rejection of known compromised passwords for this project, without changing MFA or unrelated authentication settings. This affects password-strength validation; it is not a password reset, identity migration or substitute for MFA. Supabase documents availability on Pro and above; this project's eligibility was not verified. Do not purchase an upgrade automatically.

Manual steps:
1. Open Supabase Dashboard, select **qrtest / pixhngrbhiziwapxmqjd**.
2. Open **Authentication → Sign In / Providers → Email** (the project's Auth/password security settings).
3. Locate **Prevent use of leaked passwords / Leaked password protection**, enable it and save, if available for the plan.
4. Reload the settings to verify persistence and rerun Security Advisor; `auth_leaked_password_protection` should disappear.
5. In a separately authorized disposable Auth test, verify compromised-password rejection and strong unique password acceptance. Do not change a real user's password or disclose credentials in logs/chat.

[Official Supabase password-security guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). If the control is unavailable, report plan/permission restrictions rather than claiming success.

## 4. Automated results and reliability

| Check | Result |
| --- | --- |
| Existing application suite | PASSED LOCALLY: 111/111, zero skipped, before adding the security regression. |
| Final suite with retained regression | **FAILED: 112 total, 111 passed, 1 failed**, zero skipped. Sole failure is the confirmed Manager elevation defect. |
| Existing native PostgreSQL lifecycle suite | PASSED LOCALLY: 55/55. |
| Existing native reporting/control suite | PASSED LOCALLY: 14/14, including independent-connection races. |
| New targeted native security regression | **FAILED: 0/1**, same Manager-to-Owner result. |
| Local platform browser fixtures | PASSED LOCALLY: 26 checks. |
| Local payment/session browser fixtures | PASSED LOCALLY: 11 checks. |
| Production webpack build, TypeScript, ESLint | PASSED LOCALLY; added regression separately linted. |
| Route manifest | PASSED LOCALLY: expected platform routes/status endpoint are built. Hosted HTTP responses UNVERIFIED. |

Native and application SQL coverage overlap; these are run counts, not unique scenario totals. Disposable PostgreSQL instances were shut down after testing. No dependencies installed for this checkpoint.

Existing tests exercise QR joins, multiple devices/rounds and totals; New→Ready→Served and queue history filtering; tenant/branch permissions; concurrent fulfillment; Pay at Counter as intent only; pending/failed/abandoned attempts retaining visits; one full external receipt and exactly-once closure; Available tables; closed signed URLs and new visits; platform reporting, suspension, reactivation, MFA and audit behavior. Local browser fixtures use synthetic adapters and are not live integrations.

Error/scale review: platform reads return generic errors and fail closed; credential validation detects missing/malformed environment values without printing their values; staff sessions fail closed on query errors. Directory totals/pagination beyond 1,000 tenants and audit pagination/filtering are tested. Atomic concurrency tests pass. No aggressive production load test, runtime outage injection, new EXPLAIN benchmark or infrastructure changes were performed. Hosted performance, runtime error rates, response caching headers and authenticated route availability remain UNVERIFIED. Build success alone does not establish them.

## 5. Hosted acceptance — UNVERIFIED / BLOCKED
Read-only deployment, configuration, migration and permission metadata were VERIFIED. Browser lifecycle/auth acceptance is **UNVERIFIED**: the earlier administrative browser restriction remains, and automatic approval review previously rejected hosted access. No repeated attempt or alternate browser/HTTP bypass was made. No production payments, orders, suspensions or revocations were simulated. The sole platform administrator was not revoked.

## 6. Outstanding manual acceptance
Use approved test accounts and an explicitly controlled environment; this checkpoint does not authorize a live suspension or fabricated financial receipt.
- Verify platform login, TOTP, stale-MFA recheck, expiry and revoked-identity denial with a safe recovery administrator/operator available.
- Verify Owner, Manager, PIN staff and unprovisioned identities cannot retrieve platform routes/data; repeat restaurant/branch isolation across two accounts. Retest direct membership escalation after its reviewed fix.
- Reconcile directory/analytics/detail values; test audit filters and responsive layouts on the hosted build.
- On an authorized controlled test table, join from two devices, submit multiple rounds, mark Ready/Served and confirm preserved totals/history.
- Verify counter intent, failed/abandoned payment staying open, legitimate full external-receipt confirmation exactly once, table availability, old URL ended state and clean rescan. Never represent a fake payment as a live customer's receipt.
- Exercise suspension/reactivation only in a separately authorized non-live test environment: unresolved work refused, authorized clean suspension blocks new work, unaffected tenant continues, reactivation preserves operating settings and one audit event per transition.
- Enable/verify leaked-password protection and record remaining advisor review and runtime observations.

## 7. Severity register
- **Critical:** no confirmed critical architectural or platform-wide security defect found in this bounded review; not proof that none exists.
- **High — FAILED:** restaurant Manager-to-Owner escalation through direct membership update. Must be corrected before real restaurant onboarding.
- **Medium — FAILED configuration check:** leaked-password protection disabled; manual supported configuration and verification outstanding.
- **Low — documented limitation:** conservative legacy debt may prevent suspension until separately authorized reconciliation. This is deliberate safety behavior; no bypass recommended.
- **Acceptance gate — UNVERIFIED/BLOCKED:** hosted auth/lifecycle/performance walkthrough remains outstanding. This is missing evidence, not a fabricated passing result or an independently confirmed vulnerability.

## 8. Changes made
Only this report and one narrowly targeted failing regression appended to `tests/platform-reporting-db.test.cjs`. Temporary probe copy removed. No application code, UI, dependency, Auth configuration, production record or migration changes. No GitHub push or deployment performed; the verified production release remains `42b3efd`. The failing regression is intentionally retained, not skipped or converted into an expected-pass exploit test.

## 9. Rollback
No production rollback is needed because production was unchanged. Existing rollback reference `rollback/pre-3-5-3` points to `c16d3e2891e8b5ae2209ef391b134f1e9d7a8e8c`. Rolling back 3.5.3 would not correct this older membership-policy defect; do not use rollback as its remedy. Preserve all existing audit, session and payment history. This checkpoint adds only local verification artifacts.

## 10. Decision
**READY FOR LIMITED TESTING ONLY.** Core dining/payment/platform mechanisms passed their existing local regressions, but the newly reproduced high-severity role escalation and missing hosted acceptance prevent approval for real restaurant onboarding or public launch. A separately reviewed, regression-covered database security correction is required. Planning 4.0 visuals may proceed independently; no 4.0 implementation begins here. Stop engineering work after this report.
