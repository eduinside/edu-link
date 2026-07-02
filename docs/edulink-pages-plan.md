# 에듀링크 페이지(EduLink Pages) — 구현 계획서 v2.0

> 핸드오프 문서 v0.1을 **실제 코드베이스 조사 결과로 검증·수정**한 확정 계획서.
> 대상: `edu-link` (Hono + React + Cloudflare Workers / D1 / KV).
> 조사 일자: 2026-06-30. 근거: `migrations/0001~0009`, `src/server/index.ts`, `src/server/middleware/auth.ts`, `src/server/utils/slug.ts`, `wrangler.jsonc`.

---

## 0. 핵심 결론 — 핸드오프 문서 v0.1의 가정 vs 실제 코드

핸드오프 문서는 스키마를 보기 전에 작성되어 **테이블·컬럼·스택 가정 다수가 실제와 다르다.** 아래 차이를 반영하지 않고 진행하면 마이그레이션이 깨지므로, 이 표가 계획의 출발점이다.

| 항목 | 문서 v0.1 가정 | 실제 코드 | 계획 반영 |
|---|---|---|---|
| 단축주소 테이블 | `links` | **`urls`** | `urls` 사용 |
| 슬러그 컬럼 | `links.slug` | `slug` + `base_slug` + `custom_slug` (3중 조회) | 기존 3중 조회 로직 재사용 |
| 소유자 FK | `owner_id` | **`user_id`** → `users(id)` | `user_id` 사용 |
| 타입 구분 | 신규 `type` 컬럼(`redirect`/`site`) | **이미 `kind` 컬럼 존재** (`link`/`survey`) | 신규 컬럼 ❌ → `kind`에 **`site`** 값 추가 |
| 회원 등급 | level 필드명 불명 | `users.level` INTEGER `CHECK(1,2,3,4)` (3=developer, 4=admin) | level3+ = **`level >= 3`** |
| 세션/인증 | "기존 세션 재사용"(추상) | `authMiddleware()` → `c.get('user')={id,email,name,affiliation,level}`. CF Access JWT + 자체 JWT 쿠키(`edulink_token`) | 그대로 호출, 신규 인증 없음 |
| 예약어 | 하드코딩 목록 | **DB 테이블 `reserved_slugs`** (동적). 이미 api/admin/dashboard/login/assets/static/public/favicon.ico 등록 | 테이블에 row 추가로 관리 |
| 캐시 | Functions Cache API | **KV `URL_CACHE`** (slug→destination 문자열) | KV 기반으로 재설계(§7) |
| 호스팅 | Pages + Pages Functions | **Workers** (`run_worker_first`, SPA asset fallback) | Workers 라우트로 구현 |
| 미디어 | R2 바인딩 존재 가정 | **R2 바인딩 없음** | 후순위 페이즈로 연기(Step 10) |
| 슬러그 규칙 | `^[a-z0-9-]{2,31}$`, 소문자 | `isValidCustomSlug`: **한글 허용, 4~20자** | 기존 규칙 재사용(소문자 강제 ❌) |
| HTML sanitizer | "서버 측 화이트리스트" | **의존성 없음** | v1은 sanitizer 대신 **제한 마크다운/플레인** 권장(§5) |

**가장 중요한 단순화:** 문서가 제안한 `type` 신규 컬럼은 불필요하다. 이미 설문 기능이 `kind='survey'`로 `urls` 한 테이블에 얹혀 catch-all 라우터(`src/server/index.ts:1863`)에서 `kind`로 분기한다. **사이트는 `kind='site'`라는 동일 패턴의 세 번째 케이스**일 뿐이며, 설문 구현이 그대로 청사진이 된다.

---

## 1. 기능 개요 + 확정된 사용자 결정

level3+ 회원이 폼 기반으로 간단한 공개 사이트를 만들어 `dgedu.link/{슬러그}` 및 하위 경로로 게시. 멀티테넌트(회원당 다수), 저장 즉시 공개, 단축주소 시스템과 슬러그 풀·관리 UI 공유.

확정 설계 결정(문서 §2)은 유지하되 #7만 수정: ~~`type='site'`~~ → **`kind='site'`**.

### 1.1 사용자 확정 사항 (이번 라운드)

1. **슬러그 부여 프로세스 = 설문/링크와 동일.** 생성 시 `base_slug`(6자리 무작위) 자동 부여 → 회원이 원하면 `custom_slug`로 원하는 주소 변경 가능. **단축주소 쿼터(=`urls` 풀·슬러그 네임스페이스)를 공유**한다. (참고: 현재 코드에 카운트형 쿼터는 없고 **레벨 게이트**만 있음 — 링크 `level≥2`, 사이트는 **`level≥3`**.)
2. **주소 형태 = 루트 경로 공유**, 커스텀 도메인 아님. `dgedu.link/{slug}/{depth1}/{depth2}` — **사이트 슬러그 아래 최대 2단계**(depth 0=홈, 1, 2). 3세그먼트 초과는 404.
3. **R2(이미지 업로드)는 후순위 페이즈로 연기.** 먼저 ① 사이트 관리 영역 ② 페이지 생성·타이틀 ③ 콘텐츠(text) ④ 임베드(youtube)까지만 구현. **스타일(테마)·업로드는 추후.**
4. **토큰 한도 대응**: 개발 단계를 작은·독립적·검증 가능한 증분으로 쪼개 여러 세션에 나눠 적용(§9).

---

## 2. 데이터 모델 (확정)

### 2.1 `urls` 확장 — 신규 컬럼 없이 기존 컬럼 활용

