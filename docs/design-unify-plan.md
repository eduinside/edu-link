# dgedu.link 계열 디자인 토큰 개편 계획 (2026-11-14, 운영자 결정 반영)

대상: **dgedu.link(edu-link) · kit.dgedu.link(dgedu-kit) · dic.dgedu.link(dgedu-dic)**
운영자 요청: "세 사이트가 디자인 토큰을 공유하는데 조금 느리고 구형 느낌. portal.dgedu.link 또는 on.dgedu.link 토큰 중 하나를 따라 개선. 속도·일관성·추후 개편 용이성·사용자 편의성 전반 검토."

> 이 문서는 세 저장소에 걸친 계획이라 대표 사이트인 edu-link에 둔다. 구현을 시작할 때 dgedu-kit·dgedu-dic `docs/`에 이 문서를 가리키는 한 줄짜리 문서를 둔다.

---

## 0. 요약

- **따를 기준: portal(에듀포털) 토큰.** 세 사이트의 색값·클래스 이름(`brand-*`, `ink/paper/line`, `slate-*`)이 portal과 이미 같은 뿌리(school-portal-r2 / Codeit 블루)라서, 바꿀 것은 '색'이 아니라 **배경 그라디언트·유리 효과·큰 그림자·제각각인 글꼴·지나치게 작은 글자**다. on(ADS)으로 가면 파랑 값·이름 체계·모서리 규칙이 달라 세 사이트 클래스 1,500여 개를 새로 써야 한다.
- **글꼴 전달 방식만 on에서 빌린다.** portal은 Pretendard 전체 파일(1.6MB, 인트라넷 전제)을 받고, on은 글자 범위별 조각(93개)을 자체 호스팅해 화면에 나온 글자 조각만 받는다. 공개 사이트에는 on 방식이 맞다.
- **느린 원인은 디자인보다 전달에 있다.** dgedu.link는 첫 방문에 jsdelivr에서 글꼴 2MB를 받고, 해시 붙은 JS·CSS도 매번 재검증하며, 정적 파일까지 Worker를 거친다. kit은 정적 파일이 모두 Pages Functions를 거친다. 이 넷은 화면을 바꾸지 않고 먼저 고칠 수 있다(1단계).
- **공통 토큰은 한 곳(`edu-link/design/`)에만 적고 복사 스크립트로 나눠 준다.** 지금은 세 파일이 손으로 복사돼 이미 값이 갈렸다(§2-3).
- **공통 파일은 '공통층 + 브랜드층' 둘로 나눈다.** ssac(새싹 그린)·에듀맵스(초록)처럼 브랜드 색이 다른 계열 사이트도 중립색·상태색·바탕 규칙·글꼴은 같이 쓰고 브랜드 단계만 자기 색으로 바꿀 수 있게 한다(§7).
- **kit 콘텐츠 파일 나누기를 이번 범위에 넣는다**(D5, §3-4).

---

## 1. 조사 결과

### 1-1. 지금 토큰 파일

| 사이트 | 파일 | 내용 |
|---|---|---|
| dgedu.link | `src/client/index.css` (82줄) | `@theme` brand·ink/paper/line + HeroUI `--accent` 덮어쓰기 + `.gemini-gradient-bg`·`.glassmorphism(-dark)` + 전역 스크롤바 |
| kit | `app/styles/tokens.css` (141줄) | 위를 복사 + success/danger/warning/info/violet 단계, `--gradient-page`, 카드·칩 호버, `.sk-rich` 본문, 설문 버튼 |
| dic | `app/styles/tokens.css` (88줄) | kit에서 발췌 + 글꼴만 기기 글꼴, `body`에 그라디언트, `keep-all` |

출처 주석이 모두 "school-portal-r2 / Codeit blue"다. 즉 **portal과 세 사이트는 같은 토큰에서 갈라졌고**, portal은 그 뒤로 다듬어졌고(다크 팔레트·초점 링·입력 16px·레시피 문서) 세 사이트는 처음 모양에 머물렀다.

### 1-2. 두 기준 비교

