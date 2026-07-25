/**
 * ============================================================
 * File: optimisticLock.js
 * Module: Shared Utilities
 *
 * Description:
 * Optimistic concurrency control for ordinary edit forms, so two people
 * editing the same record can't silently overwrite each other ("last write
 * wins"). The record's version token is Postgres's built-in `xmin` system
 * column, exposed to the client as `version` (repositories select
 * `xmin::text AS version`) — no schema change, and the database bumps it on
 * every update automatically, so no update path can forget to.
 *
 * The client sends back the `version` it loaded as `expectedVersion`. The
 * guarded UPDATE adds `AND xmin = <expected>::xid`, so if the row changed in
 * the meantime it matches nothing and the service raises a 409 instead of
 * clobbering the other person's change. It's OPTIONAL: a request that omits
 * expectedVersion updates as before (backward compatible), just without the
 * conflict guard.
 * ============================================================
 */

const AppError = require("./AppError");

const CONFLICT_MESSAGE =
    "This record was changed by someone else since you opened it. Please reload and try again.";

/**
 * The standard 409 raised when a guarded update matches nothing because the
 * row's version moved on.
 *
 * @returns {AppError}
 */
const conflictError = () => new AppError(CONFLICT_MESSAGE, 409);

/**
 * Extract the client-supplied expected version, normalized to a string or
 * null (absent/blank → no guard).
 *
 * @param {object} payload Request body.
 * @returns {string|null}
 */
const expectedVersionOf = (payload) => {
    const value = payload && payload.expectedVersion;
    if (value === undefined || value === null || value === "") {
        return null;
    }
    return String(value);
};

module.exports = { CONFLICT_MESSAGE, conflictError, expectedVersionOf };