```sql
-- migrations/0010_add_pages_feature.sql
-- kind 컬럼은 이미 존재('link'|'survey'). 'site'를 세 번째 값으로 사용 — ALTER 불필요.
-- 사이트는 redirect 대상이 없으므로 original_url에 사이트 홈 경로 placeholder 저장(NOT NULL 제약 충족용).
ALTER TABLE urls ADD COLUMN site_id INTEGER;   -- kind='site'일 때 sites.id (역참조)
CREATE INDEX IF NOT EXISTS idx_urls_site_id ON urls(site_id);
```

- 기존 행은 `kind='link'` 유지(영향 없음).
- 슬러그 발급·유일성·예약어·소유자 검증은 **기존 `urls` 생성 로직 그대로 재사용**(별도 충돌검사 신설 금지).
- `original_url` NOT NULL 제약: 사이트 row는 `original_url`에 `'/' + slug` 같은 placeholder를 넣어 충족(리다이렉트에는 사용 안 함).

### 2.2 신규 테이블

```sql
CREATE TABLE IF NOT EXISTS sites (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,            -- 소유자 (users.id) — 문서의 owner_id 아님
  url_id        INTEGER NOT NULL,            -- 슬러그 보유 urls 행
  title         TEXT    NOT NULL,
  theme         TEXT    NOT NULL DEFAULT '{}',
  home_page_id  INTEGER,                     -- 첫 페이지 생성 후 설정(nullable)
  is_public     INTEGER NOT NULL DEFAULT 1 CHECK(is_public IN (0,1)),
  rev           INTEGER NOT NULL DEFAULT 0,  -- 캐시 무효화 리비전(§7)
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (url_id)  REFERENCES urls(id)  ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS site_pages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id    INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  parent_id  INTEGER REFERENCES site_pages(id) ON DELETE CASCADE,
  slug       TEXT    NOT NULL,
  title      TEXT    NOT NULL,
  depth      INTEGER NOT NULL DEFAULT 0,     -- 0~2
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (site_id, parent_id, slug)
);

CREATE TABLE IF NOT EXISTS site_sections (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id    INTEGER NOT NULL REFERENCES site_pages(id) ON DELETE CASCADE,
  type       TEXT    NOT NULL,               -- text|image|youtube|heading|divider|link
  content    TEXT    NOT NULL DEFAULT '{}',  -- JSON(§4)
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sites_user        ON sites(user_id);
CREATE INDEX IF NOT EXISTS idx_site_pages_site   ON site_pages(site_id);
CREATE INDEX IF NOT EXISTS idx_site_pages_parent ON site_pages(site_id, parent_id, sort);
CREATE INDEX IF NOT EXISTS idx_site_sections_pg  ON site_sections(page_id, sort);
```

> 테이블명을 `pages`/`sections`이 아닌 **`site_pages`/`site_sections`**로 잡은 이유: 단일 D1 공유 DB라 일반명은 향후 충돌 위험. byeduin 네임스페이스 컨벤션에 맞춤.

### 2.3 depth ↔ URL 세그먼트 규칙 (구현 확정)

사용자 주소 형태는 `/{siteSlug}/{depth1}/{depth2}` — **경로 세그먼트 최대 2개**. 경로는 페이지의 조상 슬러그 체인이다. 따라서 내부 0-인덱스 depth와 세그먼트 수는 다음과 같이 매핑된다:

| 내부 depth (0-index) | URL | 사용자 표기 |
|---|---|---|
| 0 (최상위, `parent_id IS NULL`) | `/{slug}/{a}` (1세그먼트) · 홈이면 `/{slug}` (bare) | subpage-depth1 |
| 1 (자식) | `/{slug}/{a}/{b}` (2세그먼트) | subpage-depth2 |

- 따라서 **내부 `MAX_DEPTH = 1`** (0,1만 허용). 생성·이동 시 `parent.depth + 1 <= 1` 검증, 위반 422. 이동 시 **하위 트리 높이까지** 합산해 한도 검증(`newDepth + subtreeHeight <= 1`), 사이클(자기/후손을 상위로) 방지.
- 사이트 홈: `sites.home_page_id` → NULL이면 `parent_id IS NULL` 중 `sort` 최소 페이지. 홈은 bare `/{slug}`로도 노출.
- 닭-달걀: 사이트 생성 시 `home_page_id=NULL`, 첫 페이지 생성 시 자동 지정. 홈 삭제 시 남은 최상위 첫 페이지로 재지정.

---

## 3. 라우팅 (실제 catch-all 구조에 통합)

현재 라우터는 **단일 세그먼트** `/:slug` (`src/server/index.ts:1863`) 하나뿐이며 `kind`로 분기한다. 사이트는 **하위 경로**가 필요하므로 두 가지를 추가한다.

```
1) GET /:slug            → 기존 핸들러에 kind='site' 분기 추가 → 사이트 홈 렌더
2) GET /:slug/:p1{...}   → 신규 핸들러: 사이트 하위 페이지 렌더 (최대 3 세그먼트)
   ※ app.all('*') (index.ts:2018) 보다 반드시 먼저 등록
```

분기 로직(기존 흐름 재사용):
```
slug 정규화(NFC) → reserved_slugs 체크(SPA 보호) → KV/D1 조회(base/custom/slug)
  kind='survey' → (기존) 설문 렌더
  kind='site'   → sites WHERE url_id=urls.id, is_public=1 (아니면 404/홈리다이렉트)
                  rest 경로 파싱 → 페이지 조회 → 섹션 로드 → HTML 렌더
  그 외(link)   → (기존) 307 리다이렉트
```

