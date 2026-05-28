-- migrations/0009_add_survey_to_urls.sql
-- 설문지 기능: urls 테이블에 kind/survey_config 등 추가 + 응답 저장 테이블

ALTER TABLE urls ADD COLUMN kind TEXT NOT NULL DEFAULT 'link';
ALTER TABLE urls ADD COLUMN survey_config TEXT;
ALTER TABLE urls ADD COLUMN response_limit INTEGER;
ALTER TABLE urls ADD COLUMN response_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS survey_responses (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    url_id        INTEGER NOT NULL,
    answers_json  TEXT NOT NULL,
    ip_hash       TEXT DEFAULT '',
    user_agent    TEXT DEFAULT '',
    submitted_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (url_id) REFERENCES urls(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_survey_responses_url_id ON survey_responses(url_id);
CREATE INDEX IF NOT EXISTS idx_urls_kind ON urls(kind);
