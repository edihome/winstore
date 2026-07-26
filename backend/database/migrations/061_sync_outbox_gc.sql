-- Outbox garbage collection: without it sync_outbox grows forever on every
-- node. A change is safe to drop once it has been CONFIRMED delivered:
--   * on a branch — once pushed (seq <= its push watermark);
--   * on the hub  — once every active branch has pulled past it.
-- The hub therefore needs to remember how far each branch has pulled; that's
-- this column (updated from the `since` a branch sends on each pull — which it
-- only advances after applying, so it's a safe low-water mark).

ALTER TABLE sync_nodes ADD COLUMN IF NOT EXISTS last_pulled_seq BIGINT NOT NULL DEFAULT 0;