- 경로 파싱: `""→home`, `"a"→depth0`, `"a/b"→a의자식`, `"a/b/c"→b의자식`, 4세그먼트↑ 또는 미스 → 404.
- **예약어**: 사이트는 자기 슬러그 1개만 점유하고 하위 경로는 그 아래라 추가 예약어 불필요. 단 사이트 슬러그 발급도 기존 `reserved_slugs` 검증을 그대로 통과해야 함.

---

## 4. 섹션 content 스펙 (JSON, camelCase)

문서 §6과 동일하되 **text 섹션 처리 방식만 안전하게 변경**(§5 참조). **이번 구현 범위는 `text`·`youtube` 두 타입.** 나머지는 후순위 페이즈.

```jsonc
// [이번 범위] text   — 제한 마크다운/플레인텍스트(원본 저장, 렌더 시 고정 태그로 변환)
{ "text": "마크다운 원문", "format": "markdown" }
// [이번 범위] youtube
{ "videoId": "dQw4w9WgXcQ", "title": "", "start": 0 }   // 렌더: youtube-nocookie iframe만

// ───── 이하 후순위 페이즈 ─────
// heading   { "text": "소제목", "level": 2 }   // level ∈ {2,3}
// divider   {}
// link      { "label": "신청하기", "url": "https://...", "style": "button", "newTab": true } // style ∈ link|button
// image     (R2 도입 후) { "url": "<R2공개도메인>/sites/<id>/<rand>.webp", "alt": "", "caption": "", "width": "normal" }
```

검증: 모든 URL 스킴/도메인 검증. youtube는 youtube.com/youtu.be에서 videoId 추출(그 외 도메인 거부). image는 R2 도입 시 자체 공개도메인만(핫링크 차단).

> `site_sections.type`은 향후 타입 확장을 위해 자유 TEXT로 두되, **API에서 허용 타입 화이트리스트**(`text`,`youtube` → 페이즈별 확대)로 검증한다.

---

## 5. 보안 — text 섹션 처리 결정 (핸드오프 문서와의 핵심 차이)

문서 §6/§11은 "서버 측 화이트리스트 HTML sanitizer"를 전제하나, **프로젝트에 sanitizer 의존성이 없다.** Workers 환경에서 `sanitize-html`은 Node 의존이 있어 `nodejs_compat`로 동작 가능성은 있으나 번들·엣지케이스 리스크가 있다. 따라서:

- **v1 권장: 임의 HTML 입력을 받지 않는다.** text 섹션은 **제한 마크다운(굵게/기울임/링크/목록/인용/줄바꿈)** 또는 플레인텍스트로 저장하고, **서버 렌더러가 고정된 허용 태그 집합으로만** HTML을 생성한다. 사용자 HTML이 출력에 끼어들 경로 자체를 없애 XSS 표면을 제거.
- 링크 자동 변환 시 `http/https`만 허용, 그 외 스킴 제거.
- 이렇게 하면 문서 §6의 "허용 태그/금지 태그" 목록은 **렌더러 출력 화이트리스트**로 의미가 바뀐다(입력 정화가 아니라 출력 생성 제한).
- Phase 2에서 리치 편집이 정말 필요하면 그때 검증된 sanitizer 도입을 별도 검토.

기타 보안(문서 §11 유지): 슬러그/페이지슬러그 규칙·형제 유일성, 외부 URL 도메인 검증(googleFont/link/image), youtube nocookie, R2 크기·MIME 제한·키 무작위화, **모든 mutation에서 소유권 서버 재확인**(클라이언트 `site_id` 신뢰 금지).

---

## 6. 미디어 / R2 — **후순위 페이즈로 연기**

> 사용자 결정에 따라 **이번 범위에서 제외.** image 섹션·업로드 API는 R2 도입 페이즈에서 구현한다. 아래는 그때 수행할 작업 메모.

도입 시:
1. R2 버킷 생성(예: `edulink-pages-media`) + `wrangler.jsonc` `r2_buckets` 바인딩(예: `MEDIA`) + `npm run cf-typegen`.
2. 공개 접근 방식 결정 — R2 public bucket vs 커스텀 도메인 vs Worker 프록시. → image URL 검증·렌더 기준 확정.
3. `POST /api/sites/:id/media` multipart → R2 직접 저장. 키 `sites/{siteId}/{uuid}.{ext}`. 제약 5MB, MIME `image/jpeg|png|webp|gif`(SVG 제외), 확장자 무작위화.

**그때까지**: 섹션 타입에서 `image` 제외, 렌더러도 `image` 케이스 미구현. 후속 추가가 쉽도록 `site_sections.type`은 TEXT 자유값 유지(§4).

---

## 7. 렌더링 & 캐시 (KV 기반 재설계)

문서는 Cache API를 가정하나 실제는 KV `URL_CACHE`(현재 slug→destination 문자열). 사이트 슬러그를 같은 키 공간에 destination으로 넣으면 의미 충돌하므로:

- **v1: 사이트 슬러그는 `URL_CACHE`에 destination을 넣지 않는다**(리다이렉트 캐시 로직이 사이트를 오인하지 않도록). 사이트 렌더는 요청마다 D1 조회 → HTML 생성(초기 규모에서 충분).
- **Phase 2 캐시**: 별도 KV 키 네임스페이스 `site:{slug}:{rev}:{path}`에 렌더된 HTML 저장. 어떤 변경(페이지/섹션/테마/제목)이든 트랜잭션 끝에 `sites.rev += 1` → 구버전 키 자연 소멸(purge 불필요).
- `is_public=0`/사이트 삭제 시 즉시 404(캐시 우회).
- 렌더러는 **구조화 데이터→템플릿** 방식만(임의 HTML 주입 경로 없음, §5).

