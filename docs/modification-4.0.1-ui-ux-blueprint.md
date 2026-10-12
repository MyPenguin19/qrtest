# THALIQ / QR.CR — Modification 4.0.1
## UI/UX audit and redesign blueprint

**Baseline inspected:** `188748fd057747401753dc07fc05f749abbffa94`.
**Deliverable:** documentation only. No application changes, migrations, dependency changes, push or deployment. This document proposes future work; it does not authorize implementing it.

## 1. Evidence, scope and product principles

This is a source-based audit of the actual route tree, page layouts, rendered controls, component state, server-action entry points and authorization helpers. It is not a screenshot review, observed usability study, or hosted acceptance test. Layout risks below are inferred from source and must be checked at the specified viewports during implementation. The earlier hosted browser restriction remains in force. No production data was read or changed for this audit.

Primary evidence lives in `src/app`, `src/components`, and `src/lib`. Paths in this document are relative to the repository root. Routes listed as absent were checked against the complete `src/app` file inventory. The historical acceptance reports are context, not substitutes for current code inspection.

Product direction: **Scan. Order. Pay.** Explain that payment currently means paying restaurant staff externally. Help a café get a menu onto a table, receive orders, serve rounds and record receipt with minimal navigation. Use a calm, bright administration surface, a high-contrast staff workspace, and a restaurant-branded customer menu. Premium should mean readable, consistent and predictable, not more modules or animation.

### Boundaries that the redesign must preserve

| Surface | Existing boundary | Presentation constraint |
| --- | --- | --- |
| Owner / Manager | `lib/restaurant.ts`: authenticated user, scoped membership, Owner/Manager dashboard; other roles go to `/staff`; first membership is used | Do not invent a restaurant switcher or change role permissions. Managers currently share much of the dashboard, including its metrics; do not silently redefine financial access. |
| Operational staff | `lib/staff-session.ts`, `actions/staff-auth.ts`: restaurant/name/PIN; server-checked opaque staff session with branch scope | Never expose dashboard finance, settings, membership management or platform data. Preserve timeout, revocation and explicit logout. |
| Customer table | `lib/customer-tab.ts`, `actions/dining.ts`, `CartProvider`: signed restaurant/branch/table/visit/device context | Preserve shared visit, separate device carts, submission keys and token-bearing navigation. Never join a new visit automatically from an ended visit URL. |
| Platform administrator | `lib/platform-admin.ts`, reporting/control helpers and RPCs: fresh user, verified email, live authorization/session and MFA | Navigation is not authorization. Preserve every server/RPC check, recent MFA requirement, request ID, expected version and denial state. |
| Legacy routes | Staff routes verify session then redirect; `/admin/*` verifies platform access then redirects | Preserve redirect behavior. Do not reactivate obsolete role or admin screens. |

### Lifecycle contract, based on current code

- A table scan joins/opens the existing shared visit through `JoinTable`; a device receives its own customer session identity. The cart represents this device's **unsubmitted order**, not the whole table's bill.
- Submitted rounds remain distinct. `DiningRounds` groups `pending`, `accepted` and `preparing` under **New**, then exposes **Mark Round Ready → Mark Round Served**. `advanceOrderStatus` currently requests `ready` directly. Do not add a Preparing action as a cosmetic change.
- The customer `OrderStatusStepper` still displays **New → Preparing → Ready → Served**. This is a presentation inconsistency, not permission to change the operational state machine. Show the actual status; never imply a skipped step was separately confirmed.
- Serving a round does not close the visit. Cancelled rounds stay visible but are excluded from the running total.
- Open and bill-requested visits can accept more orders. Pay at Counter records intent; it does not settle or close the table. Additional rounds can update the total.
- Record Payment creates an identified pending attempt. Pending/paid visits pause customer ordering. Full external receipt confirmation records payment and closes the visit, making the table available. Failed/retried/abandoned attempts must not close it.
- The legacy paid/closing state and authorized manual closure remain supported. A manually closed unpaid visit must never be styled as payment received.
- Owner dashboard table cards use the `owner` prop for the dashboard action path; that path permits Owner **and Manager**. The prop name is not an Owner-only security rule. Staff privilege editing has separate Owner restrictions; preserve both distinctions.

## 2. Current application inventory

Status key: **Implemented** = reachable code and actions exist; **Partial** = limited surface, not a complete module; **Placeholder** = presentation without operational functionality; **Absent** = no current screen. Implemented does not mean hosted acceptance is complete.

### A. Public SaaS and account

| Route / state | Status and current content | Evidence |
| --- | --- | --- |
| `/` | Implemented landing page: headline, flow chips, Staff sign in, Sign in, Get started, Start free trial | `app/page.tsx` |
| `/signup` | Implemented name/email/password signup and inline email-confirmation state | `components/auth/signup-form.tsx`, `actions/auth.ts` |
| `/login` | Implemented Owner/Manager email/password sign-in | `components/auth/login-form.tsx` |
| `/onboarding` | Implemented authenticated restaurant creation: restaurant, optional branch name and cuisine; creates first branch | `components/onboarding/create-restaurant-form.tsx`, `actions/onboarding.ts` |
| Subscription, pricing checkout, billing portal | Absent public/Owner screen; subscription data is consulted by Branding for premium templates | Do not infer a billing product from tables or the trial CTA |
| Password reset, account profile, dedicated email-confirmation route | Absent from current route tree; confirmation notice is inside signup | Record as gaps, not new navigation destinations |

### B. Owner / Manager dashboard

All routes below use `dashboard/layout.tsx` and `requireCurrentRestaurant`. Sidebar has ten entries and is hidden below `md` with no alternate mobile navigation.

