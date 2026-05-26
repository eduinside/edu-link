-- migrations/0007_add_created_by_to_urls.sql
-- created_by: 생성 경로 ('web' = 대시보드 직접 생성, 'api' = API Key 연동 생성)

ALTER TABLE urls ADD COLUMN created_by TEXT NOT NULL DEFAULT 'web';
