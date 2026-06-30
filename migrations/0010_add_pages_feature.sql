-- migrations/0010_add_pages_feature.sql
-- 에듀링크 페이지(EduLink Pages): level3+ 회원용 멀티테넌트 게시 기능
-- kind 컬럼은 이미 존재('link'|'survey'). 'site'를 세 번째 값으로 사용하므로 type 신규 컬럼 불필요.
-- 사이트는 단축주소(urls) 풀·슬러그 네임스페이스를 공유한다.

-- 1. urls 확장: kind='site'일 때 sites.id 역참조
ALTER TABLE urls ADD COLUMN site_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_urls_site_id ON urls(site_id);

-- 2. 사이트 테이블 (회원당 다수, urls 행과 1:1)
CREATE TABLE IF NOT EXISTS sites (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL,            -- 소유자 (users.id)
    url_id        INTEGER NOT NULL,            -- 슬러그 보유 urls 행
    title         TEXT    NOT NULL,
    theme         TEXT    NOT NULL DEFAULT '{}',
    home_page_id  INTEGER,                     -- 첫 페이지 생성 후 설정 (nullable)
    is_public     INTEGER NOT NULL DEFAULT 1 CHECK(is_public IN (0, 1)),
    rev           INTEGER NOT NULL DEFAULT 0,  -- 캐시 무효화 리비전
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (url_id)  REFERENCES urls(id)  ON DELETE CASCADE
);

-- 3. 페이지 테이블 (사이트 하위, depth 0~2 = 최대 2단계)
CREATE TABLE IF NOT EXISTS site_pages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id    INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    parent_id  INTEGER REFERENCES site_pages(id) ON DELETE CASCADE,  -- NULL=최상위
    slug       TEXT    NOT NULL,               -- 형제 내 유일
    title      TEXT    NOT NULL,
    depth      INTEGER NOT NULL DEFAULT 0,     -- 0~2
    sort       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (site_id, parent_id, slug)
);

-- 4. 섹션 테이블 (페이지 하위 콘텐츠 블록)
CREATE TABLE IF NOT EXISTS site_sections (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id    INTEGER NOT NULL REFERENCES site_pages(id) ON DELETE CASCADE,
    type       TEXT    NOT NULL,               -- text|youtube (향후 heading|divider|link|image)
    content    TEXT    NOT NULL DEFAULT '{}',  -- JSON
    sort       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 5. 인덱스
CREATE INDEX IF NOT EXISTS idx_sites_user        ON sites(user_id);
CREATE INDEX IF NOT EXISTS idx_site_pages_site   ON site_pages(site_id);
CREATE INDEX IF NOT EXISTS idx_site_pages_parent ON site_pages(site_id, parent_id, sort);
CREATE INDEX IF NOT EXISTS idx_site_sections_pg  ON site_sections(page_id, sort);