| 기준 | portal (Codeit) | on (ADS, 나래와 같음) |
|---|---|---|
| 브랜드 파랑 | `#1f7af0`(600) / `#3692ff`(500) - **세 사이트와 같은 값** | `#0C66E4` / hover `#0055CC` - 다름 |
| 이름 체계 | `brand-50~900`, `ink/ink-soft/ink-faint`, `paper/surface/line`, 중립은 Tailwind `slate` | `brand/brand-hover/brand-subtle`, `text/text-subtle/text-subtlest`, `surface-sunken/hover/pressed` |
| 모서리 | lg 8 / xl 12 / 2xl 16 / full | 3px(컨트롤)·8px(카드) 둘뿐 |
| 느낌 | 밝은 파랑, 흰 카드 + 옅은 회색 바탕, 둥근 모서리 | 업무 도구, 촘촘함, 각진 모서리 |
| 다크 모드 | 있음(`html.dark`에서 변수만 바꿈) | 없음 |
| 문서 | `dgedu-portal/docs/DESIGN-TOKENS.md` - 버튼·입력·카드·배지·모달 레시피까지 | 나래 `tokens.css` 주석·FRONTEND-DESIGN-DIRECTIONS |
| 구현 | Tailwind v4 `@theme` (세 사이트와 같음) | on은 Tailwind 없이 `:root`, 나래는 `@theme` |
| 글꼴 전달 | 전체 woff2 1,613KB 자체 호스팅 | **글자 범위별 93조각 자체 호스팅**, 첫 화면 13조각 ×약 25KB |

세 사이트에서 지금 쓰는 클래스 수(실측):

| | slate-* | brand-* | ink/paper/line | 손으로 쓴 hex | 인라인 style |
|---|---|---|---|---|---|
| edu-link | 809 | 153 | 1 | 35 | 10 |
| kit | 149 | 70 | 0 | 49 | **315** |
| dic | 0 | 133 | 253 | 0 | 0 |

portal을 따르면 이 클래스는 **그대로 살아 있다.** on을 따르면 거의 전부 바꿔야 한다.

**결론: portal 토큰을 기준으로 한다.** 초등학생(dic)·교사(kit) 대상 공개 사이트에는 on의 3px 각진 모서리·촘촘한 업무 도구 밀도보다 portal의 둥근 카드·밝은 파랑이 맞고, 바꿀 양도 훨씬 적다. on에서는 토큰이 아니라 **전달 방식**(글꼴 조각, 한 곳 선언 원칙, 움직임 줄이기 처리)만 빌린다.

### 1-3. '구형 느낌'의 원인 (화면 확인 2026-11-14, 1280×800)

1. **페이지 전체 그라디언트**(`#e0f2fe → #e7f1ff → #faf5ff`, 하늘→보라) - 세 사이트 공통. portal·on은 평면 회색 바탕(`#f3f5f9` / `#F7F8F9`) 위 흰 카드.
2. **유리 효과(glassmorphism)** - `backdrop-filter: blur(16px)` 머리띠·패널. edu-link `backdrop-blur` 12곳, dic 5곳. 학교 저사양 PC에서 스크롤할 때 다시 그리는 비용도 크다.
3. **글꼴이 사이트마다 다르다.** dgedu.link = Pretendard(CDN), kit = Pretendard를 선언만 하고 받지 않아 **실제로는 맑은 고딕**, dic = 기기 글꼴(맑은 고딕). 같은 계열인데 글자 모양이 다르다.
4. **글자가 너무 작다.** edu-link에 `text-[9px]` 40곳, `text-[10px]` 93곳, `text-[11px]` 52곳. kit 인라인 `fontSize: 11~12.5` 다수. portal 최소는 11px(섹션 라벨)·본문 14px.
5. **HeroUI 기본 모양 + 직접 만든 모양이 섞임**(edu-link) - 큰 그림자(`shadow-lg/xl/2xl` 19곳), indigo·purple 강조 34곳이 브랜드 파랑과 섞인다.
6. 사이트마다 **이름만 다른 같은 유틸**(`.sk-scroll`·`.dic-scroll`·전역 스크롤바, `.gemini-gradient-bg`·`.page-gradient-bg`).

### 1-4. 속도 실측 (2026-11-14, 이 PC → 운영, 첫 방문)

| 사이트 | 첫 화면에 받는 양 (전송 크기) | 글꼴 | 해시 파일 캐시 | 정적 파일이 함수를 거침 |
|---|---|---|---|---|
| **dgedu.link** | JS 149KB + CSS 42KB + **글꼴 2,009KB**(jsdelivr) + GA(head에서 바로) | Pretendard 전체(CDN) | `max-age=0, must-revalidate` - **매번 재검증** | **예** (`run_worker_first: true`) |
| **kit** | JS 89KB + CSS 4KB + **logo.png 229KB** + GA(head에서 바로). 꾸러미를 열면 콘텐츠 청크 276KB(gzip) + 뷰어 68KB | 선언만(맑은 고딕) | `max-age=14400` - 4시간마다 재검증 | **예** (`_routes.json` 없음 → `_middleware.ts`가 모든 요청) |
| dic | JS 88KB + CSS 8KB, GA는 화면이 뜬 뒤 | 기기 글꼴 | `immutable` 1년 | 아니오 (`_routes.json`, perf-plan 2026-10-09) |
| on (참고) | CSS 27KB + JS 약 10KB + 글꼴 조각 13개 | 조각 자체 호스팅 | - | - |
| portal (참고) | JS 112KB + CSS 7KB + 글꼴 1,613KB | 전체 자체 호스팅 | - | - |

