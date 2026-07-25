-- Lets a user be granted more than one branch (e.g. a manager who covers
-- two locations), instead of the single nullable users.branch_id. That
-- column is kept as the user's PRIMARY/home branch (still used for
-- defaults); this table is the full set of branches they can act as.
-- No rows here is not an error — see branches.repository, which falls
-- back to the user's primary branch alone, so every existing user keeps
-- working unchanged with zero backfill needed.
CREATE TABLE IF NOT EXISTS user_branches (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (user_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_user_branches_branch_id ON user_branches (branch_id);
