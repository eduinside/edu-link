// Pretendard 가변 글꼴 조각(dynamic subset)을 npm 패키지에서 public/fonts/ 로 복사한다(predev·prebuild).
// 화면에 나온 글자가 든 조각만 브라우저가 받는다. 예전에는 jsdelivr에서 전체 글꼴(약 2MB)을 받았다.
// SPA(index.html)와 교사 사이트(src/server/routes/siteRender.ts)가 같은 고정 주소를 써야 해서
// Vite 해시 파일(/assets/)이 아니라 public/ 에 둔다. 주소에 버전을 넣어 1년 캐시(public/_headers)해도 안전하다.
// 패키지 버전을 올리면 FONT_DIR, index.html, siteRender.ts 의 주소를 같이 바꾼다.
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = resolve(root, "node_modules/pretendard");
const version = JSON.parse(readFileSync(resolve(pkgDir, "package.json"), "utf8")).version;
const FONT_DIR = `pretendard-${version}`;
if (version !== "1.3.9") throw new Error(`pretendard ${version}: 주소(pretendard-1.3.9)를 쓰는 곳을 같이 바꿀 것`);

const src = resolve(pkgDir, "dist/web/variable");
const out = resolve(root, "public/fonts", FONT_DIR);
mkdirSync(out, { recursive: true });
cpSync(resolve(src, "pretendardvariable-dynamic-subset.css"), resolve(out, "pretendardvariable-dynamic-subset.css"));
cpSync(resolve(src, "woff2-dynamic-subset"), resolve(out, "woff2-dynamic-subset"), { recursive: true });
const license = ["LICENSE", "LICENSE.txt"].map((f) => resolve(pkgDir, f)).find(existsSync);
if (license) cpSync(license, resolve(out, "LICENSE.txt"));
console.log(`→ public/fonts/${FONT_DIR}/`);