- edu-link 번들 원본: JS 532KB / **CSS 421KB**. CSS 대부분이 `@heroui/styles`. 실제로 쓰는 HeroUI 부품은 `Tooltip` 48 · `Card` 44 · `Button` 44 · `Chip` 27 · `Input` 9 다섯 가지뿐이다.
- 첫 바이트(TTFB)는 0.4~3.9초로 들쭉날쭉하다. dic perf-plan에서 확인한 대로 무료 플랜 한국 트래픽이 먼 엣지로 가는 영향이 커서 디자인으로 고칠 수 없다. 대신 **두 번째 방문부터 캐시로 아예 안 받게** 하는 것이 효과가 크다.
- dic은 이미 손봐서 셋 중 가장 빠르다. 이번 개편에서 느려지지 않게만 지킨다.

---

## 2. 목표 모습

### 2-1. 토큰 (portal 값 + 의미 이름 한 층)

portal `apps/web/src/index.css`의 `@theme`를 그대로 가져오고, 세 사이트에 필요한 것만 더한다. 파일은 공통층(`base.css`)과 브랜드층(`brand-blue.css`)으로 나눠 둔다(§2-3). 아래는 합친 모습이다.

```css
@theme {
  --font-sans: "Pretendard Variable", Pretendard, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif;
  /* brand 50~900 : portal 값 그대로 (brand-50 = #eef6ff 로 통일) */
  /* 중립 별칭 : ink / ink-soft / ink-faint / paper / surface / line (portal 값) */
  /* 상태색 : success·danger·warning·info (kit 단계 그대로 - 단계색·배지가 쓰고 있음) */
}
```

- **의미 이름을 기본으로**: 바탕 `bg-paper`, 카드 `bg-surface`, 글자 `text-ink`, 테두리 `border-line`. 새 코드와 고치는 화면은 이 이름을 쓴다. 나중에 다크 모드나 색을 바꿀 때 변수만 바꾸면 된다(portal `html.dark` 방식). `slate-*`는 지금 있는 것을 억지로 바꾸지 않는다.
- **없앨 것**: `--gradient-page`, `.gemini-gradient-bg`·`.page-gradient-bg`, `.glassmorphism(-dark)`, HeroUI `--accent` 덮어쓰기(HeroUI를 걷어 낸 뒤).
- **남길 것**: `--gradient-wordmark`(로고 타일에만), kit 단원 팔레트(`design.ts`, 콘텐츠 색이라 토큰과 별개), 검색어 강조.
- 모서리·그림자·간격은 portal 규칙(DESIGN-TOKENS.md §4~5): 버튼·입력 `rounded-lg`, 카드 `rounded-xl` + `border-slate-200` + `shadow-sm`, 모달 `rounded-2xl` + `shadow-xl`. dic의 `rounded-2xl/3xl`(23곳)은 어린이용 큰 카드라 2xl까지 허용하고 3xl은 2xl로.

### 2-2. 공통 바탕 규칙 (`@layer base`)

portal에서 가져오고 on·dic에서 보탠다.

| 규칙 | 출처 | 이유 |
|---|---|---|
| `body { background: var(--color-paper); color: var(--color-ink) }` | portal | 평면 바탕 + 흰 카드 |
| `:focus-visible` 브랜드 테두리 2px | portal·on | 키보드 사용자 위치 표시. 지금 세 사이트는 일부 부품에만 있음 |
| 640px 이하 `input, textarea, select { font-size: 16px }` | portal | iOS가 입력할 때 화면을 확대하는 현상 방지 |
| `word-break: keep-all; overflow-wrap: break-word` | dic·on | 낱말 중간 줄바꿈 방지. 지금 edu-link·kit에는 없음 |
| `font-synthesis: none`, `-webkit-font-smoothing: antialiased` | on | 가짜 굵기 막기, 글자 매끈하게 |
| `prefers-reduced-motion`이면 카드 들림·하트 튀김 끄기 | on | 학교 PC에 이 설정이 많음 |

