# 3.5.1 pre-implementation audit

Baseline: `681291ff37685574c7d1e0b5f22bc14195a3a37c`. Rollback: `rollback/pre-3-5-1` created before implementation.

## Authentication and existing boundaries
Supabase Auth `getUser()` identifies Owners/Managers; `restaurant_members` supplies restaurant roles. PIN staff use opaque, hashed, revocable server sessions with expiry, active employee/version/branch checks. Staff/customer writes use server credentials and scoped atomic RPCs. These remain unchanged. `SUPABASE_SERVICE_ROLE_KEY` is not a NEXT_PUBLIC variable; the admin client needs an explicit server-only import boundary.

A platform system already exists: public.platform_admins(user_id, created_at), a self-select RLS policy, is_platform_admin(), requirePlatformAdmin(), and /admin pages. Hosted count is **zero**. No platform account will be invented or provisioned automatically.

## Security findings
The old helper checks membership only: no active/revocation or MFA checks. Many restaurant RLS policies OR in is_platform_admin(), giving existing platform identities generic cross-tenant browser access. This must be retired before provisioning; a dedicated protected platform RPC is safer than keeping the old global bypass. The old /admin/users page calls service-role listUsers guarded only by a parent layout; Next layouts are not a data-access security boundary. Legacy /admin pages will become guarded redirects to /platform, preserving source history in Git and exposing no directory/analytics in 3.5.1.

Hosted platform_admins grants include ordinary client CRUD, but RLS only permits self SELECT and no writes. There is no current client self-promotion policy. Harden table grants as defense in depth.

Seven legacy SECURITY DEFINER helpers are executable by anon/authenticated:
- is_platform_admin: called by many RLS policies; membership-only cross-tenant bypass. Replace with compatibility false predicate, SECURITY INVOKER, preserving dependencies while removing this generic bypass. No production platform identities exist.
- is_restaurant_member/is_restaurant_manager: RLS predicates using auth.uid(); no arbitrary actor argument. Preserve to avoid breaking restaurant policies.
- branch_restaurant_id/table_restaurant_id: RLS scope lookups; accept object UUID and reveal restaurant mapping. Preserve in this phase; assess exposed mapping enumeration separately.
- owns_storage_object_restaurant: storage RLS helper validates UUID path then authenticated manager membership. Preserve.
- handle_new_auth_user: Auth insert trigger copies profile fields, not privileges. Trigger-returning functions cannot be invoked as ordinary SQL calls. Preserve; ACL cleanup is a separate hardening opportunity.
All have fixed public search_path; platform additions will use empty search_path and qualified names. None of the six retained helpers writes platform authorization records. Leaked-password protection is disabled; this remains an Auth-project setting warning, not evidence that MFA is enabled or tested. Enable through a trusted project operator after plan/settings review; do not silently change all restaurant password policy.

## Hosted history and project
Connected Supabase project `qrtest` is ACTIVE_HEALTHY, ref `pixhngrbhiziwapxmqjd`; seven existing migrations are applied through `20261008012015_secure_staff_console`. No migrations reapplied. Hosted schema confirms auth.sessions id/user_id/aal/not_after and auth.mfa_factors user_id/status are available for live session and factor checks. Reconfirm production public URL configuration before hosted migration.

## Proposed minimal implementation
Extend existing platform_admins with inactive-by-default lifecycle fields. Add private-to-clients append-only platform_audit_logs. PostgreSQL-only operator provisioning/revocation checks verified existing Auth identity and verified MFA factor; atomic triggers audit authorization changes. No public promotion endpoint. A parameterless own-identity RPC checks active authorization, verified Auth user, live matching Auth session, JWT expiry/AAL2, session AAL2 and existing verified factor. Server guard uses getUser and this RPC on every protected request, failing closed. Denied attempts can be audited for validated users with bounded deduplication; no secret/request payload logging. Future mutation RPCs must authorize, lock, mutate and audit in one transaction.

Add minimal /platform landing, dedicated sign-in, own-account MFA enrollment/challenge, generic denied/error states and guarded status API. Retire legacy /admin data access via guarded redirects. No restaurant enum, membership, order, payment or staff-auth changes.

## Provisioning/recovery strategy
No initial user ID supplied: document controlled SQL provisioning for an existing verified identity after it enrolls/verifies TOTP. MFA remains mandatory. Recovery requires trusted database operator identity checks and reprovisioning; no emergency browser bypass. Revocation rechecked on subsequent requests and leaves independent restaurant permissions untouched.

## Rollback and coexistence
Additive tables/columns coexist with 3.4 restaurant code. Old /admin access intentionally fails closed after grant hardening. Keep security migration in place on application rollback; never restore the insecure generic platform predicate while administrators are provisioned. No restaurant data deletion or session reset.

## Test strategy
Test server guards, direct route access, anonymous/Owner/Manager/PIN denial, MFA and revocation errors, identity forgery and service errors. PostgreSQL tests verify grants/RLS, immutable audit history, transactional provisioning, repeated revocation, live session/factor validation and retired RLS bypass. Re-run full existing application, lifecycle, concurrent PostgreSQL, payment component suites, TypeScript, lint, production build and whitespace checks. Hosted checks are read-only after migration. Live browser acceptance remains separate and must be marked UNVERIFIED if access is denied.

## Configuration confirmation
Vercel production NEXT_PUBLIC_SUPABASE_URL was read through its authenticated single-variable API and matches https://pixhngrbhiziwapxmqjd.supabase.co. The CLI-generated migration was assigned hosted version 20261008111047 by the migration tool; the local filename was aligned with that applied version without reapplying SQL.
