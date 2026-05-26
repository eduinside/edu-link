# 아키텍처

## 전체 구조

```
사용자 브라우저
      │
      ▼
Cloudflare Edge (글로벌 PoP)
      │
      ├─ run_worker_first: true ──▶ Workers Runtime (src/server/index.ts)
      │                                     │
      │                              ┌──────┼──────┐
      │                              ▼      ▼      ▼
      │                             D1    KV    Resend
      │                           (SQLite) (캐시)  (메일)
      │
      └─ 정적 자산 ──▶ Cloudflare Assets (dist/client/)
                         React SPA (React Router)
```

### 핵심 설계 포인트

**`run_worker_first: true`**
wrangler.jsonc의 핵심 설정. 이 옵션 없이는 Cloudflare가 모든 요청에 대해 SPA index.html을 먼저 반환하여 `/:slug` 리다이렉트가 전혀 동작하지 않음. 이 옵션으로 모든 요청이 Worker를 먼저 통과한 뒤, Worker가 `ASSETS.fetch()`로 넘겨야만 정적 파일이 서빙됨.

---

## 파일 구조

```
edu-link/
├── src/
│   ├── server/
│   │   ├── index.ts              # Hono 앱 — 모든 API 라우트 및 리다이렉트 핸들러
│   │   ├── env.d.ts              # Cloudflare 바인딩 타입 정의
│   │   ├── db/
│   │   │   └── schema.sql        # D1 전체 스키마 (정규화)
│   │   ├── middleware/
│   │   │   ├── auth.ts           # JWT + Cloudflare Access + 모의권한 미들웨어
│   │   │   └── rateLimit.ts      # KV 기반 고정 윈도우 Rate Limiter
│   │   └── utils/
│   │       └── slug.ts           # 슬러그 생성/검증 유틸
│   └── client/
│       ├── main.tsx              # React 진입점
│       ├── App.tsx               # React Router 라우팅 설정
│       └── pages/
│           ├── Landing.tsx       # 메인 페이지 (단축주소 생성 + 공개 링크 목록)
│           ├── Dashboard.tsx     # 사용자 대시보드 (링크 관리 + 통계)
│           └── NotFound.tsx      # 404 + 슬러그 full-reload 처리
├── migrations/                   # D1 마이그레이션 SQL 파일
├── docs/                         # 개발 문서 (이 폴더)
├── index.html                    # Vite SPA 진입점 (GA4 태그 포함)
├── wrangler.jsonc                # Cloudflare Workers 배포 설정
├── vite.config.ts                # Vite 빌드 설정
└── package.json
```

---

## 요청 흐름

### 1. 단축주소 리다이렉트 (`GET /abc123`)

```
브라우저 GET /abc123
    │
    ▼ Worker 진입 (run_worker_first)
    │
    ├─ KV.get('abc123') → HIT? ──▶ 307 redirect (Location: original_url)
    │                                   └─ Cache-Control: no-store
    │
    └─ KV MISS → D1 쿼리
        (base_slug OR custom_slug OR slug)
            │
            ├─ 없음 → ASSETS.fetch() → SPA → NotFound 렌더
            │
            ├─ 비밀번호 있음 → 비밀번호 입력 HTML 반환 (inline HTML)
            │
            ├─ 만료됨 → 비활성화 처리 후 / 리다이렉트
            │
            └─ 정상 → click_count++ & click_logs INSERT (waitUntil)
                        KV 캐싱 (만료/비밀번호 없는 경우만)
                        307 redirect
```

### 2. SPA 라우팅 (`GET /dashboard`, `GET /`)

```
브라우저 GET /dashboard
    │
    ▼ Worker 진입
    │
    ├─ reserved_slugs 체크 → 'dashboard' 예약됨
    │
    └─ ASSETS.fetch() → dist/client/index.html → React Router가 /dashboard 렌더
```

### 3. 외부 API 요청 (`POST /api/v1/shorten`)

```
외부 앱 POST /api/v1/shorten
  + Header: x-api-key: edulink_<key>
    │
    ▼ Worker → Hono 라우터
    │
    ├─ app.post('/api/v1/shorten', handler)  ← app에 직접 등록 (서브라우터 우회)
    │   └─ api.use('*', ...) 에서 /api/v1/ 경로는 authMiddleware 건너뜀
    │
    ├─ x-api-key SHA-256 해시 → D1 api_keys 조회 → level ≥ 3 확인
    ├─ 슬러그 생성/검증
    ├─ D1 INSERT (urls 테이블)
    └─ KV 캐싱 (만료/비밀번호 없는 경우)
        └─ { success: true, slug, short_url, original_url } 반환
```

> **구현 노트**: Hono에서 `api.use('*', authMiddleware())`가 `/api/*` 전체에 적용되므로,
> v1 엔드포인트를 `app.post('/api/v1/shorten', ...)` 으로 app에 직접 등록하고
> `api.use` 미들웨어에서 `/api/v1/` 경로를 명시적으로 skip 처리.

### 4. API 요청 (`POST /api/links`)

```
브라우저 POST /api/links
    │
    ▼ Worker → Hono 라우터
    │
    ├─ api.use('*', authMiddleware()) → JWT 쿠키 검증
    │
    └─ api.post('/links', handler)
        ├─ level 체크 (≥ 2 필요)
        ├─ custom_slug 중복/형식 검증
        ├─ base_slug 자동 생성 (6자 랜덤, 최대 10회 시도)
        ├─ og:title 자동 추출 (4초 timeout, best-effort)
        ├─ D1 INSERT
        └─ KV 캐싱 (만료/비밀번호 없는 경우)
```

---

## 슬러그 이중 구조

| 필드 | 설명 | 예시 |
|---|---|---|
| `base_slug` | 항상 자동 생성 6자리 랜덤, 불변 | `EHLGmC` |
| `custom_slug` | 사용자 직접 지정, 선택 사항 | `수학여행` |
| `slug` | 레거시 호환용 (= base_slug) | `EHLGmC` |

두 슬러그 모두 독립적으로 접속 가능. QR 코드는 항상 `base_slug` 기준으로 생성하여 커스텀 슬러그 변경과 무관하게 유지.

---

## 캐싱 전략

| 레이어 | 대상 | TTL |
|---|---|---|
| KV (`URL_CACHE`) | 만료·비밀번호 없는 활성 링크 URL | 영구 (링크 삭제/수정 시 즉시 무효화) |
| KV | OTP 코드 | 300초 (5분) |
| KV | Rate Limit 카운터 | windowSec × 2 |
| CF Assets | 정적 파일 (JS/CSS) | Vite 해시명으로 장기 캐시 |
| qrserver.com 프록시 | QR PNG | public, max-age=86400 |

---

## Rate Limiting

`src/server/middleware/rateLimit.ts` — KV 기반 고정 윈도우 방식

- 기본: IP당 분당 60회
- OpenAPI v1(`/api/v1/*`): API Key당 분당 15회
- KV 오류 시 바이패스 (서비스 중단 방지)
- 응답 헤더: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After`
