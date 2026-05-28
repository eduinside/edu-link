# 에듀링크 (EduLink)

> 교육청·공공기관 교직원을 위한 스마트 단축주소·설문지 플랫폼

**https://dgedu.link**

---

## 소개

에듀링크는 대구광역시교육청 소속 교직원이 긴 URL을 짧고 기억하기 쉬운 주소로 변환하여 공유하고, 별도 외부 서비스 없이 간편한 온라인 설문을 직접 운영할 수 있도록 설계된 서비스입니다. Cloudflare의 글로벌 엣지 네트워크 위에서 동작하며, 별도 서버 운영 없이 완전한 서버리스로 구현되었습니다.

---

## 기술 스택

| 영역 | 기술 |
|---|---|
| 런타임 | Cloudflare Workers (Edge) |
| 백엔드 | Hono (TypeScript) |
| 프론트엔드 | React 19 + React Router 7 + TailwindCSS 4 |
| UI 컴포넌트 | HeroUI |
| 데이터베이스 | Cloudflare D1 (SQLite) |
| 캐시 / Rate Limit | Cloudflare KV |
| 인증 | 이메일 OTP (Resend) · Kakao OAuth · Cloudflare Access JWT |
| 이메일 발송 | Resend API |
| 빌드 | Vite 8 |
| 분석 | Google Analytics 4 (G-T9GZNBEXJ0) |

---

## 주요 기능

### 단축주소
- **단축주소 생성** — 6자리 랜덤 base_slug 자동 부여, 선택적 커스텀 슬러그 (한글 포함)
- **자동 제목 추출** — og:title / `<title>` 서버사이드 파싱으로 링크 생성 시 자동 반영
- **QR 코드** — api.qrserver.com 프록시 방식, Worker에서 PNG 스트리밍
- **접속 통계** — 일별 클릭 집계, 30일 바 차트 사이드바
- **비밀번호 보호** — 6자리 숫자 PIN으로 링크 접근 제한
- **자동 만료** — 지정 일시 이후 자동 비활성화
- **공개/비공개** — 루트 페이지 공유 목록 노출 여부 설정

### 설문지 (Lv.3 이상)
- **설문지 생성·관리** — 단축주소와 동일한 슬러그 패턴(예: `dgedu.link/내슬러그`)으로 배포
- **8가지 질문 유형** — 단답형·장문형·단일선택·다중선택·만족도·전화번호·이메일·주소(카카오 우편번호)
- **미디어 첨부** — 질문별 YouTube·이미지·동영상 URL 삽입, 설명에 URL 자동 하이퍼링크
- **5가지 색상 테마** — 인디고·에메랄드·로즈·앰버·스카이
- **고급 설정** — 비밀번호 보호·종료일·최대 응답 수·브라우저당 1회 제한·비활성 안내 문구·커스텀 슬러그
- **응답 수집·내보내기** — 대시보드 그리드 조회 + UTF-8 BOM CSV 다운로드
- **실시간 카운트** — 30초 간격 자동 갱신

### 공통
- **회원 등급제** — 1(일반) / 2(인증사용자) / 3(개발자) / 4(최고관리자)
- **OpenAPI v1** — API Key 발급 및 외부 시스템 연동 (Rate Limit: 분당 15회), 단축주소 전용
- **Zero Trust 도메인** — 허용 이메일 도메인 동적 관리

---

## 빠른 시작

```bash
# 의존성 설치
npm install

# 로컬 개발 (Vite dev server)
npm run dev

# Wrangler 로컬 에뮬레이션 (D1·KV 포함)
npm run wrangler:dev

# 빌드 후 프로덕션 배포
npm run deploy
```

환경 설정 및 시크릿 관리는 [`docs/deployment.md`](docs/deployment.md)를 참고하세요.

---

## 문서

| 문서 | 내용 |
|---|---|
| [아키텍처](docs/architecture.md) | 전체 구조, 요청 흐름, 설계 결정 |
| [API 레퍼런스](docs/api.md) | 엔드포인트 목록 및 요청/응답 |
| [데이터베이스](docs/database.md) | 스키마, 마이그레이션 이력, 슬러그 구조 |
| [인증](docs/auth.md) | 로그인 방식, 등급 체계, JWT |
| [배포·운영](docs/deployment.md) | 시크릿 설정, 배포 절차, 운영 팁 |

---

## 라이선스

© 2026 에듀링크. All rights reserved.
