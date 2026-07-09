# edu-link (에듀링크)

교직원용 단축주소·설문·페이지 플랫폼. 정본: **dgedu.link**.
CF Workers + Hono(TS) + React 19/RR7/Tailwind 4/HeroUI + D1 + KV(캐시) + R2(이미지→WebP).

@AGENTS.md

## 명령
- `npm run dev` — Vite / `npm run wrangler:dev` — Workers 포함
- `npm test` — vitest / `npm run deploy` — build + wrangler deploy
- `npm run cf-typegen` — 바인딩 변경 후 타입 재생성

## 규칙
- D1 `edu-link-db`는 edu-kit과 공유 — 스키마 변경 시 edu-kit 영향 확인.
- KV 실패 시 graceful fallback 유지 (단축링크 리다이렉트는 절대 죽으면 안 됨).
- 테스트 있는 프로젝트 — 기능 변경 시 vitest 통과 확인.
