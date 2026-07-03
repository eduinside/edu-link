# API 레퍼런스

## 기본 정보

- **Base URL**: `https://dgedu.link`
- **응답 형식**: JSON (`Content-Type: application/json`)
- **인증**: `edulink_token` HttpOnly 쿠키 (로그인 후 자동 설정)

---

## 공개 API (인증 불필요)

### 시스템

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/health` | 헬스체크 |

### 공개 링크

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/links/public` | 최근 공개 링크 목록 (20개, 최신순) |
| GET | `/api/links/popular` | 인기 공개 링크 목록 (20개, 클릭수순) |

**응답 예시**
```json
{
  "success": true,
  "links": [
    {
      "slug": "EHLGmC",
      "custom_slug": "수학여행",
      "title": "2026 수학여행 안내",
      "original_url": "https://school.go.kr/notice/123",
      "click_count": 42,
      "created_at": "2026-05-25 10:00:00"
    }
  ]
}
```

### 공지사항

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/notices` | 전체 공지사항 (고정글 우선) |

### 유틸리티

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/fetch-title?url=<URL>` | 지정 URL의 og:title / title 추출 |
| POST | `/api/verify-password` | 비밀번호 보호 링크 비밀번호 검증 |

**POST /api/verify-password 요청**
```json
{ "slug": "EHLGmC", "password": "123456" }
```

### 설문 응답 제출 (공개, 인증 불필요)

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/survey/:slug/submit` | 설문 응답 제출 |

**POST /survey/:slug/submit 요청**
```json
{
  "answers": {
    "q_0": "홍길동",
    "q_1": "teacher@dge.go.kr",
    "q_2": ["선택지A", "선택지B"],
    "q_3": 4
  },
  "password": "123456"
}
```
- `answers` — 질문 ID(`q_0`, `q_1`, …)를 키로 하는 응답 맵
  - 단일선택: 문자열
  - 다중선택: 문자열 배열
  - 만족도: 숫자
  - 주소: `{ "zonecode": "41000", "address": "경기 어딘가", "detail": "101호" }` 객체
- `password` — 비밀번호 보호 설문일 경우에만 필수

**응답 (성공)**
```json
{ "success": true }
```

**응답 (실패 — 마감 / 한도 초과)**
```json
{ "success": false, "error": "closed" }
```

> 제출 시 `urls.response_count += 1`, `survey_responses` 테이블에 행 추가, IP SHA-256 해시 저장.  
> `survey_config.notify_email = true`이면 설문 소유자의 계정 이메일로 응답 내용 알림 메일(Resend)을 발송합니다.

---

## 인증 API

### OTP 로그인

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/auth/check-email?email=<email>` | 이메일 존재 여부 확인 |
| POST | `/api/auth/otp/send` | OTP 코드 발송 |
| POST | `/api/auth/otp/verify` | OTP 검증 및 로그인 |
| POST | `/api/auth/logout` | 로그아웃 (쿠키 삭제) |

**POST /api/auth/otp/send 요청**
```json
{
  "email": "teacher@dge.go.kr",
  "name": "홍길동",        // 신규 사용자만 필수
  "affiliation": "대구○○초등학교"  // 신규 사용자만 필수
}
```

### 카카오 OAuth

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/auth/kakao` | 카카오 로그인 시작 (리다이렉트) |
| GET | `/api/auth/kakao/callback` | 카카오 OAuth 콜백 처리 |

---

## 인증 필요 API (`edulink_token` 쿠키)

### 내 정보

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/auth/me` | 현재 로그인 사용자 정보 |
| PATCH | `/api/auth/profile` | 이름·소속 수정 |

**PATCH /api/auth/profile 요청**
```json
{ "name": "홍길동", "affiliation": "대구광역시교육청" }
```

