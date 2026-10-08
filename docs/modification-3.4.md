# Modification 3.4 — stabilization report

## 1. Problems discovered
Historical Served orders cluttered the Staff Console. Owner history stopped at 50 records. Overview totals used inconsistent operational and financial definitions. Failed payment attempts lacked persistent operational feedback.

## 2. Root causes
The unassociated-order query included finished history. Legacy records lack enough association data to reconstruct their original visit safely. Overview counted physical table flags and order values rather than authoritative active visits and successful receipts. Server-local midnight was not an explicit restaurant business day.

See `modification-3.4-audit.md` for the pre-edit audit and hosted findings.

## 3. Changes implemented
- Show only unfinished unassociated orders; retain unfinished paid work and clearly identify ambiguous legacy records for review. Do not attach them to another visit.
- Paginate Owner Orders, preserving access to all history.
- Reuse the existing table/session workspace, atomic New → Ready → Served operations and external-payment closure.
- Show explicit round statuses, larger fulfillment buttons, saving feedback, payment method explanations, persistent failure/retry state and a confirmation notice that survives table closure.
- Derive active tables from nonclosed visits; exclude closed visits from pending-work totals.
- Compute Today's Orders and receipt revenue using **America/New_York**, explicitly selected by the user, including daylight-saving boundaries. Orders include cancelled submissions. Revenue sums successful receipt amounts, including tax/service, by confirmation time; legacy receipts without confirmation time fall back to creation time and are identified in the overview. External receipts are staff-recorded, not provider-verified.
- Read all matching receipt/pending-work pages rather than silently stopping at 1,000. Show retry boundaries when reads fail.

## 4. Files modified
Application:
- `src/app/dashboard/page.tsx`
- `src/app/dashboard/orders/page.tsx`
- `src/app/dashboard/error.tsx` (new)
- `src/app/staff/orders/page.tsx`
- `src/app/staff/orders/error.tsx` (new)
- `src/components/staff/dining-rounds.tsx`
- `src/components/staff/dining-table-card.tsx`
- `src/components/staff/staff-operation-notice.tsx` (new)
- `src/lib/dashboard-metrics.ts` (new)
- `src/lib/operations-view.ts` (new)
- `src/lib/query-pages.ts` (new)
- `src/lib/dining-tables.ts`
- `src/lib/dining-view.ts`

Tests: `tests/operations-view.test.cjs` (new), `tests/dining-view.test.cjs`, `tests/staff-orders.test.cjs`.
Documentation: this report and `docs/modification-3.4-audit.md`.

## 5. Database changes
None. No production records changed or removed. Seven existing migrations were verified applied to Supabase project `pixhngrbhiziwapxmqjd`; none were reapplied. Hosted audit found no duplicate active table sessions. The six legacy unassociated Served records remain intact.

## 6. Security implications
No changes to PIN authentication, cookie/session expiry, revocation, RLS, RPC permissions or write operations. Owner metrics/history retain authenticated restaurant scoping. Operational staff do not gain administration or revenue access. Existing atomic server operations continue to enforce restaurant/branch isolation, idempotency and authorization. Local PostgreSQL tests cover cross-tenant/branch rejection, deactivation, PIN reset, reassignment, lockout, logout and concurrent actions. Existing Supabase advisory findings about legacy helper permissions and leaked-password protection remain outside this modification; they are not claimed resolved.

## 7. Automated test results
- TypeScript: PASS.
- ESLint: PASS.
- Production Next.js webpack build: PASS.
- Application suites: **80 passed, 0 failed, 0 skipped**.
- Disposable local PostgreSQL lifecycle/security/concurrency suite: **48 passed, 0 failed, 0 skipped**.
- Local Chrome component/payment fixtures: **11 passed**.
- Git whitespace check: PASS.

New coverage includes New York DST/year boundaries, paid receipt accounting and deduplication, legacy timestamps, pagination beyond 1,000 rows, actionable history filtering, owner history beyond 50 orders, restaurant-scoped metrics and failed-payment retry visibility. Existing database tests verify atomic payment/status history, exactly-once closure and secure staff sessions. Local browser fixtures use adapters and do not prove hosted integration. No automated result is represented as live acceptance.

