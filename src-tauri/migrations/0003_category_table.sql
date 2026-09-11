-- Categories become data, so they can be added, renamed and removed.
--
-- The description is not decoration: it is the line the model is given to sort by, so a
-- category with a vague description sorts badly. The six seeded here are the ones the
-- prompt already used, with their original wording.
CREATE TABLE categories (
    slug        TEXT PRIMARY KEY,
    -- The English name. Built-in ones are translated in the interface by slug; a category
    -- someone typed themselves is shown exactly as they typed it.
    name        TEXT    NOT NULL,
    -- Told to the model, verbatim.
    description TEXT    NOT NULL,
    -- Built-in categories have rules behind them (a calendar part, an unsubscribe link)
    -- that a user-made one cannot have.
    is_builtin  INTEGER NOT NULL DEFAULT 0,
    -- Whether the assistant may sort into it. Off means only you put mail here.
    auto_sort   INTEGER NOT NULL DEFAULT 1,
    position    INTEGER NOT NULL DEFAULT 0
);

INSERT INTO categories (slug, name, description, is_builtin, position) VALUES
    ('reply',      'Needs a reply',    'a person is asking me for something, or expects an answer from me', 1, 0),
    ('fyi',        'For information',  'a person wrote to me, but nothing is being asked of me',             1, 1),
    ('meeting',    'Meetings',         'a meeting invitation, or arranging a time',                          1, 2),
    ('invoice',    'Invoices',         'an invoice, a receipt, a payment or an order confirmation',          1, 3),
    ('automated',  'Notifications',    'an automatic notification from a system or service',                 1, 4),
    ('newsletter', 'Newsletters',      'marketing, campaigns, product news sent to many people',             1, 5);

-- A category you set by hand is never revisited: category_source 'user' outranks both
-- 'rule' and 'model', and a re-sort leaves those rows alone.
CREATE INDEX IF NOT EXISTS idx_messages_category_source ON messages (category_source);
