// src/server/routes/sites.ts
// 에듀링크 페이지: 사이트 CRUD API (Step 2)
// 기존 `api` Hono 인스턴스(authMiddleware 적용됨)에 등록한다.
import { Hono } from 'hono';
import { generateRandomSlug, isValidCustomSlug } from '../utils/slug';

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

export function registerSiteRoutes(api: ApiApp) {
    // GET /api/sites — 내 사이트 목록
    api.get('/sites', async (c) => {
        const user = c.get('user');
        if (user.level < SITE_MIN_LEVEL) {
            return c.json({ success: false, error: '에듀링크 페이지 기능은 고급사용자(레벨 3) 이상 권한이 필요합니다.' }, 403);
        }
        try {
            const { results } = await c.env.DB.prepare(
                `SELECT s.id, s.title, s.is_public, s.home_page_id, s.rev, s.created_at, s.updated_at,
                        u.slug, u.base_slug, u.custom_slug
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

            // base_slug 자동 발급 (6자리, 충돌 회피)
            let baseSlug = '';
            for (let i = 0; i < 10; i++) {
                const cand = generateRandomSlug(6);
                if (reservedSet.has(cand.toLowerCase())) continue;
                if (!(await slugTaken(c, cand))) { baseSlug = cand; break; }
            }
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
                `SELECT s.id, s.title, s.theme, s.is_public, s.home_page_id, s.rev, s.created_at, s.updated_at,
                        u.slug, u.base_slug, u.custom_slug
                 FROM sites s JOIN urls u ON u.id = s.url_id
                 WHERE s.id = ? AND s.user_id = ?`
            ).bind(id, user.id).first();
            if (!site) return c.json({ success: false, error: '사이트를 찾을 수 없거나 권한이 없습니다.' }, 404);

            const { results: pages } = await c.env.DB.prepare(
                `SELECT id, parent_id, slug, title, depth, sort
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
            const { title, custom_slug, is_public, home_page_id } = body;

            const site = await c.env.DB.prepare(
                "SELECT s.id, s.url_id, u.base_slug, u.custom_slug FROM sites s JOIN urls u ON u.id = s.url_id WHERE s.id = ? AND s.user_id = ?"
            ).bind(id, user.id).first<{ id: number; url_id: number; base_slug: string; custom_slug: string | null }>();
            if (!site) return c.json({ success: false, error: '사이트를 찾을 수 없거나 권한이 없습니다.' }, 404);

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
            }

            // sites 필드 수정
            const sets: string[] = [];
            const binds: any[] = [];
            if (title !== undefined) {
                if (!String(title).trim()) return c.json({ success: false, error: '사이트 제목이 비어 있습니다.' }, 400);
                sets.push('title = ?'); binds.push(String(title).trim());
                // urls.title 도 함께 갱신(목록 표기 일관성)
                await c.env.DB.prepare("UPDATE urls SET title = ? WHERE id = ?").bind(String(title).trim(), site.url_id).run();
            }
            if (is_public !== undefined) { sets.push('is_public = ?'); binds.push(is_public ? 1 : 0); }
            if (home_page_id !== undefined) {
                // 소유 사이트의 페이지인지 검증
                if (home_page_id !== null) {
                    const pg = await c.env.DB.prepare("SELECT id FROM site_pages WHERE id = ? AND site_id = ?")
                        .bind(home_page_id, id).first();
                    if (!pg) return c.json({ success: false, error: '홈으로 지정할 페이지를 찾을 수 없습니다.' }, 400);
                }
                sets.push('home_page_id = ?'); binds.push(home_page_id);
            }
            // 변경이 있으면 rev 증가
            sets.push("rev = rev + 1");
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

            // FK CASCADE 의존하지 않고 명시적으로 하위부터 삭제 (D1 안전)
            await c.env.DB.batch([
                c.env.DB.prepare(
                    "DELETE FROM site_sections WHERE page_id IN (SELECT id FROM site_pages WHERE site_id = ?)"
                ).bind(id),
                c.env.DB.prepare("DELETE FROM site_pages WHERE site_id = ?").bind(id),
                c.env.DB.prepare("DELETE FROM sites WHERE id = ?").bind(id),
                c.env.DB.prepare("DELETE FROM urls WHERE id = ?").bind(site.url_id),
            ]);

            // 슬러그 회수 — KV 캐시 정리(혹시 남아 있을 수 있는 키)
            for (const s of [site.slug, site.base_slug, site.custom_slug]) {
                if (s) { try { await c.env.URL_CACHE.delete(s); } catch {} }
            }

            return c.json({ success: true });
        } catch (err: any) {
            return c.json({ success: false, error: err.message }, 500);
        }
    });
}
