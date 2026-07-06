// src/client/pages/SiteEditor.tsx
// 에듀링크 페이지: 전용 편집기 (Step 14~15)
//  - 3패널(페이지 트리 · 섹션 편집 · 실시간 미리보기)
//  - 자동저장 + 저장 인디케이터, 게시 버튼/배지
//  - prompt/confirm 전면 제거 → 모달·인라인 폼, 낙관적 업데이트
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Chip, Input, Tooltip } from '@heroui/react';
import {
  ChevronLeft, Plus, Trash2, Edit3, Check, X, Home, FileText, MonitorPlay,
  Heading, Image as ImageIcon, Link as LinkIcon, Minus, ArrowUp, ArrowDown,
  Palette, Rocket, ExternalLink, Copy, Loader2, Monitor, Smartphone, CornerDownRight, RefreshCw, Code,
} from 'lucide-react';

interface SiteDetail {
  id: number; title: string; theme: string; is_public: number;
  home_page_id: number | null; rev: number; published_rev: number; published_at: string | null;
  slug: string; base_slug: string; custom_slug: string | null;
}
interface PageNode { id: number; parent_id: number | null; slug: string; title: string; depth: number; sort: number; }
interface SectionItem { id: number; type: string; content: any; sort: number; }

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const MAX_DEPTH = 1;

function safeParse(s: any): any { if (typeof s !== 'string') return s ?? {}; try { return JSON.parse(s); } catch { return {}; } }

// 제목 → 슬러그 후보 (한글 허용, 4~20자)
function slugify(title: string): string {
  let s = String(title).trim().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9가-힣-]/g, '')
    .replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (s.length > 20) s = s.slice(0, 20);
  if (s.length < 4) s = (s + '-page').slice(0, 20);
  return s;
}