---

## 8. API 명세 (편집)

공통 가드: `authMiddleware()` 적용 → **`user.level >= 3`** → 대상 사이트 `user_id === user.id` 재확인. 기존 `adminMiddleware`(level===4) 패턴을 본떠 `level3Middleware()` 추가 권장. 슬러그 변경은 §1.1처럼 `custom_slug` 수정으로 처리(기존 링크/설문 PATCH 로직 재사용).

| 범위 | 메서드 | 경로 | 설명 |
|---|---|---|---|
| ✅이번 | GET | `/api/sites` | 내 사이트 목록 |
| ✅이번 | POST | `/api/sites` | 생성(= urls에 kind='site', base_slug 자동발급 + sites row, 트랜잭션) |
| ✅이번 | GET | `/api/sites/:id` | 상세(페이지 트리) |
| ✅이번 | PATCH | `/api/sites/:id` | title/custom_slug(주소변경)/is_public/home_page_id |
| ✅이번 | DELETE | `/api/sites/:id` | 삭제(+ urls 행/슬러그 회수) |
| ✅이번 | POST | `/api/sites/:id/pages` | 페이지 생성(title/slug, depth 검증) |
| ✅이번 | PATCH | `/api/pages/:id` | title/slug/이동(parent_id) |
| ✅이번 | DELETE | `/api/pages/:id` | 삭제(cascade) |
| ✅이번 | GET | `/api/pages/:id` | 페이지 + 섹션 |
| ✅이번 | POST | `/api/pages/:id/sections` | 섹션 추가(text/youtube) |
| ✅이번 | PATCH | `/api/sections/:id` | content 수정 |
| ✅이번 | DELETE | `/api/sections/:id` | 삭제 |
| ✅이번 | POST | `/api/sections/reorder` | 섹션 정렬(페이지 내) |
| 후순위 | POST | `/api/pages/reorder` | 페이지 형제 정렬 일괄 |
| 후순위 | PATCH | `/api/sites/:id` (theme) | 테마 커스텀 |
| 후순위 | POST | `/api/sites/:id/media` | 이미지 → R2 → 공개 URL |

모든 쓰기 성공 시 해당 `sites.rev += 1`(v1은 캐시 미사용이라 표시만, Phase 캐시 도입 시 활용). 라우트는 `/api/*` 그룹(기존 컨벤션)에 등록하되 catch-all `/:slug`보다 위에 위치하므로 순서 문제 없음(예약어 `api` 등록됨).

---

## 9. 빌드 단계 (토큰 한도 대응 — 작은 증분으로 분할)

각 **Step은 독립적으로 적용·검증 가능한 단위**로 쪼갰다. 한 세션에서 한두 Step씩 진행하고, 매 Step 끝에 `npm run test`/`wrangler:dev`로 확인 후 커밋한다. R2·테마는 이번 범위 밖(Step 9~).

### 이번 범위 (사이트 관리 + 페이지/타이틀 + 콘텐츠 + 임베드)

**Step 1 — DB 마이그레이션** ⟶ *백엔드, 독립*
- `migrations/0010_add_pages_feature.sql`: `urls.site_id` 추가 + `sites`/`site_pages`/`site_sections` + 인덱스(§2).
- `src/server/db/schema.sql`에도 반영(현재 stale 상태이므로 함께 정리, A-잔여 점검).
- 검증: 로컬 D1에 적용, 테이블 생성 확인.

**Step 2 — 권한 미들웨어 + 사이트 CRUD API** ⟶ *백엔드*
- `level3Middleware()` 추가(`adminMiddleware` 패턴).
- `GET/POST/PATCH/DELETE /api/sites` : 생성 시 `base_slug` 자동발급(기존 `generateRandomSlug`+충돌검사 재사용) → `urls(kind='site')` + `sites` **단일 트랜잭션**. PATCH의 `custom_slug` 변경은 기존 링크 PATCH 로직 이식. 모든 라우트 소유권 재확인.
- 검증: `x-mock-role: developer`로 CRUD 호출 curl 테스트.

**Step 3 — 페이지 CRUD API (depth ≤ 2)** ⟶ *백엔드*
- `POST /api/sites/:id/pages`, `PATCH/DELETE/GET /api/pages/:id`. `parent.depth+1<=2` 검증(위반 422), 형제 내 slug 유일, 첫 페이지 생성 시 `home_page_id` 설정.
- 검증: depth 위반·중복 slug 거부 확인.

**Step 4 — 섹션 CRUD API (text/youtube)** ⟶ *백엔드*
- `POST /api/pages/:id/sections`, `PATCH/DELETE /api/sections/:id`, `POST /api/sections/reorder`.
- content 검증: 타입 화이트리스트(`text`,`youtube`), youtube videoId 추출/도메인 검증, text는 저장만(렌더 단계서 정화).
- 검증: 잘못된 타입·videoId 거부.

**Step 5 — 공개 렌더 라우트** ⟶ *백엔드, Step 1~4 의존*
- catch-all `/:slug`에 `kind='site'` 분기 추가(홈 페이지 렌더).
- 신규 `/:slug/:p1`, `/:slug/:p1/:p2` 라우트(`app.all('*')` 앞 등록), 경로→페이지 매핑, 4세그먼트↑/미스 404, `is_public=0`→404.
- 렌더러: 구조화 데이터→고정 템플릿(text=제한 마크다운→허용 태그, youtube=nocookie iframe). Pretendard/파스텔 기본 인라인 스타일.
- 검증: 생성한 사이트를 브라우저/`preview`로 홈·1뎁스·2뎁스 접속 확인.

