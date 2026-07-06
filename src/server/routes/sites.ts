// src/server/routes/sites.ts
// 에듀링크 페이지: 사이트 CRUD API (Step 2)
// 기존 `api` Hono 인스턴스(authMiddleware 적용됨)에 등록한다.
import { Hono } from 'hono';
import { generateRandomSlug, isValidCustomSlug } from '../utils/slug';
import { renderAllSnapshots, renderDraftResponse, pubKey } from './siteRender';

type UserVariables = { user: { id: number; email: string; name: string; level: number } };
type ApiApp = Hono<{ Bindings: Env; Variables: UserVariables }>;

const SITE_MIN_LEVEL = 3;

function normalizeSlug(raw: string): string {
    let s = String(raw).trim();
    try { s = decodeURIComponent(s).normalize('NFC'); } catch { s = s.normalize('NFC'); }
    return s;
}

async function loadReservedSet(c: any): Promise<Set<string>> {
    const reserved = await c.env.DB.prepare("SELECT slug FROM reserved_slugs").all();
    return new Set((reserved.results as Array<{ slug: string }>).map((r) => r.slug.toLowerCase()));
}

// base/custom/slug 풀 전체에서 중복 여부 확인 (선택적으로 특정 id 제외)
async function slugTaken(c: any, slug: string, exceptId?: number): Promise<boolean> {
    const sql = exceptId
        ? "SELECT id FROM urls WHERE (base_slug = ? OR custom_slug = ? OR slug = ?) AND id != ?"
        : "SELECT id FROM urls WHERE base_slug = ? OR custom_slug = ? OR slug = ?";
    const stmt = exceptId
        ? c.env.DB.prepare(sql).bind(slug, slug, slug, exceptId)
        : c.env.DB.prepare(sql).bind(slug, slug, slug);
    return !!(await stmt.first());
}

// 여러 후보 슬러그의 사용 여부를 1회 쿼리로 확인 (LAX 왕복 절감)
async function takenSlugSet(c: any, candidates: string[]): Promise<Set<string>> {
    if (!candidates.length) return new Set();
    const ph = candidates.map(() => '?').join(',');
    const { results } = await c.env.DB.prepare(
        `SELECT slug, base_slug, custom_slug FROM urls WHERE slug IN (${ph}) OR base_slug IN (${ph}) OR custom_slug IN (${ph})`
    ).bind(...candidates, ...candidates, ...candidates).all();
    const taken = new Set<string>();
    for (const r of results as Array<{ slug: string; base_slug: string | null; custom_slug: string | null }>) {
        if (r.slug) taken.add(r.slug);
        if (r.base_slug) taken.add(r.base_slug);
        if (r.custom_slug) taken.add(r.custom_slug);
    }
    return taken;
}

// base_slug 자동 발급: 후보 12개를 1회 검사로 충돌 회피
async function issueBaseSlug(c: any, reservedSet: Set<string>): Promise<string | null> {
    const cands: string[] = [];
    for (let i = 0; i < 12; i++) {
        const cand = generateRandomSlug(6);
        if (!reservedSet.has(cand.toLowerCase())) cands.push(cand);
    }
    if (!cands.length) return null;
    const taken = await takenSlugSet(c, cands);
    return cands.find(s => !taken.has(s)) ?? null;
}

// 사이트의 모든 게시 KV 키 삭제 (미공개 전환/삭제/슬러그 변경 시)
async function deletePubKeys(c: any, siteId: number | string, slug: string): Promise<void> {
    try {
        const { results } = await c.env.DB.prepare("SELECT path FROM site_snapshots WHERE site_id = ?").bind(siteId).all();
        for (const r of results as Array<{ path: string }>) {
            try { await c.env.URL_CACHE.delete(pubKey(slug, r.path)); } catch { /* noop */ }
        }
    } catch { /* noop */ }
}

