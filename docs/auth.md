# 인증 시스템

## 인증 방식 개요

에듀링크는 세 가지 로그인 방식을 지원합니다.

| 방식 | 대상 | 상태 |
|---|---|---|
| 이메일 OTP (Resend) | 교직원 이메일 | **주요 방식 (운영 중)** |
| 카카오 OAuth | 일반 사용자 | 구현 완료 (필요 시 활성화) |
| Cloudflare Access JWT | 기업/기관 Zero Trust 환경 | 지원 (Cf-Access-Jwt-Assertion 헤더) |

---

## 이메일 OTP 로그인 흐름

```
1. 사용자가 이메일 입력
2. GET /api/auth/check-email → 기존 사용자 여부 확인
   - 신규: 이름 + 소속 추가 입력 필요
3. POST /api/auth/otp/send
   - 6자리 OTP 생성 → KV에 5분간 저장 (key: otp:<email>)
   - 프로덕션(dgedu.link): Resend API로 이메일 발송
   - 로컬/개발: debug_otp 필드로 코드 반환
4. 사용자가 OTP 입력
5. POST /api/auth/otp/verify
   - KV 코드 대조 → 일치하면 D1에서 사용자 조회/생성
   - 화이트리스트 도메인 여부에 따라 level 결정
   - JWT(HS256, 7일) 생성 → edulink_token HttpOnly 쿠키 설정
   - KV에서 OTP 코드 즉시 삭제 (1회용)
```

---

## JWT 세션 쿠키

| 항목 | 값 |
|---|---|
| 쿠키명 | `edulink_token` |
| 알고리즘 | HS256 |
| 만료 | 7일 |
| 속성 | `HttpOnly`, `Secure`(HTTPS), `SameSite=Lax`, `Path=/` |

**페이로드**
```json
{
  "id": 1,
  "email": "teacher@dge.go.kr",
  "name": "홍길동",
  "affiliation": "대구○○초등학교",
  "level": 2
}
```

JWT 시크릿은 `JWT_SECRET` Worker Secret으로 관리 (`wrangler secret put JWT_SECRET`).

---

## authMiddleware 처리 순서

`src/server/middleware/auth.ts` — 인증이 필요한 모든 API 라우트에 적용.

```
1. [로컬 전용] x-mock-role 헤더 확인
   → admin / developer / authenticated / login 중 하나면
     해당 등급의 모의 사용자로 즉시 인증 처리
   (대시보드 헤더 UI의 "모의 권한" 드롭다운과 연동)

2. edulink_token 쿠키 확인
   → JWT 검증 성공 시 D1에서 사용자 조회 후 인증 처리

3. Authorization: Bearer <token> 헤더 확인
   → API Key 방식의 경우 이 경로 사용 (내부적으로 JWT)

4. Cf-Access-Jwt-Assertion 헤더 확인 (Cloudflare Access)
   → JWKS 검증 → D1에서 사용자 조회/생성

5. 모두 없음 → 401 Unauthorized
```

---

## 회원 등급 체계

| Level | 명칭 | 취득 조건 | 권한 |
|---|---|---|---|
| 1 | 일반회원 | 화이트리스트 외 이메일 가입 | 단축주소 접속·열람만 |
| 2 | 인증사용자 | 화이트리스트 도메인 이메일 또는 관리자 수동 승급 | 단축주소 생성·수정·삭제·QR·통계 |
| 3 | 개발자 | 관리자 수동 승급 | level 2 + API Key 발급·OpenAPI 연동 |
| 4 | 최고관리자 | 관리자 수동 승급 | 전체 제어 (사용자 관리·도메인 관리·공지사항) |

### 자동 승급 도메인 (화이트리스트)

`allowed_domains` 테이블에 등록된 도메인. 최고관리자가 대시보드에서 동적 관리.

기본값: `dge.go.kr`, `korea.kr`

---

## OpenAPI v1 인증 (API Key)

외부 시스템 연동용. `api_keys` 테이블 기반.

```
요청 헤더: x-api-key: edulink_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

검증 과정:
1. x-api-key 헤더에서 키 추출
2. SHA-256 해시 후 D1 api_keys.key_hash와 대조
3. 일치하면 해당 user_id의 사용자로 인증
4. last_used_at 갱신 (waitUntil)
5. Rate Limit: 분당 15회 (KV 고정 윈도우)
```

발급된 API Key는 평문으로 1회만 노출됨. 이후에는 해시만 저장.

---

## 로컬 개발 환경 모의 권한

프로덕션(`dgedu.link`)이 아닌 환경에서는 대시보드 상단의 드롭다운으로 권한 등급을 즉시 전환 가능.

| 드롭다운 선택 | x-mock-role 헤더값 | 적용 등급 |
|---|---|---|
| 1-일반회원 | `login` | 1 |
| 2-인증사용자 | `authenticated` | 2 |
| 3-개발자 | `developer` | 3 |
| 4-최고관리자 | `admin` | 4 |

선택값은 `localStorage('mock_role')`에 저장되어 새로고침 후에도 유지.