**Step 6 — Dashboard 사이트 목록/생성 UI** ⟶ *프론트, Step 2 의존*
- `src/client/pages/` 에 사이트 탭 추가(기존 `SurveyTab.tsx` 패턴). 목록·생성·주소(custom_slug)변경·삭제·공개토글.

**Step 7 — Dashboard 페이지 트리 UI** ⟶ *프론트, Step 3 의존*
- 페이지 추가/이름변경/삭제/이동(depth 표현), 홈 지정.

**Step 8 — Dashboard 섹션 편집 UI** ⟶ *프론트, Step 4 의존*
- 섹션 추가(text 에디터/youtube URL 입력)·정렬·삭제. 저장 즉시 공개 확인.

> Step 1→5(백엔드)와 6→8(프론트)은 의존만 지키면 순서 유연. 토큰 여유에 따라 Step 단위로 분할 진행.

### 후순위 페이즈 — ✅ 완료
- **Step 9 — 스타일/테마**: 색상 토큰 + 구글폰트(fonts.googleapis.com 도메인검증) + 헤더/내비(top|side), heading/divider/link 섹션, 페이지 reorder. 대시보드에 디자인 패널·섹션 추가 버튼·페이지 정렬 UI.
- **Step 10 — 미디어/R2**: `wrangler.jsonc` MEDIA 바인딩 + 업로드 API(`POST /api/sites/:id/media`, 5MB·MIME 화이트리스트·키 무작위화) + `/media/*` R2 프록시 서빙 + image 섹션(자체 /media URL만 허용). **운영 배포 전 R2 버킷 생성 필요**: `wrangler r2 bucket create edulink-pages-media`.
- **Step 11 — 캐시/정교화**: `site:{slug}:{rev}:{path}` KV 캐시(렌더 결과, 1일 TTL 안전망) + rev 증가로 자연 무효화. is_public=0/삭제는 캐시 이전 단계에서 404.

> 배포 시 운영 D1 마이그레이션: `wrangler d1 execute edu-link-db --remote --file=migrations/0010_add_pages_feature.sql`

---

## 10. 미해결·확인 필요 (Open Questions) — 갱신본

핸드오프 §13은 **본 조사 + 사용자 결정으로 모두 해소**됨.

- **A. (해소) 스키마** — 테이블 `urls`, 슬러그 3중(`slug`/`base_slug`/`custom_slug`), 소유자 `user_id`, 등급 `users.level`(3=dev), 세션 `authMiddleware()`/`c.get('user')`. → 본 계획 반영 완료.
  - **A-잔여(비차단)**: `affiliation` 컬럼이 `auth.ts`/생성 쿼리에서 쓰이나 `migrations/`·`schema.sql`엔 없음(추적되지 않은 ALTER 추정). Step 1에서 `schema.sql` 정리할 때 함께 점검.
- **B. (해소) R2** — 후순위 페이즈로 연기(Step 10). 이번 범위 제외. 공개 접근 방식은 그때 결정.
- **C. (해소) 슬러그/쿼터** — 단축주소 풀(`urls`) 공유, 별도 카운트 쿼터 없음. 게이트는 **`level≥3`**. 생성 시 `base_slug` 자동 + `custom_slug` 변경 가능(설문/링크와 동일 플로우).
- **D. (해소) 주소 형태** — `dgedu.link/{slug}/{depth1}/{depth2}`, 루트 경로 공유(커스텀 도메인 아님), depth 최대 2.

---

## 11. byeduin 컨벤션 준수
JSON camelCase, 파일명 kebab-case, 파스텔 라이트 + Pretendard 기본, Cloudflare Workers/D1/R2/KV 스택, 단일 책임 모듈, 시크릿은 바인딩/환경변수로만.

---

## 12. 사용성 개선 계획 v2 — 테스트 운영 피드백 반영 (2026-07-01)

> 테스트 버전(`dgedu.link/7fmKH3`, 상위 2·하위 1페이지) 운영 피드백과 실측·소스 진단을 바탕으로 한 보완계획.
> **구현은 Opus가 Step 단위로 수행. 본 절이 유일한 스펙이므로 재조사 없이 착수 가능하도록 상세히 기술.**

### 12.0 사용자 확정 결정

| # | 항목 | 결정 |
|---|---|---|
| 1 | 게시 방식 | **초안→게시 버튼 방식**(구글 사이트형). 편집은 초안으로 자동저장, '게시' 시 스냅샷 공개. **미게시 변경이 있음을 편집기에 항상 표시** |
| 2 | 편집기 | **전용 편집기 + 실시간 미리보기**(대시보드 탭에서 분리된 전체화면) |
| 3 | 느린 지점 | 공개 접속·편집 반응·수정→공개 반영·대시보드 로딩 **전부** 해당 |
| 4 | R2 버킷 | **미생성** → 운영에서 이미지 업로드 현재 불가. 인프라 절차 포함(§12.7) |

### 12.1 실측·소스 진단 (2026-07-01 기준)

**A. 공개 페이지 접속 (실측 0.7~1.0초/요청, 재요청도 0.7초)**
- `CF-RAY: …-LAX` — 무료 플랜의 한국 트래픽이 **미국 LA 엣지로 라우팅**. Worker↔D1 왕복마다 태평양 횡단.
- 응답에 **`Cache-Control` 헤더 없음** → 브라우저·엣지 캐시 전무. HTML 3.9KB로 페이로드는 문제 아님 — **왕복 횟수가 문제**.
- 렌더 경로 D1 쿼리 **직렬 4회**(`siteRender.ts`: urls 조회→sites JOIN→site_pages 전체→site_sections) + 하위 경로는 `reserved_slugs` 조회 1회 추가(`index.ts` `handleSiteSubPage`) = 최대 5왕복.
- KV 캐시 히트여도 LAX 콜드 리드 + TLS 왕복으로 0.7초 유지.

