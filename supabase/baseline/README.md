# Original source migrations

These seven files are retained unchanged as the source of the hosted initial schema. On 2026-10-06 they were applied together under migration `20261006223057_qrtest_initial_schema`. During recovery, the stored SQL was retrieved from hosted migration history and verified to contain every one of these files exactly. The consolidated migration now lives in `../migrations` so fresh installs and hosted migration history agree.

Do not apply this folder separately to the hosted project. Database unit tests use the original core-schema pieces to supply isolated auth fixtures without depending on Supabase Storage.