### 2-3. 한 곳에 적고 나눠 주기

지금 갈린 값: `brand-50`(`#eef6ff` vs `#eff6ff`), 글꼴 세 가지, 유리 효과 두 가지, 스크롤바 이름 세 가지. 손 복사가 원인이다.

- **정본**: `edu-link/design/` (새 저장소를 만들지 않는다, D2)
  - `base.css` - **공통층**: 중립(`ink/paper/surface/line`), 상태색(success·danger·warning·info), 글꼴 이름, `@layer base` 규칙(§2-2), 공통 유틸(검색어 강조, 스크롤바 `.dg-scroll` 하나). 브랜드 색을 쓰는 곳은 `var(--color-brand-*)`만 부른다.
  - `brand-blue.css` - **브랜드층**: Codeit 파랑 `brand-50~900` + `primary`(portal 값). 세 사이트는 이것을 쓴다. 다른 색을 쓰는 계열 사이트는 같은 이름(`brand-50~900`)으로 자기 색 파일을 둔다(ssac이 이미 이 방식, §7).
  - `tokens.mjs` - 같은 값을 JS 객체로(Tailwind 3 `tailwind.config`용, ssac). `base.css`·`brand-blue.css`에서 스크립트로 만들어 값이 한 벌이게 한다.
  - `RECIPES.md` - portal DESIGN-TOKENS.md §6 레시피를 세 사이트용으로 줄인 것(버튼·입력·카드·배지·배너·빈 상태)
  - `README.md` - 쓰는 사이트 목록, 브랜드층 바꾸는 법, portal 값과 맞출 때 볼 곳
  - `VERSION` - 날짜 버전(예 `2026.11.1`)
- 글꼴 파일은 `design/`에 두지 않는다(§2-4, npm 패키지로 받음).
- **나눠 주기**: 각 사이트 `scripts/sync-design.mjs` - `../edu-link/design/`에서 `app/styles/dgedu/`로 복사하고 파일 맨 위에 버전을 적는다. 복사본은 **커밋한다**(kit·dic은 CF Pages가 빌드하므로 빌드 때 옆 폴더를 읽을 수 없다).
- **사이트별 추가분**은 `app/styles/site.css`에 따로(kit의 `.sk-rich`·설문 버튼, dic의 낱말장 인쇄 등). 공통 파일은 손으로 고치지 않는다.
- `npm run design:check` - 복사본이 정본과 같은지 비교(다르면 실패). 세 사이트 `check`/`test`에 붙인다.

### 2-4. 글꼴

- 세 사이트 모두 **Pretendard 가변 글꼴 조각(dynamic subset)을 자기 도메인에서** 낸다. 화면에 나온 글자가 든 조각만 받는다(on과 같은 방식). `font-display: swap`이라 글꼴이 늦어도 글자는 맑은 고딕으로 먼저 보인다.
- **받는 방법은 ssac 방식**: `pretendard` npm 패키지(1.3.9 고정)를 설치하고 `import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css"`. Vite가 조각 파일을 `/assets/`에 해시 이름으로 내보내므로 `/assets/*` immutable 캐시 한 줄로 끝나고, 93개 파일을 복사·관리할 필요가 없다. 라이선스(OFL)도 패키지에 들어 있다.
- **예외 - dgedu.link 교사 사이트(`siteRender.ts`)**: Worker가 HTML을 직접 만들어 해시 이름을 모르므로, 같은 패키지 파일을 빌드 때 `public/fonts/pretendard/`로 한 벌 복사해 고정 주소로 쓴다. 이 경우 SPA도 같은 `/fonts/` 주소를 쓰게 맞춰 한 번 받은 글꼴을 두 화면이 같이 쓴다.
- dgedu.link의 jsdelivr 링크(`index.html`, `siteRender.ts` 두 곳)를 없앤다.
- dic은 2026-10의 "글꼴 파일을 받지 않는다" 결정을 바꿔 조각 방식으로 간다(D3, 2026-11-14 운영자). dic `docs/PLAN.md`에 바뀐 이유를 적는다.

### 2-5. 글자 크기 바닥

| 쓰임 | 최소 | 지금 |
|---|---|---|
| 본문·버튼·입력 | 14px (`text-sm`) | 대체로 지킴 |
| 보조·메타·배지 | 12px (`text-xs`) | edu-link 9~11px 185곳, kit 11~12.5px 다수 |
| 섹션 라벨(대문자 느낌 작은 제목) | 11px | - |
| 어린이 화면(dic) | 본문 16px | 지킴 |

