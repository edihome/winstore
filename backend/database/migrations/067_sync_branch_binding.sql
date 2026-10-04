-- Preserve the branch selected on the web across desktop restarts.
-- Existing installations remain compatible with their unbound enrollment.
ALTER TABLE sync_branch_config
    ADD COLUMN branch_id UUID REFERENCES branches(id);
