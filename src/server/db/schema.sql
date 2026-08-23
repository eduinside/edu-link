-- src/server/db/schema.sql
-- 편의용 전체 스냅샷. 실제 적용 순서/진실은 migrations/*.sql 이 canonical.
-- (migrations 0001~0010 누적 반영본)

-- 1. 사용자 테이블 (0005: role→level 정수화, affiliation 추가)
CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL DEFAULT '',
    level       INTEGER NOT NULL DEFAULT 1 CHECK(level IN (1, 2, 3, 4)), -- 1일반 2인증 3개발자 4관리자
    affiliation TEXT DEFAULT '',
    avatar_url  TEXT DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. 단축 URL 테이블 (KV 캐시의 원본 소스) — 링크/설문/사이트를 kind로 구분
CREATE TABLE IF NOT EXISTS urls (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    slug           TEXT NOT NULL UNIQUE,
    base_slug      TEXT,
    custom_slug    TEXT,
    original_url   TEXT NOT NULL,
    title          TEXT DEFAULT '',
    description    TEXT DEFAULT '',
    user_id        INTEGER NOT NULL,
    is_active      INTEGER NOT NULL DEFAULT 1,
    is_public      INTEGER NOT NULL DEFAULT 0,
    click_count    INTEGER NOT NULL DEFAULT 0,
    expires_at     TEXT,
    password       TEXT,
    created_by     TEXT NOT NULL DEFAULT 'web',
    kind           TEXT NOT NULL DEFAULT 'link',   -- 'link' | 'survey' | 'site'
    survey_config  TEXT,                           -- kind='survey'
    response_limit INTEGER,                         -- kind='survey'
    response_count INTEGER NOT NULL DEFAULT 0,      -- kind='survey'
    site_id        INTEGER,                         -- kind='site' → sites.id
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 3. API Keys 테이블 (외부 API 접근용)
CREATE TABLE IF NOT EXISTS api_keys (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL,
    key_hash     TEXT NOT NULL UNIQUE,
    key_prefix   TEXT NOT NULL,
    name         TEXT NOT NULL DEFAULT 'Default',
    is_active    INTEGER NOT NULL DEFAULT 1,
    last_used_at TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 4. 상세 클릭 로그 테이블 (분석용)
CREATE TABLE IF NOT EXISTS click_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    url_id      INTEGER NOT NULL,
    ip_hash     TEXT DEFAULT '',
    country     TEXT DEFAULT '',
    referer     TEXT DEFAULT '',
    user_agent  TEXT DEFAULT '',
    device_type TEXT DEFAULT 'unknown',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (url_id) REFERENCES urls(id) ON DELETE CASCADE
);

-- 5. 동적 허용 이메일 도메인 테이블 (Zero Trust/Access 연동)
CREATE TABLE IF NOT EXISTS allowed_domains (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    domain      TEXT NOT NULL UNIQUE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 6. 동적 예약 슬러그 테이블 (충돌 방지용)
CREATE TABLE IF NOT EXISTS reserved_slugs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    slug        TEXT NOT NULL UNIQUE,
    reason      TEXT DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 초기 기본 데이터 설정
INSERT OR IGNORE INTO allowed_domains (domain) VALUES ('dge.go.kr'), ('korea.kr');
INSERT OR IGNORE INTO reserved_slugs (slug, reason) VALUES 
('api', 'System API Route'),
('admin', 'Admin Dashboard Route'),
('dashboard', 'User Dashboard Route'),
('login', 'Login Route'),
('assets', 'Static Assets Route'),
('static', 'Static Folder Route'),
('public', 'Public Folder Route'),
('favicon.ico', 'Favicon');

-- 7. 에듀링크 페이지: 사이트 / 페이지 / 섹션 (0010) + 게시 모델 (0011)
CREATE TABLE IF NOT EXISTS sites (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL,
    url_id        INTEGER NOT NULL,
    title         TEXT    NOT NULL,
    theme         TEXT    NOT NULL DEFAULT '{}',
    home_page_id  INTEGER,
    is_public     INTEGER NOT NULL DEFAULT 1 CHECK(is_public IN (0, 1)),
    rev           INTEGER NOT NULL DEFAULT 0,
    published_rev INTEGER NOT NULL DEFAULT 0,  -- 0=미게시. rev>published_rev면 '게시 필요'
    published_at  TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (url_id)  REFERENCES urls(id)  ON DELETE CASCADE
);

-- 게시 스냅샷 (공개의 유일한 소스)
CREATE TABLE IF NOT EXISTS site_snapshots (
    site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    path    TEXT    NOT NULL,
    html    TEXT    NOT NULL,
    rev     INTEGER NOT NULL,
    PRIMARY KEY (site_id, path)
);

CREATE TABLE IF NOT EXISTS site_pages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id    INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    parent_id  INTEGER REFERENCES site_pages(id) ON DELETE CASCADE,
    slug       TEXT    NOT NULL,
    title      TEXT    NOT NULL,
    depth      INTEGER NOT NULL DEFAULT 0,
    sort       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (site_id, parent_id, slug)
);

CREATE TABLE IF NOT EXISTS site_sections (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id    INTEGER NOT NULL REFERENCES site_pages(id) ON DELETE CASCADE,
    type       TEXT    NOT NULL,
    content    TEXT    NOT NULL DEFAULT '{}',
    sort       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 성능 최적화 인덱스
CREATE INDEX IF NOT EXISTS idx_urls_slug ON urls(slug);
CREATE INDEX IF NOT EXISTS idx_urls_user_id ON urls(user_id);
CREATE INDEX IF NOT EXISTS idx_urls_site_id ON urls(site_id);
CREATE INDEX IF NOT EXISTS idx_site_snapshots_site ON site_snapshots(site_id);
CREATE INDEX IF NOT EXISTS idx_click_logs_url_id ON click_logs(url_id);
CREATE INDEX IF NOT EXISTS idx_click_logs_created_at ON click_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_sites_user        ON sites(user_id);
CREATE INDEX IF NOT EXISTS idx_site_pages_site   ON site_pages(site_id);
CREATE INDEX IF NOT EXISTS idx_site_pages_parent ON site_pages(site_id, parent_id, sort);
CREATE INDEX IF NOT EXISTS idx_site_sections_pg  ON site_sections(page_id, sort);