- 글자색: `ink-faint`(`#9aa4b5`)·`slate-400`은 흰 바탕 대비가 약 2.6:1이라 **아이콘·입력 안내 글에만** 쓴다. 읽어야 하는 글은 `slate-500`(약 4.8:1) 이상.

---

## 3. 사이트별 할 일

### 3-1. kit.dgedu.link (먼저 - 정적 사이트라 위험이 가장 낮다)

속도
- [ ] `public/_routes.json` - Functions는 `/api/*`와 꾸러미 경로(OG 넣기)만. `/assets/*`·`/og/*`·`/fonts/*`·`/*.png`·`/*.ico`·`/catalog.json` 제외.
- [ ] `public/_headers` - `/assets/*`, `/fonts/*` `immutable` 1년.
- [ ] `logo.png` 229KB → 머리띠 표시 크기에 맞춘 작은 PNG/WebP(목표 10KB 이하). 공유용 큰 로고는 그대로.
- [ ] GA를 dic처럼 화면이 뜬 뒤 받기.

디자인
- [ ] `tokens.css` → 공통 복사본(`app/styles/dgedu/base.css`·`brand-blue.css`) + `site.css`로 나누기.
- [ ] 그라디언트 바탕·유리 머리띠 제거, 평면 `paper` + 흰 머리띠 `border-b`.
- [ ] Pretendard 조각 연결(지금은 선언만 하고 실제는 맑은 고딕).
- [ ] 인라인 style 315곳: **이번에 손대는 화면의 색·글자 크기만** 클래스로 옮긴다. 한 번에 다 옮기지 않는다.
- [ ] 글자 크기 바닥(§2-5) 적용.

발행은 kit 규칙대로: 작업 브랜치 → `npm run check` → Pages 미리보기에서 운영자 확인 → main 병합.

콘텐츠 파일 나누기는 §3-4.

### 3-2. dic.dgedu.link

- [ ] 공통 토큰 파일로 교체 + `site.css`(낱말장 인쇄, 낱말 칩).
- [ ] `body` 그라디언트 → `paper`, 머리띠 유리 효과 제거.
- [ ] `rounded-3xl` → `rounded-2xl`, 큰 그림자 정리.
- [ ] 글꼴: `pretendard` 조각 import(D3). `docs/PLAN.md`의 '기기 글꼴만' 문구를 고친다.
- [ ] 이미 있는 `_routes.json`·`_headers`·GA 지연은 그대로. `/fonts/*` 캐시 줄만 추가.
- [ ] 데스크톱 앱(`desktop/`)의 `wwwroot/css/app.css`는 이번 범위 밖(따로 맞출지 나중에).

### 3-3. dgedu.link (가장 크다 - 둘로 나눠 배포)

**3-3a. 화면은 그대로, 속도만** (먼저 배포)
- [ ] `wrangler.jsonc` `run_worker_first: true` → 경로 목록으로(예: `["/*", "!/assets/*", "!/fonts/*", "!/*.png", "!/favicon*"]`). 단축주소(`/abc`)는 계속 Worker가 먼저 받아야 한다. **배포 전 로컬에서 단축주소 이동·사이트 경로·SPA 경로·정적 파일을 모두 확인**(CLAUDE.md: "단축링크 리다이렉트는 절대 죽으면 안 됨"). 정적 파일 요청이 Worker를 거치지 않으면 무료 요청 한도(하루 10만)도 아낀다.
- [ ] `dist/client/_headers`(= `public/_headers`) - `/assets/*`, `/fonts/*` `immutable` 1년. **위 경로 목록 변경과 같이 해야 효과가 있다** - `_headers`는 정적 자산이 바로 나갈 때만 붙고 Worker 코드가 돌려준 응답에는 붙지 않는다. 지금 해시 파일이 `max-age=0`인 것도 이 때문이다(Cloudflare 문서 static-assets/headers, 2026-11-14 확인).
  - 확인한 문서: `run_worker_first`는 경로 배열과 `!` 제외 패턴을 받는다(최대 100개, 제외가 우선). 정적 자산 요청은 무료·무제한이고, Worker를 먼저 거치는 요청은 무료 한도를 넘으면 429가 난다(static-assets/binding, billing-and-limitations).
- [ ] jsdelivr 글꼴 → 자체 호스팅 조각(`index.html`, `siteRender.ts`).
- [ ] GA를 화면이 뜬 뒤 받기.

