-- Sorting mail into categories.
--
-- Stored rather than derived: the model pass costs seconds per message, so it must survive
-- a restart. `source` records how a category was arrived at, which matters because the
-- rules are cheap and certain while the model is neither: changing the model, or improving
-- the prompt, means re-running only the rows it decided.
ALTER TABLE messages ADD COLUMN category TEXT;
ALTER TABLE messages ADD COLUMN category_source TEXT;

-- The mail list filters on this, and the backlog pass looks for the rows still missing one.
CREATE INDEX IF NOT EXISTS idx_messages_category ON messages (account_id, category);