export default function SiteEditor() {
  const { id } = useParams();
  const siteId = Number(id);
  const navigate = useNavigate();
  const mockRole = typeof localStorage !== 'undefined' ? localStorage.getItem('mock_role') : null;
  const getHeaders = useCallback((extra: any = {}) => {
    const h: any = { 'Content-Type': 'application/json', ...extra };
    if (mockRole) h['x-mock-role'] = mockRole;
    return h;
  }, [mockRole]);

  const [site, setSite] = useState<SiteDetail | null>(null);
  const [pages, setPages] = useState<PageNode[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<number | null>(null);
  const [sections, setSections] = useState<SectionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState<string>('');
  const [dirty, setDirty] = useState(false);       // 미게시 변경 존재
  const [publishing, setPublishing] = useState(false);

  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const toastTimer = useRef<any>(null);
  const showToast = (type: 'ok' | 'err', msg: string) => {
    setToast({ type, msg });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  };

  // 미리보기
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewDevice, setPreviewDevice] = useState<'pc' | 'mobile'>('pc');
  const previewTimer = useRef<any>(null);

  // 모달
  const [pageModal, setPageModal] = useState<{ mode: 'create' | 'edit'; parentId: number | null; page?: PageNode } | null>(null);
  const [addressModal, setAddressModal] = useState(false);
  const [confirmDel, setConfirmDel] = useState<{ kind: 'page' | 'section'; id: number; label: string } | null>(null);
  const [showDesign, setShowDesign] = useState(false);

  // ─────────── 저장 상태 래퍼 ───────────
  const markSaving = () => setSaveState('saving');
  const markSaved = () => { setSaveState('saved'); setSavedAt(new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })); setDirty(true); schedulePreview(); };
  const markError = (m?: string) => { setSaveState('error'); if (m) showToast('err', m); };

  // ─────────── 로드 ───────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/sites/${siteId}`, { headers: getHeaders() });
      const data = await res.json();
      if (!data.success) { setNotFound(true); setLoading(false); return; }
      setSite(data.site);
      setPages(data.pages);
      setDirty((data.site.rev || 0) > (data.site.published_rev || 0));
      const first = (data.site.home_page_id && data.pages.find((p: PageNode) => p.id === data.site.home_page_id))
        ? data.site.home_page_id : (data.pages[0]?.id ?? null);
      if (first) await selectPage(first, data.pages);
      else { setSelectedPageId(null); setSections([]); }
    } catch (e: any) { showToast('err', '불러오기 오류: ' + e.message); }
    finally { setLoading(false); }
  }, [siteId, getHeaders]);

  useEffect(() => { if (Number.isFinite(siteId)) load(); }, [siteId]);

  const pathForPage = useCallback((pageId: number | null, list = pages): string => {
    if (!pageId) return '';
    const byId = new Map(list.map(p => [p.id, p]));
    const p = byId.get(pageId); if (!p) return '';
    // 홈이면 '' 로 미리보기
    if (site && site.home_page_id === pageId) return '';
    if (p.parent_id == null) return encodeURIComponent(p.slug);
    const parent = byId.get(p.parent_id);
    return parent ? `${encodeURIComponent(parent.slug)}/${encodeURIComponent(p.slug)}` : encodeURIComponent(p.slug);
  }, [pages, site]);

  const selectPage = async (pageId: number, list = pages) => {
    setSelectedPageId(pageId);
    setShowDesign(false);
    try {
      const res = await fetch(`/api/pages/${pageId}`, { headers: getHeaders() });
      const data = await res.json();
      if (data.success) setSections((data.sections as any[]).map(s => ({ ...s, content: safeParse(s.content) })));
      else showToast('err', data.error || '페이지 로드 실패');
    } catch (e: any) { showToast('err', '오류: ' + e.message); }
    schedulePreview(pageId, list);
  };

  // ─────────── 미리보기 (srcdoc: 인증 헤더/쿠키 모두 대응) ───────────
  const fetchPreview = useCallback(async (pageId = selectedPageId, list = pages) => {
    try {
      const path = pathForPage(pageId, list);
      const res = await fetch(`/api/sites/${siteId}/preview?path=${path}`, { headers: getHeaders() });
      const html = await res.text();
      setPreviewHtml(html);
    } catch { /* 무시 */ }
  }, [siteId, selectedPageId, pages, getHeaders, pathForPage]);

  const schedulePreview = (pageId = selectedPageId, list = pages) => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => fetchPreview(pageId, list), 500);
  };
  useEffect(() => { if (site) fetchPreview(); /* 최초 */ }, [site?.id]);

  // ─────────── 사이트 필드 ───────────
  const patchSite = async (body: any, optimistic?: Partial<SiteDetail>) => {
    markSaving();
    if (optimistic) setSite(s => s ? { ...s, ...optimistic } : s);
    try {
      const res = await fetch(`/api/sites/${siteId}`, { method: 'PATCH', headers: getHeaders(), body: JSON.stringify(body) });
      const data = await res.json();
      if (data.success) markSaved(); else markError(data.error);
      return data.success;
    } catch (e: any) { markError('네트워크 오류'); return false; }
  };

  const [titleDraft, setTitleDraft] = useState('');
  useEffect(() => { if (site) setTitleDraft(site.title); }, [site?.id]);
  const commitTitle = async () => {
    const t = titleDraft.trim();
    if (!t || !site || t === site.title) { if (site) setTitleDraft(site.title); return; }
    await patchSite({ title: t }, { title: t });
  };

  // ─────────── 페이지 ───────────
  const rootPages = pages.filter(p => p.parent_id == null).sort((a, b) => a.sort - b.sort);
  const childrenOf = (pid: number) => pages.filter(p => p.parent_id === pid).sort((a, b) => a.sort - b.sort);

  const submitPageModal = async (title: string, slug: string) => {
    if (!pageModal) return;
    markSaving();
    try {
      if (pageModal.mode === 'create') {
        const res = await fetch(`/api/sites/${siteId}/pages`, {
          method: 'POST', headers: getHeaders(),
          body: JSON.stringify({ title, slug, parent_id: pageModal.parentId }),
        });
        const data = await res.json();
        if (!data.success) return markError(data.error);
        const np: PageNode = { id: data.id, parent_id: pageModal.parentId, slug: data.slug, title, depth: data.depth, sort: data.sort };
        setPages(prev => [...prev, np]);
        setPageModal(null); markSaved();
        selectPage(data.id, [...pages, np]);
      } else if (pageModal.page) {
        const res = await fetch(`/api/pages/${pageModal.page.id}`, { method: 'PATCH', headers: getHeaders(), body: JSON.stringify({ title, slug }) });
        const data = await res.json();
        if (!data.success) return markError(data.error);
        setPages(prev => prev.map(p => p.id === pageModal.page!.id ? { ...p, title, slug } : p));
        setPageModal(null); markSaved();
      }
    } catch (e: any) { markError('네트워크 오류'); }
  };

  const setHome = async (p: PageNode) => {
    const ok = await patchSite({ home_page_id: p.id }, { home_page_id: p.id });
    if (ok) showToast('ok', `'${p.title}'을(를) 홈으로 지정했습니다.`);
  };

  const doDeletePage = async (pageId: number) => {
    markSaving();
    try {
      const res = await fetch(`/api/pages/${pageId}`, { method: 'DELETE', headers: getHeaders() });
      const data = await res.json();
      if (!data.success) return markError(data.error);
      // 후손까지 로컬 제거
      const toRemove = new Set<number>([pageId]);
      let grew = true;
      while (grew) { grew = false; for (const p of pages) if (p.parent_id && toRemove.has(p.parent_id) && !toRemove.has(p.id)) { toRemove.add(p.id); grew = true; } }
      const remaining = pages.filter(p => !toRemove.has(p.id));
      setPages(remaining);
      if (selectedPageId && toRemove.has(selectedPageId)) {
        const next = remaining[0]?.id ?? null;
        if (next) selectPage(next, remaining); else { setSelectedPageId(null); setSections([]); }
      }
      markSaved();
    } catch (e: any) { markError('네트워크 오류'); }
  };

  const movePage = async (p: PageNode, dir: -1 | 1) => {
    const sibs = pages.filter(x => (x.parent_id ?? null) === (p.parent_id ?? null)).sort((a, b) => a.sort - b.sort);
    const i = sibs.findIndex(x => x.id === p.id); const j = i + dir;
    if (j < 0 || j >= sibs.length) return;
    [sibs[i], sibs[j]] = [sibs[j], sibs[i]];
    const orderIds = sibs.map(s => s.id);
    // 낙관적 sort 갱신
    setPages(prev => prev.map(x => { const idx = orderIds.indexOf(x.id); return idx >= 0 ? { ...x, sort: idx } : x; }));
    markSaving();
    try {
      const res = await fetch('/api/pages/reorder', { method: 'POST', headers: getHeaders(), body: JSON.stringify({ order: orderIds }) });
      const data = await res.json();
      if (data.success) markSaved(); else markError(data.error);
    } catch { markError('네트워크 오류'); }
  };

  // ─────────── 섹션 ───────────
  const addSection = async (type: string, content: any) => {
    if (!selectedPageId) return;
    markSaving();
    try {
      const res = await fetch(`/api/pages/${selectedPageId}/sections`, { method: 'POST', headers: getHeaders(), body: JSON.stringify({ type, content }) });
      const data = await res.json();
      if (!data.success) return markError(data.error);
      setSections(prev => [...prev, { id: data.id, type, content: data.content, sort: data.sort }]);
      markSaved();
    } catch { markError('네트워크 오류'); }
  };

  const patchSectionContent = async (sec: SectionItem, content: any, optimistic = true) => {
    if (optimistic) setSections(prev => prev.map(s => s.id === sec.id ? { ...s, content } : s));
    markSaving();
    try {
      const res = await fetch(`/api/sections/${sec.id}`, { method: 'PATCH', headers: getHeaders(), body: JSON.stringify({ content }) });
      const data = await res.json();
      if (data.success) { if (data.content) setSections(prev => prev.map(s => s.id === sec.id ? { ...s, content: data.content } : s)); markSaved(); }
      else markError(data.error);
    } catch { markError('네트워크 오류'); }
  };

  const deleteSection = async (secId: number) => {
    markSaving();
    try {
      const res = await fetch(`/api/sections/${secId}`, { method: 'DELETE', headers: getHeaders() });
      const data = await res.json();
      if (!data.success) return markError(data.error);
      setSections(prev => prev.filter(s => s.id !== secId));
      markSaved();
    } catch { markError('네트워크 오류'); }
  };

  const moveSection = async (idx: number, dir: -1 | 1) => {
    const next = [...sections]; const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setSections(next);
    markSaving();
    try {
      const res = await fetch('/api/sections/reorder', { method: 'POST', headers: getHeaders(), body: JSON.stringify({ page_id: selectedPageId, order: next.map(s => s.id) }) });
      const data = await res.json();
      if (data.success) markSaved(); else markError(data.error);
    } catch { markError('네트워크 오류'); }
  };

  const uploadImage = (): Promise<string | null> => new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp,image/gif';
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return resolve(null);
      markSaving();
      try {
        const fd = new FormData(); fd.append('file', file);
        const h: any = {}; if (mockRole) h['x-mock-role'] = mockRole;
        const res = await fetch(`/api/sites/${siteId}/media`, { method: 'POST', headers: h, body: fd });
        const data = await res.json();
        if (data.success) { markSaved(); resolve(data.url); }
        else { markError(data.error); resolve(null); }
      } catch { markError('업로드 오류'); resolve(null); }
    };
    input.click();
  });

  // ─────────── 게시 ───────────
  const publish = async () => {
    setPublishing(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/publish`, { method: 'POST', headers: getHeaders() });
      const data = await res.json();
      if (data.success) {
        showToast('ok', `게시되었습니다 (${data.published}개 페이지).`);
        setDirty(false);
        setSite(s => s ? { ...s, published_rev: data.rev } : s);
      } else showToast('err', data.error || '게시 실패');
    } catch (e: any) { showToast('err', '네트워크 오류'); }
    finally { setPublishing(false); }
  };

  const copyPublicLink = () => {
    if (!site) return;
    const url = `${window.location.origin}/${site.custom_slug || site.base_slug}`;
    navigator.clipboard.writeText(url).then(() => showToast('ok', '주소 복사됨: ' + url));
  };

  // ─────────── 렌더 ───────────
  if (loading) return <FullMsg><Loader2 className="w-6 h-6 animate-spin text-blue-500" /><span className="text-slate-500 text-sm">불러오는 중…</span></FullMsg>;
  if (notFound || !site) return <FullMsg><p className="text-slate-600">사이트를 찾을 수 없거나 권한이 없습니다.</p><Button size="sm" variant="flat" onClick={() => navigate('/dashboard/pages')}>대시보드로</Button></FullMsg>;

  const publicSlug = site.custom_slug || site.base_slug;
  const needPublish = dirty || site.published_rev === 0;
  const selectedPage = pages.find(p => p.id === selectedPageId) || null;

  return (
    <div className="h-screen flex flex-col bg-slate-50">
      {/* 상단바 */}
      <header className="flex items-center gap-2 px-3 h-14 bg-white border-b border-slate-200 shrink-0">
        <Tooltip content="대시보드로 나가기" delay={200}>
          <Button size="sm" variant="bordered" onClick={() => navigate('/dashboard/pages')} className="bg-slate-50 border-slate-200 text-slate-600 font-medium hover:bg-slate-100" startContent={<ChevronLeft className="w-4 h-4" />}>나가기</Button>
        </Tooltip>
        <input className="font-bold text-slate-800 text-sm bg-transparent border border-transparent hover:border-slate-200 focus:border-blue-400 rounded px-2 py-1 focus:outline-none max-w-[220px]"
          value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} onBlur={commitTitle}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        <SaveIndicator state={saveState} at={savedAt} />
        <div className="flex-1" />
        <Tooltip content="클릭하면 공개용 주소를 복사합니다" delay={200}>
          <button className="text-xs text-slate-600 bg-slate-50 hover:bg-slate-100 hover:text-blue-600 border border-slate-200 rounded-lg px-2.5 py-1.5 inline-flex items-center gap-1.5 transition-colors font-mono" onClick={copyPublicLink}>
            /{publicSlug} <Copy className="w-3 h-3 text-slate-400" />
          </button>
        </Tooltip>
        <Tooltip content="연결용 맞춤 주소 변경" delay={200}><Button isIconOnly size="sm" variant="bordered" className="border-slate-200 text-slate-600 hover:bg-slate-100" onClick={() => setAddressModal(true)}><Edit3 className="w-4 h-4" /></Button></Tooltip>
        <Tooltip content="공개용 웹 페이지 열기" delay={200}><Button isIconOnly size="sm" variant="bordered" className="border-slate-200 text-slate-600 hover:bg-slate-100" onClick={() => window.open(`/${publicSlug}`, '_blank')}><ExternalLink className="w-4 h-4" /></Button></Tooltip>
        {needPublish
          ? <Chip size="sm" variant="flat" color="warning">{site.published_rev === 0 ? '미게시' : '게시 필요'}</Chip>
          : <Chip size="sm" variant="flat" color="success">게시됨</Chip>}
        <Tooltip content="현재 편집 중인 초안 상태를 사이트에 최종 반영(게시)합니다" delay={200}>
          <Button size="sm" color="primary" variant={needPublish ? 'solid' : 'flat'} isLoading={publishing}
            onClick={publish} startContent={!publishing ? <Rocket className="w-3.5 h-3.5" /> : undefined}>게시</Button>
        </Tooltip>
      </header>

      {/* 본문 3패널 */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)_minmax(0,1fr)]">
        {/* 페이지 트리 + 디자인(하단) */}
        <aside className="border-r border-slate-200 bg-white flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto p-2.5">
            <div className="flex items-center justify-between mb-1.5 px-1">
              <span className="text-xs font-bold text-slate-500">페이지</span>
              <Button size="sm" variant="flat" color="primary" onClick={() => setPageModal({ mode: 'create', parentId: null })} startContent={<Plus className="w-3.5 h-3.5" />}>추가</Button>
            </div>
            {rootPages.length === 0 && <p className="text-xs text-slate-400 py-4 text-center">페이지를 추가하세요.</p>}
            {rootPages.map((root, ri) => (
              <div key={root.id}>
                <TreeRow page={root} isHome={site.home_page_id === root.id} active={!showDesign && selectedPageId === root.id}
                  canChild={childrenOf(root.id).length < 99}
                  onSelect={() => selectPage(root.id)} onEdit={() => setPageModal({ mode: 'edit', parentId: root.parent_id, page: root })}
                  onDelete={() => setConfirmDel({ kind: 'page', id: root.id, label: root.title })} onHome={() => setHome(root)}
                  onAddChild={() => setPageModal({ mode: 'create', parentId: root.id })}
                  onUp={ri > 0 ? () => movePage(root, -1) : undefined} onDown={ri < rootPages.length - 1 ? () => movePage(root, 1) : undefined} />
                {childrenOf(root.id).map((ch, ci, arr) => (
                  <TreeRow key={ch.id} page={ch} child isHome={site.home_page_id === ch.id} active={!showDesign && selectedPageId === ch.id}
                    onSelect={() => selectPage(ch.id)} onEdit={() => setPageModal({ mode: 'edit', parentId: ch.parent_id, page: ch })}
                    onDelete={() => setConfirmDel({ kind: 'page', id: ch.id, label: ch.title })} onHome={() => setHome(ch)}
                    onUp={ci > 0 ? () => movePage(ch, -1) : undefined} onDown={ci < arr.length - 1 ? () => movePage(ch, 1) : undefined} />
                ))}
              </div>
            ))}
          </div>
          <div className="border-t border-slate-100 p-2.5">
            <Button 
              size="sm" 
              variant={showDesign ? 'solid' : 'bordered'} 
              color={showDesign ? 'secondary' : 'default'} 
              className={showDesign 
                ? 'w-full font-bold shadow-md shadow-secondary/20 bg-purple-600 text-white' 
                : 'w-full border-purple-200 text-purple-600 hover:bg-purple-50 font-bold'
              } 
              onClick={() => setShowDesign(true)} 
              startContent={<Palette className="w-3.5 h-3.5" />}
            >
              디자인 설정
            </Button>
          </div>
        </aside>

        {/* 섹션 편집 */}
        <main className="overflow-y-auto p-4 bg-slate-50">
          {showDesign ? (
            <DesignPanel
              theme={safeParse(site.theme)}
              onClose={() => setShowDesign(false)}
              onPreview={(t) => fetchPreviewTheme(t)}
              onSave={async (t) => {
                const ok = await patchSite({ theme: t });
                if (ok) {
                  setShowDesign(false);
                  showToast('ok', '디자인 저장됨. 게시하면 반영됩니다.');
                }
              }}
            />
          ) : !selectedPage ? (
            <p className="text-sm text-slate-400 text-center py-16">왼쪽에서 페이지를 선택하거나 추가하세요.</p>
          ) : (
            <>
              <div className="flex items-center gap-1.5 mb-3 flex-wrap sticky top-0 bg-slate-50 py-2 border-b border-slate-200/60 z-10">
                <span className="text-xs font-bold text-slate-500 mr-auto">‘{selectedPage.title}’ 콘텐츠</span>
                <AddBtn onClick={() => addSection('text', { text: '', format: 'markdown' })} icon={<FileText className="w-3.5 h-3.5" />} tooltip="본문에 들어갈 텍스트 단락 추가 (마크다운 지원)">본문</AddBtn>
                <AddBtn onClick={() => addSection('heading', { text: '제목', level: 2, bg: false })} icon={<Heading className="w-3.5 h-3.5" />} tooltip="텍스트 단락들을 나눌 대/소제목 섹션 추가">제목</AddBtn>
                <AddBtn onClick={async () => { const u = await uploadImage(); if (u) addSection('image', { url: u, alt: '', width: 'normal' }); }} icon={<ImageIcon className="w-3.5 h-3.5" />} tooltip="기기에 소장한 사진/이미지 파일 삽입">이미지</AddBtn>
                <AddBtn color="danger" onClick={() => addSection('youtube', { url: '' })} icon={<MonitorPlay className="w-3.5 h-3.5" />} tooltip="유튜브 비디오 플레이어 삽입">유튜브</AddBtn>
                <AddBtn onClick={() => addSection('link', { label: '버튼', url: '', style: 'button', newTab: true })} icon={<LinkIcon className="w-3.5 h-3.5" />} tooltip="외부 링크 혹은 타 페이지 연결 버튼 추가">버튼</AddBtn>
                <AddBtn onClick={() => addSection('embed', { html: '' })} icon={<Code className="w-3.5 h-3.5" />} tooltip="구글 폼/지도/패들릿 등 외부 HTML 아이프레임(iframe) 삽입">임베드</AddBtn>
                <AddBtn onClick={() => addSection('divider', {})} icon={<Minus className="w-3.5 h-3.5" />} tooltip="섹션을 구분하는 가로줄 추가">구분선</AddBtn>
              </div>
              {sections.length === 0 && <p className="text-sm text-slate-400 text-center py-10">위 버튼으로 콘텐츠를 추가하세요.</p>}
              <div className="space-y-3">
                {sections.map((sec, idx) => (
                  <SectionCard key={sec.id} sec={sec} idx={idx} total={sections.length}
                    onSave={(content) => patchSectionContent(sec, content)}
                    onUpload={uploadImage}
                    onDelete={() => setConfirmDel({ kind: 'section', id: sec.id, label: '이 섹션' })}
                    onMove={(d) => moveSection(idx, d)} />
                ))}
              </div>
            </>
          )}
        </main>

        {/* 미리보기 */}
        <section className="border-l border-slate-200 bg-slate-100 hidden lg:flex flex-col">
          <div className="flex items-center gap-2 px-3 h-9 border-b border-slate-200 bg-white shrink-0">
            <span className="text-xs font-bold text-slate-500">미리보기</span>
            <span className="text-[10px] text-slate-400">(초안)</span>
            <div className="flex-1" />
            <button className={`p-1 rounded ${previewDevice === 'pc' ? 'bg-slate-200 text-slate-700' : 'text-slate-400'}`} onClick={() => setPreviewDevice('pc')}><Monitor className="w-4 h-4" /></button>
            <button className={`p-1 rounded ${previewDevice === 'mobile' ? 'bg-slate-200 text-slate-700' : 'text-slate-400'}`} onClick={() => setPreviewDevice('mobile')}><Smartphone className="w-4 h-4" /></button>
            <button className="p-1 rounded text-slate-400 hover:text-slate-700" onClick={() => fetchPreview()}><RefreshCw className="w-4 h-4" /></button>
          </div>
          <div className="flex-1 overflow-auto p-3 flex justify-center">
            <iframe title="preview" srcDoc={previewHtml}
              className="bg-white shadow-sm rounded-lg border border-slate-200"
              style={{ width: previewDevice === 'mobile' ? 375 : '100%', height: '100%', minHeight: 480 }} />
          </div>
        </section>
      </div>

      {/* 토스트 — 페이지 중앙 */}
      {toast && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center pointer-events-none">
          <div className={`px-5 py-3 rounded-xl shadow-xl text-sm text-white text-center max-w-[90%] ${toast.type === 'ok' ? 'bg-slate-800' : 'bg-rose-600'}`}>{toast.msg}</div>
        </div>
      )}

      {/* 모달들 */}
      {pageModal && <PageModal modal={pageModal} onClose={() => setPageModal(null)} onSubmit={submitPageModal} />}
      {confirmDel && <ConfirmModal label={confirmDel.label}
        message={confirmDel.kind === 'page' ? '이 페이지와 하위 페이지·콘텐츠가 모두 삭제됩니다.' : '이 섹션이 삭제됩니다.'}
        onCancel={() => setConfirmDel(null)}
        onConfirm={() => { const c = confirmDel; setConfirmDel(null); if (c.kind === 'page') doDeletePage(c.id); else deleteSection(c.id); }} />}
      {addressModal && <AddressModal current={site.custom_slug || ''} base={site.base_slug}
        onClose={() => setAddressModal(false)}
        onSubmit={async (v) => { const ok = await patchSite({ custom_slug: v }); if (ok) { setAddressModal(false); load(); } }} />}
    </div>
  );

  // 디자인 패널의 실시간 미리보기: theme 오버라이드로 preview 요청
  function fetchPreviewTheme(theme: any) {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(async () => {
      try {
        const path = pathForPage(selectedPageId);
        const res = await fetch(`/api/sites/${siteId}/preview?path=${path}&theme=${encodeURIComponent(JSON.stringify(theme))}`, { headers: getHeaders() });
        setPreviewHtml(await res.text());
      } catch { /* 무시 */ }
    }, 400);
  }
}

// ───────────────── 하위 컴포넌트 ─────────────────

function FullMsg({ children }: { children: React.ReactNode }) {
  return <div className="h-screen flex flex-col items-center justify-center gap-3 bg-slate-50">{children}</div>;
}

function SaveIndicator({ state, at }: { state: SaveState; at: string }) {
  if (state === 'saving') return <span className="text-xs text-slate-400 inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />저장 중…</span>;
  if (state === 'saved') return <span className="text-xs text-emerald-600 inline-flex items-center gap-1"><Check className="w-3 h-3" />저장됨 {at}</span>;
  if (state === 'error') return <span className="text-xs text-rose-500">저장 실패</span>;
  return null;
}

function AddBtn({ children, icon, onClick, color, tooltip }: { children: React.ReactNode; icon: React.ReactNode; onClick: () => void; color?: any; tooltip?: string }) {
  const btn = (
    <Button
      size="sm"
      variant="flat"
      color={color}
      onClick={onClick}
      className="border border-slate-200/80 shadow-sm hover:shadow hover:bg-slate-100 transition-all font-semibold"
      startContent={icon}
    >
      {children}
    </Button>
  );
  if (tooltip) {
    return <Tooltip content={tooltip} delay={200}>{btn}</Tooltip>;
  }
  return btn;
}

function TreeRow({ page, isHome, active, child, canChild, onSelect, onEdit, onDelete, onHome, onAddChild, onUp, onDown }: {
  page: PageNode; isHome: boolean; active: boolean; child?: boolean; canChild?: boolean;
  onSelect: () => void; onEdit: () => void; onDelete: () => void; onHome: () => void; onAddChild?: () => void; onUp?: () => void; onDown?: () => void;
}) {
  return (
    <div className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 cursor-pointer ${active ? 'bg-blue-50' : 'hover:bg-slate-50'} ${child ? 'ml-4' : ''}`} onClick={onSelect}>
      {child && <CornerDownRight className="w-3 h-3 text-slate-300 shrink-0" />}
      {isHome && <Home className="w-3 h-3 text-blue-500 shrink-0" />}
      <span className={`flex-1 truncate text-sm ${active ? 'text-blue-700 font-semibold' : 'text-slate-600'}`}>{page.title}</span>
      <div className="hidden group-hover:flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
        <IconBtn disabled={!onUp} onClick={onUp} title="위로"><ArrowUp className="w-3.5 h-3.5" /></IconBtn>
        <IconBtn disabled={!onDown} onClick={onDown} title="아래로"><ArrowDown className="w-3.5 h-3.5" /></IconBtn>
        {!isHome && <IconBtn onClick={onHome} title="홈으로"><Home className="w-3.5 h-3.5" /></IconBtn>}
        {canChild && onAddChild && <IconBtn onClick={onAddChild} title="하위 추가"><Plus className="w-3.5 h-3.5" /></IconBtn>}
        <IconBtn onClick={onEdit} title="편집"><Edit3 className="w-3.5 h-3.5" /></IconBtn>
        <IconBtn onClick={onDelete} title="삭제" danger><Trash2 className="w-3.5 h-3.5" /></IconBtn>
      </div>
    </div>
  );
}

