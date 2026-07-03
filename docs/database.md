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

### `urls` — 단축 URL / 설문지 / 페이지

단축주소·설문지·페이지(사이트)를 단일 테이블로 관리합니다. `kind` 컬럼으로 종류를 구분하며, 세 종류 모두 동일한 슬러그 풀·예약어·소유권 검증을 공유합니다.

```sql
CREATE TABLE urls (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    slug           TEXT NOT NULL UNIQUE,       -- 레거시 호환 (= base_slug)
    base_slug      TEXT NOT NULL UNIQUE,       -- 자동생성 6자리 랜덤, 불변
    custom_slug    TEXT UNIQUE,               -- 사용자 지정 슬러그 (선택)
    original_url   TEXT NOT NULL DEFAULT '',   -- 단축링크 대상 URL; 설문일 때 빈 문자열
    title          TEXT DEFAULT '',
    description    TEXT DEFAULT '',
    user_id        INTEGER NOT NULL,
    created_by     INTEGER,                    -- 생성자 user_id (user_id와 동일, 후속 확장용)
    is_active      INTEGER NOT NULL DEFAULT 1,
    is_public      INTEGER NOT NULL DEFAULT 0, -- 0=비공개, 1=공개
    click_count    INTEGER NOT NULL DEFAULT 0,
    expires_at     TEXT,                       -- UTC datetime, NULL=영구
    password       TEXT,                       -- 6자리 숫자 PIN, NULL=없음
    kind           TEXT NOT NULL DEFAULT 'link', -- 'link' | 'survey' | 'site'
    survey_config  TEXT,                       -- 설문 메타 JSON (kind='survey'일 때만 사용)
    response_limit INTEGER,                    -- 최대 응답 수, NULL=무제한
    response_count INTEGER NOT NULL DEFAULT 0, -- 누적 응답 수
    site_id        INTEGER,                    -- 페이지 사이트 역참조 (kind='site'일 때 sites.id)
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

#### 슬러그 이중 구조

단축주소·설문지 모두 동일한 슬러그 패턴을 사용합니다.

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

#### survey_config JSON 구조

```json
{
  "title": "2026 만족도 조사",
  "intro": "안녕하세요! 설문에 참여해 주세요.",
  "outro": "감사합니다!",
  "theme": "indigo",
  "one_response_per_browser": false,
  "inactive_message": "이 설문은 종료되었습니다.",
  "questions": [
    {
      "id": "q_0",
      "type": "short",
      "label": "성함을 입력해 주세요",
      "required": true,
      "description": "설명 텍스트",
      "media_url": "https://youtube.com/watch?v=...",
      "options": [],
      "scale": null
    }
  ]
}
```

**질문 타입 목록**: `short` · `long` · `single` · `multi` · `rating` · `phone` · `email` · `address`

---

### `survey_responses` — 설문 응답

```sql
CREATE TABLE survey_responses (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    url_id       INTEGER NOT NULL,
    answers_json TEXT NOT NULL,   -- { "q_0": "값", "q_1": ["A","B"], "q_2": 4 } JSON
    ip_hash      TEXT DEFAULT '', -- IP SHA-256 해시 (개인정보 비식별)
    user_agent   TEXT DEFAULT '',
    submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (url_id) REFERENCES urls(id) ON DELETE CASCADE
);
```

- `answers_json` — 질문 ID(`q_0`, `q_1`, …)를 키로 하는 JSON 객체
  - 단일선택: 문자열
  - 다중선택: 문자열 배열
  - 만족도: 숫자
  - 주소: `{ "zonecode": "...", "address": "...", "detail": "..." }` 객체
- 응답 제출 시 `urls.response_count += 1`로 원자적 업데이트

---

## 페이지 (EduLink Pages) 테이블

`kind='site'`인 `urls` 행 1개가 사이트 1개를 소유하며, 아래 3개 테이블로 페이지 트리·콘텐츠·게시 스냅샷을 관리합니다. (마이그레이션 `0010`, `0011`)

### `sites` — 사이트

```sql
CREATE TABLE sites (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL,            -- 소유자 (users.id)
    url_id        INTEGER NOT NULL,            -- 슬러그 보유 urls 행 (kind='site')
    title         TEXT    NOT NULL,
    theme         TEXT    NOT NULL DEFAULT '{}', -- 테마 JSON (colors/font/header)
    home_page_id  INTEGER,                     -- bare /{slug} 진입 시 표시할 페이지
    is_public     INTEGER NOT NULL DEFAULT 1,  -- 0=게시 중단(공개 차단)
    rev           INTEGER NOT NULL DEFAULT 0,  -- 초안 리비전 (편집 시 +1)
    published_rev INTEGER NOT NULL DEFAULT 0,  -- 0=미게시. rev>published_rev면 '게시 필요'
    published_at  TEXT,                        -- 최근 게시 시각
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (url_id)  REFERENCES urls(id)  ON DELETE CASCADE
);
```

- 공개 조회수는 `urls.click_count`(사이트 행)에 집계됩니다.

### `site_pages` — 페이지 트리 (depth ≤ 1)

```sql
CREATE TABLE site_pages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id    INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    parent_id  INTEGER REFERENCES site_pages(id) ON DELETE CASCADE, -- NULL=최상위
    slug       TEXT    NOT NULL,               -- 형제 내 유일
    title      TEXT    NOT NULL,
    depth      INTEGER NOT NULL DEFAULT 0,     -- 0(최상위) | 1(자식)
    sort       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (site_id, parent_id, slug)
);
```

- URL 경로 = 조상 슬러그 체인. 최상위 `= /{siteSlug}/{slug}`, 자식 `= /{siteSlug}/{상위}/{자식}`. 홈 페이지는 bare `/{siteSlug}`로도 노출.
- 내부 `MAX_DEPTH=1`(0·1만 허용) → 경로 세그먼트 최대 2개.

### `site_sections` — 콘텐츠 섹션

```sql
CREATE TABLE site_sections (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id    INTEGER NOT NULL REFERENCES site_pages(id) ON DELETE CASCADE,
    type       TEXT    NOT NULL,               -- text|heading|image|youtube|link|embed|divider
    content    TEXT    NOT NULL DEFAULT '{}',  -- 타입별 JSON
    sort       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- 이미지(`image`)는 R2 프록시 경로(`/media/sites/{siteId}/{uuid}.webp`)만 허용. 업로드 시 Images 바인딩으로 **WebP로 변환**되어 저장되므로 확장자는 항상 `.webp`. 섹션 삭제·교체, 페이지 삭제(하위 포함), 사이트 삭제 시 해당 R2 객체도 정리.
- 임베드(`embed`)는 저장 원본을 렌더 시 `<script>`·이벤트핸들러 제거 후 표시(iframe 허용).

### `site_snapshots` — 게시 스냅샷 (공개의 유일한 소스)

```sql
CREATE TABLE site_snapshots (
    site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    path    TEXT    NOT NULL,   -- ''(홈) | '{a}' | '{a}/{b}'
    html    TEXT    NOT NULL,   -- 게시 시점 렌더된 완성 HTML
    rev     INTEGER NOT NULL,
    PRIMARY KEY (site_id, path)
);
```

- **게시(`POST /api/sites/:id/publish`)** 시 전 경로를 렌더해 스냅샷을 교체하고 `published_rev=rev`로 갱신. KV `pub:{slug}:{path}`에도 적재.
- **공개 서빙**은 KV → D1 스냅샷 순으로 조회(D1 렌더 왕복 없음). 미게시/비공개/미스는 404 안내.
- 편집(초안)은 공개에 영향을 주지 않으며, `GET /api/sites/:id/preview`로 소유자만 실시간 미리보기.

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

단축주소·설문지 생성 시 이 목록과 충돌하면 거부. 기본 예약어:

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
| `survey` | Survey Submit Route |

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
CREATE INDEX idx_urls_site_id      ON urls(site_id);
CREATE INDEX idx_click_logs_url_id ON click_logs(url_id);
CREATE INDEX idx_click_logs_created_at ON click_logs(created_at);
CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX idx_survey_responses_url_id ON survey_responses(url_id);
-- 페이지
CREATE INDEX idx_sites_owner        ON sites(user_id);
CREATE INDEX idx_site_pages_site    ON site_pages(site_id);
CREATE INDEX idx_site_pages_parent  ON site_pages(site_id, parent_id, sort);
CREATE INDEX idx_site_sections_pg   ON site_sections(page_id, sort);
CREATE INDEX idx_site_snapshots_site ON site_snapshots(site_id);
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
| `0007_add_affiliation_to_users.sql` | users.affiliation 컬럼 추가 |
| `0008_add_created_by_to_urls.sql` | urls.created_by 컬럼 추가 |
| `0009_add_survey_to_urls.sql` | urls.kind, urls.survey_config, urls.response_limit, urls.response_count 컬럼 추가; survey_responses 테이블 생성 |
| `0010_add_pages_feature.sql` | urls.site_id 추가; sites·site_pages·site_sections 테이블·인덱스 생성 (EduLink Pages) |
| `0011_publish_model.sql` | sites.published_rev·published_at 추가; site_snapshots(게시 스냅샷) 테이블 생성 |

### 새 마이그레이션 실행

```bash
# 로컬
npx wrangler d1 migrations apply edu-link-db

# 원격(프로덕션)
npx wrangler d1 migrations apply edu-link-db --remote

# 개별 파일 직접 실행(마이그레이션 추적 밖에서 적용할 때)
npx wrangler d1 execute edu-link-db --remote --file=migrations/0011_publish_model.sql
```

> **페이지 이미지용 R2 버킷**은 마이그레이션과 별개로 1회 생성 필요:
> `npx wrangler r2 bucket create edulink-pages-media` (바인딩명 `MEDIA`, `wrangler.jsonc` 참조)