export function registerSiteRoutes(api: ApiApp) {
    // GET /api/sites — 내 사이트 목록
    api.get('/sites', async (c) => {
        const user = c.get('user');
        if (user.level < SITE_MIN_LEVEL) {
            return c.json({ success: false, error: '에듀링크 페이지 기능은 고급사용자(레벨 3) 이상 권한이 필요합니다.' }, 403);
        }
        try {
            const { results } = await c.env.DB.prepare(
                `SELECT s.id, s.title, s.is_public, s.home_page_id, s.rev, s.published_rev, s.published_at, s.created_at, s.updated_at,
                        u.id AS url_id, u.slug, u.base_slug, u.custom_slug, u.click_count, u.is_active,
                        (SELECT COUNT(*) FROM site_pages sp WHERE sp.site_id = s.id) AS page_count
                 FROM sites s JOIN urls u ON u.id = s.url_id
                 WHERE s.user_id = ?
                 ORDER BY s.created_at DESC`
            ).bind(user.id).all();
            return c.json({ success: true, sites: results });
        } catch (err: any) {
            return c.json({ success: false, error: err.message }, 500);
        }
    });

    // POST /api/sites — 사이트 생성 (base_slug 자동발급 + 선택 custom_slug)
    api.post('/sites', async (c) => {
        const user = c.get('user');
        if (user.level < SITE_MIN_LEVEL) {
            return c.json({ success: false, error: '에듀링크 페이지 기능은 고급사용자(레벨 3) 이상 권한이 필요합니다.' }, 403);
        }
        try {
            const body = await c.req.json();
            const title = body.title;
            const inputCustomSlug = body.custom_slug ?? body.slug ?? null;
            if (!title || !String(title).trim()) {
                return c.json({ success: false, error: '사이트 제목이 필요합니다.' }, 400);
            }

            const reservedSet = await loadReservedSet(c);

            // 선택 custom_slug 검증
            let customSlug: string | null = null;
            if (inputCustomSlug && String(inputCustomSlug).trim()) {
                const cs = normalizeSlug(inputCustomSlug);
                if (!isValidCustomSlug(cs)) {
                    return c.json({ success: false, error: '슬러그는 4~20자의 영숫자, 한글, 하이픈만 사용할 수 있습니다.' }, 400);
                }
                if (reservedSet.has(cs.toLowerCase())) {
                    return c.json({ success: false, error: '사용할 수 없는 예약 슬러그입니다.' }, 400);
                }
                if (await slugTaken(c, cs)) {
                    return c.json({ success: false, error: '이미 사용 중인 슬러그입니다.' }, 400);
                }
                customSlug = cs;
            }

            // base_slug 자동 발급 (후보 12개 1회 검사)
            const baseSlug = await issueBaseSlug(c, reservedSet);
            if (!baseSlug) {
                return c.json({ success: false, error: '슬러그 생성에 실패했습니다.' }, 500);
            }

            const publicSlug = customSlug || baseSlug;
            const cleanTitle = String(title).trim();

            // 1) urls 행 (kind='site', original_url은 placeholder)
            const urlRes = await c.env.DB.prepare(
                `INSERT INTO urls (slug, base_slug, custom_slug, original_url, title, description, is_public, user_id, kind)
                 VALUES (?, ?, ?, ?, ?, '', 0, ?, 'site')`
            ).bind(baseSlug, baseSlug, customSlug, '/' + publicSlug, cleanTitle, user.id).run();
            const urlId = Number(urlRes.meta.last_row_id);

            // 2) sites 행
            const siteRes = await c.env.DB.prepare(
                `INSERT INTO sites (user_id, url_id, title) VALUES (?, ?, ?)`
            ).bind(user.id, urlId, cleanTitle).run();
            const siteId = Number(siteRes.meta.last_row_id);

            // 3) 역참조 연결
            await c.env.DB.prepare("UPDATE urls SET site_id = ? WHERE id = ?").bind(siteId, urlId).run();

            return c.json({
                success: true,
                id: siteId,
                url_id: urlId,
                base_slug: baseSlug,
                custom_slug: customSlug,
                slug: publicSlug,
            });
        } catch (err: any) {
            return c.json({ success: false, error: err.message }, 500);
        }
    });

    // GET /api/sites/:id — 사이트 상세 (페이지 트리 포함)
    api.get('/sites/:id', async (c) => {
        const user = c.get('user');
        if (user.level < SITE_MIN_LEVEL) {
            return c.json({ success: false, error: '에듀링크 페이지 기능은 고급사용자(레벨 3) 이상 권한이 필요합니다.' }, 403);
        }
        const id = c.req.param('id');
        try {
            const site = await c.env.DB.prepare(
                `SELECT s.id, s.title, s.theme, s.is_public, s.home_page_id, s.rev, s.published_rev, s.published_at, s.created_at, s.updated_at,
                        u.slug, u.base_slug, u.custom_slug
                 FROM sites s JOIN urls u ON u.id = s.url_id
                 WHERE s.id = ? AND s.user_id = ?`
            ).bind(id, user.id).first();
            if (!site) return c.json({ success: false, error: '사이트를 찾을 수 없거나 권한이 없습니다.' }, 404);

            const { results: pages } = await c.env.DB.prepare(
                `SELECT id, parent_id, slug, title, depth, sort, icon
                 FROM site_pages WHERE site_id = ? ORDER BY depth, sort, id`
            ).bind(id).all();

            return c.json({ success: true, site, pages });
        } catch (err: any) {
            return c.json({ success: false, error: err.message }, 500);
        }
    });

    // PATCH /api/sites/:id — title / custom_slug(주소변경) / is_public / home_page_id
    api.patch('/sites/:id', async (c) => {
        const user = c.get('user');
        if (user.level < SITE_MIN_LEVEL) {
            return c.json({ success: false, error: '에듀링크 페이지 기능은 고급사용자(레벨 3) 이상 권한이 필요합니다.' }, 403);
        }
        const id = c.req.param('id');
        try {
            const body = await c.req.json();
            const { title, custom_slug, is_public, home_page_id, theme } = body;

            const site = await c.env.DB.prepare(
                "SELECT s.id, s.url_id, u.base_slug, u.custom_slug FROM sites s JOIN urls u ON u.id = s.url_id WHERE s.id = ? AND s.user_id = ?"
            ).bind(id, user.id).first<{ id: number; url_id: number; base_slug: string; custom_slug: string | null }>();
            if (!site) return c.json({ success: false, error: '사이트를 찾을 수 없거나 권한이 없습니다.' }, 404);

            let contentChanged = false;

            // 주소(custom_slug) 변경 — urls 행에 반영
            if (custom_slug !== undefined) {
                let updatedCustomSlug: string | null = site.custom_slug;
                if (!custom_slug || String(custom_slug).trim() === '') {
                    updatedCustomSlug = null;
                } else {
                    const cs = normalizeSlug(custom_slug);
                    if (cs === site.base_slug) {
                        updatedCustomSlug = null;
                    } else {
                        if (!isValidCustomSlug(cs)) {
                            return c.json({ success: false, error: '슬러그는 4~20자의 영숫자, 한글, 하이픈만 사용할 수 있습니다.' }, 400);
                        }
                        const reservedSet = await loadReservedSet(c);
                        if (reservedSet.has(cs.toLowerCase())) {
                            return c.json({ success: false, error: '사용할 수 없는 예약 슬러그입니다.' }, 400);
                        }
                        if (await slugTaken(c, cs, site.url_id)) {
                            return c.json({ success: false, error: '이미 사용 중인 슬러그입니다.' }, 400);
                        }
                        updatedCustomSlug = cs;
                    }
                }
                const newPublic = updatedCustomSlug || site.base_slug;
                await c.env.DB.prepare(
                    "UPDATE urls SET custom_slug = ?, original_url = ?, updated_at = datetime('now') WHERE id = ?"
                ).bind(updatedCustomSlug, '/' + newPublic, site.url_id).run();
                if (updatedCustomSlug !== site.custom_slug) {
                    contentChanged = true;
                    // 이전 슬러그의 게시 KV 키 정리 (재발행 전까지 stale 방지)
                    await deletePubKeys(c, id, site.custom_slug || site.base_slug);
                }
            }

            // sites 필드 수정
            const sets: string[] = [];
            const binds: any[] = [];
            if (title !== undefined) {
                if (!String(title).trim()) return c.json({ success: false, error: '사이트 제목이 비어 있습니다.' }, 400);
                sets.push('title = ?'); binds.push(String(title).trim());
                contentChanged = true;
                // urls.title 도 함께 갱신(목록 표기 일관성)
                await c.env.DB.prepare("UPDATE urls SET title = ? WHERE id = ?").bind(String(title).trim(), site.url_id).run();
            }
            if (is_public !== undefined) {
                sets.push('is_public = ?'); binds.push(is_public ? 1 : 0);
                // 게시 중단 시 공개 KV 즉시 제거 (D1 serve는 is_public=1만 반환)
                if (!is_public) await deletePubKeys(c, id, site.custom_slug || site.base_slug);
            }
            if (theme !== undefined) { sets.push('theme = ?'); binds.push(JSON.stringify(normalizeTheme(theme))); contentChanged = true; }
            if (home_page_id !== undefined) {
                // 소유 사이트의 페이지인지 검증
                if (home_page_id !== null) {
                    const pg = await c.env.DB.prepare("SELECT id FROM site_pages WHERE id = ? AND site_id = ?")
                        .bind(home_page_id, id).first();
                    if (!pg) return c.json({ success: false, error: '홈으로 지정할 페이지를 찾을 수 없습니다.' }, 400);
                }
                sets.push('home_page_id = ?'); binds.push(home_page_id); contentChanged = true;
            }
            // 콘텐츠에 영향을 주는 변경만 rev 증가(is_public 토글은 제외 = 재발행 불필요)
            if (contentChanged) sets.push("rev = rev + 1");
            sets.push("updated_at = datetime('now')");
            binds.push(id);
            await c.env.DB.prepare(`UPDATE sites SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();

            return c.json({ success: true });
        } catch (err: any) {
            return c.json({ success: false, error: err.message }, 500);
        }
    });

    // DELETE /api/sites/:id — 사이트 + 하위(페이지/섹션) + urls 행 회수
    api.delete('/sites/:id', async (c) => {
        const user = c.get('user');
        if (user.level < SITE_MIN_LEVEL) {
            return c.json({ success: false, error: '에듀링크 페이지 기능은 고급사용자(레벨 3) 이상 권한이 필요합니다.' }, 403);
        }
        const id = c.req.param('id');
        try {
            const site = await c.env.DB.prepare(
                "SELECT s.id, s.url_id, u.base_slug, u.custom_slug, u.slug FROM sites s JOIN urls u ON u.id = s.url_id WHERE s.id = ? AND s.user_id = ?"
            ).bind(id, user.id).first<{ id: number; url_id: number; base_slug: string; custom_slug: string | null; slug: string }>();
            if (!site) return c.json({ success: false, error: '사이트를 찾을 수 없거나 권한이 없습니다.' }, 404);

            // 게시 KV 키 정리 (스냅샷 경로 기준) — 삭제 전에 수행
            await deletePubKeys(c, id, site.custom_slug || site.base_slug);

            // R2 미디어 전량 삭제 (sites/{id}/ 프리픽스, 1000개 초과분까지 커서로 순회)
            await deleteMediaByPrefix(c, `sites/${id}/`);

            // FK CASCADE 의존하지 않고 명시적으로 하위부터 삭제 (D1 안전)
            await c.env.DB.batch([
                c.env.DB.prepare("DELETE FROM site_snapshots WHERE site_id = ?").bind(id),
                c.env.DB.prepare(
                    "DELETE FROM site_sections WHERE page_id IN (SELECT id FROM site_pages WHERE site_id = ?)"
                ).bind(id),
                c.env.DB.prepare("DELETE FROM site_pages WHERE site_id = ?").bind(id),
                c.env.DB.prepare("DELETE FROM sites WHERE id = ?").bind(id),
                c.env.DB.prepare("DELETE FROM urls WHERE id = ?").bind(site.url_id),
            ]);

            // 슬러그 회수 — 리다이렉트 KV 캐시 정리(혹시 남아 있을 수 있는 키)
            for (const s of [site.slug, site.base_slug, site.custom_slug]) {
                if (s) { try { await c.env.URL_CACHE.delete(s); } catch {} }
            }

            return c.json({ success: true });
        } catch (err: any) {
            return c.json({ success: false, error: err.message }, 500);
        }
    });
}

// ─────────────────────────────────────────────────────────────
// Step 3: 페이지 CRUD (depth ≤ 2)
// ─────────────────────────────────────────────────────────────

// 경로는 조상 슬러그 체인(/{siteSlug}/{depth0}/{depth1}). 세그먼트 2개 = 내부 depth 0,1.
// 홈은 /{siteSlug}(bare)로도 노출. 사용자 표기 "subpage-depth1/depth2" = 내부 depth 0/1.
const MAX_DEPTH = 1;
const MAX_LEVEL_LABEL = 2; // 사용자 표기 단계 수

// 소유 사이트 검증 (없으면 null)
async function ownedSite(c: any, siteId: number | string, userId: number) {
    return await c.env.DB.prepare("SELECT id, url_id, home_page_id FROM sites WHERE id = ? AND user_id = ?")
        .bind(siteId, userId).first();
}

// 소유 페이지 검증 (site 소유권까지 조인)
async function ownedPage(c: any, pageId: number | string, userId: number) {
    return await c.env.DB.prepare(
        `SELECT p.id, p.site_id, p.parent_id, p.slug, p.title, p.depth, p.sort, p.icon
         FROM site_pages p JOIN sites s ON s.id = p.site_id
         WHERE p.id = ? AND s.user_id = ?`
    ).bind(pageId, userId).first();
}

async function bumpRev(c: any, siteId: number | string) {
    await c.env.DB.prepare("UPDATE sites SET rev = rev + 1, updated_at = datetime('now') WHERE id = ?").bind(siteId).run();
}

// 형제 내 slug 중복 여부 (parent_id NULL 처리 포함)
async function siblingSlugTaken(c: any, siteId: number, parentId: number | null, slug: string, exceptId?: number): Promise<boolean> {
    const parentCond = parentId === null ? "parent_id IS NULL" : "parent_id = ?";
    const exceptCond = exceptId ? " AND id != ?" : "";
    const sql = `SELECT id FROM site_pages WHERE site_id = ? AND ${parentCond} AND slug = ?${exceptCond}`;
    const binds: any[] = [siteId];
    if (parentId !== null) binds.push(parentId);
    binds.push(slug);
    if (exceptId) binds.push(exceptId);
    return !!(await c.env.DB.prepare(sql).bind(...binds).first());
}

// 특정 페이지의 모든 후손 (자기 제외) — depth 포함
async function getDescendants(c: any, siteId: number, rootId: number): Promise<Array<{ id: number; depth: number }>> {
    const { results } = await c.env.DB.prepare(
        "SELECT id, parent_id, depth FROM site_pages WHERE site_id = ?"
    ).bind(siteId).all();
    const rows = results as Array<{ id: number; parent_id: number | null; depth: number }>;
    const childrenOf = new Map<number, Array<{ id: number; depth: number }>>();
    for (const r of rows) {
        const p = r.parent_id ?? -1;
        if (!childrenOf.has(p)) childrenOf.set(p, []);
        childrenOf.get(p)!.push({ id: r.id, depth: r.depth });
    }
    const out: Array<{ id: number; depth: number }> = [];
    const stack = [rootId];
    while (stack.length) {
        const cur = stack.pop()!;
        for (const ch of childrenOf.get(cur) ?? []) {
            out.push(ch);
            stack.push(ch.id);
        }
    }
    return out;
}

export function registerPageRoutes(api: ApiApp) {
    // POST /api/sites/:id/pages — 페이지 생성
    api.post('/sites/:id/pages', async (c) => {
        const user = c.get('user');
        if (user.level < SITE_MIN_LEVEL) return c.json({ success: false, error: '권한이 필요합니다.' }, 403);
        const siteId = c.req.param('id');
        try {
            const site = await ownedSite(c, siteId, user.id);
            if (!site) return c.json({ success: false, error: '사이트를 찾을 수 없거나 권한이 없습니다.' }, 404);

            const body = await c.req.json();
            const title = String(body.title ?? '').trim();
            if (!title) return c.json({ success: false, error: '페이지 제목이 필요합니다.' }, 400);

            const slug = normalizeSlug(body.slug ?? '');
            if (!isValidCustomSlug(slug)) {
                return c.json({ success: false, error: '페이지 슬러그는 4~20자의 영숫자, 한글, 하이픈만 사용할 수 있습니다.' }, 400);
            }

            // 부모 검증 + depth 계산
            let parentId: number | null = null;
            let depth = 0;
            if (body.parent_id !== undefined && body.parent_id !== null) {
                const parent = await c.env.DB.prepare("SELECT id, depth FROM site_pages WHERE id = ? AND site_id = ?")
                    .bind(body.parent_id, siteId).first<{ id: number; depth: number }>();
                if (!parent) return c.json({ success: false, error: '상위 페이지를 찾을 수 없습니다.' }, 400);
                depth = parent.depth + 1;
                if (depth > MAX_DEPTH) return c.json({ success: false, error: `페이지는 최대 ${MAX_DEPTH + 1}단계까지만 만들 수 있습니다.` }, 422);
                parentId = parent.id;
            }

            if (await siblingSlugTaken(c, Number(siteId), parentId, slug)) {
                return c.json({ success: false, error: '같은 위치에 동일한 슬러그의 페이지가 이미 있습니다.' }, 400);
            }

            // sort = 형제 중 최대 + 1
            const maxRow = await c.env.DB.prepare(
                `SELECT COALESCE(MAX(sort), -1) AS m FROM site_pages WHERE site_id = ? AND ${parentId === null ? 'parent_id IS NULL' : 'parent_id = ?'}`
            ).bind(...(parentId === null ? [siteId] : [siteId, parentId])).first<{ m: number }>();
            const sort = (maxRow?.m ?? -1) + 1;

            const res = await c.env.DB.prepare(
                "INSERT INTO site_pages (site_id, parent_id, slug, title, depth, sort) VALUES (?, ?, ?, ?, ?, ?)"
            ).bind(siteId, parentId, slug, title, depth, sort).run();
            const pageId = Number(res.meta.last_row_id);

            // 첫 페이지면 사이트 홈으로 지정
            if (!site.home_page_id) {
                await c.env.DB.prepare("UPDATE sites SET home_page_id = ? WHERE id = ?").bind(pageId, siteId).run();
            }
            await bumpRev(c, siteId);

            return c.json({ success: true, id: pageId, slug, depth, sort });
        } catch (err: any) {
            return c.json({ success: false, error: err.message }, 500);
        }
    });

    // GET /api/pages/:id — 페이지 + 섹션
    api.get('/pages/:id', async (c) => {
        const user = c.get('user');
        if (user.level < SITE_MIN_LEVEL) return c.json({ success: false, error: '권한이 필요합니다.' }, 403);
        try {
            const page = await ownedPage(c, c.req.param('id'), user.id);
            if (!page) return c.json({ success: false, error: '페이지를 찾을 수 없거나 권한이 없습니다.' }, 404);
            const { results: sections } = await c.env.DB.prepare(
                "SELECT id, type, content, sort FROM site_sections WHERE page_id = ? ORDER BY sort, id"
            ).bind(page.id).all();
            return c.json({ success: true, page, sections });
        } catch (err: any) {
            return c.json({ success: false, error: err.message }, 500);
        }
    });

    // PATCH /api/pages/:id — title / slug / 이동(parent_id)
    api.patch('/pages/:id', async (c) => {
        const user = c.get('user');
        if (user.level < SITE_MIN_LEVEL) return c.json({ success: false, error: '권한이 필요합니다.' }, 403);
        const id = Number(c.req.param('id'));
        try {
            const page = await ownedPage(c, id, user.id) as any;
            if (!page) return c.json({ success: false, error: '페이지를 찾을 수 없거나 권한이 없습니다.' }, 404);
            const body = await c.req.json();

            let newParentId: number | null = page.parent_id;
            let newDepth: number = page.depth;

            // 이동 처리
            if (body.parent_id !== undefined && body.parent_id !== page.parent_id) {
                if (body.parent_id === id) return c.json({ success: false, error: '자기 자신을 상위로 지정할 수 없습니다.' }, 422);
                const descendants = await getDescendants(c, page.site_id, id);
                if (body.parent_id === null) {
                    newParentId = null;
                    newDepth = 0;
                } else {
                    const parent = await c.env.DB.prepare("SELECT id, depth FROM site_pages WHERE id = ? AND site_id = ?")
                        .bind(body.parent_id, page.site_id).first<{ id: number; depth: number }>();
                    if (!parent) return c.json({ success: false, error: '상위 페이지를 찾을 수 없습니다.' }, 400);
                    if (descendants.some(d => d.id === parent.id)) {
                        return c.json({ success: false, error: '하위 페이지를 상위로 지정할 수 없습니다.' }, 422);
                    }
                    newParentId = parent.id;
                    newDepth = parent.depth + 1;
                }
                // 후손까지 depth 한도 검증
                const subtreeHeight = descendants.length ? Math.max(...descendants.map(d => d.depth)) - page.depth : 0;
                if (newDepth + subtreeHeight > MAX_DEPTH) {
                    return c.json({ success: false, error: `이동 시 페이지 단계 한도(${MAX_DEPTH + 1}단계)를 초과합니다.` }, 422);
                }
                // 후손 depth 일괄 갱신
                const delta = newDepth - page.depth;
                if (delta !== 0 && descendants.length) {
                    await c.env.DB.batch(descendants.map(d =>
                        c.env.DB.prepare("UPDATE site_pages SET depth = ? WHERE id = ?").bind(d.depth + delta, d.id)
                    ));
                }
            }

            // slug 변경
            let newSlug = page.slug;
            if (body.slug !== undefined) {
                const s = normalizeSlug(body.slug);
                if (!isValidCustomSlug(s)) return c.json({ success: false, error: '페이지 슬러그 형식이 올바르지 않습니다.' }, 400);
                newSlug = s;
            }
            // 형제 중복 검사 (이동/이름변경 반영된 위치 기준)
            if (newSlug !== page.slug || newParentId !== page.parent_id) {
                if (await siblingSlugTaken(c, page.site_id, newParentId, newSlug, id)) {
                    return c.json({ success: false, error: '같은 위치에 동일한 슬러그의 페이지가 이미 있습니다.' }, 400);
                }
            }

            const newTitle = body.title !== undefined ? String(body.title).trim() : page.title;
            if (!newTitle) return c.json({ success: false, error: '페이지 제목이 비어 있습니다.' }, 400);

            const newIcon = body.icon !== undefined ? (body.icon === null ? null : String(body.icon).slice(0, 10)) : page.icon;

            await c.env.DB.prepare(
                "UPDATE site_pages SET title = ?, slug = ?, parent_id = ?, depth = ?, icon = ?, updated_at = datetime('now') WHERE id = ?"
            ).bind(newTitle, newSlug, newParentId, newDepth, newIcon, id).run();
            await bumpRev(c, page.site_id);

            return c.json({ success: true });
        } catch (err: any) {
            return c.json({ success: false, error: err.message }, 500);
        }
    });

    // DELETE /api/pages/:id — 페이지 + 후손 + 섹션 삭제
    api.delete('/pages/:id', async (c) => {
        const user = c.get('user');
        if (user.level < SITE_MIN_LEVEL) return c.json({ success: false, error: '권한이 필요합니다.' }, 403);
        const id = Number(c.req.param('id'));
        try {
            const page = await ownedPage(c, id, user.id) as any;
            if (!page) return c.json({ success: false, error: '페이지를 찾을 수 없거나 권한이 없습니다.' }, 404);

            const descendants = await getDescendants(c, page.site_id, id);
            const allIds = [id, ...descendants.map(d => d.id)];
            const placeholders = allIds.map(() => '?').join(',');

            // 삭제될 페이지(하위 포함)의 이미지 섹션은 R2 객체도 함께 정리
            const { results: imgRows } = await c.env.DB.prepare(
                `SELECT content FROM site_sections WHERE type = 'image' AND page_id IN (${placeholders})`
            ).bind(...allIds).all<{ content: string }>();
            for (const row of imgRows as Array<{ content: string }>) {
                let url: string | undefined;
                try { url = JSON.parse(row.content || '{}').url; } catch { /* noop */ }
                if (url) await deleteMediaByUrl(c, url);
            }

            await c.env.DB.batch([
                c.env.DB.prepare(`DELETE FROM site_sections WHERE page_id IN (${placeholders})`).bind(...allIds),
                c.env.DB.prepare(`DELETE FROM site_pages WHERE id IN (${placeholders})`).bind(...allIds),
            ]);

            // 홈 페이지였다면 홈 재지정 (남은 최상위 첫 페이지)
            const site = await c.env.DB.prepare("SELECT home_page_id FROM sites WHERE id = ?").bind(page.site_id).first<{ home_page_id: number | null }>();
            if (site && (site.home_page_id === null || allIds.includes(site.home_page_id))) {
                const next = await c.env.DB.prepare(
                    "SELECT id FROM site_pages WHERE site_id = ? AND parent_id IS NULL ORDER BY sort, id LIMIT 1"
                ).bind(page.site_id).first<{ id: number }>();
                await c.env.DB.prepare("UPDATE sites SET home_page_id = ? WHERE id = ?").bind(next?.id ?? null, page.site_id).run();
            }
            await bumpRev(c, page.site_id);

            return c.json({ success: true });
        } catch (err: any) {
            return c.json({ success: false, error: err.message }, 500);
        }
    });

    // POST /api/pages/reorder — 형제 페이지 정렬 { order: [id, ...] }
    api.post('/pages/reorder', async (c) => {
        const user = c.get('user');
        if (user.level < SITE_MIN_LEVEL) return c.json({ success: false, error: '권한이 필요합니다.' }, 403);
        try {
            const body = await c.req.json();
            const order = Array.isArray(body.order) ? body.order : null;
            if (!order || !order.length) return c.json({ success: false, error: 'order 배열이 필요합니다.' }, 400);
            // 모두 같은 사용자 소유 페이지인지 확인
            let siteId: number | null = null;
            for (const pid of order) {
                const p = await ownedPage(c, pid, user.id) as any;
                if (!p) return c.json({ success: false, error: '페이지를 찾을 수 없거나 권한이 없습니다.' }, 404);
                siteId = p.site_id;
            }
            await c.env.DB.batch(order.map((pid: number, idx: number) =>
                c.env.DB.prepare("UPDATE site_pages SET sort = ? WHERE id = ?").bind(idx, pid)
            ));
            if (siteId) await bumpRev(c, siteId);
            return c.json({ success: true });
        } catch (err: any) {
            return c.json({ success: false, error: err.message }, 500);
        }
    });
}

// ─────────────────────────────────────────────────────────────
// Step 4: 섹션 CRUD (text / youtube)
// ─────────────────────────────────────────────────────────────

const ALLOWED_SECTION_TYPES = ['text', 'youtube', 'heading', 'divider', 'link', 'image', 'embed'];
const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

// /media/sites/{id}/{uuid}.ext → R2 key sites/{id}/{uuid}.ext (아니면 null)
function mediaKeyFromUrl(url: any): string | null {
    const s = String(url ?? '');
    return /^\/media\/[A-Za-z0-9/_.-]+$/.test(s) ? s.replace(/^\/media\//, '') : null;
}
async function deleteMediaByUrl(c: any, url: any): Promise<void> {
    const key = mediaKeyFromUrl(url);
    if (key && c.env.MEDIA) { try { await c.env.MEDIA.delete(key); } catch { /* noop */ } }
}

// R2에서 프리픽스에 해당하는 객체 전체 삭제 (1000개 초과 시 cursor로 순회)
async function deleteMediaByPrefix(c: any, prefix: string): Promise<void> {
    if (!c.env.MEDIA) return;
    try {
        let cursor: string | undefined;
        do {
            const listed = await c.env.MEDIA.list({ prefix, cursor });
            if (listed.objects.length) {
                try { await c.env.MEDIA.delete(listed.objects.map((o: any) => o.key)); } catch { /* noop */ }
            }
            cursor = listed.truncated ? listed.cursor : undefined;
        } while (cursor);
    } catch { /* noop */ }
}

function isHttpUrl(u: string): boolean {
    try { const x = new URL(String(u)); return x.protocol === 'http:' || x.protocol === 'https:'; } catch { return false; }
}

function parseYouTube(input: string): { videoId: string } | null {
    const v = String(input).trim();
    if (YT_ID_RE.test(v)) return { videoId: v };
    try {
        const u = new URL(v);
        const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '');
        if (host === 'youtu.be') {
            const id = u.pathname.slice(1).split('/')[0];
            if (YT_ID_RE.test(id)) return { videoId: id };
        } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
            const q = u.searchParams.get('v');
            if (q && YT_ID_RE.test(q)) return { videoId: q };
            const m = u.pathname.match(/\/(embed|shorts|v)\/([A-Za-z0-9_-]{11})/);
            if (m) return { videoId: m[2] };
        }
    } catch { /* not a URL */ }
    return null;
}

// 섹션 content 검증·정규화. 실패 시 Error throw.
function normalizeSectionContent(type: string, raw: any): any {
    if (type === 'text') {
        const text = typeof raw?.text === 'string' ? raw.text : '';
        if (text.length > 20000) throw new Error('텍스트가 너무 깁니다.');
        const format = raw?.format === 'plain' ? 'plain' : 'markdown';
        return { text, format };
    }
    if (type === 'youtube') {
        const input = String(raw?.url ?? raw?.videoId ?? '').trim();
        if (!input) return { videoId: '', title: '', start: 0 }; // 추가 직후 빈 상태 허용
        const p = parseYouTube(input);
        if (!p) throw new Error('유효한 유튜브 주소 또는 영상 ID가 아닙니다.');
        const startNum = Number(raw?.start);
        const start = Number.isFinite(startNum) && startNum > 0 ? Math.floor(startNum) : 0;
        const title = typeof raw?.title === 'string' ? raw.title.slice(0, 200) : '';
        return { videoId: p.videoId, title, start };
    }
    if (type === 'heading') {
        const text = (typeof raw?.text === 'string' ? raw.text : '').slice(0, 300).trim();
        if (!text) throw new Error('제목 텍스트가 필요합니다.');
        const level = raw?.level === 3 || raw?.level === '3' ? 3 : 2;
        const bg = raw?.bg === true;
        return { text, level, bg };
    }
    if (type === 'divider') {
        return {};
    }
    if (type === 'embed') {
        const html = (typeof raw?.html === 'string' ? raw.html : '').slice(0, 20000);
        return { html };
    }
    if (type === 'link') {
        const label = (typeof raw?.label === 'string' ? raw.label : '').slice(0, 200).trim() || '버튼';
        const url = String(raw?.url ?? '').trim();
        // 주소는 선택 — 있으면 http/https만. 비어 있으면 렌더 시 표시되지 않음.
        if (url && !isHttpUrl(url)) throw new Error('버튼 주소는 http/https로 시작해야 합니다.');
        const style = raw?.style === 'link' ? 'link' : 'button';
        const newTab = raw?.newTab !== false;
        const align = ['center', 'right', 'left'].includes(raw?.align) ? raw.align : 'left';
        return { label, url, style, newTab, align };
    }
    if (type === 'image') {
        // 자체 R2 프록시 경로(/media/...)만 허용 — 외부 핫링크 차단
        const url = String(raw?.url ?? '').trim();
        if (!/^\/media\/[A-Za-z0-9/_.-]+$/.test(url)) throw new Error('업로드한 이미지만 사용할 수 있습니다.');
        const alt = (typeof raw?.alt === 'string' ? raw.alt : '').slice(0, 300);
        const caption = (typeof raw?.caption === 'string' ? raw.caption : '').slice(0, 300);
        const width = ['full', 'wide', 'normal'].includes(raw?.width) ? raw.width : 'normal';
        return { url, alt, caption, width };
    }
    throw new Error('지원하지 않는 섹션 타입입니다.');
}

// 사이트 테마 검증·정규화
const HEX_RE = /^#[0-9A-Fa-f]{3,8}$/;
function normalizeTheme(raw: any): any {
    const t = raw && typeof raw === 'object' ? raw : {};
    const colors: any = {};
    const cIn = t.colors && typeof t.colors === 'object' ? t.colors : {};
    for (const k of ['primary', 'bg', 'text', 'muted', 'accent']) {
        if (typeof cIn[k] === 'string' && HEX_RE.test(cIn[k].trim())) colors[k] = cIn[k].trim();
    }
    const fIn = t.font && typeof t.font === 'object' ? t.font : {};
    const font: any = {};
    if (typeof fIn.family === 'string') font.family = fIn.family.slice(0, 80);
    // 구글폰트는 fonts.googleapis.com 도메인만 허용
    if (typeof fIn.googleFontUrl === 'string' && fIn.googleFontUrl.trim()) {
        try {
            const u = new URL(fIn.googleFontUrl.trim());
            if (u.protocol === 'https:' && u.hostname === 'fonts.googleapis.com') font.googleFontUrl = u.toString();
        } catch { /* ignore invalid */ }
    }
    const hIn = t.header && typeof t.header === 'object' ? t.header : {};
    const header: any = {};
    if (typeof hIn.title === 'string') header.title = hIn.title.slice(0, 120);
    header.showTitle = hIn.showTitle !== false;
    header.navPosition = ['side', 'right'].includes(hIn.navPosition) ? hIn.navPosition : 'top';

    const ftIn = t.footer && typeof t.footer === 'object' ? t.footer : {};
    const footer: any = {
        showNavigation: ftIn.showNavigation !== false
    };

    const cntIn = t.counter && typeof t.counter === 'object' ? t.counter : {};
    const counter: any = {
        showCounter: cntIn.showCounter === true
    };

    return { colors, font, header, footer, counter };
}

export function registerSectionRoutes(api: ApiApp) {
    // POST /api/pages/:id/sections — 섹션 추가
    api.post('/pages/:id/sections', async (c) => {
        const user = c.get('user');
        if (user.level < SITE_MIN_LEVEL) return c.json({ success: false, error: '권한이 필요합니다.' }, 403);
        try {
            const page = await ownedPage(c, c.req.param('id'), user.id) as any;
            if (!page) return c.json({ success: false, error: '페이지를 찾을 수 없거나 권한이 없습니다.' }, 404);

            const body = await c.req.json();
            const type = String(body.type ?? '');
            if (!ALLOWED_SECTION_TYPES.includes(type)) {
                return c.json({ success: false, error: '지원하지 않는 섹션 타입입니다.' }, 400);
            }
            let content: any;
            try { content = normalizeSectionContent(type, body.content ?? body); }
            catch (e: any) { return c.json({ success: false, error: e.message }, 400); }

            const maxRow = await c.env.DB.prepare("SELECT COALESCE(MAX(sort), -1) AS m FROM site_sections WHERE page_id = ?")
                .bind(page.id).first<{ m: number }>();
            const sort = (maxRow?.m ?? -1) + 1;

            const res = await c.env.DB.prepare(
                "INSERT INTO site_sections (page_id, type, content, sort) VALUES (?, ?, ?, ?)"
            ).bind(page.id, type, JSON.stringify(content), sort).run();
            await bumpRev(c, page.site_id);

            return c.json({ success: true, id: Number(res.meta.last_row_id), type, content, sort });
        } catch (err: any) {
            return c.json({ success: false, error: err.message }, 500);
        }
    });

    // 섹션 소유권 조인 헬퍼
    const ownedSection = async (c: any, sectionId: number | string, userId: number) =>
        await c.env.DB.prepare(
            `SELECT sec.id, sec.page_id, sec.type, p.site_id
             FROM site_sections sec JOIN site_pages p ON p.id = sec.page_id JOIN sites s ON s.id = p.site_id
             WHERE sec.id = ? AND s.user_id = ?`
        ).bind(sectionId, userId).first();

    // PATCH /api/sections/:id — content 수정
    api.patch('/sections/:id', async (c) => {
        const user = c.get('user');
        if (user.level < SITE_MIN_LEVEL) return c.json({ success: false, error: '권한이 필요합니다.' }, 403);
        try {
            const sec = await ownedSection(c, c.req.param('id'), user.id) as any;
            if (!sec) return c.json({ success: false, error: '섹션을 찾을 수 없거나 권한이 없습니다.' }, 404);

            const body = await c.req.json();
            let content: any;
            try { content = normalizeSectionContent(sec.type, body.content ?? body); }
            catch (e: any) { return c.json({ success: false, error: e.message }, 400); }

            // 이미지 교체 시 이전 R2 객체 삭제
            if (sec.type === 'image') {
                const old = await c.env.DB.prepare("SELECT content FROM site_sections WHERE id = ?").bind(sec.id).first<{ content: string }>();
                let oldUrl: string | undefined;
                try { oldUrl = JSON.parse(old?.content || '{}').url; } catch { /* noop */ }
                if (oldUrl && oldUrl !== content.url) await deleteMediaByUrl(c, oldUrl);
            }

            await c.env.DB.prepare("UPDATE site_sections SET content = ? WHERE id = ?")
                .bind(JSON.stringify(content), sec.id).run();
            await bumpRev(c, sec.site_id);
            return c.json({ success: true, content });
        } catch (err: any) {
            return c.json({ success: false, error: err.message }, 500);
        }
    });

    // DELETE /api/sections/:id
    api.delete('/sections/:id', async (c) => {
        const user = c.get('user');
        if (user.level < SITE_MIN_LEVEL) return c.json({ success: false, error: '권한이 필요합니다.' }, 403);
        try {
            const sec = await ownedSection(c, c.req.param('id'), user.id) as any;
            if (!sec) return c.json({ success: false, error: '섹션을 찾을 수 없거나 권한이 없습니다.' }, 404);
            // 이미지 섹션이면 R2 객체도 삭제
            if (sec.type === 'image') {
                const row = await c.env.DB.prepare("SELECT content FROM site_sections WHERE id = ?").bind(sec.id).first<{ content: string }>();
                let url: string | undefined;
                try { url = JSON.parse(row?.content || '{}').url; } catch { /* noop */ }
                if (url) await deleteMediaByUrl(c, url);
            }
            await c.env.DB.prepare("DELETE FROM site_sections WHERE id = ?").bind(sec.id).run();
            await bumpRev(c, sec.site_id);
            return c.json({ success: true });
        } catch (err: any) {
            return c.json({ success: false, error: err.message }, 500);
        }
    });

    // POST /api/sections/reorder — 페이지 내 섹션 정렬 { page_id, order: [id, ...] }
    api.post('/sections/reorder', async (c) => {
        const user = c.get('user');
        if (user.level < SITE_MIN_LEVEL) return c.json({ success: false, error: '권한이 필요합니다.' }, 403);
        try {
            const body = await c.req.json();
            const pageId = body.page_id;
            const order = Array.isArray(body.order) ? body.order : null;
            if (!pageId || !order) return c.json({ success: false, error: 'page_id와 order 배열이 필요합니다.' }, 400);

            const page = await ownedPage(c, pageId, user.id) as any;
            if (!page) return c.json({ success: false, error: '페이지를 찾을 수 없거나 권한이 없습니다.' }, 404);

            await c.env.DB.batch(order.map((sid: number, idx: number) =>
                c.env.DB.prepare("UPDATE site_sections SET sort = ? WHERE id = ? AND page_id = ?").bind(idx, sid, pageId)
            ));
            await bumpRev(c, page.site_id);
            return c.json({ success: true });
        } catch (err: any) {
            return c.json({ success: false, error: err.message }, 500);
        }
    });
}

// ─────────────────────────────────────────────────────────────
// Step 10: 미디어 업로드 (R2) — 업로드 즉시 WebP로 변환해 저장
// 레벨별 정책: level4(최고관리자)는 무제한, level3(고급사용자)은 일간 개수 + 파일당 용량 제한.
// ─────────────────────────────────────────────────────────────

const ALLOWED_UPLOAD_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

interface MediaPolicy { maxFileBytes: number; dailyLimit: number | null } // dailyLimit=null → 무제한
const MEDIA_POLICY_BY_LEVEL: Record<number, MediaPolicy> = {
    3: { maxFileBytes: 5 * 1024 * 1024, dailyLimit: 30 },   // 고급사용자: 5MB / 일 30장
    4: { maxFileBytes: 10 * 1024 * 1024, dailyLimit: null }, // 최고관리자: 10MB / 무제한
};
function mediaPolicyFor(level: number): MediaPolicy {
    return MEDIA_POLICY_BY_LEVEL[level] || MEDIA_POLICY_BY_LEVEL[3];
}
// KST(UTC+9) 기준 오늘 날짜 — 사용자 체감상 자정(한국시간) 리셋을 위해 UTC 타임스탬프 대신 사용
function todayKstDateKey(): string {
    return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function registerMediaRoutes(api: ApiApp) {
    // POST /api/sites/:id/media — 이미지 업로드 → WebP 변환 → R2 → 프록시 URL 반환
    api.post('/sites/:id/media', async (c) => {
        const user = c.get('user');
        if (user.level < SITE_MIN_LEVEL) return c.json({ success: false, error: '권한이 필요합니다.' }, 403);
        const siteId = c.req.param('id');
        try {
            if (!c.env.MEDIA) return c.json({ success: false, error: '미디어 저장소가 설정되지 않았습니다.' }, 500);
            if (!c.env.IMAGES) return c.json({ success: false, error: '이미지 변환기가 설정되지 않았습니다.' }, 500);
            const site = await ownedSite(c, siteId, user.id);
            if (!site) return c.json({ success: false, error: '사이트를 찾을 수 없거나 권한이 없습니다.' }, 404);

            const policy = mediaPolicyFor(user.level);

            // 일간 업로드 개수 제한 (KV 카운터, level4는 dailyLimit=null이라 건너뜀)
            const quotaKey = `media_quota:${user.id}:${todayKstDateKey()}`;
            let quotaUsed = 0;
            if (policy.dailyLimit !== null) {
                quotaUsed = Number((await c.env.URL_CACHE.get(quotaKey)) || '0');
                if (quotaUsed >= policy.dailyLimit) {
                    return c.json({ success: false, error: `일일 이미지 업로드 한도(${policy.dailyLimit}장)를 초과했습니다. 내일 다시 시도해주세요.` }, 429);
                }
            }

            const form = await c.req.formData();
            const file = form.get('file');
            if (!file || typeof file === 'string') return c.json({ success: false, error: '파일이 필요합니다.' }, 400);

            const type = (file as File).type;
            if (!ALLOWED_UPLOAD_MIME.has(type)) return c.json({ success: false, error: 'jpg/png/webp/gif 이미지만 업로드할 수 있습니다.' }, 400);
            if ((file as File).size > policy.maxFileBytes) {
                return c.json({ success: false, error: `파일 크기는 ${Math.floor(policy.maxFileBytes / (1024 * 1024))}MB 이하여야 합니다.` }, 400);
            }

            // 모든 업로드를 WebP로 통일 변환(용량 절감). 애니메이션 GIF는 애니메이션 WebP로 보존.
            // .image() 스트림은 길이를 알 수 없어 R2 put()이 거부하므로, ArrayBuffer로 받아 저장한다.
            let webpBuffer: ArrayBuffer;
            try {
                const result = await c.env.IMAGES.input((file as File).stream()).output({ format: 'image/webp' });
                webpBuffer = await result.response().arrayBuffer();
            } catch (e: any) {
                return c.json({ success: false, error: '이미지 변환에 실패했습니다. 손상된 파일이거나 지원하지 않는 이미지입니다.' }, 400);
            }

            const key = `sites/${siteId}/${crypto.randomUUID()}.webp`;
            await c.env.MEDIA.put(key, webpBuffer, { httpMetadata: { contentType: 'image/webp' } });

            // 변환·저장 성공 후에만 일일 쿼터 차감(실패한 시도는 소모하지 않음)
            if (policy.dailyLimit !== null) {
                c.executionCtx.waitUntil(c.env.URL_CACHE.put(quotaKey, String(quotaUsed + 1), { expirationTtl: 60 * 60 * 48 }));
            }

            return c.json({
                success: true,
                url: `/media/${key}`,
                remaining: policy.dailyLimit === null ? null : Math.max(0, policy.dailyLimit - (quotaUsed + 1)),
            });
        } catch (err: any) {
            return c.json({ success: false, error: err.message }, 500);
        }
    });
}

// ─────────────────────────────────────────────────────────────
// Step 13: 게시(publish) + 초안 미리보기(preview)
// ─────────────────────────────────────────────────────────────

export function registerPublishRoutes(api: ApiApp) {
    // POST /api/sites/:id/publish — 초안을 렌더해 스냅샷 생성 + 공개 반영
    api.post('/sites/:id/publish', async (c) => {
        const user = c.get('user');
        if (user.level < SITE_MIN_LEVEL) return c.json({ success: false, error: '권한이 필요합니다.' }, 403);
        const id = c.req.param('id');
        try {
            const owned = await c.env.DB.prepare("SELECT id FROM sites WHERE id = ? AND user_id = ?").bind(id, user.id).first();
            if (!owned) return c.json({ success: false, error: '사이트를 찾을 수 없거나 권한이 없습니다.' }, 404);

            const rendered = await renderAllSnapshots(c, Number(id));
            if (!rendered) return c.json({ success: false, error: '렌더에 실패했습니다.' }, 500);
            if (!rendered.snapshots.length) return c.json({ success: false, error: '게시할 페이지가 없습니다. 페이지를 먼저 추가하세요.' }, 400);

            // 기존 스냅샷 경로 (제거된 경로의 KV 정리용)
            const { results: oldRows } = await c.env.DB.prepare("SELECT path FROM site_snapshots WHERE site_id = ?").bind(id).all();
            const oldPaths = new Set((oldRows as Array<{ path: string }>).map(r => r.path));
            const newPaths = new Set(rendered.snapshots.map(s => s.path));

            // D1: 스냅샷 전량 교체 + 게시 상태 갱신 (원자적 batch)
            const stmts = [c.env.DB.prepare("DELETE FROM site_snapshots WHERE site_id = ?").bind(id)];
            for (const snap of rendered.snapshots) {
                stmts.push(c.env.DB.prepare(
                    "INSERT INTO site_snapshots (site_id, path, html, rev) VALUES (?, ?, ?, ?)"
                ).bind(id, snap.path, snap.html, rendered.rev));
            }
            stmts.push(c.env.DB.prepare(
                "UPDATE sites SET published_rev = ?, published_at = datetime('now') WHERE id = ?"
            ).bind(rendered.rev, id));
            await c.env.DB.batch(stmts);

            // KV: 신규 경로 적재 + 제거된 경로 삭제
            const kvOps = async () => {
                for (const snap of rendered.snapshots) {
                    try { await c.env.URL_CACHE.put(pubKey(rendered.siteSlug, snap.path), snap.html, { expirationTtl: 604800 }); } catch { /* noop */ }
                }
                for (const p of oldPaths) {
                    if (!newPaths.has(p)) { try { await c.env.URL_CACHE.delete(pubKey(rendered.siteSlug, p)); } catch { /* noop */ } }
                }
            };
            try { c.executionCtx.waitUntil(kvOps()); } catch { await kvOps(); }

            const actualPageCount = rendered.snapshots.filter(s => s.path !== '').length;
            return c.json({ success: true, published: actualPageCount, rev: rendered.rev, slug: rendered.siteSlug });
        } catch (err: any) {
            return c.json({ success: false, error: err.message }, 500);
        }
    });

    // GET /api/sites/:id/preview?path=&theme= — 소유자 초안 실시간 미리보기(HTML)
    api.get('/sites/:id/preview', async (c) => {
        const user = c.get('user');
        if (user.level < SITE_MIN_LEVEL) return c.text('권한이 필요합니다.', 403);
        const id = c.req.param('id');
        try {
            const owned = await c.env.DB.prepare("SELECT id FROM sites WHERE id = ? AND user_id = ?").bind(id, user.id).first();
            if (!owned) return c.text('사이트를 찾을 수 없거나 권한이 없습니다.', 404);

            const pathParam = c.req.query('path') || '';
            const segs = pathParam ? pathParam.split('/').filter(Boolean) : [];

            // 저장 전 테마 미리보기 오버라이드(선택)
            let themeOverride: string | undefined;
            const themeQ = c.req.query('theme');
            if (themeQ) { try { themeOverride = JSON.stringify(normalizeTheme(JSON.parse(themeQ))); } catch { /* 무시 */ } }

            return await renderDraftResponse(c, Number(id), segs, themeOverride);
        } catch (err: any) {
            return c.text('미리보기 오류: ' + err.message, 500);
        }
    });
}
