-- migrations/0006_add_base_custom_slug.sql
-- base_slug: 최초 생성 시 자동 부여, 이후 절대 변경 불가
-- custom_slug: 사용자가 자유롭게 지정/변경 가능 (선택)

ALTER TABLE urls ADD COLUMN base_slug TEXT;
ALTER TABLE urls ADD COLUMN custom_slug TEXT;

-- 기존 레코드: 현재 slug를 base_slug로 백필
UPDATE urls SET base_slug = slug WHERE base_slug IS NULL;

-- custom_slug 고유 인덱스 (NULL 허용 — SQLite에서 NULL은 UNIQUE 중복 허용)
CREATE UNIQUE INDEX IF NOT EXISTS idx_urls_custom_slug ON urls(custom_slug) WHERE custom_slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_urls_base_slug ON urls(base_slug);