| Route | Status and actual capability |
| --- | --- |
| `/dashboard` | Implemented four live metrics and eight recent orders. “Today” is America/New_York; receipts are staff-reported, not provider verified. |
| `/dashboard/orders` | Implemented paginated order history, 50 rows/page, table/session association, timestamps, status and amount. Payment status is queried but not rendered as a payment ledger. No dedicated order-detail or receipt-history route. |
| `/dashboard/tables` | Implemented table creation and reused `DiningTableCard`: active visits, rounds, totals, payment recording, empty reset, authorized manual closure. |
| `/dashboard/qr` | Implemented branch general-menu QR and permanent table QR images/URLs. No explicit print/download/copy controls here. |
| `/dashboard/menu` | Partial: add category, add item/photo, list categories/items/prices/availability. No edit/delete/reorder/availability-toggle controls in this screen; no variant/add-on editor. |
| `/dashboard/staff` | Implemented staff entry QR/link/code, add/edit PIN access, deactivate/reactivate, Owner-only Manager linking to a verified account. |
| `/dashboard/settings` | Implemented restaurant profile, logo/cover, phone, description, tax/service charges, UPI fields. |
| `/dashboard/branding` | Implemented template, color and font selection with live-menu preview link and premium gating. |
| `/dashboard/offers` | Partial read-only offer listing; builder explicitly on roadmap. Empty copy suggests Supabase/API operations, which is unsuitable restaurant-facing guidance. |
| `/dashboard/analytics` | Placeholder cards with dashes; copy incorrectly suggests insights will populate automatically. |
| Subscription management, branch management, completed visits, payment ledger | No dedicated screens. Preserve existing records and access paths; do not claim these modules exist. |

### C. Unified Staff Console

| Route / state | Status and actual capability |
| --- | --- |
| `/staff`, `/staff?r=slug` | Implemented code lookup or remembered restaurant, name selection, 4–8 digit PIN, no-active-staff/error states and Owner/Manager login link. |
| `/staff/orders` | Implemented active-table grid, collapsed available tables, unresolved assistance requests and actionable unassociated orders. No separate kitchen/waiter/cashier login is required. |
| Table card / View Tab dialog | Implemented round groups, branch, open age, running total, payment intent and receipt confirmation. Completed rounds collapse inside active visits. |
| Payment states | Implemented Record Payment, method selector, pending receipt confirmation, failed/retry notice and session-ended feedback. |
| Completed table sessions | No separate staff history screen. Closed visits leave the active workspace; footer directs to Owner Orders history, which is order history rather than a full visit ledger. |
| `/staff/kitchen`, `/staff/waiter`, `/staff/cashier` | Compatibility redirects to `/staff/orders`, with staff-session validation. |

### D. Customer QR experience

Let **B** = `/menu/[restaurant]/[branch]` and **T** = `B/[table]`.

| Route / state | Status and actual capability |
| --- | --- |
| B | Implemented general branch menu and ordering without a table; do not convert it into a dine-in-only menu. |
| T | Implemented table resolution, automatic join, retry, signed-session menu and link to shared tab. |
| Item dialog, cart dialog | Implemented variants/add-ons, instructions, quantity, optional coupon/name/mobile, subtotal disclaimer, safe submission retry. These are overlays, not routes. |
| T`/tab?session=…` | Implemented all shared rounds, order statuses, running total, Add More Items and payment-choice dialog. |
| Pay Now dialog | Partial payment choice: online card disabled; Pay at Counter works; Keep Ordering returns to menu. No customer online payment processing. |
| T and T`/tab` ended states | Implemented “Thank you / Your table session has ended.” No receipt or new-session autojoin action. |
| B`/order/[orderId]` | Implemented individual-order tracking for non-table ordering/legacy access, with amount breakdown. Route verifies matching restaurant and branch slugs; do not replace with a shared tab. |
| Assistance dialog | Implemented table-only Call waiter / Water / Cutlery / Other request with sent and error feedback. |
| Invalid links / suspended account / pending settlement | Implemented not-found, ordering-unavailable and paused-order states, mostly minimal text. |

### E. Super Admin

| Route | Status and actual capability |
| --- | --- |
| `/platform/login` | Implemented separate platform sign-in. |
| `/platform/mfa` | Implemented TOTP preparation/enrollment, private QR/manual secret, challenge/verification; enrollment grants no platform authority. |
| `/platform/access-denied` | Implemented unavailable/denied guidance with sign-in, MFA and retry links. |
| `/platform` | Implemented tenant/activity/setup metrics, three trends and recent registrations. |
| `/platform/restaurants` | Implemented filtered/searchable/sortable/paginated directory with verified owner contact and readiness. |
| `/platform/restaurants/[restaurantId]` | Implemented metadata, setup attention, usage, staff-recorded receipts, recent record activity, suspension/reactivation controls. |
| `/platform/analytics` | Implemented adoption and usage reports; explicitly not SaaS revenue. |
| `/platform/audit` | Implemented filtered paginated append-only events with actor, reason, previous/new state and request ID. |
| `/platform/controls` | Implemented read-only safeguards/security summary and links. Not an editable global settings console. |
| `/admin`, `/admin/restaurants`, `/admin/users`, `/admin/subscriptions`, `/admin/payments`, `/admin/templates` | Guarded redirects to `/platform`. The old `AdminSidebarNav` file is not evidence of live Users/Billing/Templates modules. |
| `/api/platform/status` | API endpoint, not a user-facing page. Preserve contract; no new navigation. |

## 3. Ranked UI/UX findings

Severity refers to impact on task completion, not a new security vulnerability finding.