**3-3b. 디자인**
- [ ] HeroUI 걷어 내기: `components/ui/`에 `Button`·`Card`·`Chip`·`Input`·`Tooltip` 다섯 개를 portal 레시피로 만들고 import만 바꾼다. Tooltip은 나래 `.tip`처럼 마우스·키보드 둘 다 뜨는 CSS 말풍선. `@heroui/react`·`@heroui/styles`·`framer-motion` 의존성 제거.
  - 기대: CSS 421KB → 수십 KB, JS 전송 149KB → kit·dic 수준(약 90~100KB) 근처.
- [ ] 그라디언트·유리·indigo/purple 강조 → 브랜드 파랑과 상태색으로.
- [ ] 글자 크기 바닥: `text-[9px]`·`[10px]` → `text-xs`(12px), `[11px]`은 라벨이면 유지·글이면 12px.
- [ ] 그림자 위계 portal대로(카드 sm, 모달 xl).
- [ ] `Dashboard.tsx`(3,571줄)는 **부품 교체만** 하고 구조 개편은 하지 않는다(위험 대비 효과가 낮다).
- [ ] 테스트(vitest) 통과 확인.

### 3-4. kit 콘텐츠 파일 나누기 (D5)

**지금**: 꾸러미 하나를 열어도 모든 꾸러미의 콘텐츠를 받는다. `app/lib/kit-content.ts`가 `data/items.json`(1.65MB) + `stage_meta.json`(72KB)을, `lib/quiz.ts`가 `quiz.json`(282KB)을 통째로 import해 뷰어 청크에 묶인다(전송 gzip 276KB + 뷰어 코드 68KB). 꾸러미가 139개라 한 꾸러미 몫은 평균 1% 남짓이다.

`ITEMS`를 쓰는 곳은 네 군데다.

| 쓰는 곳 | 필요한 것 | 바꾼 뒤 |
|---|---|---|
| `ViewerPage` (`getGroups`, `getQuiz`) | 꾸러미 1개의 항목·단계·퀴즈 | `/k/<id>.<hash>.json` 하나만 받음 |
| `SearchModal` → `lib/search.ts` | 전체 항목의 제목·소개 글 | 검색 전용 가벼운 색인 `/k/search.<hash>.json`(검색에 쓰는 칸만). 검색 창을 열 때 받음(지금처럼 지연) |
| `MixPage` (`/m/:id`) | 모음에 든 영상들(여러 꾸러미) | 모음에 든 꾸러미 파일만 동시에 받음 |
| `MixBuilderModal` | 고른 영상들 | 위와 같음 |

할 일
- [ ] `scripts/build-data.ts`: 지금 `data/*.json`은 그대로 두고(점검·보고 스크립트, OG 미들웨어, `catalog.json`이 씀), 사이트용으로 `public/k/<id>.<hash>.json`(꾸러미별 items + stage_meta + quiz)과 `public/k/search.<hash>.json`을 더 만든다. 해시는 내용 기준이고, 해시 목록은 `kits.json`의 각 꾸러미에 `content` 칸으로 넣는다(홈이 이미 받는 파일).
- [ ] `public/_headers`: `/k/*` immutable 1년(이름에 해시가 있어 내용이 바뀌면 주소가 바뀜).
- [ ] `kit-content.ts`·`quiz.ts`를 `fetch` 기반으로 바꾸고, 뷰어에 불러오는 중 자리표시를 둔다. 홈 카드에 마우스를 올리면 그 꾸러미 파일을 미리 받는다.
- [ ] 받기에 실패하면 '다시 시도' 단추(학교망 끊김 대비).
- [ ] 빌드한 `dist/k/` 개수 = 공개 꾸러미 수인지 `npm run check`에 점검 추가.
- [ ] `data/items.json` 등은 사이트 번들에 더는 들어가지 않는지 빌드 크기로 확인.

기대: 꾸러미를 처음 열 때 받는 콘텐츠가 gzip 276KB → 꾸러미 1개 몫(수 KB). 검색 색인은 검색을 쓸 때만.
지킬 것: 공유 링크(`/:kitId`, `/m/:id`)·D1 카운터 키(`id`, 영상 `key`)는 그대로. YAML 형식 변경 없음.

---

## 4. 진행 순서