### 단축 링크 (level ≥ 1 필요)

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/links` | 내 링크 목록 전체 (`kind='link'` 필터) |
| POST | `/api/links` | 단축 링크 생성 |
| PATCH | `/api/links/:id` | 링크 수정 |
| DELETE | `/api/links/:id` | 링크 삭제 |
| GET | `/api/links/check-slug` | 슬러그 중복 확인 |
| GET | `/api/links/:id/stats` | 일별 클릭 통계 (최근 30일) |

**POST /api/links 요청**
```json
{
  "original_url": "https://school.go.kr/notice/123",
  "title": "수학여행 안내",           // 선택, 비어있으면 og:title 자동추출
  "description": "6학년 대상",        // 선택
  "custom_slug": "수학여행",          // 선택 (4~20자, 한글/영숫자/하이픈)
  "is_public": false,                 // 선택, 기본 false
  "expires_at": "2026-06-01 00:00:00", // 선택
  "password": "123456"                // 선택, 숫자 6자리
}
```

**POST /api/links 응답**
```json
{
  "success": true,
  "slug": "EHLGmC",
  "base_slug": "EHLGmC",
  "custom_slug": "수학여행",
  "title": "2026 수학여행 안내",
  "short_url": "https://dgedu.link/수학여행",
  "original_url": "https://school.go.kr/notice/123"
}
```

**GET /api/links/:id/stats 응답**
```json
{
  "success": true,
  "link": { "id": 1, "slug": "EHLGmC", ... },
  "daily_clicks": [
    { "date": "2026-05-24", "clicks": 5 },
    { "date": "2026-05-25", "clicks": 12 }
  ]
}
```

### 설문지 (고급사용자, level ≥ 3 필요)

> 설문지는 대시보드 전용 웹 API입니다. 외부 OpenAPI(v1)에는 노출되지 않습니다.

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/surveys` | 내 설문 목록 전체 |
| POST | `/api/surveys` | 설문 생성 |
| PATCH | `/api/surveys/:id` | 설문 수정 |
| DELETE | `/api/surveys/:id` | 설문 삭제 |
| GET | `/api/surveys/:id/responses` | 응답 그리드 (JSON) |
| GET | `/api/surveys/:id/responses.csv` | 응답 CSV 다운로드 (UTF-8 BOM) |

**POST /api/surveys 요청**
```json
{
  "title": "2026 만족도 조사",
  "custom_slug": "만족도조사",        // 선택
  "password": "123456",               // 선택
  "expires_at": "2026-06-30 00:00:00", // 선택
  "response_limit": 200,              // 선택, null=무제한
  "survey_config": {
    "title": "2026 만족도 조사",
    "intro": "안녕하세요! 설문에 참여해 주세요.",
    "outro": "감사합니다!",
    "theme": "indigo",               // indigo | emerald | rose | amber | sky
    "one_response_per_browser": true, // 선택, 기본 false
    "inactive_message": "이 설문은 종료되었습니다.", // 선택
    "notify_email": true,            // 선택, 기본 false — 응답 수신 시 소유자 이메일로 알림 발송
    "questions": [
      {
        "id": "q_0",
        "type": "short",             // short | long | single | multi | rating | phone | email | address
        "label": "성함을 입력해 주세요",
        "required": true,
        "description": "실명으로 입력해 주세요.",  // 선택
        "media_url": "",             // 선택 (YouTube / 이미지 / 동영상 URL)
        "options": [],               // type=single/multi일 때 선택지 배열
        "scale": 5                   // type=rating일 때 최대값 (5 또는 7)
      }
    ]
  }
}
```

**GET /api/surveys/:id/responses 응답**
```json
{
  "success": true,
  "questions": ["성함", "이메일", "만족도"],
  "responses": [
    {
      "id": 1,
      "submitted_at": "2026-05-28 10:00:00",
      "answers": ["홍길동", "teacher@dge.go.kr", "4"]
    }
  ]
}
```

**GET /api/surveys/:id/responses.csv**  
UTF-8 BOM CSV 파일 다운로드. 첫 행은 `제출일시, 질문1, 질문2, ...` 헤더.

### API Keys (고급사용자, level ≥ 3 필요)

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/keys` | 내 API Key 목록 |
| POST | `/api/keys` | API Key 신규 발급 |
| DELETE | `/api/keys/:id` | API Key 폐기 |

---

### 페이지 / EduLink Pages (고급사용자, level ≥ 3 필요)

모든 편집 라우트는 세션 인증 + `level ≥ 3` + 대상 사이트 소유권(`user_id`)을 서버에서 재확인합니다.

**사이트**

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/sites` | 내 사이트 목록 (click_count·page_count·게시 상태 포함) |
| POST | `/api/sites` | 사이트 생성 (base_slug 자동발급, 선택 custom_slug) |
| GET | `/api/sites/:id` | 사이트 상세 (테마 + 페이지 트리) |
| PATCH | `/api/sites/:id` | title / custom_slug(주소변경) / is_public / home_page_id / theme |
| DELETE | `/api/sites/:id` | 사이트 삭제 (페이지·섹션·스냅샷·urls·R2·KV 회수) |
| POST | `/api/sites/:id/publish` | 게시 — 전 경로 렌더 → 스냅샷 교체 + `published_rev` 갱신 |
| GET | `/api/sites/:id/preview?path=&theme=` | 소유자 초안 실시간 미리보기(HTML, no-store) |
| POST | `/api/sites/:id/media` | 이미지 업로드(multipart) → WebP 변환(Images 바인딩) → R2 → `/media/....webp` URL 반환 |