| Rank | Finding and evidence | Recommendation / verification |
| --- | --- | --- |
| High 1 | Owner navigation and sign-out disappear below 768px (`dashboard/layout.tsx`, `hidden … md:flex`) | Add an accessible mobile navigation panel in a later phase; every existing authorized destination and sign-out must remain reachable. |
| High 2 | Payment language can imply online processing: Pay Now leads to disabled card option; settings promises a cashier QR although current staff route redirects and uses the table card | Explain “Pay with restaurant staff”; keep current actions and payment semantics. Verify every surface distinguishes intent, pending and recorded receipt. |
| High 3 | Customer cart quantity buttons are 24px (`cart-sheet.tsx`, `size-6`); default buttons are 36px; plus/minus have no descriptive labels | Start with customer purchase controls: 44px minimum targets, descriptive accessible names, focus and error feedback. |
| High 4 | Shared visit versus personal cart is insufficiently explained (`CartSheet`, customer tab) | Use “Your cart” for unsubmitted lines; “Table bill · shared by this table” for all rounds; maintain authoritative totals. |
| High 5 | Customer progress suggests a Preparing milestone, while current staff actions go New → Ready → Served | Preserve state transitions. Make actual state explicit and avoid marking Preparing as an independently confirmed event. Product decision needed before any new operational step. |
| Medium 1 | Ten Owner links include placeholder Analytics and a read-only Offers module | Six main destinations; move appearance to settings and QR under tables; hide placeholder Analytics; retain Offers as secondary read-only access. |
| Medium 2 | Table cards mix long round lists, View Tab and settlement controls; manual closure appears both inside and outside detail for eligible dashboard users | Use summary cards plus focused existing details; one visible exceptional closure entry, preserving confirmation/reason. Verify fast round actions remain on cards. |
| Medium 3 | QR generation is separate from tables and displays raw long URLs; staff QR is a third context | Link table administration to its existing QR view; distinguish general-menu, table and staff sign-in QR. Copy/print helpers would be new UI actions and need explicit later scope. |
| Medium 4 | Several dashboard queries ignore errors and can render empty content (menu/staff/QR/settings/branding/offers) | Do not equate missing data with no records. Error-surfacing changes need a separately reviewed phase; no API/schema changes. |
| Medium 5 | Theme color overrides do not select a contrast-safe foreground; premium-dark applies surface classes without consistently scoping all tokens | Validate customer themes including portaled dialogs; retain owner colors/settings, propose presentation fallback only. No claim of present contrast compliance. |
| Medium 6 | Menu management lacks edit controls; payment and completed-visit history lack dedicated screens | Record capability gaps. Do not design active buttons to nonexistent actions or promise full menu management/receipt history. |
| Medium 7 | Owner New York “Today”, staff round UTC times and platform UTC reports are easy to confuse | Label zones near timestamps; use age for staff scanning. Preserve metric windows and server calculations. |
| Medium 8 | Polling (staff 3s, customer 4s, Owner 5–8s) has no visible freshness indicator | Preserve intervals, identities, sort and focus; do not introduce realtime/offline queues. A last-successful-refresh indicator requires real success evidence and separate scope. |
| Medium 9 | Platform detail opens with a large account control block; audit prints dense UUIDs/JSON | Separate everyday inspection from a clearly marked account-control section; compact event summary with expandable technical fields. Do not hide reasons, blockers or audit outcome. |
| Low | Large landing flow diagram and “operating system” positioning overstate simplicity; trial terms are unspecified | Use three-step explanation, factual CTA and existing screenshots only after verification. No pricing/plan promises. |
| Low | Inconsistent raw HTML buttons/selects, muted text, spacing and all-caps round labels | Incrementally adopt existing primitives and semantic tokens; avoid sweeping global restyling. |

## 4. Recommended navigation architecture

Preserve all existing URLs. These are navigation groupings, not new routes or access rules. Hide means remove from primary navigation, not delete data, route or permission checks.

| Audience / proposed item | What and why | Existing destination | Merge / hide decision |
| --- | --- | --- | --- |
| Public: Get started | Create restaurant account | `/signup` then `/onboarding` | One primary CTA; no pricing checkout link |
| Public: Sign in | Owner/Manager management access | `/login` | Keep secondary |
| Public: Staff access | PIN workspace access | `/staff` | Keep distinct, quieter link |
| Owner: Overview | Daily state and recent orders | `/dashboard` | Keep; hide placeholder Analytics from main navigation |
| Owner: Orders | Active/historical order records | `/dashboard/orders` | Keep label “Orders”; do not label “Payments” until ledger exists |
| Owner: Tables & QR | Visits/table setup and QR distribution | `/dashboard/tables`, secondary `/dashboard/qr` | One main entry, two existing destinations via subnavigation |
| Owner: Menu | Categories/items/pricing | `/dashboard/menu` | Keep. Offers as a secondary read-only link, not main entry |
| Owner: Staff | PIN team access and authorized Manager management | `/dashboard/staff` | Keep separate from restaurant preferences |
| Owner: Settings | Restaurant profile/charges and appearance | `/dashboard/settings`, secondary `/dashboard/branding` | Merge navigation grouping only; retain separate forms and URLs |
| Owner: Account / sign out | Identity and exit | Existing sidebar identity and sign-out form | Persistent desktop footer; mobile panel footer. No nonexistent account page |
| Staff: Tables | Primary daily work | `/staff/orders#active-tables` | One console; existing Available section remains collapsed |
| Staff: Requests / unassigned work | Resolve assistance and work without table association | Existing sections in `/staff/orders` | In-page jump links only when present, not new role tabs |
| Staff: Identity / sign out | Confirm who is operating shared device | Existing header/logout | Always reachable; no owner reports/history destination |
| Customer: Menu / Table bill | Add items or inspect shared bill | T and T`/tab` with unchanged session token | Two contextual links; general B has no fabricated Table bill |
| Customer: Cart | Review this device's unsubmitted round | Existing cart overlay | Persistent when nonempty; do not turn it into a third full route |
| Customer: Help | Ask restaurant staff | Existing assistance overlay | Table-only, secondary, clear of cart footer |
| Platform: Overview | Current adoption snapshot | `/platform` | Keep |
| Platform: Restaurants | Inspect tenants and guarded account control | `/platform/restaurants` and detail | Keep |
| Platform: Analytics | Detailed adoption reporting | `/platform/analytics` | Keep deeper analysis out of Overview |
| Platform: Audit | Explain administrative changes | `/platform/audit` | Keep first-class for security |
| Platform: Controls | Security/operational facts and MFA recheck | `/platform/controls` | Keep secondary; do not relabel as editable global settings |

No primary Subscription, Users, POS, Inventory, Reservations, Loyalty or SaaS Revenue entry. No role switcher between PIN staff and privileged account surfaces.

## 5. Screen-by-screen specifications

### Shared specification contract

Each row below specifies purpose/user, data/actions, layout/reuse, states and accessibility. **M/T/D** means mobile/tablet/desktop. All rows inherit these requirements unless explicitly overridden:

- M: one column, 16px gutters, primary controls ≥44px, no horizontal page overflow. T: 24px gutters and split content only when both columns remain readable. D: 32px gutters, constrained content width, no stretched forms.
- Loading: retain heading/context, use static skeletons for known regions; never show a zero amount as loading. Error: plain language with retry where an existing retry is safe; preserve input; never invent success. Empty: explain the state and link only to an existing permitted next step. Success: inline persistent status for mutations, not color alone.
- Semantic landmarks, single page h1, explicit labels and names, visible focus, keyboard operation, text plus status color. Dialogs retain Radix focus containment, Escape and return focus. Errors use `role=alert`; routine updates use polite status announcements only on meaningful changes, not every poll.
- Reuse existing data/actions and authorization exactly. New presentation wrappers must accept existing props without moving trusted reads into the client. No offline submission or optimistic payment/closure state.

### Public and account screens

