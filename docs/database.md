# 데이터베이스

## 개요

- **엔진**: Cloudflare D1 (SQLite 기반 서버리스 DB)
- **Database ID**: `e5fa6f54-6063-48f9-9cf3-0517381dd005`
- **Database Name**: `edu-link-db`
- **스키마 파일**: `src/server/db/schema.sql`

---

## 테이블 구조

### `users` — 사용자

```sql
CREATE TABLE users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL DEFAULT '',
    affiliation TEXT NOT NULL DEFAULT '',     -- 소속 (학교/기관명)
    level       INTEGER NOT NULL DEFAULT 1,   -- 등급 (1~4)
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `level` | INTEGER | 1=일반, 2=인증사용자, 3=개발자, 4=최고관리자 |
| `affiliation` | TEXT | 소속 기관명, 신규 가입 시 필수 입력 |

---

### `urls` — 단축 URL

```sql
CREATE TABLE urls (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    slug          TEXT NOT NULL UNIQUE,       -- 레거시 호환 (= base_slug)
    base_slug     TEXT NOT NULL UNIQUE,       -- 자동생성 6자리 랜덤, 불변
    custom_slug   TEXT UNIQUE,               -- 사용자 지정 슬러그 (선택)
    original_url  TEXT NOT NULL,
    title         TEXT DEFAULT '',
    description   TEXT DEFAULT '',
    user_id       INTEGER NOT NULL,
    is_active     INTEGER NOT NULL DEFAULT 1,
    is_public     INTEGER NOT NULL DEFAULT 0, -- 0=비공개, 1=공개
    click_count   INTEGER NOT NULL DEFAULT 0,
    expires_at    TEXT,                       -- UTC datetime, NULL=영구
    password      TEXT,                      -- 6자리 숫자 PIN, NULL=없음
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

#### 슬러그 이중 구조

단축주소는 두 개의 슬러그를 독립적으로 운용합니다.

```
생성 시 사용자 입력: "수학여행"
    → custom_slug = "수학여행"  (사용자 지정, 변경 가능)
    → base_slug   = "EHLGmC"   (서버 자동 생성, 불변)
    → slug        = "EHLGmC"   (레거시 호환, = base_slug)

접속 가능한 주소:
    https://dgedu.link/EHLGmC    (base_slug)
    https://dgedu.link/수학여행  (custom_slug)

QR 코드는 항상 base_slug 기준으로 생성 → 커스텀 슬러그 변경과 무관하게 유지
```

---

### `click_logs` — 클릭 로그

```sql
CREATE TABLE click_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    url_id      INTEGER NOT NULL,
    ip_hash     TEXT DEFAULT '',      -- IP SHA-256 해시 (개인정보 비식별)
    country     TEXT DEFAULT '',      -- Cloudflare CF-IPCountry 헤더
    referer     TEXT DEFAULT '',
    user_agent  TEXT DEFAULT '',
    device_type TEXT DEFAULT 'unknown', -- mobile / desktop / tablet / unknown
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (url_id) REFERENCES urls(id) ON DELETE CASCADE
);
```

> 통계 집계 쿼리: `SELECT DATE(created_at) as date, COUNT(*) as clicks FROM click_logs WHERE url_id = ? AND created_at >= datetime('now', '-30 days') GROUP BY DATE(created_at)`

---

### `api_keys` — API 키

```sql
CREATE TABLE api_keys (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL,
    key_hash     TEXT NOT NULL UNIQUE,  -- SHA-256 해시 (원본 미저장)
    key_prefix   TEXT NOT NULL,         -- 식별용 앞 8자 (edulink_XXXXXXXX)
    name         TEXT NOT NULL DEFAULT 'Default',
    is_active    INTEGER NOT NULL DEFAULT 1,
    last_used_at TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

---

### `allowed_domains` — 허용 이메일 도메인

```sql
CREATE TABLE allowed_domains (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    domain     TEXT NOT NULL UNIQUE,  -- 예: dge.go.kr, korea.kr
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

로그인 시 이 테이블에 존재하는 도메인의 이메일이면 level 2(인증사용자)로 자동 승급.

기본 등록값: `dge.go.kr`, `korea.kr`

---

### `reserved_slugs` — 예약 슬러그

```sql
CREATE TABLE reserved_slugs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    slug       TEXT NOT NULL UNIQUE,
    reason     TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

단축주소 생성 시 이 목록과 충돌하면 거부. 기본 예약어:

| 슬러그 | 이유 |
|---|---|
| `api` | System API Route |
| `admin` | Admin Dashboard Route |
| `dashboard` | User Dashboard Route |
| `login` | Login Route |
| `assets` | Static Assets Route |
| `static` | Static Folder Route |
| `public` | Public Folder Route |
| `favicon.ico` | Favicon |

---

### `notices` — 공지사항

```sql
CREATE TABLE notices (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    content    TEXT NOT NULL,
    is_pinned  INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## 인덱스

```sql
CREATE INDEX idx_urls_slug         ON urls(slug);
CREATE INDEX idx_urls_user_id      ON urls(user_id);
CREATE INDEX idx_click_logs_url_id ON click_logs(url_id);
CREATE INDEX idx_click_logs_created_at ON click_logs(created_at);
CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash);
```

---

## 마이그레이션 이력

| 파일 | 내용 |
|---|---|
| `0001_create_tables.sql` | users, urls, api_keys, click_logs, allowed_domains, reserved_slugs 초기 생성 |
| `0002_create_notices.sql` | notices 테이블 추가 |
| `0003_add_is_public_to_urls.sql` | urls.is_public 컬럼 추가 |
| `0004_add_password_to_urls.sql` | urls.password 컬럼 추가 |
| `0005_update_user_levels.sql` | users.level (role TEXT → INTEGER) 체계 변경 |
| `0006_add_base_custom_slug.sql` | urls.base_slug, urls.custom_slug 컬럼 추가 |
| *(ALTER)* | users.affiliation 컬럼 추가 (CLI로 직접 실행) |

### 새 마이그레이션 실행

```bash
npx wrangler d1 execute edu-link-db --remote --file=migrations/000X_name.sql
```
