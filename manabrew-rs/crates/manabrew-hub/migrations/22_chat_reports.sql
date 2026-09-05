-- A player's report of another player's chat. `transcript` is the reporter's
-- chat buffer for both scopes, each line annotated at write time with whether
-- its relay `seal` opened under SECRET_MANABREW_KEY (`verified`) and the IP it
-- yielded. `reported_ip` comes only from a verified line sent by
-- `reported_username`; the reporter cannot supply it. `request_ip` is the
-- address the report itself arrived from.
CREATE TABLE chat_reports (
    id                  TEXT PRIMARY KEY,
    created_at          TEXT NOT NULL,
    reporter_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    request_ip          TEXT NOT NULL,
    reported_username   TEXT NOT NULL,
    reported_ip         TEXT,
    reason              TEXT NOT NULL,
    details             TEXT,
    room_id             TEXT,
    transcript          TEXT NOT NULL
);

CREATE INDEX idx_chat_reports_created ON chat_reports(created_at);
CREATE INDEX idx_chat_reports_reported_ip ON chat_reports(reported_ip);