| Screen / purpose / user | Information and primary / secondary actions | Layout, reuse and responsive treatment | Loading / empty / error / success; accessibility |
| --- | --- | --- | --- |
| Landing / prospective owner | Explain scan, order, staff settlement; primary Get started; secondary Sign in, Staff access | `app/page.tsx`, Button. M stacked hero and wrapped header; T/D modest two-column explanation with real product evidence, not invented metrics | Static content needs no skeleton/empty state. Navigation failure stays a normal link failure; success is destination navigation. Logical heading order and no decorative arrow announcements |
| Signup / new owner | Name, email, password; Create account; existing Sign in link | `SignupForm`, Card/Input/Label. 400px readable form at all widths; retain browser password-manager support | Existing pending/disabled submit, validation and confirmation notice; add labeled error association. No “resend” or recovery action without backend scope; confirmation notice is success, not proof account is ready |
| Login / Owner or Manager | Email/password; Sign in; Create account | `LoginForm`; same account shell, explicit Owner/Manager label; small Staff access link may point to existing route | Pending label, generic access error, no empty-data state; successful redirect unchanged. Preserve autofill and avoid exposing account existence |
| Onboarding / authenticated creator | Restaurant, branch, cuisine; Create restaurant | `CreateRestaurantForm`; one short form, retain optional fields. M single column; same constrained form on T/D | Empty initial form; pending; retain entered data on error; success dashboard redirect. Do not redesign transaction/bootstrap or add a wizard that submits multiple times |
| Email confirmation / signup state | Existing confirmation instruction and Sign in | Reuse notice Card, consistent success icon/text; not a new route | Clear email-delivery instruction without pretending to know delivery status. No timers or verification claims |

### Owner / Manager screens

| Screen / purpose / user | Information and primary / secondary actions | Layout, reuse and responsive treatment | Loading / empty / error / success; accessibility |
| --- | --- | --- | --- |
| Dashboard shell / authorized manager | Restaurant identity, role, six grouped destinations, sign out | `DashboardLayout`, `SidebarNav`, `AccountNotice`; D 240px sidebar, T compact drawer, M labeled Menu button opening existing Dialog primitive | Preserve suspension notice before content. Panel opens/closes with focus return; active link uses `aria-current=page`; sign out remains form action |
| Overview / daily monitoring | Existing four metrics and recent eight orders; primary link to Tables; secondary Orders | Existing Card/Badge, `getDashboardMetrics`; M 1–2 metric columns, T/D four. Put metric definitions behind disclosure while keeping “recorded receipts” distinction visible | Skeleton, no orders instruction, existing error boundary, completed refresh without focus jump. State New York day window beside metrics; accessible numeric labels |
| Orders / historical review | Existing number, table/session, branch, time, amount, fulfillment; newer/older pages | Existing query/pagination and `fulfillmentLabel`; M stacked records, T/D aligned list. Distinguish order value from paid amount. No fabricated detail drawer or receipt data | No orders versus empty later page must differ; preserve pager links. Loading/error separate. Date/time labels include zone; history is retained after service/closure |
| Tables / visit oversight and setup | Label, branch, availability, age, rounds, totals, settlement; primary per-table action; Add table secondary | `AddTableForm`, `DiningTableCard`; M one card, T two, D up to three when ≥320px each. Move create form below operational summary or into expandable existing content; add link to QR route | No tables → existing add form; no branches → explanatory state, not dead Create branch link. Existing mutation pending/errors/notices; manual closure confirms reason and amount. Never infer permission from prop name |
| QR Codes / distribution | General-menu QR versus table QR, branch and destination | Existing generated QR images; M full-width cards, T/D grid. Larger visible code with quiet destination disclosure; link back to Tables | Existing no branches/tables messages linked to supported setup route; failed query must not be rendered as empty in later error phase. Unique QR alt labels. Print/download/copy are optional future UI scope, not existing actions |
| Menu / catalogue setup | Categories/items/prices/availability; Add item primary, Add category secondary | Existing add forms, image upload and list. M category then items; T/D list plus expandable add form. Show “Unavailable” and dietary text, not colored squares alone | First category prerequisite explicit. Upload/submission progress and errors stay attached to form; success announcement when saved. No edit/delete/toggle controls until separately implemented |
| Staff / manage access | Restaurant sign-in code/link/QR, team, role, active state; Add staff; Edit/PIN/Access disclosure | `StaffLoginCard`, `AddStaffForm`; put team first after setup, share-access card secondary. M stack, T/D team list with compact entry instructions | No staff → create action; no branch message; existing save/errors and disabled pending. Keep Manager fields Owner-gated, PIN secret handling unchanged; no readable saved PINs |
| Settings / configure restaurant | Profile/media/contact, tax/service, existing UPI fields; Save changes | `RestaurantSettingsForm`, `ImageUpload`; group Profile, Charges, External payment details within same action. M stack, T/D max 720px; appearance link to Branding | Loading versus missing restaurant data must be distinguished later; existing Saved/error states. Numeric labels include units. Rewrite obsolete cashier-QR promise only after confirming live capability; no new payment integration |
| Branding / appearance | Existing templates/color/font and preview; Save; Preview live menu | `BrandingForm`, templates data. M stacked preview choices; T/D cards. Preserve saved template slugs/premium eligibility, no forced reset | Missing templates/query error needs honest state, not fabricated choices. Selected state text/outline; swatches need names. Test all existing templates and dialog portals; visible new-tab indication |
| Offers / read-only existing records | Name/type/active; no builder action | Current list, Badge; secondary link from Menu. M cards/T-D compact list | Replace infrastructure instructions with “Offer editing is not available here.” Empty/list/error distinct. Do not add Create offer button or delete route |
| Analytics / placeholder | No actual analytics dataset currently rendered | Hide primary link; direct route explains unavailable report and links Overview | No indefinite fake loading or promise of future auto-population. No charts until independently scoped functionality exists |
| Dashboard error boundary | Failure and safe retry | Reuse `dashboard/error.tsx` with calm ErrorState presentation | Explicitly no reliable current data. Keep Next 16.3 `retry` callback; local installed docs confirm this API. Do not “correct” it to an older framework contract |

### Staff screens and operational states

