-- Enum values must be committed before the following migration uses them.
alter type table_session_status add value if not exists 'payment_pending';
alter type table_session_status add value if not exists 'paid';
alter type table_status add value if not exists 'payment_pending';
alter type table_status add value if not exists 'paid';
