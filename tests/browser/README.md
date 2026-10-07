# Payment UI component checks

`payment-flow.cjs` bundles the real customer payment and staff table-card components, then exercises them in headless Google Chrome. Router and server-action adapters are deterministic fixtures. This suite does **not** verify a deployed Next.js/Supabase flow or a card provider.

Install `esbuild@0.25.11` and Playwright in a separate test-tools directory, or use existing installations, then run from the repository root:

```sh
ESBUILD_MODULE=/absolute/path/to/node_modules/esbuild \
PLAYWRIGHT_MODULE=/absolute/path/to/node_modules/playwright \
node tests/browser/payment-flow.cjs
```

The runner starts an ephemeral loopback HTTP server and closes it and Chrome afterward. It verifies optional Pay Now, disabled/unavailable online card payment, session-preserving Keep Ordering, stale counter-request errors, refreshed counter totals and staff intent, and manual closure without a customer payment action.

For authorization and actual database behavior, run `node --test tests/*.test.cjs`. For parallel PostgreSQL races, run `tests/dining-lifecycle.test.cjs` with `DINING_TEST_DATABASE_URL` pointing to a **fresh empty isolated test database**, plus `PG_TEST_DRIVER` pointing to the `pg` module if it is not installed locally. That test initializes the schema; never point it at production.
