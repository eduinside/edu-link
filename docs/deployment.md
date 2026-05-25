# 배포 및 운영

## 인프라 구성

| 리소스 | 이름 | ID |
|---|---|---|
| Cloudflare Worker | `edu-link` | — |
| D1 Database | `edu-link-db` | `e5fa6f54-6063-48f9-9cf3-0517381dd005` |
| KV Namespace | `URL_CACHE` | `8acabbbf2c7c43eaaf876f0c27cc2bd1` |
| 프로덕션 도메인 | `dgedu.link` | — |
| Worker 기본 URL | `edu-link.parkjh85.workers.dev` | — |
| GA4 측정 ID | `G-T9GZNBEXJ0` | — |

---

## Worker Secrets (환경 변수)

아래 시크릿은 **절대 코드/파일에 직접 작성하지 않고** Wrangler CLI로만 설정합니다.

```bash
# Resend 이메일 발송 API Key
npx wrangler secret put RESEND_API_KEY

# JWT 세션 쿠키 서명 시크릿
npx wrangler secret put JWT_SECRET

# 카카오 OAuth 클라이언트 ID (선택)
npx wrangler secret put KAKAO_CLIENT_ID
```

현재 등록된 시크릿 확인:
```bash
npx wrangler secret list
```

> **주의**: `RESEND_API_KEY`는 `re_` 접두사로 시작하는 Resend API 키. 로컬 개발 환경에서는 `debug_otp` 필드로 OTP를 직접 반환하므로 실제 이메일 발송은 프로덕션(`dgedu.link`)에서만 동작.

---

## 배포 절차

### 일반 배포

```bash
# 빌드 + 배포 한 번에
npm run deploy

# 개별 실행
npm run build          # Vite 빌드 (dist/client/, dist/edu_link/)
npx wrangler deploy    # Cloudflare에 업로드
```

### 개발 서버

```bash
# Vite dev server (HMR, 빠른 반복 개발용)
npm run dev

# Wrangler dev (D1·KV 에뮬레이션 포함, 로컬 Worker 실행)
npm run wrangler:dev
```

### Git 연동

```bash
git add .
git commit -m "feat: ..."
git push origin main
```

현재는 수동 배포 방식. GitHub Actions 등 CI/CD 파이프라인은 미구성.

---

## D1 데이터베이스 관리

### 마이그레이션 실행

```bash
# 원격 (프로덕션)
npx wrangler d1 execute edu-link-db --remote --file=migrations/000X_name.sql

# 로컬
npx wrangler d1 execute edu-link-db --local --file=migrations/000X_name.sql
```

### 쿼리 직접 실행

```bash
npx wrangler d1 execute edu-link-db --remote --command="SELECT COUNT(*) FROM urls"
```

### 데이터 백업

```bash
npx wrangler d1 export edu-link-db --remote --output=backup_$(date +%Y%m%d).sql
```

---

## KV 관리

```bash
# KV 항목 조회
npx wrangler kv key list --binding=URL_CACHE

# 특정 키 삭제 (캐시 무효화)
npx wrangler kv key delete --binding=URL_CACHE "EHLGmC"

# 로컬 KV 초기화 (테스트용)
rm -rf .wrangler/state/v3/kv/
```

---

## wrangler.jsonc 주요 설정

```jsonc
{
  "name": "edu-link",
  "main": "src/server/index.ts",
  "compatibility_date": "2026-05-25",
  "compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],
  "assets": {
    "directory": "./dist/client",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": true   // ← 리다이렉트 동작의 핵심 설정
  }
}
```

**`run_worker_first: true` 필수 이유**
이 옵션 없이는 Cloudflare가 `/:slug` 경로를 Worker에 전달하기 전에 SPA index.html(200)을 반환. 결과적으로 단축주소 리다이렉트가 전혀 동작하지 않음.

---

## 롤백

Cloudflare 대시보드 → Workers & Pages → edu-link → Deployments 탭에서 이전 버전으로 원클릭 롤백 가능. 각 배포는 Version ID로 관리됨.

---

## 모니터링

- **Cloudflare 대시보드** → Workers → edu-link → Analytics: 요청 수, 오류율, CPU 시간
- **Observability 로그**: `wrangler.jsonc`에 `observability.enabled: true` 설정 → Workers Logs에서 `console.log/error` 확인 가능
- **Source Maps**: `upload_source_maps: true` 설정으로 에러 스택트레이스가 원본 TypeScript 라인 기준으로 표시
- **GA4**: `G-T9GZNBEXJ0` — 프론트엔드 페이지뷰 및 사용자 행동 분석

---

## 체크리스트 (신규 환경 구성 시)

- [ ] `npx wrangler secret put RESEND_API_KEY`
- [ ] `npx wrangler secret put JWT_SECRET`
- [ ] D1 초기 스키마 적용: `npx wrangler d1 execute edu-link-db --remote --file=src/server/db/schema.sql`
- [ ] 초기 마이그레이션 순서대로 실행 (0001 → 0006)
- [ ] `users` 테이블에 `affiliation` 컬럼 추가: `ALTER TABLE users ADD COLUMN affiliation TEXT NOT NULL DEFAULT ''`
- [ ] 초기 최고관리자 등급 수동 설정: `UPDATE users SET level = 4 WHERE email = 'admin@example.com'`
- [ ] 도메인 DNS 설정 (dgedu.link → Worker 라우팅)
