# Final Security Hotfix (3.5)

## Scope and release gate
The continuation fixed only the Owner-onboarding fixture UUID/text parameter mismatch, using separately typed parameters. Assertions and migration SQL were unchanged. No application, UI, ordering, payment, billing or authentication-architecture changes.

Baseline: `42b3efd4913d7aa5e4ed9d6934663ad209c5a818`. Local rollback ref: `rollback/pre-3-5-security-hotfix`. GitHub deployment branch: `claude/thaliq-saas-prd-qluyf1`.

## Migration
Reviewed original `20261009100127_membership_owner_boundary.sql` applied successfully to production Supabase project `pixhngrbhiziwapxmqjd`. Supabase assigned version `20261009101545`; the local filename and test loaders were aligned to `20261009101545_membership_owner_boundary.sql` without changing SQL.

The migration adds an Owner membership predicate, restricts privileged membership/staff writes to Owners, preserves Manager operational staff management and directory reads, and guards restaurant ownership changes/deletion. Existing self-owner onboarding remains intact. No existing business records are rewritten.

## Verification
- Application tests: **116 passed, 0 failed, 0 skipped**.
- Native PostgreSQL lifecycle tests: **55 passed**.
- Native PostgreSQL reporting/security tests: **19 passed**, including the previously failing authenticated Owner onboarding test and the original Manager self-promotion regression.
- Production build (`next build --webpack`), TypeScript (`tsc --noEmit`) and ESLint passed.
- Hosted policies: authenticated Owner boundary present on both old/new membership and staff rows; existing bootstrap policy preserved; all three tables retain RLS.
- Hosted grants: authenticated can execute Owner predicate; anon cannot; authenticated cannot directly execute the private trigger function. Existing table DML grants remain subject to RLS.
- Hosted rollback transaction exercised authenticated database roles: Manager self-promotion, privileged INSERT/UPSERT, promotion of another member, owner_id changes, restaurant deletion, staff-role/link bypasses and cross-tenant writes were blocked. Owner onboarding, branch creation, privileged membership management, legitimate ownership transfer and linked-staff management succeeded. Normal Manager settings/staff changes and directory reads succeeded. Every synthetic restaurant/membership/staff/branch record was rolled back; existing users were only referenced as fixture identities and were not modified.

## Release
Database migration applied and hosted verification passed. Exact GitHub commit and Vercel deployment identifiers are recorded in the final delivery message after source publication and deployment verification. The production public Supabase URL was checked against the target project before applying.

## Files
- `supabase/migrations/20261009101545_membership_owner_boundary.sql`
- `tests/dining-lifecycle.test.cjs`
- `tests/platform-reporting-db.test.cjs`
- `docs/modification-3.5-final-acceptance.md` (historical pre-hotfix findings)
- `docs/modification-3.5-security-hotfix.md`

## Acceptance limits
Hosted checks validate actual PostgreSQL authenticated-role/RLS behavior through trusted rollback SQL; they do not constitute a live browser login or full production acceptance. Hosted browser verification remains unavailable under the earlier administrative browser-access restriction. No Modification 4.0 work was undertaken.
