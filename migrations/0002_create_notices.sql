-- migrations/0002_create_notices.sql

-- 1. 공지사항 테이블 생성
CREATE TABLE IF NOT EXISTS notices (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    content     TEXT NOT NULL,
    is_pinned   INTEGER NOT NULL DEFAULT 0 CHECK(is_pinned IN (0, 1)),
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. 초기 공지사항 데이터 삽입
INSERT OR IGNORE INTO notices (id, title, content, is_pinned) VALUES 
(1, '에듀링크 서비스 정식 오픈 안내', '안전하고 편리한 교육용 단축주소 플랫폼 에듀링크가 오픈되었습니다. korea.kr 및 dge.go.kr 계정으로 로그인 후 단축주소를 즉시 생성하실 수 있습니다.', 1),
(2, '개인정보보호 및 링크 보안 가이드라인', '공유되는 링크 중 아동/청소년 유해 매체나 불법 스팸성 목적지가 포함된 경우, 서비스 이용 권한이 영구 제한되며 관련 법에 의해 조치될 수 있으니 사용 시 유의해 주시기 바랍니다.', 0);

-- 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_notices_pinned ON notices(is_pinned);
CREATE INDEX IF NOT EXISTS idx_notices_created ON notices(created_at);
