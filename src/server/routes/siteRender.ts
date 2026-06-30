// src/server/routes/siteRender.ts
// 에듀링크 페이지: 공개 사이트 렌더링 (Step 5)
// 구조화 데이터 → 고정 템플릿. 임의 HTML 주입 경로 없음(§5 보안).
import type { Context } from 'hono';

type AnyCtx = Context<any, any, any>;

function escapeHtml(s: string): string {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function safeHref(url: string): string | null {
    const u = String(url).trim();
    if (/^https?:\/\//i.test(u)) return u;
    return null;
}

// 제한 마크다운 → 안전한 HTML. 입력은 먼저 전부 escape 후 화이트리스트 변환만 적용.
function renderMarkdown(src: string): string {
    const lines = String(src).replace(/\r\n/g, '\n').split('\n');
    const out: string[] = [];
    let inList = false;
    const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };

    const inline = (raw: string): string => {
        let t = escapeHtml(raw);
        // 링크 [label](http..)
        t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
            const href = safeHref(url);
            if (!href) return label;
            return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer nofollow">${label}</a>`;
        });
        // 굵게 **x**
        t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        // 기울임 *x* 또는 _x_
        t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
        t = t.replace(/_([^_\n]+)_/g, '<em>$1</em>');
        return t;
    };

    for (const line of lines) {
        const trimmed = line.trimEnd();
        if (/^\s*-\s+/.test(trimmed)) {
            if (!inList) { out.push('<ul>'); inList = true; }
            out.push(`<li>${inline(trimmed.replace(/^\s*-\s+/, ''))}</li>`);
        } else if (/^\s*>\s?/.test(trimmed)) {
            closeList();
            out.push(`<blockquote>${inline(trimmed.replace(/^\s*>\s?/, ''))}</blockquote>`);
        } else if (trimmed.trim() === '') {
            closeList();
        } else {
            closeList();
            out.push(`<p>${inline(trimmed)}</p>`);
        }
    }
    closeList();
    return out.join('\n');
}

function renderSection(type: string, content: any): string {
    if (type === 'text') {
        const body = content?.format === 'plain'
            ? `<p>${escapeHtml(content?.text ?? '').replace(/\n/g, '<br>')}</p>`
            : renderMarkdown(content?.text ?? '');
        return `<section class="sec sec-text">${body}</section>`;
    }
    if (type === 'youtube') {
        const id = String(content?.videoId ?? '');
        if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return '';
        const start = Number(content?.start) > 0 ? `?start=${Math.floor(Number(content.start))}` : '';
        const title = escapeHtml(content?.title ?? '');
        return `<section class="sec sec-youtube"><div class="yt"><iframe src="https://www.youtube-nocookie.com/embed/${id}${start}" title="${title}" loading="lazy" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div></section>`;
    }
    return '';
}

// 페이지 트리 → 상단 내비 (최상위 + 1뎁스 정도만 단순 노출)
function renderNav(pages: Array<any>, siteSlug: string, currentId: number): string {
    const roots = pages.filter(p => p.parent_id === null).sort((a, b) => a.sort - b.sort);
    if (roots.length <= 1) return '';
    const items = roots.map(p => {
        const href = `/${encodeURIComponent(siteSlug)}/${encodeURIComponent(p.slug)}`;
        const active = p.id === currentId ? ' class="active"' : '';
        return `<a href="${href}"${active}>${escapeHtml(p.title)}</a>`;
    }).join('');
    return `<nav class="site-nav">${items}</nav>`;
}

