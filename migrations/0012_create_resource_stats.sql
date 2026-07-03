-- migrations/0012_create_resource_stats.sql
-- edumaps 리소스 카드 클릭/다운로드(외부 이동) 카운터
-- v1: 방문자 중복방지 없음(단순 카운터). 필요해지면 edukit_view_dedupe와 동일한
-- 패턴(방문자+날짜 PK)의 dedupe 테이블을 나중에 추가하면 된다.

CREATE TABLE IF NOT EXISTS resource_stats (
    resource_id    TEXT    NOT NULL PRIMARY KEY, -- edumaps resources.json의 id (예: 'res_011')
    click_count    INTEGER NOT NULL DEFAULT 0,    -- 카드 클릭(상세 모달 열람) 횟수
    download_count INTEGER NOT NULL DEFAULT 0,    -- 외부 링크(웹사이트 바로가기) 이동 횟수
    updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_resource_stats_click ON resource_stats(click_count DESC);
CREATE INDEX IF NOT EXISTS idx_resource_stats_download ON resource_stats(download_count DESC);