| 단계 | 내용 | 화면 변화 | 되돌리기 |
|---|---|---|---|
| 0 | 기준 측정 - 세 사이트 Lighthouse(모바일·데스크톱) 숫자와 화면 캡처를 `design/baseline-2026-11.md`에 | 없음 | - |
| 1 | **속도만**: kit `_routes`·`_headers`·로고·GA, dgedu.link 3-3a | 거의 없음(글꼴만 같아짐) | 파일 하나씩 되돌리면 됨 |
| 2 | kit 콘텐츠 파일 나누기(§3-4) → 미리보기 확인 → 병합 | 불러오는 중 표시만 | 브랜치 |
| 3 | 공통 `design/` 만들기: base·brand-blue·tokens.mjs·RECIPES·sync·check | 없음 | - |
| 4 | kit 디자인 적용 → 미리보기 확인 → 병합 | 있음 | 브랜치 |
| 5 | dic 디자인 적용 | 있음 | 커밋 |
| 6 | dgedu.link 3-3b (HeroUI 교체 포함) | 있음 | 커밋 |
| 7 | 다시 측정해 0단계와 비교, 각 저장소 STATUS·CHANGELOG, 상위 CLAUDE.md 표 설명 보완 | - | - |
| 8 | (따로) 계열 사이트 적용 - §7. 세 사이트가 자리 잡은 뒤 사이트마다 운영자 확인 | 사이트별 | 사이트별 |

0단계는 따로 Lighthouse를 돌리지 않고 §1-4 실측(2026-11-14)을 기준값으로 쓴다.

**진행 기록**
- 2026-11-14 1단계 구현(각 저장소 `perf/stage1` 브랜치, 배포 전)
  - kit: `public/_routes.json`(빌드 파일·OG 그림·아이콘·catalog.json은 Functions 제외), `public/_headers`(`/assets/*` 1년), 머리띠 로고 `logo-64.png`(321KB → 6KB, 원본 `logo.png`는 아이콘·공유용으로 남김), GA 지연. 로컬 `wrangler pages dev`에서 해시 파일 1년 캐시·꾸러미 경로 OG 주입 확인.
  - edu-link: `run_worker_first` 경로 목록, `public/_headers`(`/assets/*`·`/fonts/*` 1년), `pretendard@1.3.9` 패키지 + `scripts/copy-fonts.mjs`(predev·prebuild가 `public/fonts/pretendard-1.3.9/`로 복사, git 밖), `index.html`·`siteRender.ts` jsdelivr 제거, GA 지연. 로컬 `wrangler dev`에서 확인: 해시 파일·글꼴 1년 캐시, `/sitemap.xml`·`/wp-admin`은 그대로 Worker, KV 시험 단축주소 307 이동(브라우저 이동 요청·일반 요청 둘 다), 첫 화면 글꼴 조각 10개 약 280KB(전에는 2,009KB). vitest 6/6 통과. `tsc` 오류 5개는 원래 있던 것(`index.ts`·`auth.ts`).
  - 교사 사이트(`siteRender.ts`) 화면은 로컬에 데이터가 없어 직접 보지 못했다 - 배포 뒤 실제 사이트 하나를 열어 글꼴 확인.

콘텐츠 나누기(2)는 화면 디자인과 겹치는 파일이 적어서 디자인보다 먼저 한다. 뷰어를 디자인할 때 이미 가벼워진 상태에서 확인할 수 있다.

1단계는 화면을 거의 바꾸지 않으면서 체감 속도가 가장 크게 달라지는 부분이라 먼저 한다.

---

## 5. 지킬 것·위험

- **단축주소 이동은 죽으면 안 된다** - 3-3a의 `run_worker_first` 변경은 로컬 `wrangler dev`로 단축주소·`/s/…` 사이트·SPA 새로고침·정적 파일을 모두 확인한 뒤 배포.
- D1 `edu-link-db`는 kit과 같이 쓰지만 이번 작업은 DB를 건드리지 않는다.
- 무료 티어 유지: 글꼴·정적 파일은 Pages/Workers 정적 자산(무료). 정적 요청을 함수에서 빼므로 오히려 한도를 아낀다.
- 글꼴 라이선스: Pretendard SIL OFL 1.1 - 라이선스 파일을 같이 둔다.
- portal은 오프라인 인트라넷 제품이라 이번 공통 파일을 따라 바꾸지 않는다. 값이 같게 유지되는지만 `design/README`에 적어 둔다(portal 토큰을 바꿀 때 여기도 볼 것).
- 화면 문구를 고치면 상위 '화면 글투' 규칙 점검.

---

## 6. 운영자 결정 (2026-11-14)