**페이지**

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/sites/:id/pages` | 페이지 생성 (title·slug·parent_id, depth ≤ 1 검증) |
| GET | `/api/pages/:id` | 페이지 + 섹션 |
| PATCH | `/api/pages/:id` | title / slug / 이동(parent_id) |
| DELETE | `/api/pages/:id` | 페이지 + 하위·섹션 삭제 |
| POST | `/api/pages/reorder` | 형제 페이지 정렬 `{ order: [id, ...] }` |

**섹션**

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/pages/:id/sections` | 섹션 추가 (type: text·heading·image·youtube·link·embed·divider) |
| PATCH | `/api/sections/:id` | 섹션 content 수정 |
| DELETE | `/api/sections/:id` | 섹션 삭제 (image면 R2 객체도 삭제) |
| POST | `/api/sections/reorder` | 페이지 내 섹션 정렬 `{ page_id, order: [id, ...] }` |

> 공개 페이지는 별도 인증 없이 `GET /{siteSlug}[/{상위}[/{하위}]]`로 게시 스냅샷을 서빙합니다(§리다이렉트 참조).

---

## 관리자 API (level = 4 필요)

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/admin/domains` | 허용 도메인 목록 |
| POST | `/api/admin/domains` | 허용 도메인 추가 |
| DELETE | `/api/admin/domains/:id` | 허용 도메인 삭제 |
| GET | `/api/admin/users` | 전체 사용자 목록 |
| PATCH | `/api/admin/users/:id` | 사용자 등급 변경 (본인 제외) |
| POST | `/api/admin/notices` | 공지사항 등록 |
| DELETE | `/api/admin/notices/:id` | 공지사항 삭제 |

---

## OpenAPI v1 (외부 연동, API Key 인증)

외부 시스템에서 단축주소를 API로 생성할 수 있는 공개 엔드포인트. **단축주소 전용** — 설문지는 포함되지 않습니다.

- **Rate Limit**: API Key당 분당 15회
- **인증 헤더**: `x-api-key: edulink_<key>`

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/v1/shorten` | 단축주소 생성 |

**POST /api/v1/shorten 요청**
```json
{
  "original_url": "https://school.go.kr/notice/123",
  "slug": "notice-123",       // 선택 (4~20자, 한글/영숫자/하이픈)
  "is_public": false,          // 선택, 기본 false
  "title": "공지 링크",        // 선택
  "description": "메모",       // 선택
  "expires_at": "2026-12-31 00:00:00",  // 선택
  "password": "123456"         // 선택, 숫자 6자리
}
```

**POST /api/v1/shorten 응답 (성공)**
```json
{
  "success": true,
  "slug": "aB3kR9",
  "short_url": "https://dgedu.link/aB3kR9",
  "original_url": "https://school.go.kr/notice/123"
}
```

**연동 예시 — ssac-app (`functions/api/shorten.ts`)**
```typescript
const res = await fetch("https://dgedu.link/api/v1/shorten", {
  method: "POST",
  headers: {
    "x-api-key": env.EDULINK_API_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ original_url: url, is_public: false }),
});
const data = await res.json(); // { success, short_url, slug, original_url }
```

---

## QR 코드

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/qr/:slug` | QR 코드 PNG 이미지 (600×600, ECC High) |

Worker가 api.qrserver.com에서 PNG를 프록시하여 반환. `Cache-Control: public, max-age=86400`.  
단축주소와 설문지 모두 동일한 슬러그 기반 QR 코드를 사용합니다.

---

## 리다이렉트 / 설문 진입 / 페이지 서빙

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/:slug` | 단축주소 리다이렉트(307) · 설문 · 페이지 홈 — `kind`로 분기 |
| GET | `/:slug/:p1` · `/:slug/:p1/:p2` | 페이지 하위 경로 (게시 스냅샷) |
| GET | `/media/*` | 페이지 이미지 R2 프록시(불변 캐시) |

- `kind = 'link'` — 비밀번호 없으면 307 리다이렉트, 있으면 PIN 입력 HTML 반환.
- `kind = 'survey'` — 비밀번호 없으면 설문 HTML 반환, 있으면 PIN 검증 후 설문 표시. URL은 변하지 않음.
- `kind = 'site'` — 게시 스냅샷 서빙(KV `pub:{slug}:{path}` → D1 `site_snapshots`). 응답 헤더 `Cache-Control: public, max-age=60, stale-while-revalidate=600`, 조회수 집계. 미게시·비공개·경로 미스는 404 안내.
- 만료 또는 비활성화된 항목은 종료 안내 HTML 반환 (커스텀 메시지 지원).
- 응답 한도 초과 설문은 마감 안내 HTML 반환.