function IconBtn({ children, onClick, disabled, danger, title }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; danger?: boolean; title?: string }) {
  const btn = (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`p-1 rounded transition-all ${
        danger 
          ? 'text-slate-400 hover:text-rose-500 hover:bg-rose-50' 
          : 'text-slate-400 hover:text-blue-500 hover:bg-blue-50'
      } disabled:opacity-20`}
    >
      {children}
    </button>
  );
  if (title) {
    return <Tooltip content={title} delay={200}>{btn}</Tooltip>;
  }
  return btn;
}

const SEC_LABEL: Record<string, string> = { text: '본문', youtube: '유튜브', heading: '제목', divider: '구분선', link: '버튼/링크', image: '이미지', embed: '임베드(HTML)' };

function SectionCard({ sec, idx, total, onSave, onUpload, onDelete, onMove }: {
  sec: SectionItem; idx: number; total: number;
  onSave: (content: any) => void; onUpload: () => Promise<string | null>; onDelete: () => void; onMove: (d: -1 | 1) => void;
}) {
  return (
    <div className="border border-slate-200/80 hover:border-slate-300 shadow-sm hover:shadow rounded-xl p-4 bg-white transition-all">
      <div className="flex items-center gap-2 mb-3">
        <Chip size="sm" variant="flat" color={sec.type === 'youtube' ? 'danger' : 'default'} className="font-bold">{SEC_LABEL[sec.type] || sec.type}</Chip>
        <div className="flex-1" />
        <IconBtn disabled={idx === 0} onClick={() => onMove(-1)} title="위로 이동"><ArrowUp className="w-4 h-4" /></IconBtn>
        <IconBtn disabled={idx === total - 1} onClick={() => onMove(1)} title="아래로 이동"><ArrowDown className="w-4 h-4" /></IconBtn>
        <IconBtn onClick={onDelete} danger title="삭제"><Trash2 className="w-4 h-4" /></IconBtn>
      </div>
      <SectionBody sec={sec} onSave={onSave} onUpload={onUpload} />
    </div>
  );
}