**B. 편집기 조작 반응**
- 매 API 요청마다 `authMiddleware`가 **users SELECT 1회**(auth.ts, 4개 경로) + 매 쓰기마다 `bumpRev` UPDATE 1회(sites.ts 내 9곳).
- 클라이언트는 mutation 성공 후 **전체 refetch**(`openEditorKeepPage`/`selectPage` 패턴 12곳) — 요청 1회가 실제로는 3~4회 왕복.
- `prompt()/confirm()` **17곳** — 브라우저 블로킹 다이얼로그라 체감 품질 최악 + 모바일 어색.
- 사이트 생성 시 `loadReservedSet`(전 테이블) + `slugTaken` 최대 10회 직렬 조회.

**C. 대시보드/편집기 로딩**
- 단일 번들 **JS 529KB + CSS 417KB**, `Dashboard.tsx` 3,300라인 모놀리스에 PagesTab 포함 — 코드 스플리팅 없음.

**D. 수정→공개 반영 지연**
- rev 키 캐시는 즉시 무효화되지만, KV의 엣지 간 전파(최대 60초) + 캐시 헤더 부재 + LAX 왕복이 겹쳐 "저장했는데 안 바뀜" 체감. → **게시제 전환으로 반영 시점 자체를 명시적 행위로 변경**(근본 해소).

**E. 내비게이션/UX 구조**
- 공개 내비에 **최상위 페이지만 노출**(`renderNav`가 `parent_id===null`만 필터) — **하위 페이지는 URL을 알아야만 접근 가능**. "하위가 상위 밑에 보이는" 혼란은 편집기 트리(들여쓰기)와 공개 내비 부재가 겹친 결과 → 공개 내비에 드롭다운/트리로 명시 노출해 별도 페이지임을 드러냄.
- 편집 진입점 불명확: 목록 카드의 '관리' 버튼이 페이지 편집기임이 드러나지 않음.
- 페이지·섹션 설정이 호버 마이크로버튼에 흩어져 "버튼을 일일이" 눌러야 함.

### 12.2 게시 모델 설계 (아키텍처 변경 핵심)

**데이터 (migration 0011)**
```sql
ALTER TABLE sites ADD COLUMN published_rev INTEGER NOT NULL DEFAULT 0; -- 0=미게시
ALTER TABLE sites ADD COLUMN published_at  TEXT;
CREATE TABLE IF NOT EXISTS site_snapshots (          -- 게시된 완성 HTML (공개의 유일한 소스)
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  path    TEXT    NOT NULL,                          -- ''(홈) | 'a' | 'a/b'
  html    TEXT    NOT NULL,
  rev     INTEGER NOT NULL,
  PRIMARY KEY (site_id, path)
);
```

**게시 API — `POST /api/sites/:id/publish`**
1. 소유권·level3 가드 → 사이트 전 페이지를 서버 렌더러로 일괄 렌더(기존 `renderPage` 재사용).
2. `site_snapshots` UPSERT(전 경로) + 사라진 경로 행 삭제 → `published_rev = rev`, `published_at` 갱신.
3. KV에 `pub:{slug}:{path}` 로 HTML 저장(내구 저장 겸 캐시). 슬러그 변경 시 이전 슬러그 키 삭제(경로 목록은 snapshots에서 열거).
4. 응답에 게시된 경로 수 반환.

**공개 라우트 전환 (`index.ts` + `siteRender.ts`)**
```
GET /{slug}[/p1[/p2]]  (kind='site')
  1) KV get pub:{slug}:{path}  → 히트: 즉시 응답 (D1 0회)
  2) 미스: D1 site_snapshots 1회 조회 → 응답 + KV 재적재(waitUntil)
  3) 스냅샷 없음(미게시/비공개): 404 안내 페이지("아직 게시되지 않은 페이지")
  응답 헤더: Cache-Control: public, max-age=60, stale-while-revalidate=600
  + Cloudflare Cache API(caches.default)에 저장, 게시 시 해당 URL purge
```
- 기존 실시간 렌더 경로(`renderSiteById`의 D1 4쿼리)는 **초안 미리보기 전용**으로 강등(§12.3).
- `is_public` 의미 정리: 게시 여부는 `published_rev>0`, `is_public=0`은 **게시 중단**(스냅샷 서빙 차단 + KV `pub:` 키 삭제).
- 미게시 변경 감지: **`rev > published_rev`** → 편집기 상단에 "게시 필요" 배지 + 게시 버튼 강조.

### 12.3 전용 편집기 설계 (`/dashboard/sites/:id`)

**라우팅/로딩**: React Router 신규 라우트, `React.lazy` + `Suspense`로 **에디터 청크 분리**(대시보드 최초 로딩 경량화). PagesTab은 목록·생성만 남기고 편집 기능 전부 이전.

**레이아웃 (3패널 + 상단바)**
```
┌──────────────────────────────────────────────────────────────┐
│ ← 나가기 | 사이트제목(인라인 편집) | ●저장됨 ✓ 14:02          │
│           [미리보기 ⌕] [디자인 🎨] [게시 ●변경 있음]  /slug 🔗 │
├─────────┬──────────────────────────┬─────────────────────────┤
│ 페이지   │ 섹션 편집(선택 페이지)     │ 실시간 미리보기(iframe)  │
│ 트리     │  + 콘텐츠 추가 바         │  모바일/PC 토글          │
└─────────┴──────────────────────────┴─────────────────────────┘
```
- 우측 미리보기는 토글 가능(좁은 화면은 오버레이). **초안 미리보기 엔드포인트** 신설: `GET /api/sites/:id/preview?path=…` — 인증+소유권 가드, 현재 D1 초안 상태를 기존 렌더러로 렌더(테마 미저장 상태도 쿼리 파라미터로 오버라이드 지원 → 디자인 패널 실시간 반영). iframe `src`로 연결, 저장 완료 이벤트마다 새로고침(디바운스).