| Screen / purpose / user | Information and primary / secondary actions | Layout, reuse and responsive treatment | Loading / empty / error / success; accessibility |
| --- | --- | --- | --- |
| Staff entry / employee | Restaurant identity/code; name; PIN; Continue/Sign in; Change restaurant and Owner/Manager link | `StaffLoginForm`; 400px form; 48px inputs/buttons for touch. Standard numeric keyboard, no custom keypad | Existing lookup/sign-in pending, invalid credentials and no-active-staff states; successful console redirect. Never remember PIN, weaken rate limits or change restaurant scope |
| Console / employee daily work | Identity, active visits, assistance, unassigned work; next round action, View Tab; Available tables | `StaffOrdersPage`, `DiningTableCard`, `KitchenOrderCard`, `WaiterRequestCard`, notices. T two columns, landscape D three only if legible; M one. Keep backend priority/order, identify new/ready/payment independently | No active visits is success/empty, not failure. Existing boundary and action errors; persistent receipt notice. Preserve polling, trusted activity timeout, focus, scroll and open dialog state |
| Table details / employee | Table/branch/age, distinct rounds with items/instructions, completed/cancelled disclosure, running total | Existing View Tab Dialog + expanded `DiningRounds`; M near-full-height scrolling, T/D max 720px. Keep actionable rounds visible and total footer separate | No submitted items; saving and failed action; refreshed authoritative status. Accessible round action names include round/table context. Never merge identical items across rounds |
| Payment recording / authorized operator | Method, actual total, pending attempt, full-receipt wording; Record Payment then Record external payment received; not-received/retry | Same `DiningTableCard`; distinct settlement area, separate from fulfillment. Confirm button uses full clear text, not icon. All widths stack critical explanation above action | Pending is amber and never green/paid. Failure explicitly keeps table open; success explicitly says payment recorded and visit ended. Do not silently replace two-step sequence with one click |
| Manual close / authorized dashboard operator; legacy paid close | Amount, closure reason, explicit consequence; Confirm closure; Keep table open | Reuse existing dialog and action; one exceptional entry under View Tab, subject to existing eligibility | Keep unpaid/manual closure visually distinct from recorded receipt. Errors stay in dialog; no optimistic Available state or change to permission conditions |
| Requests / employee | Table and requested assistance; existing resolve action | `WaiterRequestCard`; compact section, M one/T two columns; no new inbox route | Pending resolution, retry error, disappears only after authoritative resolution. Status announcement must not claim request fulfilled before save |
| Unassociated orders / employee | Counter order versus needs-review label, items/status; existing next round action | `KitchenOrderCard`; separate from table totals, paid label remains separate from fulfillment | No section when none. Never assign a table in UI based on guesswork. Paid still may require service; existing errors preserved |
| Available / completed | Available tables are existing collapsed section; completed rounds inside current visit | Preserve Available and completed-round disclosures. No new completed-visit staff screen | Ended visit leaves active cards; persistent receipt notice avoids unexplained disappearance. Do not expose Owner history to PIN staff |
| Staff error boundary | Unavailable current operational data; retry | Existing `staff/orders/error.tsx`; prominent but calm | No stale empty table claim; keyboard accessible retry; preserve session redirect on expiry |

### Customer screens and overlays

| Screen / purpose / user | Information and primary / secondary actions | Layout, reuse and responsive treatment | Loading / empty / error / success; accessibility |
| --- | --- | --- | --- |
| Branch menu B / walk-up guest | Restaurant identity, categories/items/prices; select item; cart | `CustomerMenu`, template styles. M 16px gutters/max 560px; T/D retain readable menu width, not a dashboard. Category anchor strip can be later presentation scope | Menu coming soon, empty category, sold-out labels; suspended ordering message. No Table bill link without table context. Images optional; full item name available and dietary indicator has text |
| Table entry T / seated guest | Opening table context; automatic join; Try again on failure | `JoinTable`, existing action/router replacement; simple progress region at all widths | Announce “Opening your table…” then success navigation; safe retry. Invalid token/unknown table remains fail-closed. No manual table picker or cookie shortcut |
| Table menu T / joined guest | Same menu plus Table label and Table bill link; select/add items; Help | Reuse CustomerMenu, existing token-bearing link and assistance control. M compact context header; T/D same bounded canvas | Keep joined context during refresh. Payment-pending replaces menu with paused state; ended state must not show cart/order CTA |
| Item customization / guest | Full name, photo/description, variants/add-ons, instructions, quantity, computed line amount; Add to cart | `AddToCartDialog`; M bottom-aligned full-width dialog within safe gutters, T/D centered. Scroll body, reachable footer; retain current variant calculation | Missing photo uses no fake asset; unavailable item stays disabled at menu. Announce added item; variant selection needs radio or equivalent selected semantics, quantity buttons descriptive names. Do not change payload shape |
| Cart / guest's device | Lines/options/quantity, subtotal, existing tax/service disclaimer; Place order; edit/remove/coupon/details | `CartSheet`, `CartProvider`, `CartBar`; 44px controls, clearly label “Your cart”; optional details may use disclosure in later phase, retaining values | Empty cart, sending, server validation, unknown-result retry with unchanged submission key; only clear on success. Do not display subtotal as final payable total; server remains pricing authority |
| Shared Table bill / all diners | All submitted rounds, actual statuses, table running total; Add More Items; payment choice | Existing T/tab, OrderStatusStepper, CustomerPayment. M stacked rounds, completed rounds may collapse with accessible summaries; T/D max 640px | Explicit “Includes orders from everyone at this table.” No orders yet state, live shared updates, cancelled excluded. Pending settlement disables ordering by existing condition. Never clear others' rounds or imply personal-only balance |
| Payment choice / guest | Current shared total, external settlement explanation; Pay at Counter; Keep Ordering | `CustomerPayment`; keep action semantics. Proposed label “Payment options” or “Pay with staff”; disabled card can be reduced to a factual unavailable note after copy review | Saving/error; counter-intent success says table remains open. Extra rounds still allowed until pending settlement. No checkout success, paid badge or online-card promise |
| Paused ordering / guest | Bill being settled; View Table bill | Existing T pending/paid branch and polling, contextual heading and total only if already available | Distinguish pending versus legacy recorded-awaiting-close; preserve legacy state but avoid suggesting every payment requires separate closure. No Add More or new join |
| Ended visit / guest | Thank you, visit ended | Reuse existing closed returns on both T and T/tab; consistent icon/heading, no automatic redirect | Terminal success, not payment verification: manual unpaid closure also ends visits. No “Paid” unless authoritative receipt proof exists. Never reopen old token or show stale cart |
| Individual tracking B/order/id | Number, actual status, items and subtotal/discount/tax/service/total | Existing tracking page/stepper; M vertical card, T/D bounded width. Keep distinct from shared tab | Invalid order/tenant combination remains not-found; final served/completed/cancelled stops existing refresh. No invented Order more link to a table or payment action |
| Assistance dialog / seated guest | Call waiter/water/cutlery/other; send; close | `WaiterRequestButton`; leave clear space above cart and device safe area. T/D anchor within menu width | Pending and error retained; sent message announced before existing close. Label call-to-action “Help” with accessible name; no floating overlap at zoom |
| Invalid/unavailable customer state | Bad link or ordering suspended; ask staff | Existing not-found and unavailable branches, propose branded presentation within existing outcomes | Never disclose internal IDs/tokens, switch tenants or turn errors into join. Retry only where existing operation supports it; no claim that record does not exist when access was denied |