function SectionBody({ sec, onSave, onUpload }: { sec: SectionItem; onSave: (c: any) => void; onUpload: () => Promise<string | null> }) {
  const c = sec.content || {};

  if (sec.type === 'text') return <TextBody value={c.text ?? ''} onSave={(t) => onSave({ text: t, format: 'markdown' })} />;

  if (sec.type === 'heading') return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input className="flex-1 text-sm border border-slate-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-blue-400"
          defaultValue={c.text ?? ''} placeholder="제목 텍스트"
          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== c.text) onSave({ text: v, level: c.level || 2, bg: !!c.bg }); }} />
        <select className="text-sm border border-slate-200 rounded-lg px-2 py-2" value={c.level || 2} onChange={(e) => onSave({ text: c.text || '제목', level: Number(e.target.value), bg: !!c.bg })}>
          <option value={2}>큰제목</option><option value={3}>작은제목</option>
        </select>
      </div>
      <label className="flex items-center gap-1.5 text-xs text-slate-500">
        <input type="checkbox" checked={!!c.bg} onChange={(e) => onSave({ text: c.text || '제목', level: c.level || 2, bg: e.target.checked })} /> 강조색 배경 (디자인 색조를 배경으로)
      </label>
    </div>
  );

  if (sec.type === 'divider') return <div className="text-xs text-slate-400 text-center py-1">— 구분선 —</div>;

  if (sec.type === 'youtube') return (
    <div className="flex items-center gap-2">
      <input className="flex-1 text-sm border border-slate-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-blue-400"
        defaultValue={c.videoId ? `https://youtu.be/${c.videoId}` : ''} placeholder="유튜브 주소 붙여넣기"
        onBlur={(e) => { const v = e.target.value.trim(); if (v) onSave({ url: v }); }} />
      {c.videoId && <img src={`https://i.ytimg.com/vi/${c.videoId}/default.jpg`} alt="" className="w-16 h-12 object-cover rounded" />}
    </div>
  );

  if (sec.type === 'link') return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <input className="text-sm border border-slate-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-blue-400"
        defaultValue={c.label ?? ''} placeholder="버튼 이름"
        onBlur={(e) => onSave({ ...c, label: e.target.value.trim() || '버튼', url: (c.url || '').trim(), style: c.style || 'button', newTab: c.newTab !== false })} />
      <input className="text-sm border border-slate-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-blue-400"
        defaultValue={c.url ?? ''} placeholder="https://..."
        onBlur={(e) => onSave({ ...c, label: c.label || '버튼', url: e.target.value.trim(), style: c.style || 'button', newTab: c.newTab !== false })} />
      <div className="flex gap-1.5 col-span-full">
        {['button', 'link'].map(st => (
          <button key={st} className={`text-xs px-2.5 py-1 rounded ${(c.style || 'button') === st ? 'bg-blue-100 text-blue-700 font-semibold' : 'text-slate-400 hover:bg-slate-100'}`}
            onClick={() => onSave({ ...c, label: c.label || '버튼', url: (c.url || '').trim(), style: st, newTab: c.newTab !== false })}>{st === 'button' ? '버튼 모양' : '텍스트 링크'}</button>
        ))}
      </div>
    </div>
  );

  if (sec.type === 'embed') return <EmbedBody value={c.html ?? ''} onSave={(html) => onSave({ html })} />;

  if (sec.type === 'image') return (
    <div className="flex items-center gap-3">
      {c.url ? <img src={c.url} alt="" className="w-20 h-20 object-cover rounded-lg border border-slate-200" /> : <div className="w-20 h-20 rounded-lg bg-slate-100 flex items-center justify-center text-slate-300"><ImageIcon className="w-6 h-6" /></div>}
      <div className="flex-1 space-y-2">
        <div className="flex gap-1">
          {['normal', 'wide', 'full'].map(w => (
            <button key={w} className={`text-[11px] px-2 py-1 rounded ${(c.width || 'normal') === w ? 'bg-blue-100 text-blue-700 font-semibold' : 'text-slate-400 hover:bg-slate-100'}`}
              onClick={() => onSave({ ...c, width: w })}>{w === 'normal' ? '보통' : w === 'wide' ? '넓게' : '전체'}</button>
          ))}
        </div>
        <Button size="sm" variant="flat" onClick={async () => { const u = await onUpload(); if (u) onSave({ ...c, url: u }); }} startContent={<Edit3 className="w-3.5 h-3.5" />}>이미지 교체</Button>
      </div>
    </div>
  );

  return null;
}