**자동저장 + 상태 표시**
- 텍스트 섹션: 입력 **디바운스 800ms 자동 PATCH**(저장 버튼 제거). 기타 편집(제목·설정·정렬)은 즉시 PATCH.
- 전역 저장 인디케이터: `저장 중…`(스피너) → `저장됨 ✓ HH:MM` / 실패 시 `재시도` 버튼. 저장 실패분은 로컬 보존.
- **낙관적 업데이트로 전체 refetch 제거**: mutation 응답을 로컬 상태에 직접 반영(추가는 서버 반환 id 사용, 실패 시 롤백). `openEditorKeepPage` 전면 refetch 12곳 폐지.

**prompt/confirm 17곳 전면 제거 → 대체 매핑**
| 현행 | 대체 |
|---|---|
| 페이지 생성 prompt×2 | **페이지 생성 모달**: 제목 입력 → 슬러그 자동 생성(제목 정규화, 수정 가능), 위치(최상위/상위 선택) 드롭다운 |
| 이름변경/슬러그 prompt | 트리 노드 **더블클릭 인라인 편집** + 페이지 설정 팝오버(슬러그·홈지정·삭제 한곳에) |
| 삭제 confirm×4 | **삭제 확인 모달**(삭제 대상·하위 포함 경고 명시) |
| 유튜브/제목/버튼 섹션 prompt | **섹션 카드 내 인라인 폼**(입력+저장, 유튜브는 URL 붙여넣기 즉시 썸네일 확인) |
| 주소변경 prompt | 상단 `/slug 🔗` 클릭 → 주소 변경 모달(중복 실시간 검사) |
| 링크 style confirm | 인라인 폼의 버튼/링크 토글 |

### 12.4 공개 화면·내비 디자인 v2

- **상단 내비(top)**: 최상위 메뉴 + **하위 페이지 드롭다운**(hover/터치 클릭). **좌측 내비(side)**: 아코디언 트리(현재 페이지 경로 자동 펼침). 640px 이하 **햄버거 메뉴**(전체 트리).
- 현재 페이지 강조 + 상위 경로 브레드크럼(2단계 페이지).
- **테마 프리셋 5종**: SurveyTab `THEMES`(indigo/emerald/rose/amber/sky) 색상을 사이트 테마 프리셋으로 재사용 — 디자인 패널을 "프리셋 카드 5개(원클릭) + 고급(개별 색·구글폰트)" 2단 구성으로 재편.
- 공개 페이지 기본 디자인 다듬기: 헤더(사이트 제목+내비) 스티키, 본문 카드 여백·타이포 정리, 섹션 간격 리듬, 푸터 간결화, 다크 배경 유튜브 라운드 유지. 목표: "기본값만으로 수려".

### 12.5 성능 세부 작업 (게시제와 별개로 즉효)

1. **Smart Placement**: `wrangler.jsonc`에 `"placement": { "mode": "smart" }` — Worker를 D1 인접 리전으로 이동시켜 편집 API의 쿼리 왕복 단축(무료 플랜 가용, 1줄).
2. **편집 API 왕복 축소**: `bumpRev`를 각 핸들러의 본 쿼리와 `DB.batch()`로 묶기(9곳). base_slug 발급은 후보 10개를 `WHERE slug IN(…)` 1회 검사로. `reserved_slugs`는 요청당 1회만 로드.
3. **공개 응답 캐시 계층**: §12.2의 Cache-Control + Cache API. `/media/*`는 기존 immutable 유지.
4. **번들 분할**: 에디터 lazy 청크(§12.3) + 가능하면 SurveyTab도 lazy(동일 패턴, 부수 효과 최소).
5. (선택) authMiddleware의 users SELECT를 JWT 페이로드(level 포함, 서명됨) 신뢰로 대체 가능 — 등급 변경 반영이 토큰 만료까지 지연되는 트레이드오프 있으므로 **보류, 기록만**.

### 12.6 구현 단계 (Step 12~17, Opus 실행용 — 각 Step 독립 커밋)

**Step 12 — 인프라 + 즉효 성능** ⟶ ✅ 완료(2026-07-02)
- Smart Placement(`wrangler.jsonc` `placement.mode=smart`), base_slug 후보 12개 1회 검사(`takenSlugSet`/`issueBaseSlug`).
- 공개 응답 `Cache-Control: public, max-age=60, stale-while-revalidate=600`(§13 스냅샷 서빙에 통합).
- R2 버킷 생성은 **인프라 미완**(§12.7, 계정 인증 필요) — 코드/바인딩은 준비됨.
- (보류) bumpRev batch화: 게시제 도입으로 편집 왕복보다 게시 시점이 핵심이 되어 우선순위 낮춤. Smart Placement로 왕복 지연 자체가 감소.