function renderPage(site: any, page: any, sections: Array<any>, pages: Array<any>, siteSlug: string): string {
    const sectionsHtml = sections.map(s => {
        let content: any = {};
        try { content = JSON.parse(s.content || '{}'); } catch { /* noop */ }
        return renderSection(s.type, content);
    }).join('\n');

    return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(page.title)} · ${escapeHtml(site.title)}</title>
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<style>
  :root { --c-primary:#5B8DEF; --c-bg:#FFFFFF; --c-text:#1F2937; --c-muted:#6B7280; --c-border:#E5E7EB; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:'Pretendard',-apple-system,sans-serif; color:var(--c-text); background:#F8FAFC; line-height:1.7; }
  .site-header { background:var(--c-bg); border-bottom:1px solid var(--c-border); padding:18px 20px; }
  .site-header h1 { margin:0; font-size:1.25rem; }
  .site-header h1 a { color:var(--c-text); text-decoration:none; }
  .site-nav { margin-top:10px; display:flex; gap:14px; flex-wrap:wrap; }
  .site-nav a { color:var(--c-muted); text-decoration:none; font-size:.95rem; }
  .site-nav a.active, .site-nav a:hover { color:var(--c-primary); font-weight:600; }
  main { max-width:760px; margin:0 auto; padding:32px 20px 80px; }
  main > .page-title { font-size:1.75rem; margin:0 0 24px; }
  .sec { margin:0 0 24px; }
  .sec-text p { margin:0 0 12px; }
  .sec-text a { color:var(--c-primary); }
  .sec-text blockquote { margin:0 0 12px; padding:8px 16px; border-left:3px solid var(--c-primary); color:var(--c-muted); background:#fff; }
  .sec-text ul { margin:0 0 12px; padding-left:22px; }
  .yt { position:relative; width:100%; padding-top:56.25%; border-radius:12px; overflow:hidden; background:#000; }
  .yt iframe { position:absolute; inset:0; width:100%; height:100%; }
  footer { text-align:center; color:var(--c-muted); font-size:.8rem; padding:24px; }
</style>
</head>
<body>
  <header class="site-header">
    <h1><a href="/${encodeURIComponent(siteSlug)}">${escapeHtml(site.title)}</a></h1>
    ${renderNav(pages, siteSlug, page.id)}
  </header>
  <main>
    <h2 class="page-title">${escapeHtml(page.title)}</h2>
    ${sectionsHtml || '<p style="color:var(--c-muted)">아직 콘텐츠가 없습니다.</p>'}
  </main>
  <footer>Powered by 에듀링크</footer>
</body>
</html>`;
}

function notFoundHtml(): string {
    return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>페이지를 찾을 수 없습니다</title>
<style>body{margin:0;font-family:-apple-system,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#F8FAFC;color:#1F2937}.box{text-align:center}h1{font-size:3rem;margin:0}p{color:#6B7280}</style>
</head><body><div class="box"><h1>404</h1><p>요청하신 페이지를 찾을 수 없습니다.</p></div></body></html>`;
}

// slug → 사이트 여부 확인. 사이트가 아니면 null (호출측에서 SPA fallback).
export async function lookupSiteBySlug(c: AnyCtx, slug: string): Promise<{ siteId: number } | null> {
    const row = await c.env.DB.prepare(
        "SELECT site_id, kind, is_active FROM urls WHERE base_slug = ? OR custom_slug = ? OR slug = ?"
    ).bind(slug, slug, slug).first() as { site_id: number | null; kind: string; is_active: number } | null;
    if (!row || row.kind !== 'site' || !row.site_id) return null;
    return { siteId: row.site_id };
}

// 사이트 페이지 렌더. 항상 Response 반환 (사이트 비공개/페이지 미스 → 404 HTML).
export async function renderSiteById(c: AnyCtx, siteId: number, segs: string[]): Promise<Response> {
    const site = await c.env.DB.prepare(
        `SELECT s.id, s.title, s.theme, s.is_public, s.home_page_id, u.base_slug, u.custom_slug
         FROM sites s JOIN urls u ON u.id = s.url_id WHERE s.id = ?`
    ).bind(siteId).first() as any;
    if (!site || site.is_public === 0) return c.html(notFoundHtml(), 404);

    const siteSlug = site.custom_slug || site.base_slug;

    // 전체 페이지 (내비 + 경로 해석용)
    const { results: pagesRaw } = await c.env.DB.prepare(
        "SELECT id, parent_id, slug, title, depth, sort FROM site_pages WHERE site_id = ? ORDER BY depth, sort, id"
    ).bind(siteId).all();
    const pages = pagesRaw as Array<any>;

    // 경로 해석
    let page: any = null;
    if (segs.length === 0) {
        page = (site.home_page_id && pages.find(p => p.id === site.home_page_id))
            || pages.filter(p => p.parent_id === null).sort((a, b) => a.sort - b.sort)[0]
            || null;
    } else {
        let parentId: number | null = null;
        for (const seg of segs) {
            const decoded = (() => { try { return decodeURIComponent(seg).normalize('NFC'); } catch { return seg.normalize('NFC'); } })();
            const match = pages.find(p => p.slug === decoded && (p.parent_id ?? null) === parentId);
            if (!match) { page = null; break; }
            page = match;
            parentId = match.id;
        }
    }

    if (!page) return c.html(notFoundHtml(), 404);

    const { results: sections } = await c.env.DB.prepare(
        "SELECT id, type, content, sort FROM site_sections WHERE page_id = ? ORDER BY sort, id"
    ).bind(page.id).all();

    return c.html(renderPage(site, page, sections as Array<any>, pages, siteSlug));
}