### Platform screens

| Screen / purpose / user | Information and primary / secondary actions | Layout, reuse and responsive treatment | Loading / empty / error / success; accessibility |
| --- | --- | --- | --- |
| Login / provisioned administrator | Existing verified account credentials; Sign in | `PlatformLogin`; reuse form styling only, visibly distinct platform context; M/T/D max 440px | Pending/error and unchanged MFA/denial routing. No shared staff role selector |
| MFA / administrator | Existing factor or private enrollment QR/manual key, six-digit code; prepare/verify | `PlatformMfa`; M stacked QR/form, D constrained. Manual key disclosure remains private and in memory | Prepare/verify pending, fresh-code error, secret cleared after success. QR readable, manual fallback accessible. No screenshots/logs containing real enrollment secrets |
| Access denied / unauthorized or unavailable | Existing neutral explanation; Sign in, Verify MFA, Retry | Existing denied page; same security shell | Do not disclose provisioning status or treat unavailable as authorized. Explicit focusable links; no report skeleton behind denial |
| Overview / platform operator | Existing six metrics, trends, recent tenants; inspect restaurant; period apply | `PlatformShell`, Metrics, ActivityChart, Definitions. M one column, T two, D three; compact report period | Existing loading/error, no registrations/activity states. Maintain UTC/partial-day caveats and exact-values disclosure; no financial inference |
| Restaurant directory / platform operator | Search/filter/sort/page; inspect restaurant; apply/refresh | `ReportFilters`, existing query params. M cards, T/D compact rows/cards with name/status first and metadata disclosure | Empty match/page distinguished; clear filters returns existing URL; errors not zero counts. Keep owner email platform-only; labeled filters and pager |
| Restaurant detail / platform operator | Identity/status/setup, usage/receipt definitions, activity; inspect; account control | Existing data and `AccountControlForm`; overview first, clearly separated Account management section; M stack, D summary plus detail | Not-found, loading and unavailable states; account change states below. Currency unconfigured stays explicit—do not attach ₹ or infer SaaS revenue |
| Suspension/reactivation / platform operator | Actual blockers, reason, checkbox, fresh MFA and last change; suspend/reactivate; MFA link | Existing form/action, version/request ID. Keep a single clear consequence summary and visible blockers; no one-click toggle | Preserve stale-state, conflict, denied, unknown-result, unresolved activity and recent-MFA messages. Retry unknown result uses same request semantics. Success only from server; never close visits or record money here |
| Analytics / platform operator | Adoption/cohort/usage metrics/trends, definitions; period apply | Reuse Metrics/ActivityChart; group Activation, Activity, Configuration without changing formulas. M stacked, D 2–3 columns | Zero versus unavailable distinct; no-data chart text; exact values accessible. Keep current/previous period and denominator caveats |
| Audit / platform operator | Event/time/result/actor/reason; filter/page; expand previous/new states and IDs | Existing audit data/form; M event cards, D aligned list; disclosure for raw JSON with pre-wrap | Empty filters, query errors, legacy unavailable actor/state shown truthfully. No truncation without accessible full value; immutable history has no edit/delete |
| Controls / platform operator | Existing guardrail facts and counts; restaurant/audit/MFA links | Existing Controls page; short Security, Account controls, Limitations sections | Loading/error; preserve leaked-password-protection uncertainty and no-billing statement. Do not imply monitoring or provisioning UI exists |
| Platform loading/error/not-found | Fetch/failed/missing states | Existing route files and report shell proportions | Skeleton plus loading status; error has retry and no partial totals; not-found returns to directory. No tenant information in denial screen |
| Legacy admin/staff routes | Compatibility only | No new layout specification; preserve guarded redirect | Verify destination and security checks; never show obsolete sidebar or role-specific login |

## 6. Practical design system

Use the existing Tailwind CSS variables, Geist/Geist Mono, Lucide icons, Radix Dialog and UI primitives. No new component library, font dependency or chart package. Existing restaurant templates are supported inputs, not replaced by a single forced theme.

### Typography and spacing

- Geist sans for product chrome; preserve restaurant font preference inside customer menu. Mono only for technical identifiers/manual MFA key, never normal navigation.
- Body 16px/24px; compact metadata 14px/20px; rare secondary labels 12px/18px, never essential order instructions or payment consequences.
- Page title 28px/34px desktop, 24px/30px mobile; section 20px/28px; card heading 18px/24px; metric 28–32px with tabular numbers. Weights 400/500/600; avoid letter-spaced all-caps for long operational labels.
- Spacing scale 4, 8, 12, 16, 24, 32, 48px. Cards 16–24px padding, related field gap 8px, unrelated groups 24px. 10–12px card radius; 8px controls; subtle border, shadow only for overlays/sticky bars.

### Proposed semantic palette

These are design targets, not measured compliance results. Validate rendered color pairs, opacity, focus and all restaurant overrides before acceptance.

| Token / use | Proposed value | Pairing |
| --- | --- | --- |
| Canvas / surface | `#F7F8FA` / `#FFFFFF` | Primary text `#17212B` |
| Muted text | `#526170` | White/light canvas; never low-opacity primary instruction |
| Decorative separator | `#DCE2E7` | Not sufficient alone for interactive boundary/focus |
| Interactive border | `#7B8794` | White controls |
| Primary action | `#155E59` | White text; hover `#134E4A` |
| Focus | `#1D4ED8` | 2px ring with 2px surface offset |
| New / informational | `#1E40AF` on `#EFF6FF` | Text “New” and icon |
| Ready / attention | `#92400E` on `#FFFBEB` | Text distinguishes Ready from Payment pending |
| Served / recorded success | `#166534` on `#F0FDF4` | Explicit state label; served is not paid |
| Error / destructive | `#991B1B` on `#FEF2F2` | Error text plus icon; solid destructive button only for consequential action |
| Neutral / available / closed | `#475569` on `#F1F5F9` | Available and Closed must retain different words/icons |

