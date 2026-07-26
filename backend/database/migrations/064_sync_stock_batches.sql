-- Sync stock_batches so cross-node FEFO/expiry is correct, not just the
-- aggregate quantity. Batches are authoritative data (expiry can't be re-derived
-- from movements), created/consumed at whichever branch handles the goods — so
-- they flow both ways like stock_movements. Carries organization_id + id, so the
-- standard capture trigger + id-keyed upsert apply cleanly.
DROP TRIGGER IF EXISTS sync_capture_trg ON stock_batches;
CREATE TRIGGER sync_capture_trg AFTER INSERT OR UPDATE OR DELETE ON stock_batches
    FOR EACH ROW EXECUTE FUNCTION sync_capture();