| # | 질문 | 결정 |
|---|---|---|
| D1 | 기준 토큰: portal vs on | **portal** (§1-2) |
| D2 | 공통 파일 둘 곳 | **`edu-link/design/`**. 다른 dgedu.link 계열 사이트에도 쓸 수 있는지 더 확인할 것 → §7 |
| D3 | dic 글꼴 | **Pretendard 조각으로 바꿈** (2026-10 '글꼴 받지 않음' 결정을 바꿈) |
| D4 | 다크 모드 | **이번엔 켜지 않음**. 의미 이름(`paper/surface/ink/line`)을 써서 나중에 변수만 바꾸면 되게 해 둔다 |
| D5 | kit 콘텐츠 파일 나누기 | **이번 범위에 넣음** → §3-4 |

---

## 7. 다른 dgedu.link 계열 사이트에 쓸 수 있는지 (D2 확인)

| 사이트 | 지금 모습 | 브랜드 색 | 글꼴 | 판단 |
|---|---|---|---|---|
| **dgedu-ssac** (ssac.dgedu.link) | Vite + React 18 + **Tailwind 3**. `tailwind.config.ts` 주석이 "Codeit 토큰 구조 × 새싹 그린" - `brand-50~900`·`ink/paper/surface/line` 이름이 세 사이트와 같다 | 새싹 그린(유지) | `pretendard` npm 조각 - **이미 이번 계획의 방식** | **쓸 수 있음.** 공통층 값은 `tokens.mjs`로 받고 브랜드층만 그린. `ink-faint`를 `#6b7588`(대비 4.6:1)로 진하게 바꿔 둔 것은 공통층에 거꾸로 가져올 만하다(§2-5와 같은 문제의식). Tailwind 4로 옮기는 일은 따로 |
| **edu-maps** (map.dgedu.link) | Next.js 16 정적 + Tailwind 4. `brand`는 초록 한 단계뿐, 실제로는 `emerald-*` 92곳. 시스템 설정 따라 **다크 모드 있음** | 초록(유지) | jsdelivr 조각 CSS(CDN) | **일부.** 글꼴 자체 호스팅과 base 규칙은 바로 쓸 수 있다. 중립·상태색은 다크값이 필요해 D4(다크 모드)를 할 때 같이 |
| **dgedu-team** (team.dgedu.link) | Workers + React 19 + Tailwind 4. 토큰이 거의 없고 `slate`·`emerald` 직접 사용 | 미정(emerald가 많음) | jsdelivr 전체 글꼴 CSS. 그런데 CSS의 글꼴 이름이 `'PretendardVariable'`이고 CDN이 선언한 이름은 `'Pretendard Variable'`이라 **Pretendard가 적용되지 않는다**(코드로 확인, 화면은 확인 안 함) | **전부 쓸 수 있음.** 토큰이 없어서 부딪히는 것이 없다. 브랜드 색을 파랑으로 할지 초록으로 할지 운영자 확인 필요. 글꼴 이름 오류는 작은 수정이라 먼저 고칠 만하다 |
| dge-atlas (atlas.dgedu.link) | Tailwind 4 + **ADS 토큰**(나래에서 옮김), 다크 모드, 글꼴 자체 호스팅 | ADS 파랑 | 자체 호스팅 | **제외** - on·나래(ADS) 계열 |
| dge-narae, dgedu-agent(on) | ADS | - | 자체 호스팅 | **제외** - ADS 계열 정본 |
| dgedu-portal | 이 토큰의 출처. 인트라넷 오프라인 설치형 | Codeit 파랑 | 전체 파일 자체 호스팅(오프라인 전제라 맞음) | **제외** - 복사본을 받지 않고, portal 토큰을 바꿀 때 `design/README.md`를 같이 본다 |
| dgedu-dic 데스크톱(`desktop/`) | .NET 앱 안 `wwwroot/css/app.css` | - | - | 나중에 |

정리
- dgedu.link 계열은 **ADS 계열(나래·온에듀·대구교육지도)** 과 **Codeit 계열(포털·링크·꾸러미·사전·ON싹·에듀맵스·에듀팀)** 두 갈래다. `edu-link/design/`은 Codeit 계열의 공통 파일이 된다.
- 브랜드 색이 사이트마다 다른 것(파랑·그린·초록)은 사이트 성격 구분으로 보고 유지한다. 그래서 §2-3에서 공통층과 브랜드층을 나눴다.
- 세 사이트에 먼저 적용하고 공통 파일이 자리 잡은 뒤(§4의 8단계), ssac → team → maps 순으로 사이트마다 따로 계획한다. team 글꼴 이름 오류는 그 전에 따로 고쳐도 된다.