**Step 13 — 게시 모델(백엔드) + 최소 게시 UI** ⟶ ✅ 완료(2026-07-02)
- migration 0011(`sites.published_rev`/`published_at` + `site_snapshots`).
- `POST /api/sites/:id/publish`(전 경로 렌더→스냅샷 D1 교체 + KV `pub:{slug}:{path}` 적재), `GET /api/sites/:id/preview`(초안 실시간+테마 오버라이드).
- 공개 라우트를 **스냅샷 서빙**으로 전환(KV→D1, 미게시/비공개 404 안내). is_public=0 → 게시중단(KV 삭제+D1 gate). 콘텐츠 변경만 rev 증가(is_public 토글 제외).
- PagesTab에 게시 버튼·미게시/게시필요/게시됨 배지·미게시 배너(게시 필요 안내) 추가.
- 검증(로컬): 게시 전 404 → 게시 후 200+Cache-Control → 수정 시 공개 불변(초안 격리) + preview는 초안 반영 → 재게시 반영 → is_public 토글 404/200. UI: 배지·게시버튼·공개 서빙 확인.
> ⚠️ 배포 시 주의: 공개 서빙이 스냅샷 기반으로 바뀌어 **기존 미게시 사이트는 게시 전까지 404**. 배포 후 각 사이트 1회 게시 필요.

**Step 14 — 전용 편집기 셸** ⟶ ✅ 완료(2026-07-02)
- `/dashboard/sites/:id` React.lazy 라우트(App.tsx `Suspense`) — 편집기 31KB 별도 청크로 분리, 메인 번들 529KB→508KB.
- `SiteEditor.tsx`: 3패널(페이지 트리 · 섹션 편집 · 미리보기), 상단바(제목 인라인편집·저장 인디케이터·디자인·주소변경·공개열기·게시버튼+배지).
- **미리보기는 iframe `srcDoc`**: `GET /api/sites/:id/preview`를 getHeaders로 인증 fetch(dev=헤더/prod=쿠키) 후 주입 → 양쪽 모두 동작. 저장/페이지전환 시 디바운스 재요청, PC/모바일 폭 토글.
- PagesTab은 목록/생성/진입("편집" 버튼 → navigate)으로 축소. 생성 즉시 편집기 이동.

**Step 15 — 편집 UX 리팩터** ⟶ ✅ 완료(2026-07-02)
- **prompt/confirm/alert 0개**(grep 확인): 페이지 생성/편집 모달(제목→슬러그 자동생성, 한글 허용), 삭제 확인 모달, 주소변경 모달, 섹션은 카드 내 **인라인 폼**(텍스트=자동저장 textarea, 제목/유튜브/버튼/이미지=인라인 입력·onBlur 저장, 유튜브 썸네일 프리뷰).
- **자동저장 + 저장 인디케이터**(저장 중…/저장됨 HH:MM/실패) 전역 표기. 텍스트 800ms 디바운스.
- **낙관적 업데이트**로 전체 refetch 폐지: 섹션·페이지 추가/삭제/이동을 로컬 상태 직접 갱신(서버 반환 id 사용). 페이지 삭제는 후손까지 로컬 제거.
- 디자인 모달에 **프리셋 5종**(인디고/에메랄드/로즈/앰버/스카이) + 색상 직접지정, 변경 시 theme 오버라이드로 미리보기 실시간 반영.
- 검증(dev preview): 편집기 로드·미리보기 렌더(환영/`<strong>`)·페이지모달+자동슬러그(행사 안내→행사-안내)·섹션추가·저장인디케이터·게시("게시됨")·공개서빙. 스크린샷 도구는 srcDoc iframe 캡처에서 타임아웃(제품은 정상 응답, eval로 전 기능 확인).

**Step 16 — 내비/디자인 v2** ⟶ ✅ 완료(2026-07-02)
- 공개 렌더 내비를 **CSS-only 상호작용**(정적 스냅샷 제약)으로 재작성: 상단=최상위+하위 **드롭다운**(hover/focus-within), 좌측=**아코디언**(항상 펼침 들여쓰기), 모바일 **햄버거**(checkbox 토글).
- **브레드크럼**(홈 › 상위 › 현재) — depth1 페이지에 표시. → 하위가 상위 밑에 묻히지 않고 별도 페이지로 도달·인지 가능.
- 프리셋 5종은 편집기 디자인 모달에 이미 반영(Step 15).
- 검증(로컬): 드롭다운(`nav-sub`/`has-sub`/`nav-caret`)·햄버거(`nav-toggle`)·브레드크럼(`crumb`) 마크업 확인.

**Step 17 — 마무리·재실측** ⟶ ✅ 완료(2026-07-02)
- 엣지케이스 검증(로컬): **홈 삭제 시 남은 최상위로 재지정**(about 삭제→notice 홈), **게시 중 슬러그 변경**(구 슬러그는 SPA 폴백, 신 슬러그는 재게시 후 정상 링크 반영).
- 편집기 트리는 들여쓰기+코너아이콘으로 하위 페이지 구분(별도 페이지임 명확).
- 성능 재실측: 게시제+Smart Placement+캐시헤더 배포 후 §12.1 대비 측정 권장(공개=스냅샷 KV 1왕복).

### 12.7 인프라 체크리스트 (코드 외, 계정 인증 필요)

```bash
wrangler r2 bucket create edulink-pages-media                     # R2 (미생성 확인됨)
wrangler d1 execute edu-link-db --remote --file=migrations/0011_publish_model.sql
```
- 운영 D1의 0010은 적용 완료(테스트 페이지 동작으로 확인).
- 한국 접속 라우팅(LAX)은 무료 플랜 특성 — Smart Placement+캐시로 완화하되, 잔여 지연 시 유료 플랜 검토는 운영 판단 사항으로 기록.

---
*v2.0 — 테스트 운영 피드백 진단(실측 포함) + 게시제 전환·전용 편집기·내비/디자인 v2 보완계획(Step 12~17) 추가. 구현은 Opus가 Step 단위로 수행.*
