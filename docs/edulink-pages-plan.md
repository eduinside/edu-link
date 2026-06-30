# 에듀링크 페이지(EduLink Pages) — 구현 계획서 v1.0

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

### 2.3 3depth 규칙 (문서 §4.3 유지)

- `depth ∈ {0,1,2}`. 페이지 생성·이동 시 `parent.depth + 1 <= 2` 서버 검증, 위반 422.
- 사이트 홈: `sites.home_page_id` → NULL이면 `parent_id IS NULL` 중 `sort` 최소 페이지.
- 닭-달걀 문제: 사이트 생성 시 `home_page_id=NULL`로 만들고, 첫 페이지 생성 트랜잭션 끝에 `home_page_id` 설정.

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

### 후순위 페이즈 (이번 범위 밖)
- **Step 9 — 스타일/테마**: 색상 토큰 + 구글폰트(도메인검증) + 헤더/내비(top|side), heading/divider/link 섹션, 페이지 reorder UI.
- **Step 10 — 미디어/R2**: 버킷·바인딩 세팅(§6) + image 섹션·업로드 API.
- **Step 11 — 캐시/정교화**: `site:{slug}:{rev}:{path}` KV 캐시 + 엣지케이스(404/권한)·정화 강화.

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
*v1.1 — 실제 스키마 검증 + 사용자 결정(슬러그 풀 공유 / 루트경로 depth2 / R2·테마 연기 / 토큰분할) 반영 완료. Step 1부터 착수 가능.*
