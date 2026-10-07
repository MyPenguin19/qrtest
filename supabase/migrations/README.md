# Canonical hosted migration chain

The active migration directory matches project `pixhngrbhiziwapxmqjd` after the 2026-10-07 recovery. No restaurant records were deleted/reset to establish this chain.

| Canonical applied version | Earlier source filename |
| --- | --- |
| 20261006223057_qrtest_initial_schema | Seven original 202608 migrations, preserved in ../baseline |
| 20261007213147_dining_lifecycle_states | 20261007103504_dining_lifecycle_states |
| 20261007213159_atomic_dining_lifecycle | 20261007103510_atomic_dining_lifecycle |
| 20261007213210_optional_customer_payment | 20261007204919_optional_customer_payment |

The Supabase migration tool assigned application timestamps when the three missing migrations were applied in order. Their SQL contents are unchanged. Filenames now use those actual history versions; the consolidated initial SQL is the exact stored hosted migration. This prevents a future CLI deployment from trying to apply already-present tables/functions again.

The enum migration must commit before the following migration. Apply pending migrations before deploying code that depends on them. Modification 3.2 adds no database migration.
