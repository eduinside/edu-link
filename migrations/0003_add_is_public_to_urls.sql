-- migrations/0003_add_is_public_to_urls.sql

-- 1. urls 테이블에 is_public 컬럼 추가 (기본값 0: 비공개)
ALTER TABLE urls ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0 CHECK(is_public IN (0, 1));

-- 2. 공개 링크 조회 성능을 향상시키기 위한 복합 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_urls_public_active ON urls(is_public, is_active);
