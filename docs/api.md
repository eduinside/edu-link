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

### 단축 링크 (level ≥ 2 필요)

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/links` | 내 링크 목록 전체 |
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

### API Keys (level ≥ 3 필요)

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/keys` | 내 API Key 목록 |
| POST | `/api/keys` | API Key 신규 발급 |
| DELETE | `/api/keys/:id` | API Key 폐기 |

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

외부 시스템에서 단축주소를 API로 생성할 수 있는 공개 엔드포인트.

- **Rate Limit**: API Key당 분당 15회
- **인증 헤더**: `x-api-key: edulink_<key>`

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/v1/shorten` | 단축주소 생성 |

**POST /api/v1/shorten 요청**
```json
{
  "original_url": "https://school.go.kr/notice/123",
  "slug": "notice-123",     // 선택
  "is_public": true,         // 선택
  "title": "공지 링크",      // 선택
  "description": "메모"      // 선택
}
```

---

## QR 코드

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/qr/:slug` | QR 코드 PNG 이미지 (600×600, ECC High) |

Worker가 api.qrserver.com에서 PNG를 프록시하여 반환. `Cache-Control: public, max-age=86400`.

---

## 리다이렉트

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/:slug` | 단축주소 리다이렉트 (307) |

비밀번호가 있는 경우 PIN 입력 HTML 반환. 만료된 경우 410 또는 `/` 리다이렉트.