function TextBody({ value, onSave }: { value: string; onSave: (t: string) => void }) {
  const [text, setText] = useState(value);
  const timer = useRef<any>(null);
  useEffect(() => { setText(value); }, []); // 최초 마운트만
  const onChange = (v: string) => {
    setText(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onSave(v), 800); // 자동저장
  };
  return (
    <textarea className="w-full min-h-[110px] text-sm border border-slate-200 bg-slate-50/20 hover:bg-slate-50/50 focus:bg-white rounded-lg p-2.5 transition-all focus:outline-none focus:border-blue-400 resize-y font-mono"
      placeholder="마크다운: **굵게**, *기울임*, [링크](https://...), - 목록, > 인용"
      value={text} onChange={(e) => onChange(e.target.value)} onBlur={() => { if (timer.current) clearTimeout(timer.current); if (text !== value) onSave(text); }} />
  );
}

function EmbedBody({ value, onSave }: { value: string; onSave: (t: string) => void }) {
  const [html, setHtml] = useState(value);
  const timer = useRef<any>(null);
  useEffect(() => { setHtml(value); }, []);
  const onChange = (v: string) => {
    setHtml(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onSave(v), 800);
  };
  return (
    <div className="space-y-1.5">
      <textarea className="w-full min-h-[120px] text-xs border border-slate-200 bg-slate-50/20 hover:bg-slate-50/50 focus:bg-white rounded-lg p-2.5 transition-all focus:outline-none focus:border-blue-400 resize-y font-mono"
        placeholder="<iframe ...></iframe> 등 임베드 HTML을 붙여넣으세요 (구글폼·패들릿·유튜브 등)"
        value={html} onChange={(e) => onChange(e.target.value)} onBlur={() => { if (timer.current) clearTimeout(timer.current); if (html !== value) onSave(html); }} />
      <p className="text-[11px] text-slate-400">&lt;script&gt;와 이벤트 핸들러는 보안상 자동 제거됩니다. iframe 임베드는 그대로 표시됩니다.</p>
    </div>
  );
}

