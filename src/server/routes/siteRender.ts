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
    if (type === 'heading') {
        const lvl = content?.level === 3 ? 3 : 2;
        return `<section class="sec sec-heading"><h${lvl}>${escapeHtml(content?.text ?? '')}</h${lvl}></section>`;
    }
    if (type === 'divider') {
        return `<section class="sec sec-divider"><hr></section>`;
    }
    if (type === 'link') {
        const href = safeHref(content?.url ?? '');
        if (!href) return '';
        const label = escapeHtml(content?.label ?? '');
        const cls = content?.style === 'link' ? 'btn-link' : 'btn';
        const tab = content?.newTab !== false ? ' target="_blank" rel="noopener noreferrer nofollow"' : '';
        return `<section class="sec sec-link"><a class="${cls}" href="${escapeHtml(href)}"${tab}>${label}</a></section>`;
    }
    if (type === 'image') {
        const url = String(content?.url ?? '');
        if (!/^\/media\/[A-Za-z0-9/_.-]+$/.test(url)) return '';
        const alt = escapeHtml(content?.alt ?? '');
        const cap = content?.caption ? `<figcaption>${escapeHtml(content.caption)}</figcaption>` : '';
        const w = ['full', 'wide', 'normal'].includes(content?.width) ? content.width : 'normal';
        return `<section class="sec sec-image img-${w}"><figure><img src="${escapeHtml(url)}" alt="${alt}" loading="lazy">${cap}</figure></section>`;
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

function buildThemeVars(theme: any): { vars: string; fontFamily: string; googleFontLink: string; navSide: boolean; headerTitle: string; showTitle: boolean } {
    const colors = theme?.colors && typeof theme.colors === 'object' ? theme.colors : {};
    const map: Record<string, string> = { primary: '--c-primary', bg: '--c-bg', text: '--c-text', muted: '--c-muted', accent: '--c-accent' };
    const hexRe = /^#[0-9A-Fa-f]{3,8}$/;
    const overrides: string[] = [];
    for (const k of Object.keys(map)) {
        if (typeof colors[k] === 'string' && hexRe.test(colors[k])) overrides.push(`${map[k]}:${colors[k]}`);
    }
    const font = theme?.font && typeof theme.font === 'object' ? theme.font : {};
    const fam = typeof font.family === 'string' && font.family.trim() ? font.family.replace(/["'<>]/g, '') : 'Pretendard';
    let googleFontLink = '';
    if (typeof font.googleFontUrl === 'string') {
        try { const u = new URL(font.googleFontUrl); if (u.protocol === 'https:' && u.hostname === 'fonts.googleapis.com') googleFontLink = `<link rel="stylesheet" href="${escapeHtml(u.toString())}">`; } catch { /* ignore */ }
    }
    const header = theme?.header && typeof theme.header === 'object' ? theme.header : {};
    return {
        vars: overrides.join('; '),
        fontFamily: `'${fam}','Pretendard',-apple-system,sans-serif`,
        googleFontLink,
        navSide: header.navPosition === 'side',
        headerTitle: typeof header.title === 'string' && header.title.trim() ? header.title : '',
        showTitle: header.showTitle !== false,
    };
}

function renderPage(site: any, page: any, sections: Array<any>, pages: Array<any>, siteSlug: string): string {
    const sectionsHtml = sections.map(s => {
        let content: any = {};
        try { content = JSON.parse(s.content || '{}'); } catch { /* noop */ }
        return renderSection(s.type, content);
    }).join('\n');

    let theme: any = {};
    try { theme = JSON.parse(site.theme || '{}'); } catch { /* noop */ }
    const t = buildThemeVars(theme);
    const headerTitle = t.headerTitle || site.title;

    return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(page.title)} · ${escapeHtml(site.title)}</title>
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
${t.googleFontLink}
<style>
  :root { --c-primary:#5B8DEF; --c-bg:#FFFFFF; --c-text:#1F2937; --c-muted:#6B7280; --c-border:#E5E7EB; --c-accent:#F472B6; ${t.vars} }
  * { box-sizing: border-box; }
  body { margin:0; font-family:${t.fontFamily}; color:var(--c-text); background:#F8FAFC; line-height:1.7; }
  .layout { ${t.navSide ? 'display:flex; align-items:flex-start; min-height:100vh;' : ''} }
  .site-header { background:var(--c-bg); border-bottom:1px solid var(--c-border); padding:18px 20px; ${t.navSide ? 'width:220px; min-height:100vh; border-right:1px solid var(--c-border); border-bottom:none; flex-shrink:0;' : ''} }
  .site-header h1 { margin:0; font-size:1.25rem; }
  .site-header h1 a { color:var(--c-text); text-decoration:none; }
  .site-nav { margin-top:${t.navSide ? '18px' : '10px'}; display:flex; gap:14px; flex-wrap:wrap; ${t.navSide ? 'flex-direction:column;' : ''} }
  .site-nav a { color:var(--c-muted); text-decoration:none; font-size:.95rem; }
  .site-nav a.active, .site-nav a:hover { color:var(--c-primary); font-weight:600; }
  .content { flex:1; }
  main { max-width:760px; margin:0 auto; padding:32px 20px 80px; }
  main > .page-title { font-size:1.75rem; margin:0 0 24px; }
  .sec { margin:0 0 24px; }
  .sec-text p { margin:0 0 12px; }
  .sec-text a { color:var(--c-primary); }
  .sec-text blockquote { margin:0 0 12px; padding:8px 16px; border-left:3px solid var(--c-primary); color:var(--c-muted); background:#fff; }
  .sec-text ul { margin:0 0 12px; padding-left:22px; }
  .sec-heading h2 { font-size:1.4rem; margin:8px 0; }
  .sec-heading h3 { font-size:1.15rem; margin:6px 0; }
  .sec-divider hr { border:none; border-top:1px solid var(--c-border); margin:8px 0; }
  .sec-link .btn { display:inline-block; background:var(--c-primary); color:#fff; padding:10px 22px; border-radius:10px; text-decoration:none; font-weight:600; }
  .sec-link .btn-link { color:var(--c-primary); text-decoration:underline; }
  .sec-image figure { margin:0; }
  .sec-image img { width:100%; border-radius:12px; display:block; }
  .sec-image.img-normal { max-width:480px; } .sec-image.img-wide { max-width:680px; } .sec-image.img-full { max-width:100%; }
  .sec-image figcaption { color:var(--c-muted); font-size:.85rem; margin-top:6px; text-align:center; }
  .yt { position:relative; width:100%; padding-top:56.25%; border-radius:12px; overflow:hidden; background:#000; }
  .yt iframe { position:absolute; inset:0; width:100%; height:100%; }
  footer { text-align:center; color:var(--c-muted); font-size:.8rem; padding:24px; }
  @media (max-width:640px){ .layout{display:block;} .site-header{width:auto;min-height:0;border-right:none;border-bottom:1px solid var(--c-border);} .site-nav{flex-direction:row;} }
</style>
</head>
<body>
  <div class="layout">
    <header class="site-header">
      ${t.showTitle ? `<h1><a href="/${encodeURIComponent(siteSlug)}">${escapeHtml(headerTitle)}</a></h1>` : ''}
      ${renderNav(pages, siteSlug, page.id)}
    </header>
    <div class="content">
      <main>
        <h2 class="page-title">${escapeHtml(page.title)}</h2>
        ${sectionsHtml || '<p style="color:var(--c-muted)">아직 콘텐츠가 없습니다.</p>'}
      </main>
      <footer>Powered by 에듀링크</footer>
    </div>
  </div>
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
        `SELECT s.id, s.title, s.theme, s.is_public, s.home_page_id, s.rev, u.base_slug, u.custom_slug
         FROM sites s JOIN urls u ON u.id = s.url_id WHERE s.id = ?`
    ).bind(siteId).first() as any;
    if (!site || site.is_public === 0) return c.html(notFoundHtml(), 404);

    const siteSlug = site.custom_slug || site.base_slug;

    // KV 캐시 확인 — rev 포함 키라 변경 시 자연 무효화. 비공개/삭제는 위에서 이미 차단.
    const cacheKey = `site:${siteSlug}:${site.rev}:${segs.join('/')}`;
    try {
        const cached = await c.env.URL_CACHE.get(cacheKey);
        if (cached) return c.html(cached);
    } catch { /* 캐시 실패는 무시하고 렌더 */ }

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

    const html = renderPage(site, page, sections as Array<any>, pages, siteSlug);
    // 렌더 결과 캐시 (rev 키 + 1일 TTL 안전망). 비동기로 저장.
    try { c.executionCtx.waitUntil(c.env.URL_CACHE.put(cacheKey, html, { expirationTtl: 86400 })); }
    catch { try { await c.env.URL_CACHE.put(cacheKey, html, { expirationTtl: 86400 }); } catch { /* noop */ } }

    return c.html(html);
}
