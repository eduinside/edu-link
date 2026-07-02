-- migrations/0011_publish_model.sql
-- 에듀링크 페이지: 게시(초안→게시) 모델
-- 편집은 초안(rev)으로 누적, '게시' 시 완성 HTML 스냅샷을 만들어 공개.
-- 공개 요청은 스냅샷(KV+D1)만 읽어 D1 렌더 왕복을 제거한다.

-- 1. sites: 게시 상태 컬럼
ALTER TABLE sites ADD COLUMN published_rev INTEGER NOT NULL DEFAULT 0; -- 0=미게시. rev>published_rev면 '게시 필요'
ALTER TABLE sites ADD COLUMN published_at  TEXT;                        -- 최근 게시 시각

-- 2. 게시 스냅샷 (공개의 유일한 소스)
CREATE TABLE IF NOT EXISTS site_snapshots (
    site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    path    TEXT    NOT NULL,   -- ''(홈) | '{a}' | '{a}/{b}'
    html    TEXT    NOT NULL,
    rev     INTEGER NOT NULL,
    PRIMARY KEY (site_id, path)
);

CREATE INDEX IF NOT EXISTS idx_site_snapshots_site ON site_snapshots(site_id);