## 8. Live acceptance results and manual steps
**A–H: UNVERIFIED.** The browser tool refused access because its admin-policy check could not be verified. No alternative live-browser route was used to bypass that denial. Run these on the production alias with approved test staff, an Owner/Manager account and a controlled test table; record results before acceptance.

| Scenario | Manual acceptance steps and expected result |
| --- | --- |
| A — Normal dining | Scan Table 1, submit Cappuccino ×2, verify one active visit; mark Ready then Served; add Latte ×1 from the same visit. Verify distinct round IDs and authoritative combined total. Record full external payment once. Verify one paid receipt, one closure and Available table. |
| B — Multiple devices | Scan the same physical QR from two devices before closure, submit independent rounds, verify one shared visit/card and correct combined total/history. |
| C — Walk-up payment | Submit a round without customer Pay Now; fulfill it and record external payment from staff. Verify successful automatic closure. |
| D — Failed payment | Use a controlled test visit: start payment and abandon it; table must stay open. Mark payment not received, verify failure/retry feedback, no paid receipt and no closure. Retry and confirm only actual full receipt closes the visit. |
| E — Deactivation | Sign in with employee name/PIN; deactivate through owner staff management. Attempt another protected action from the already-open staff device; it must be rejected. Also verify reset, logout and branch reassignment revoke inappropriate access; repeated wrong PINs are limited. |
| F — History | Verify the six old Served unassociated orders are absent from active staff work but remain in Owner Orders (including older pages). Verify unfinished unassigned orders remain visible. Compare Owner Tables and Staff Console for the same visits. |
| G — Concurrency | From two employee sessions submit the same Ready/Served change and payment confirmation simultaneously on a controlled visit. Verify one transition/history event, one paid receipt and one closure; stale retries must not change another visit. Test another restaurant/branch cannot act on it. |
| H — Session protection | Open the old signed customer URL after closure; verify the ended-session/Thank You state. Rescan the physical QR and place a new order; verify a new visit with no inherited bill/history. |

For A/C/G, use a controlled test payment record and do not misrepresent an actual customer payment. Verify mobile/tablet layout, loading/error feedback and owner-only administration during the walkthrough.

## 9. Known limitations
Live hosted browser acceptance is outstanding. Timezone is the explicitly chosen application constant, not a new per-restaurant setting. Legacy order provenance cannot be recovered from missing associations, so it remains honestly labeled. Legacy receipt fallback timestamps may not reflect the original receipt-confirmation day. No provider settlement verification or new payment engine was added. High-volume queries paginate but are not a single transactional reporting snapshot during concurrent writes.

## 10. Deployment status
Release publication is in progress; exact commit/deployment verification will be recorded after publishing. The verified pre-release production alias was `https://qrtest-beryl.vercel.app`, deployment `dpl_FiNCKYL4yUW7xEWK6PQ9PSLJwC6v`, commit `b84bab2f40ea91ce1f643c0f56c39a2ac614da93`, READY. Intended GitHub branch: `MyPenguin19/qrtest`, `claude/thaliq-saas-prd-qluyf1`. Intended hosted Supabase project: `pixhngrbhiziwapxmqjd`. Vercel connector returned 403; authenticated same-project CLI metadata access works. Deployment metadata verification does not constitute live acceptance.

## 11. Rollback instructions
Preserved local `rollback/pre-3-4` points to `b84bab2f40ea91ce1f643c0f56c39a2ac614da93`. Roll back Vercel to the previously verified production deployment above, or revert the 3.4 application changes on the deployment branch and redeploy. Do not reset the database or reverse existing migrations: 3.4 adds none. Preserve any orders/payments recorded after deployment.

## 12. Readiness recommendation
The local implementation/build/regressions pass. **Modification 3.4 is not yet fully accepted.** Complete and record live A–H before treating the platform as ready for the next major modification.