Owner and platform surfaces share structure but platform adds a persistent “Platform administration” identifier. Staff stays light with stronger borders, larger text and clear status rails; a new dark-mode preference is not required. Customer restaurant color can remain an accent; use a contrast-safe neutral action treatment when its foreground pair is unreadable, subject to explicit later approval. Portaled dialogs must inherit the intended theme explicitly rather than assuming subtree CSS variables cross the portal.

### Component rules and reuse map

| Primitive | Existing foundation | Proposed contract |
| --- | --- | --- |
| Page header / shell | DashboardLayout, PlatformShell, existing route headers | One h1, short description, primary action, secondary actions; wrapping supported |
| Buttons | `ui/button.tsx` | One primary per task region; default 44px, staff 48px; icon target ≥44px; no global sizing change in the first phase |
| Forms | Input/Label plus native select/checkbox | Visible labels, required/optional text, helper/error associations; 16px input text, no placeholder-only labels |
| Status badge | Badge plus current status helpers | Text + optional icon + semantic color; retain business mapping and distinguish fulfillment/session/payment |
| Card / list row | Card and existing page markup | Summary first, secondary metadata second, action last. Avoid nesting full cards solely for decoration |
| Modal / sheet | `ui/dialog.tsx` | Consumer-scoped responsive styles; scrollable body, reachable close/action controls, title/description, focus return; do not globally change every dialog for customer work |
| Table/round display | DiningTableCard, DiningRounds | Same data, round IDs and actions; completed/cancelled disclosures; no merged submissions |
| Empty/error/notice | Existing error boundaries, AccountNotice, StaffOperationNotice | Shared visual pattern; actual states remain sourced from existing results |
| Skeleton | New lightweight markup only when later scoped | Same geometry as final content, static or reduced-motion-safe, no zero values masquerading as loaded data |
| Charts | ActivityChart + exact daily values | Retain SVG and text fallback; improve labels/spacing without new chart dependency or formulas |

Accessibility targets: 4.5:1 normal text, 3:1 large text and meaningful controls/graphics; visible focus at zoom; 44px minimum touch controls, 48px preferred staff actions. Verify rather than claim conformance. Support keyboard-only completion, 200% zoom and reflow at 320 CSS px; respect reduced motion. Do not announce all refreshed orders every three seconds. Status must never rely on red/green or an unlabeled symbol. Long translations are out of scope, but avoid fixed widths that already truncate English names.

## 7. Responsive behavior and validation matrix

| Width / context | Customer | Staff | Owner / platform |
| --- | --- | --- | --- |
| 320–639px | One column, safe-area-aware cart, no fixed element over content; keyboard-visible dialog actions | One table per row; wrapped identity/header; 48px actions | Mobile navigation; stacked rows/forms, full filter width |
| 640–767px | Bounded menu, larger dialog where useful | Two cards only if ≥300px each, otherwise one | Still mobile navigation; 2-column metrics where readable |
| 768–1023px | Menu stays readable, not stretched | Tablet primary target: two columns, touch-first | Compact navigation drawer; two-column reports, constrained forms |
| 1024–1279px | Max 560–640px reading canvas | Two or three columns based on 320px minimum card | Desktop sidebar; report filters wrap; no tiny text to fit columns |
| ≥1280px | Deliberate whitespace around menu | Three/four cards only after real dense-order test | Max 1280px workspace; wider tables only with readable columns |

Required future fixture coverage: 320×568, 390×844, 768×1024, 1024×768 and 1440×900; portrait/landscape tablet; long restaurant/item/staff names; no photos; 20 categories; 30 cart lines; 10 rounds on one table; multiple tables with pending receipt; empty data; server error; expired PIN session; two diners/two staff devices. Check sticky areas with mobile keyboard, 200% zoom and reduced motion. Do not use real MFA secrets or customer information in screenshots.

## 8. Phased implementation roadmap

Complexity is relative engineering/review effort, not a delivery-time promise. Each phase is separately requested, reviewed and tested. No phase grants permission to alter server contracts, RLS, pricing, status transitions or authentication. Keep URLs stable and commits narrow.

| Modification | Exact scope / files or components | Dependencies / complexity | Acceptance criteria | Principal regression risk |
| --- | --- | --- | --- | --- |
| **4.0.2 Customer cart and item accessibility** | Consumer-local presentation in `components/menu/cart-sheet.tsx`, `add-to-cart-dialog.tsx`, `cart-bar.tsx`; touch size, accessible names, error announcements, safe-area spacing and long-content layout | Existing UI primitives; **Small** | 44px controls, no overlap at specified mobile sizes/zoom; identical variants/add-ons/amounts/payloads; unchanged retry key/cart preservation; keyboard dialog flow works | Accidental cart mutation, duplicate submission, footer obstruction, global dialog blast radius |
| **4.0.3 Customer table/menu clarity** | `customer-menu`, `customer-payment`, `order-status-stepper`, `join-table`, waiter button and existing menu route presentations; shared-tab wording, clear state layout and payment copy | 4.0.2; confirm status-copy decision; **Medium** | General-menu and dine-in both work; two devices share rounds; intent permits ordering; pending pauses; confirmation ends; ended URL never reopens; no online-payment claim | Lost session token, incorrect paid claim, theme/portal contrast, skipped-state misrepresentation |
| **4.0.4 Staff operational hierarchy** | Staff orders page, DiningTableCard/Rounds, KitchenOrderCard, requests/notices and login presentation | Customer vocabulary settled; **Medium** | Same single PIN session, next-round actions, branch isolation and priorities; clear receipts; long rounds readable at tablet widths; polling does not reset focus/dialog | Hidden work, altered role gating, premature closure or timeout extension |
| **4.0.5 Owner navigation and daily screens** | Dashboard layout/sidebar, Overview/Orders/Tables/QR page presentation; six groups and accessible mobile navigation | Existing routes; **Medium** | Every authorized route and logout reachable on phone; tables/QR connected; historical orders and New York metric semantics unchanged; no fake payment ledger | Menu grouping accidentally changes access; pagination/query loss; manual closure hidden incorrectly |
| **4.0.6 Owner setup and truthful states** | Menu/staff/settings/branding/offers/analytics presentation and their existing forms; explicit loading/empty/error treatment where queries currently ignore errors | 4.0.5; separate review of error branches; **Medium** | Existing create/save/edit-staff actions preserved; Owner-only Manager controls preserved; no error shown as empty; placeholders clearly unavailable; template settings retained | Mistaken new CRUD feature, image/form reset issues, subscription gating change, suppressed real errors |
| **4.0.7 Public account presentation** | Landing/login/signup/onboarding components | Stable product naming/copy decision; **Small** | Existing signup/email-confirmation and bootstrap paths unchanged; mobile header fits; no unsupported trial/plan/payment promise | Broken onboarding fields or misleading conversion copy |
| **4.0.8 Platform information hierarchy** | PlatformShell/report-ui, existing report pages, audit, account control/login/MFA presentation | No auth changes; **Medium** | Current MFA and recent-MFA gates pass; denied/stale/conflict/unknown results clear; chart exact values and definitions retained; audit immutable | Dangerous controls made too easy, data/secret exposure, changed metric meaning |
| **4.0.9 Cross-surface visual consolidation and acceptance** | Only shared tokens/primitives demonstrated safe by prior phases; remaining theme/error/spacing inconsistencies | Prior phases accepted; **Medium** | Full responsive/accessibility matrix, all existing regression suites, approved hosted end-to-end checks; exact deployment commit verified | Global CSS changes affecting all roles; local tests mistaken for hosted proof |