// ── 모달 ──
function Backdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

function PageModal({ modal, onClose, onSubmit }: { modal: { mode: 'create' | 'edit'; parentId: number | null; page?: PageNode }; onClose: () => void; onSubmit: (title: string, slug: string) => void }) {
  const [title, setTitle] = useState(modal.page?.title ?? '');
  const [slug, setSlug] = useState(modal.page?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(modal.mode === 'edit');
  const onTitle = (v: string) => { setTitle(v); if (!slugTouched) setSlug(slugify(v)); };
  const valid = title.trim().length > 0 && /^[a-zA-Z0-9가-힣-]{4,20}$/.test(slug);
  return (
    <Backdrop onClose={onClose}>
      <h3 className="font-bold text-slate-800 mb-3">{modal.mode === 'create' ? (modal.parentId ? '하위 페이지 추가' : '페이지 추가') : '페이지 편집'}</h3>
      <label className="block text-xs font-bold text-slate-500 mb-1">제목</label>
      <input autoFocus className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 mb-3 focus:outline-none focus:border-blue-400" value={title} onChange={(e) => onTitle(e.target.value)} placeholder="예: 학급 소개" />
      <label className="block text-xs font-bold text-slate-500 mb-1">주소(슬러그) · 4~20자 영숫자/한글/하이픈</label>
      <input className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400" value={slug} onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }} placeholder="about" />
      {!valid && (title || slug) && <p className="text-[11px] text-rose-500 mt-1.5">제목과 4~20자 슬러그를 입력하세요.</p>}
      <div className="flex justify-end gap-2 mt-4">
        <Button size="sm" variant="light" onClick={onClose}>취소</Button>
        <Button size="sm" color="primary" isDisabled={!valid} onClick={() => onSubmit(title.trim(), slug.trim())}>{modal.mode === 'create' ? '추가' : '저장'}</Button>
      </div>
    </Backdrop>
  );
}

function ConfirmModal({ label, message, onCancel, onConfirm }: { label: string; message: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Backdrop onClose={onCancel}>
      <h3 className="font-bold text-slate-800 mb-2">{label} 삭제</h3>
      <p className="text-sm text-slate-500 mb-4">{message} 되돌릴 수 없습니다.</p>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="light" onClick={onCancel}>취소</Button>
        <Button size="sm" color="danger" onClick={onConfirm} startContent={<Trash2 className="w-4 h-4" />}>삭제</Button>
      </div>
    </Backdrop>
  );
}

function AddressModal({ current, base, onClose, onSubmit }: { current: string; base: string; onClose: () => void; onSubmit: (v: string) => void }) {
  const [v, setV] = useState(current);
  return (
    <Backdrop onClose={onClose}>
      <h3 className="font-bold text-slate-800 mb-2">주소 변경</h3>
      <p className="text-xs text-slate-500 mb-3">비우면 자동주소(<code>/{base}</code>)로 되돌립니다. 4~20자 영숫자/한글/하이픈.</p>
      <input autoFocus className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400" value={v} onChange={(e) => setV(e.target.value)} placeholder={base} />
      <div className="flex justify-end gap-2 mt-4">
        <Button size="sm" variant="light" onClick={onClose}>취소</Button>
        <Button size="sm" color="primary" onClick={() => onSubmit(v.trim())}>변경</Button>
      </div>
    </Backdrop>
  );
}

const COLOR_FIELDS = [
  { key: 'primary', label: '강조색', def: '#5B8DEF' },
  { key: 'bg', label: '헤더 배경', def: '#FFFFFF' },
  { key: 'text', label: '본문 글자', def: '#1F2937' },
  { key: 'accent', label: '포인트', def: '#F472B6' },
];
const PRESETS: Array<{ name: string; primary: string; accent: string }> = [
  { name: '인디고', primary: '#4f46e5', accent: '#818cf8' },
  { name: '에메랄드', primary: '#059669', accent: '#34d399' },
  { name: '로즈', primary: '#e11d48', accent: '#fb7185' },
  { name: '앰버', primary: '#d97706', accent: '#fbbf24' },
  { name: '스카이', primary: '#0284c7', accent: '#38bdf8' },
];
// 한글 구글폰트 프리셋 — 선택 시 family+url을 함께 지정(그래야 실제로 폰트가 바뀜)
type FontPreset = { label: string; family: string; url: string };
// 구글 폰트(한글) 카테고리(https://fonts.google.com/?script=Kore 의 분류)와 동일하게 그룹 구성
const FONT_PRESET_GROUPS: Array<{ category: string; fonts: FontPreset[] }> = [
  {
    category: '고딕 (Sans Serif)',
    fonts: [
      { label: '본고딕', family: 'Noto Sans KR', url: 'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700&display=swap' },
      { label: '나눔고딕', family: 'Nanum Gothic', url: 'https://fonts.googleapis.com/css2?family=Nanum+Gothic:wght@400;700&display=swap' },
      { label: '고딕 A1', family: 'Gothic A1', url: 'https://fonts.googleapis.com/css2?family=Gothic+A1:wght@400;700&display=swap' },
      { label: 'IBM 플렉스', family: 'IBM Plex Sans KR', url: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;700&display=swap' },
    ],
  },
  {
    category: '명조 (Serif)',
    fonts: [
      { label: '나눔명조', family: 'Nanum Myeongjo', url: 'https://fonts.googleapis.com/css2?family=Nanum+Myeongjo:wght@400;700&display=swap' },
      { label: '본명조', family: 'Noto Serif KR', url: 'https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400;700&display=swap' },
      { label: '송명', family: 'Song Myung', url: 'https://fonts.googleapis.com/css2?family=Song+Myung&display=swap' },
    ],
  },
  {
    category: '디스플레이 (Display)',
    fonts: [
      { label: '주아(둥근)', family: 'Jua', url: 'https://fonts.googleapis.com/css2?family=Jua&display=swap' },
      { label: '검은고딕', family: 'Black Han Sans', url: 'https://fonts.googleapis.com/css2?family=Black+Han+Sans&display=swap' },
      { label: '도현', family: 'Do Hyeon', url: 'https://fonts.googleapis.com/css2?family=Do+Hyeon&display=swap' },
      { label: '구기', family: 'Gugi', url: 'https://fonts.googleapis.com/css2?family=Gugi&display=swap' },
      { label: '스타일리쉬', family: 'Stylish', url: 'https://fonts.googleapis.com/css2?family=Stylish&display=swap' },
    ],
  },
  {
    category: '손글씨 (Handwriting)',
    fonts: [
      { label: '개구', family: 'Gaegu', url: 'https://fonts.googleapis.com/css2?family=Gaegu:wght@400;700&display=swap' },
      { label: '나눔손글씨 펜', family: 'Nanum Pen Script', url: 'https://fonts.googleapis.com/css2?family=Nanum+Pen+Script&display=swap' },
      { label: '하이멜로디', family: 'Hi Melody', url: 'https://fonts.googleapis.com/css2?family=Hi+Melody&display=swap' },
      { label: '푸어스토리', family: 'Poor Story', url: 'https://fonts.googleapis.com/css2?family=Poor+Story&display=swap' },
      { label: '감자꽃', family: 'Gamja Flower', url: 'https://fonts.googleapis.com/css2?family=Gamja+Flower&display=swap' },
    ],
  },
  {
    category: '고정폭 (Monospace)',
    fonts: [
      { label: '나눔고딕 코딩', family: 'Nanum Gothic Coding', url: 'https://fonts.googleapis.com/css2?family=Nanum+Gothic+Coding:wght@400;700&display=swap' },
    ],
  },
];
const DEFAULT_FONT: FontPreset = { label: '프리텐다드(기본)', family: 'Pretendard', url: '' };

function DesignPanel({ theme, onClose, onSave, onPreview }: { theme: any; onClose: () => void; onSave: (t: any) => void; onPreview: (t: any) => void }) {
  const [colors, setColors] = useState<any>(theme?.colors || {});
  const [headerTitle, setHeaderTitle] = useState<string>(theme?.header?.title || '');
  const [showTitle, setShowTitle] = useState<boolean>(theme?.header?.showTitle !== false);
  const [navPosition, setNavPosition] = useState<string>(['side', 'right'].includes(theme?.header?.navPosition) ? theme.header.navPosition : 'top');
  const [fontFamily, setFontFamily] = useState<string>(theme?.font?.family || 'Pretendard');
  const [googleFontUrl, setGoogleFontUrl] = useState<string>(theme?.font?.googleFontUrl || '');
  const [showFontUrl, setShowFontUrl] = useState(false);
  const [showNavigation, setShowNavigation] = useState<boolean>(theme?.footer?.showNavigation !== false);

  const [customFonts, setCustomFonts] = useState<FontPreset[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('edulink_custom_fonts') || '[]');
    } catch {
      return [];
    }
  });

  const pickFont = (f: { family: string; url: string }) => { setFontFamily(f.family); setGoogleFontUrl(f.url); };

  const build = (over?: any) => ({
    colors: over?.colors ?? colors,
    font: { family: fontFamily, googleFontUrl: googleFontUrl.trim() || null },
    header: { title: headerTitle.trim(), showTitle, navPosition },
    footer: { showNavigation },
  });
  useEffect(() => { onPreview(build()); }, [colors, headerTitle, showTitle, navPosition, fontFamily, googleFontUrl, showNavigation]);

  const handleSave = () => {
    if (fontFamily && googleFontUrl.trim()) {
      const isPreset = FONT_PRESET_GROUPS.some(group => 
        group.fonts.some(f => f.family === fontFamily)
      ) || fontFamily === DEFAULT_FONT.family;
      
      if (!isPreset) {
        const newFont = { label: fontFamily, family: fontFamily, url: googleFontUrl.trim() };
        let updated = [...customFonts];
        if (!updated.some(f => f.family === fontFamily)) {
          updated.push(newFont);
          setCustomFonts(updated);
          localStorage.setItem('edulink_custom_fonts', JSON.stringify(updated));
        }
      }
    }
    onSave(build());
  };

  return (
    <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-sm space-y-6 max-w-2xl mx-auto animate-fade-in">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <h3 className="font-extrabold text-slate-800 text-base inline-flex items-center gap-2">
          <Palette className="w-5 h-5 text-purple-500" />
          디자인 설정
        </h3>
        <span className="text-[11px] text-slate-400">변경사항은 실시간 미리보기에 즉시 반영됩니다.</span>
      </div>

      <div className="space-y-1.5">
        <div className="text-xs font-bold text-slate-500">테마 프리셋</div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map(p => (
            <button key={p.name} className="text-xs px-3.5 py-1.5 rounded-full border border-slate-200 hover:border-purple-300 hover:bg-purple-50/20 active:scale-95 transition-all inline-flex items-center gap-2"
              onClick={() => setColors({ ...colors, primary: p.primary, accent: p.accent })}>
              <span className="w-3.5 h-3.5 rounded-full shadow-sm" style={{ background: p.primary }} />
              <span className="font-medium text-slate-700">{p.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2.5">
        <div className="text-xs font-bold text-slate-500">색상 직접 지정</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-100">
          {COLOR_FIELDS.map(f => (
            <label key={f.key} className="flex flex-col gap-1.5 text-xs font-semibold text-slate-600">
              <span>{f.label}</span>
              <div className="flex items-center gap-2">
                <input type="color" value={colors[f.key] || f.def} onChange={(e) => setColors({ ...colors, [f.key]: e.target.value })} className="w-8 h-8 rounded border border-slate-200 cursor-pointer shadow-sm" />
                <span className="font-mono text-[10px] text-slate-400 select-all uppercase">{colors[f.key] || f.def}</span>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <div className="text-xs font-bold text-slate-500">헤더 제목</div>
          <input className="w-full text-sm border border-slate-200 bg-slate-50/20 hover:bg-slate-50/50 focus:bg-white rounded-lg px-3 py-2 transition-all focus:outline-none focus:border-blue-400" value={headerTitle} onChange={(e) => setHeaderTitle(e.target.value)} placeholder="비우면 사이트명" />
        </div>
        <div className="space-y-1.5">
          <div className="text-xs font-bold text-slate-500">메뉴 위치</div>
          <div className="flex gap-1 items-center bg-slate-100 p-1 rounded-lg border border-slate-200/50">
            {['top', 'side', 'right'].map(pos => (
              <button
                key={pos}
                className={`flex-1 text-xs py-1.5 rounded-md font-bold transition-all ${
                  navPosition === pos 
                    ? 'bg-white text-blue-600 shadow-sm' 
                    : 'text-slate-500 hover:text-slate-800'
                }`}
                onClick={() => setNavPosition(pos)}
              >
                {pos === 'top' ? '상단' : pos === 'side' ? '좌측' : '우측'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-3 pt-2">
        <div className="text-xs font-bold text-slate-500">레이아웃 및 기능 설정</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-100">
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 cursor-pointer select-none">
            <input type="checkbox" checked={showTitle} onChange={(e) => setShowTitle(e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer" />
            <span>헤더에 제목 표시</span>
          </label>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 cursor-pointer select-none">
            <input type="checkbox" checked={showNavigation} onChange={(e) => setShowNavigation(e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer" />
            <span>페이지 하단 네비게이션 표시 (이전/다음)</span>
          </label>
        </div>
      </div>

      <div className="space-y-3">
        <div className="text-xs font-bold text-slate-500">글꼴 지정</div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => pickFont(DEFAULT_FONT)}
            className={`text-xs px-3.5 py-1.5 rounded-full border transition-all ${fontFamily === DEFAULT_FONT.family ? 'border-purple-400 bg-purple-50 text-purple-700 font-bold shadow-sm' : 'border-slate-200 hover:border-slate-300 text-slate-600'}`}>
            {DEFAULT_FONT.label}
          </button>
        </div>

        {customFonts.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[10px] font-bold text-purple-500 uppercase tracking-wider">추가한 글꼴 (로컬 저장)</div>
            <div className="flex flex-wrap gap-1.5">
              {customFonts.map(f => (
                <button key={f.family} onClick={() => pickFont(f)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-all ${fontFamily === f.family ? 'border-purple-400 bg-purple-50 text-purple-700 font-bold shadow-sm' : 'border-slate-200 hover:border-slate-300 hover:bg-white text-slate-600'}`}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-100">
          {FONT_PRESET_GROUPS.map(group => (
            <div key={group.category} className="space-y-1.5">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{group.category}</div>
              <div className="flex flex-wrap gap-1.5">
                {group.fonts.map(f => (
                  <button key={f.family} onClick={() => pickFont(f)}
                    className={`text-xs px-3 py-1 rounded-full border transition-all ${fontFamily === f.family ? 'border-purple-400 bg-purple-50 text-purple-700 font-bold shadow-sm' : 'border-slate-200 hover:border-slate-300 hover:bg-white text-slate-600'}`}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="pt-2">
          <button className="text-[11px] font-bold text-blue-500 hover:text-blue-700 inline-flex items-center gap-1.5 transition-colors" onClick={() => setShowFontUrl(v => !v)}>
            {showFontUrl ? '▴ 직접 입력 접기' : '▾ 구글폰트 URL 직접 입력'}
          </button>
          {showFontUrl && (
            <div className="mt-2.5 space-y-2 bg-slate-50 border border-slate-200/60 p-3.5 rounded-xl animate-fade-in">
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-400">구글 폰트 URL</span>
                <input className="w-full text-sm border border-slate-200 bg-white rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-400 font-mono" value={googleFontUrl} onChange={(e) => setGoogleFontUrl(e.target.value)} placeholder="https://fonts.googleapis.com/css2?family=..." />
              </div>
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-400">폰트 Family 이름</span>
                <input className="w-full text-sm border border-slate-200 bg-white rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-400" value={fontFamily} onChange={(e) => setFontFamily(e.target.value)} placeholder="폰트 이름 (예: Sunflower)" />
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed pt-1.5 border-t border-slate-200/60 mt-1">
                <a href="https://fonts.google.com/?script=Kore" target="_blank" rel="noreferrer" className="text-blue-500 font-semibold underline">구글 폰트(한글) 열기 ↗</a> → 폰트 선택 → “Get font” → “Get embed code” → <b>@import</b>가 아닌 <b>&lt;link&gt;</b> 탭의 <code>https://fonts.googleapis.com/…</code> 주소를 위 칸에, 폰트 이름을 아래 칸에 입력하세요.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 mt-6">
        <Button size="sm" variant="flat" onClick={onClose} className="font-bold">닫기</Button>
        <Button size="sm" color="secondary" onClick={handleSave} startContent={<Check className="w-4 h-4" />} className="font-bold shadow-md shadow-secondary/15">디자인 저장</Button>
      </div>
    </div>
  );
}
