-- Shrink the node-token blast radius. Instead of one ~10-year node JWT, a
-- branch holds a long-lived REFRESH SECRET (hashed here) and exchanges it for
-- SHORT-lived access tokens via POST /sync/token. A stolen access token expires
-- fast; revocation stays instant (is_active=false blocks both refresh and any
-- outstanding access token). The secret itself is stored only as a SHA-256 hash.

ALTER TABLE sync_nodes ADD COLUMN IF NOT EXISTS refresh_secret_hash TEXT;

-- The branch's own copy of its refresh secret (its device, like the offline
-- password hashes). Replaces the stored access token.
ALTER TABLE sync_branch_config ADD COLUMN IF NOT EXISTS refresh_secret TEXT;