**Outside this roadmap:** menu editing/availability CRUD, subscription billing, password recovery, branch switching/management, completed-visit ledger, receipt ledger/export, new online payments, new Preparing action, offline operation, additional languages and new platform controls. These are capability decisions requiring separate scope, not decorative redesign tasks.

### Regression and release gates for future implementation

- Before any code change, record baseline and permitted file list; read applicable installed Next.js docs. Keep historical 3.5 security tests unchanged.
- Run focused presentation/browser fixtures for changed surfaces. For a release, run the existing application tests, native PostgreSQL lifecycle/security/onboarding suites, TypeScript, ESLint and production build. The last 3.5 verification passed 116 application and 74 native tests; those are historical counts, not a new result from this audit.
- Validate owner signup → restaurant creation → menu/table/staff setup; Manager cannot elevate self/others or edit linked privileged staff; cross-tenant requests denied; platform MFA/denial/control-conflict behavior retained.
- Validate two diners on one table, independent carts, multiple rounds, ready/served without closing, bill intent then more ordering, Record Payment → pending → full receipt confirmation → closed/available/ended URL. Failed, abandoned and retried attempts must not close or duplicate receipts.
- Include general-menu counter order and individual tracking, legacy redirect URLs, suspension and closed-token behavior.
- Hosted release requires its own authorized browser/API/database evidence and correct deployment SHA. If access remains restricted, report the exact missing evidence; do not bypass it or claim production acceptance from local fixtures.

## 9. Risks, unresolved questions and decisions

| Question / risk | Safe default for implementation | When decision is needed |
| --- | --- | --- |
| THALIQ versus QR.CR naming | Keep THALIQ visible product name; use QR.CR only where already needed; no domain/logo migration | Before public copy phase |
| Currency and geography | Preserve current ₹ display and stored amounts; do not infer currency from New York timezone or change UPI semantics | Separate localization/product task; platform reports continue saying currency unavailable |
| Preparing discrepancy | Preserve actual backend progression; improve clarity without adding a new transition | Before 4.0.3 status presentation changes |
| Owner/Manager financial access | Preserve existing dashboard membership rules; no new restrictions or expansions in UI project | Separate permissions decision if desired |
| Paid/closing legacy records | Keep truthful fallback state; normal confirmed receipt auto-closes | Every settlement-related presentation review |
| Online card unavailable | Keep it unavailable and explain external payment; do not promise imminent gateway support | Copy review only; integration is separate |
| Menu editing and history gaps | Do not render nonfunctional controls; current lists remain limited | Separate capability backlog |
| First-membership restaurant selection | Do not add switcher or persist a new selected tenant | Separate tenancy task |
| Existing premium/template behavior | Preserve trial/premium decision logic; validate all stored template slugs and custom colors | Before theme consolidation |
| Hosted/browser evidence | This audit contains source-confirmed facts and proposed designs, not observed production visuals | Before declaring a redesign phase fully accepted |
| Leaked-password protection | Platform Controls currently says “not verified enabled”; redesign must not replace uncertainty with a green check | Trusted operator verification outside this design task |
| Broad source audit is not a security re-audit | Preserve 3.5 boundaries and tests; report newly discovered functional/security issues separately | Any implementation finding that needs business-logic changes |

## 10. Recommended first implementation prompt — 4.0.2

> **THALIQ / QR.CR — Modification 4.0.2: Customer cart and item accessibility**
>
> Continue from commit `188748fd057747401753dc07fc05f749abbffa94`, or verify and report a later approved baseline first. Read `docs/modification-4.0.1-ui-ux-blueprint.md`. Implement only the first customer accessibility slice; do not start the other phases.
>
> Limit application edits to `src/components/menu/cart-sheet.tsx`, `src/components/menu/add-to-cart-dialog.tsx` and `src/components/menu/cart-bar.tsx`, plus focused presentation tests. Use existing primitives and dependencies. Do not change global styles or the shared Dialog/Button defaults.
>
> Make cart and item quantity/remove controls at least 44×44 CSS pixels with descriptive accessible names. Provide clear selected-state semantics for variants, labeled quantity controls, and announced submission errors/success where existing state supports them. Make long cart/item content usable at 320px width and with the mobile keyboard; keep the primary action reachable and add safe-area spacing to the existing cart bar. Label the cart as this device's unsubmitted order and continue showing the existing subtotal/tax/service disclaimer.
>
> Preserve every calculation, variant/add-on selection, optional field, form value, submission key, unknown-result retry, token/query parameter, server-action signature, cart-clear condition and route destination. Do not change payment, order/session transitions, storage identity, polling, RLS or permissions. Do not add a new page, dependency, payment method, pricing estimate or checkout flow.
>
> Verify mouse, touch and keyboard interactions; focus containment/return; 320×568 and 390×844 mobile, tablet and desktop; long names, missing images and large carts; failed/unknown submission retains the same cart and key; successful submission follows the existing destination exactly once. Run relevant existing regressions, TypeScript, ESLint and production build; preserve the 3.5 security/lifecycle gates. Report changed files, exact checks, limitations and any blocker. Do not claim hosted acceptance from local tests. Do not push/deploy unless separately instructed. Stop after this slice.

**Recommendation:** begin with **4.0.2 customer cart and item accessibility**. It improves the core ordering task with a narrow, reviewable change surface. Follow with shared-table/payment clarity and the staff console, then Owner navigation. Do not begin with a global theme replacement or new management modules.
