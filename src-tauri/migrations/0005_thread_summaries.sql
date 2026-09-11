-- Summaries, kept so a long thread is summarised once rather than on every open.
--
-- A summary is only true of the messages it was made from, so what it covered is stored
-- with it: when a reply arrives the count and the newest timestamp no longer match and the
-- summary is shown as out of date instead of quietly describing a conversation that has
-- moved on. Regenerating is then the reader's call, because it costs seconds of CPU.
--
-- Keyed by language as well: a Swedish summary is no use to someone who has switched the
-- app to Norwegian, and both can be kept rather than one overwriting the other.
CREATE TABLE thread_summaries (
    thread_key   TEXT NOT NULL,
    language     TEXT NOT NULL,
    summary      TEXT NOT NULL,
    -- What it was made from.
    message_count INTEGER NOT NULL,
    newest_at    TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    PRIMARY KEY (thread_key, language)
);
