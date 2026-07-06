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

// 임베드 HTML 정화: <script>/이벤트핸들러/javascript:는 제거하되 iframe 등 임베드 태그는 허용.
// (소유자 본인이 붙여넣는 임베드 코드용 — 구글폼/패들릿/유튜브 iframe 등)
function sanitizeEmbed(html: string): string {
    return String(html)
        .replace(/<\s*script[\s\S]*?<\s*\/\s*script\s*>/gi, '')
        .replace(/<\s*script\b[^>]*>/gi, '')
        .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
        .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
        .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
        .replace(/javascript:/gi, '');
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

function unescapeHtml(s: string): string {
    return String(s)
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

function linkifyRawUrls(html: string): string {
    const parts = html.split(/(<\/?[a-zA-Z0-9]+[^>]*>)/g);
    for (let i = 0; i < parts.length; i++) {
        if (i % 2 === 0) {
            parts[i] = parts[i].replace(/(https?:\/\/[^\s<)"]+)/gi, (url) => {
                const rawUrl = unescapeHtml(url);
                const href = safeHref(rawUrl);
                if (!href) return url;
                
                let cleanRawUrl = rawUrl;
                let suffix = '';
                const match = rawUrl.match(/[.,;:?!]+$/);
                if (match) {
                    suffix = match[0];
                    cleanRawUrl = rawUrl.substring(0, rawUrl.length - suffix.length);
                }
                const cleanHref = safeHref(cleanRawUrl);
                if (!cleanHref) return url;
                return `<a href="${escapeHtml(cleanHref)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(cleanRawUrl)}</a>` + escapeHtml(suffix);
            });
        }
    }
    return parts.join('');
}

function renderSection(type: string, content: any): string {
    if (type === 'text') {
        let body = content?.format === 'plain'
            ? `<p>${escapeHtml(content?.text ?? '').replace(/\n/g, '<br>')}</p>`
            : renderMarkdown(content?.text ?? '');
        body = linkifyRawUrls(body);
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
        const bg = content?.bg === true ? ' sec-heading-bg' : '';
        return `<section class="sec sec-heading${bg}"><h${lvl}>${escapeHtml(content?.text ?? '')}</h${lvl}></section>`;
    }
    if (type === 'divider') {
        return `<section class="sec sec-divider"><hr></section>`;
    }
    if (type === 'embed') {
        const html = sanitizeEmbed(String(content?.html ?? ''));
        if (!html.trim()) return '';
        return `<section class="sec sec-embed">${html}</section>`;
    }
    if (type === 'link') {
        const href = safeHref(content?.url ?? '');
        if (!href) return '';
        const label = escapeHtml(content?.label ?? '');
        const cls = content?.style === 'link' ? 'btn-link' : 'btn';
        const tab = content?.newTab !== false ? ' target="_blank" rel="noopener noreferrer nofollow"' : '';
        const align = ['center', 'right', 'left'].includes(content?.align) ? content.align : 'left';
        return `<section class="sec sec-link align-${align}"><a class="${cls}" href="${escapeHtml(href)}"${tab}>${label}</a></section>`;
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

// 페이지 트리 → 내비 (드롭다운/아코디언 + 모바일 햄버거). 정적 HTML이라 CSS-only 상호작용.
function renderNav(pages: Array<any>, siteSlug: string, currentPage: any): string {
    const roots = pages.filter(p => p.parent_id == null).sort((a, b) => a.sort - b.sort);
    const kids = (id: number) => pages.filter(p => p.parent_id != null && Number(p.parent_id) === Number(id)).sort((a, b) => a.sort - b.sort);
    const hasChildren = pages.length > roots.length;
    if (roots.length <= 1 && !hasChildren) return '';
    const currentRootId = currentPage.parent_id == null ? currentPage.id : currentPage.parent_id;
    const base = `/${encodeURIComponent(siteSlug)}`;
    const rootLink = (p: any) => `${base}/${encodeURIComponent(p.slug)}`;
    // 하위 페이지 경로는 반드시 상위 슬러그를 포함해야 함 (/{slug}/{root}/{child})
    const childLink = (root: any, c: any) => `${base}/${encodeURIComponent(root.slug)}/${encodeURIComponent(c.slug)}`;
    const aClass = (p: any) => p.id === currentPage.id ? ' class="active"' : '';

    const pageLabel = (p: any) => `${p.icon ? p.icon + ' ' : ''}${p.title}`;

    const items = roots.map(root => {
        const ch = kids(root.id);
        const rootActive = root.id === currentRootId;
        const sub = ch.length
            ? `<ul class="nav-sub">${ch.map(c => `<li><a href="${childLink(root, c)}"${aClass(c)}>${escapeHtml(pageLabel(c))}</a></li>`).join('')}</ul>`
            : '';
        const caret = ch.length ? '<span class="nav-caret">▾</span>' : '';
        return `<li class="nav-li${rootActive ? ' active' : ''}${ch.length ? ' has-sub' : ''}"><a href="${rootLink(root)}"${aClass(root)}>${escapeHtml(pageLabel(root))}${caret}</a>${sub}</li>`;
    }).join('');

    return `<input type="checkbox" id="nav-toggle" class="nav-toggle-cb"><label for="nav-toggle" class="nav-toggle" aria-label="메뉴 열기">☰</label><nav class="site-nav"><ul class="nav-list">${items}</ul></nav>`;
}

// 하위(depth1) 페이지의 경로 안내
function renderBreadcrumb(page: any, pages: Array<any>, siteSlug: string): string {
    if (page.parent_id == null) return '';
    const parent = pages.find(p => p.id === page.parent_id);
    if (!parent) return '';
    const base = `/${encodeURIComponent(siteSlug)}`;
    const pageLabel = (p: any) => `${p.icon ? p.icon + ' ' : ''}${p.title}`;
    // depth 최대 2단계이므로 브레드크럼도 상위 › 현재 2단만 노출(사이트 루트 링크 중복 제거)
    return `<nav class="crumb"><a href="${base}/${encodeURIComponent(parent.slug)}">${escapeHtml(pageLabel(parent))}</a><span>›</span><b>${escapeHtml(pageLabel(page))}</b></nav>`;
}

function buildThemeVars(theme: any): { vars: string; fontFamily: string; googleFontLink: string; navPos: 'top' | 'side' | 'right'; headerTitle: string; showTitle: boolean; showNavigation: boolean } {
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
    const footer = theme?.footer && typeof theme.footer === 'object' ? theme.footer : {};
    const counter = theme?.counter && typeof theme.counter === 'object' ? theme.counter : {};
    return {
        vars: overrides.join('; '),
        fontFamily: `'${fam}','Pretendard',-apple-system,sans-serif`,
        googleFontLink,
        navPos: header.navPosition === 'side' ? 'side' : header.navPosition === 'right' ? 'right' : 'top',
        headerTitle: typeof header.title === 'string' && header.title.trim() ? header.title : '',
        showTitle: header.showTitle !== false,
        showNavigation: footer.showNavigation !== false,
        showCounter: counter.showCounter === true,
    };
}

function renderPageNavigation(currentPage: any, pages: Array<any>, siteSlug: string, showNavigation: boolean): string {
    if (!showNavigation) return '';
    const roots = pages.filter(p => p.parent_id == null).sort((a, b) => a.sort - b.sort);
    const kids = (id: number) => pages.filter(p => p.parent_id != null && Number(p.parent_id) === Number(id)).sort((a, b) => a.sort - b.sort);
    const flatPages: Array<any> = [];
    for (const r of roots) {
        flatPages.push(r);
        flatPages.push(...kids(r.id));
    }
    const curIdx = flatPages.findIndex(p => p.id === currentPage.id);
    if (curIdx === -1) return '';
    
    const prev = curIdx > 0 ? flatPages[curIdx - 1] : null;
    const next = curIdx < flatPages.length - 1 ? flatPages[curIdx + 1] : null;
    if (!prev && !next) return '';

    const base = `/${encodeURIComponent(siteSlug)}`;
    const getPageLink = (p: any) => {
        if (p.parent_id == null) return `${base}/${encodeURIComponent(p.slug)}`;
        const parent = pages.find(parentPage => Number(parentPage.id) === Number(p.parent_id));
        return parent ? `${base}/${encodeURIComponent(parent.slug)}/${encodeURIComponent(p.slug)}` : `${base}/${encodeURIComponent(p.slug)}`;
    };
    const pageLabel = (p: any) => `${p.icon ? p.icon + ' ' : ''}${p.title}`;

    const prevHtml = prev ? `
        <a href="${getPageLink(prev)}" class="page-nav-card prev">
            <div class="page-nav-icon">
                <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"></path></svg>
            </div>
            <div style="flex: 1; text-align: right; min-width: 0;">
                <span class="page-nav-label">Previous</span>
                <span class="page-nav-title">${escapeHtml(pageLabel(prev))}</span>
            </div>
        </a>
    ` : `<div></div>`;

    const nextHtml = next ? `
        <a href="${getPageLink(next)}" class="page-nav-card next">
            <div style="flex: 1; text-align: left; min-width: 0;">
                <span class="page-nav-label">Next</span>
                <span class="page-nav-title">${escapeHtml(pageLabel(next))}</span>
            </div>
            <div class="page-nav-icon">
                <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"></path></svg>
            </div>
        </a>
    ` : `<div></div>`;

    return `
        <div class="page-nav-container">
            ${prevHtml}
            ${nextHtml}
        </div>
    `;
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
    const navSide = t.navPos !== 'top';   // 좌측 또는 우측 사이드바
    const navRight = t.navPos === 'right';
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
  :root { --c-primary:#5B8DEF; --c-bg:color-mix(in srgb, var(--c-primary) 5%, #FFFFFF); --c-text:#1F2937; --c-muted:#6B7280; --c-border:#E5E7EB; --c-accent:#F472B6; ${t.vars} }
  * { box-sizing: border-box; }
  body { margin:0; font-family:${t.fontFamily}; color:var(--c-text); background:#F8FAFC; line-height:1.7; }
  .layout { ${navSide ? `display:flex; align-items:flex-start; min-height:100vh; ${navRight ? 'flex-direction:row-reverse;' : ''}` : ''} }
  .site-header { background:var(--c-bg); border-bottom:1px solid var(--c-border); padding:18px 20px; ${navSide ? `width:220px; min-height:100vh; ${navRight ? 'border-left' : 'border-right'}:1px solid var(--c-border); border-bottom:none; flex-shrink:0;` : ''} }
  .site-header h1 { margin:0; font-size:1.25rem; }
  .site-header h1 a { color:var(--c-text); text-decoration:none; }
  .site-nav { margin-top:${navSide ? '18px' : '10px'}; }
  .nav-list { list-style:none; margin:0; padding:0; display:flex; gap:4px; flex-wrap:wrap; ${navSide ? 'flex-direction:column;' : ''} }
  .nav-li { position:relative; }
  .nav-li > a { display:inline-flex; align-items:center; gap:4px; color:var(--c-muted); text-decoration:none; font-size:.95rem; padding:6px 10px; border-radius:8px; }
  .nav-li.active > a, .nav-li > a.active, .nav-li > a:hover { color:var(--c-primary); font-weight:600; background:rgba(0,0,0,.03); }
  .nav-caret { font-size:.65em; ${navSide ? 'display:none;' : ''} }
  .nav-sub { list-style:none; margin:0; padding:${navSide ? '2px 0 4px 14px' : '6px'}; ${navSide ? '' : 'position:absolute; top:100%; left:0; min-width:170px; background:var(--c-bg); border:1px solid var(--c-border); border-radius:10px; box-shadow:0 8px 24px rgba(0,0,0,.08); display:none; z-index:20;'} }
  ${navSide ? '' : '.nav-li.has-sub:hover .nav-sub, .nav-li.has-sub:focus-within .nav-sub { display:block; }'}
  .nav-sub li a { display:block; padding:7px 10px; color:var(--c-text); text-decoration:none; font-size:.9rem; border-radius:6px; }
  .nav-sub li a:hover, .nav-sub li a.active { background:rgba(0,0,0,.04); color:var(--c-primary); font-weight:600; }
  .nav-toggle, .nav-toggle-cb { display:none; }
  .content { flex:1; min-width:0; background:#FFFFFF; min-height:100vh; }
  main { max-width:760px; margin:0 auto; padding:32px 20px 80px; }
  main > .page-title { font-size:1.75rem; margin:0 0 24px; }
  .crumb { font-size:.8rem; color:var(--c-muted); margin:0 0 14px; display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
  .crumb a { color:var(--c-muted); text-decoration:none; } .crumb a:hover { color:var(--c-primary); } .crumb b { color:var(--c-text); }
  .sec { margin:0 0 24px; }
  .sec-text p { margin:0 0 12px; }
  .sec-text a { color:var(--c-primary); }
  .sec-text blockquote { margin:0 0 12px; padding:8px 16px; border-left:3px solid var(--c-primary); color:var(--c-muted); background:#fff; }
  .sec-text ul { margin:0 0 12px; padding-left:22px; }
  .sec-heading h2 { font-size:1.9rem; font-weight:800; margin:10px 0; letter-spacing:-.01em; }
  .sec-heading h3 { font-size:1.2rem; font-weight:700; margin:6px 0; color:var(--c-muted); }
  .sec-heading-bg { background:var(--c-primary); border-radius:12px; padding:14px 20px; }
  .sec-heading-bg h2, .sec-heading-bg h3 { color:#fff; margin:0; }
  .sec-divider hr { border:none; border-top:1px solid var(--c-border); margin:8px 0; }
  .sec-embed { overflow:hidden; }
  .sec-embed iframe { max-width:100%; border:0; }
  .sec-embed img { max-width:100%; height:auto; }
  .sec-link .btn { display:inline-block; background:var(--c-primary); color:#fff; padding:10px 22px; border-radius:10px; text-decoration:none; font-weight:600; }
  .sec-link .btn-link { color:var(--c-primary); text-decoration:underline; }
  .sec-image figure { margin:0; }
  .sec-image img { width:100%; border-radius:12px; display:block; }
  .sec-image.img-normal { max-width:480px; } .sec-image.img-wide { max-width:680px; } .sec-image.img-full { max-width:100%; }
  .sec-image figcaption { color:var(--c-muted); font-size:.85rem; margin-top:6px; text-align:center; }
  .yt { position:relative; width:100%; padding-top:56.25%; border-radius:12px; overflow:hidden; background:#000; }
  .yt iframe { position:absolute; inset:0; width:100%; height:100%; }
  .site-footer { text-align: center; color: #94A3B8; font-size: 10px; padding: 24px 20px; border-top: 1px solid var(--c-border); margin-top: 64px; opacity: 0.85; }
  .page-nav-container { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 48px; border-t: 1px solid var(--c-border); padding-top: 32px; }
  .page-nav-card { display: flex; align-items: center; gap: 16px; background: var(--c-bg); border: 1px solid var(--c-border); border-radius: 12px; padding: 16px 20px; text-decoration: none; transition: all 0.2s ease; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
  .page-nav-card:hover { border-color: var(--c-primary); box-shadow: 0 4px 12px rgba(0,0,0,0.05); transform: translateY(-1px); }
  .page-nav-label { display: block; font-size: 10px; font-weight: 700; color: var(--c-muted); text-transform: uppercase; letter-spacing: 0.05em; line-height: 1.2; margin-bottom: 4px; }
  .page-nav-title { display: block; font-size: 0.95rem; font-weight: 700; color: var(--c-text); line-height: 1.3; }
  .page-nav-card:hover .page-nav-title { color: var(--c-primary); }
  .page-nav-icon { display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: var(--c-muted); }
  .page-nav-card:hover .page-nav-icon { color: var(--c-primary); }
  .site-counter { display: inline-flex; align-items: center; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; font-size:10px; font-weight:700; border-radius:4px; overflow:hidden; border:1px solid var(--c-border); line-height:1; }
  .counter-label { background:#475569; color:#FFFFFF; padding:4px 6px; letter-spacing:0.05em; }
  .counter-val { background:var(--c-primary); color:#FFFFFF; padding:4px 8px; }
  .top-counter { margin-left: auto; align-self: center; }
  @media (max-width:640px){
    .layout{display:block;}
    .site-header{width:auto;min-height:0;border-right:none;border-bottom:1px solid var(--c-border);display:flex;flex-wrap:wrap;align-items:center;gap:8px;}
    .site-header h1{flex:1;}
    .nav-toggle{display:inline-flex;cursor:pointer;font-size:1.3rem;line-height:1;padding:4px 10px;border:1px solid var(--c-border);border-radius:8px;color:var(--c-text);user-select:none;}
    .site-nav{display:none;flex-basis:100%;margin-top:6px;}
    .nav-toggle-cb:checked ~ .site-nav{display:block;}
    .nav-list{flex-direction:column;gap:2px;}
    .nav-caret{display:none;}
    .nav-sub{position:static;display:block;border:none;box-shadow:none;padding:2px 0 4px 14px;min-width:0;background:transparent;}
    .page-nav-container { grid-template-columns: 1fr; gap: 12px; }
  }
</style>
</head>
<body>
  <div class="layout">
    <header class="site-header">
      ${t.showTitle ? `<h1><a href="/${encodeURIComponent(siteSlug)}">${escapeHtml(headerTitle)}</a></h1>` : ''}
      ${renderNav(pages, siteSlug, page)}
      ${t.showCounter && !navSide ? `<div class="site-counter top-counter"><span class="counter-label">VIEWS</span><span class="counter-val">${site.click_count ?? 0}</span></div>` : ''}
    </header>
    <div class="content">
      <main>
        ${renderBreadcrumb(page, pages, siteSlug)}
        <h1 class="page-title">${page.icon ? `<span class="page-icon" style="margin-right:8px; font-size:1.15em; vertical-align: middle;">${page.icon}</span>` : ''}<span style="vertical-align: middle;">${escapeHtml(page.title)}</span></h1>
        ${sectionsHtml || '<p style="color:var(--c-muted)">아직 콘텐츠가 없습니다.</p>'}
        ${renderPageNavigation(page, pages, siteSlug, t.showNavigation)}
        ${t.showCounter && navSide ? `<div style="display:flex; justify-content:center; margin-top:48px; width:100%;"><div class="site-counter"><span class="counter-label">VIEWS</span><span class="counter-val">${site.click_count ?? 0}</span></div></div>` : ''}
      </main>
      <footer class="site-footer">
        최종 게시: ${site.published_at ? site.published_at : '미게시 상태'}
      </footer>
    </div>
  </div>
</body>
</html>`;
}

function notFoundHtml(title = '페이지를 찾을 수 없습니다', msg = '요청하신 페이지를 찾을 수 없습니다.'): string {
    return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(title)}</title>
<style>body{margin:0;font-family:'Pretendard',-apple-system,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#F8FAFC;color:#1F2937}.box{text-align:center;padding:24px}h1{font-size:3rem;margin:0}p{color:#6B7280}</style>
</head><body><div class="box"><h1>404</h1><p>${escapeHtml(msg)}</p></div></body></html>`;
}

// slug → 사이트 여부 확인. 사이트가 아니면 null (호출측에서 SPA fallback).
export async function lookupSiteBySlug(c: AnyCtx, slug: string): Promise<{ siteId: number } | null> {
    const row = await c.env.DB.prepare(
        "SELECT site_id, kind, is_active FROM urls WHERE base_slug = ? OR custom_slug = ? OR slug = ?"
    ).bind(slug, slug, slug).first() as { site_id: number | null; kind: string; is_active: number } | null;
    if (!row || row.kind !== 'site' || !row.site_id) return null;
    return { siteId: row.site_id };
}

// KV 게시 캐시 키
export function pubKey(slug: string, path: string): string { return `pub:${slug}:${path}`; }

const PUBLIC_CACHE_HEADERS = { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=600' };

function htmlResponse(html: string, status = 200, extraHeaders: Record<string, string> = {}): Response {
    return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=UTF-8', ...extraHeaders } });
}

// 페이지 → 공개 경로('' | 'a' | 'a/b') 매핑. 홈은 '' 로도 매핑.
function pagePathMap(pages: Array<any>, homePageId: number | null): Map<number, string> {
    const byId = new Map<number, any>(pages.map(p => [p.id, p]));
    const pathOf = (p: any): string => {
        if (p.parent_id == null) return p.slug;
        const parent = byId.get(p.parent_id);
        return parent ? `${parent.slug}/${p.slug}` : p.slug;
    };
    const map = new Map<number, string>();
    for (const p of pages) map.set(p.id, pathOf(p));
    return map;
}

function resolveHome(pages: Array<any>, homePageId: number | null): any | null {
    return (homePageId && pages.find(p => p.id === homePageId))
        || pages.filter(p => p.parent_id == null).sort((a, b) => a.sort - b.sort)[0]
        || null;
}

// ── 게시(publish)용: 사이트의 모든 경로를 렌더해 스냅샷 배열 반환 ──
export async function renderAllSnapshots(c: AnyCtx, siteId: number): Promise<{ siteSlug: string; rev: number; snapshots: Array<{ path: string; html: string }> } | null> {
    const site = await c.env.DB.prepare(
        `SELECT s.id, s.title, s.theme, s.home_page_id, s.rev, s.published_at, u.base_slug, u.custom_slug, u.click_count AS click_count
         FROM sites s JOIN urls u ON u.id = s.url_id WHERE s.id = ?`
    ).bind(siteId).first() as any;
    if (!site) return null;
    const siteSlug = site.custom_slug || site.base_slug;

    const { results: pagesRaw } = await c.env.DB.prepare(
        "SELECT id, parent_id, slug, title, depth, sort, icon FROM site_pages WHERE site_id = ? ORDER BY depth, sort, id"
    ).bind(siteId).all();
    const pages = pagesRaw as Array<any>;

    // 사이트 전체 섹션을 1회 조회 후 페이지별 그룹핑
    const { results: secRaw } = await c.env.DB.prepare(
        `SELECT sec.id, sec.page_id, sec.type, sec.content, sec.sort
         FROM site_sections sec JOIN site_pages p ON p.id = sec.page_id
         WHERE p.site_id = ? ORDER BY sec.sort, sec.id`
    ).bind(siteId).all();
    const sectionsByPage = new Map<number, Array<any>>();
    for (const s of secRaw as Array<any>) {
        if (!sectionsByPage.has(s.page_id)) sectionsByPage.set(s.page_id, []);
        sectionsByPage.get(s.page_id)!.push(s);
    }

    const paths = pagePathMap(pages, site.home_page_id);
    const snapshots: Array<{ path: string; html: string }> = [];
    for (const p of pages) {
        const html = renderPage(site, p, sectionsByPage.get(p.id) || [], pages, siteSlug);
        snapshots.push({ path: paths.get(p.id)!, html });
    }
    // 홈('' 경로)
    const home = resolveHome(pages, site.home_page_id);
    if (home) snapshots.push({ path: '', html: renderPage(site, home, sectionsByPage.get(home.id) || [], pages, siteSlug) });

    return { siteSlug, rev: site.rev, snapshots };
}

// 공개 조회수 집계 (사이트 urls 행의 click_count += 1). 비동기, 실패 무시.
function bumpView(c: AnyCtx, siteId: number): void {
    try { c.executionCtx.waitUntil(c.env.DB.prepare("UPDATE urls SET click_count = click_count + 1 WHERE site_id = ?").bind(siteId).run()); } catch { /* noop */ }
}

// ── 공개 서빙: 게시 스냅샷(KV → D1) 기반. 미게시/비공개/미스는 404 ──
export async function serveSiteById(c: AnyCtx, siteId: number, slug: string, segs: string[]): Promise<Response> {
    const path = segs.map(s => { try { return decodeURIComponent(s).normalize('NFC'); } catch { return s.normalize('NFC'); } }).join('/');

    // 1) KV 게시 캐시
    try {
        const cached = await c.env.URL_CACHE.get(pubKey(slug, path));
        if (cached) { bumpView(c, siteId); return htmlResponse(cached, 200, PUBLIC_CACHE_HEADERS); }
    } catch { /* KV 실패는 D1로 폴백 */ }

    // 2) D1 스냅샷 (is_public=1 게시분만)
    const row = await c.env.DB.prepare(
        `SELECT snap.html AS html FROM site_snapshots snap
         JOIN sites s ON s.id = snap.site_id
         WHERE snap.site_id = ? AND snap.path = ? AND s.is_public = 1 AND s.published_rev > 0`
    ).bind(siteId, path).first() as { html: string } | null;

    if (!row) {
        return htmlResponse(notFoundHtml('아직 게시되지 않았습니다', '이 페이지는 아직 게시되지 않았거나 존재하지 않습니다.'), 404);
    }

    // KV 재적재 (7일 TTL 안전망 — D1이 권위 소스)
    try { c.executionCtx.waitUntil(c.env.URL_CACHE.put(pubKey(slug, path), row.html, { expirationTtl: 604800 })); } catch { /* noop */ }
    bumpView(c, siteId);
    return htmlResponse(row.html, 200, PUBLIC_CACHE_HEADERS);
}

// ── 초안 미리보기(preview): 인증된 소유자용. D1 실시간 렌더, 캐시 없음. theme 오버라이드 지원 ──
export async function renderDraftResponse(c: AnyCtx, siteId: number, segs: string[], themeOverride?: string): Promise<Response> {
    const site = await c.env.DB.prepare(
        `SELECT s.id, s.title, s.theme, s.home_page_id, s.published_at, u.base_slug, u.custom_slug, u.click_count AS click_count
         FROM sites s JOIN urls u ON u.id = s.url_id WHERE s.id = ?`
    ).bind(siteId).first() as any;
    if (!site) return htmlResponse(notFoundHtml(), 404);
    if (themeOverride) site.theme = themeOverride;
    const siteSlug = site.custom_slug || site.base_slug;

    const { results: pagesRaw } = await c.env.DB.prepare(
        "SELECT id, parent_id, slug, title, depth, sort, icon FROM site_pages WHERE site_id = ? ORDER BY depth, sort, id"
    ).bind(siteId).all();
    const pages = pagesRaw as Array<any>;

    let page: any = null;
    if (segs.length === 0) {
        page = resolveHome(pages, site.home_page_id);
    } else {
        let parentId: number | null = null;
        for (const seg of segs) {
            const decoded = (() => { try { return decodeURIComponent(seg).normalize('NFC'); } catch { return seg.normalize('NFC'); } })();
            const match = pages.find(p => p.slug === decoded && (p.parent_id ?? null) === parentId);
            if (!match) { page = null; break; }
            page = match; parentId = match.id;
        }
    }
    if (!page) return htmlResponse(notFoundHtml(), 404);

    const { results: sections } = await c.env.DB.prepare(
        "SELECT id, type, content, sort FROM site_sections WHERE page_id = ? ORDER BY sort, id"
    ).bind(page.id).all();

    return htmlResponse(renderPage(site, page, sections as Array<any>, pages, siteSlug), 200, { 'Cache-Control': 'no-store' });
}
