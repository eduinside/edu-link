// src/client/pages/PagesTab.tsx
// 에듀링크 페이지: 대시보드 편집 UI (Step 6~8)
//  - Step 6: 사이트 목록/생성/주소변경/공개토글/삭제
//  - Step 7: 페이지 트리(추가/이름변경/삭제/홈 지정)
//  - Step 8: 섹션 편집(text/youtube 추가·수정·삭제·정렬)
import React, { useEffect, useState } from 'react';
import { Button, Card, CardContent, Chip, Input, Tooltip } from '@heroui/react';
import {
  Globe, Plus, Copy, ExternalLink, Trash2, Edit3, Check, X,
  Home, FileText, MonitorPlay, ArrowUp, ArrowDown, ChevronLeft, Settings, Eye, EyeOff, CornerDownRight,
  Palette, Heading, Image as ImageIcon, Link as LinkIcon, Minus,
} from 'lucide-react';

interface SiteItem {
  id: number;
  title: string;
  is_public: number;
  home_page_id: number | null;
  rev: number;
  slug: string;
  base_slug: string;
  custom_slug: string | null;
  theme?: string;
}

interface PageNode {
  id: number;
  parent_id: number | null;
  slug: string;
  title: string;
  depth: number;
  sort: number;
}

interface SectionItem {
  id: number;
  type: 'text' | 'youtube';
  content: any;
  sort: number;
}

interface Props {
  getHeaders: () => Record<string, string>;
  setSuccessMsg: (m: string) => void;
  setError: (m: string) => void;
}

function publicSlug(s: SiteItem): string {
  return s.custom_slug || s.base_slug || s.slug;
}

export default function PagesTab({ getHeaders, setSuccessMsg, setError }: Props) {
  const [sites, setSites] = useState<SiteItem[]>([]);
  const [loading, setLoading] = useState(true);

  // 생성 폼
  const [newTitle, setNewTitle] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [creating, setCreating] = useState(false);

  // 편집 대상 사이트
  const [editorId, setEditorId] = useState<number | null>(null);
  const [editorSite, setEditorSite] = useState<SiteItem | null>(null);
  const [pages, setPages] = useState<PageNode[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<number | null>(null);
  const [sections, setSections] = useState<SectionItem[]>([]);
  const [showSettings, setShowSettings] = useState(false);

  // ─────────── 사이트 목록 ───────────
  const fetchSites = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/sites', { headers: getHeaders() });
      const data = await res.json();
      if (data.success) setSites(data.sites);
      else setError(data.error || '사이트 목록을 불러오지 못했습니다.');
    } catch (e: any) {
      setError('네트워크 오류: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSites(); }, []);

  const createSite = async () => {
    if (!newTitle.trim()) { setError('사이트 제목을 입력해주세요.'); return; }
    setCreating(true);
    try {
      const body: any = { title: newTitle.trim() };
      if (newSlug.trim()) body.custom_slug = newSlug.trim();
      const res = await fetch('/api/sites', { method: 'POST', headers: getHeaders(), body: JSON.stringify(body) });
      const data = await res.json();
      if (data.success) {
        setSuccessMsg('사이트가 생성되었습니다.');
        setNewTitle(''); setNewSlug('');
        await fetchSites();
        openEditor(data.id);
      } else setError(data.error || '생성 실패');
    } catch (e: any) {
      setError('네트워크 오류: ' + e.message);
    } finally {
      setCreating(false);
    }
  };

  const deleteSite = async (s: SiteItem) => {
    if (!confirm(`'${s.title}' 사이트를 삭제할까요? 모든 페이지·콘텐츠가 함께 삭제되며 주소(${publicSlug(s)})는 회수됩니다.`)) return;
    try {
      const res = await fetch(`/api/sites/${s.id}`, { method: 'DELETE', headers: getHeaders() });
      const data = await res.json();
      if (data.success) { setSuccessMsg('삭제되었습니다.'); fetchSites(); }
      else setError(data.error || '삭제 실패');
    } catch (e: any) { setError('네트워크 오류: ' + e.message); }
  };

  const togglePublic = async (s: SiteItem) => {
    try {
      const res = await fetch(`/api/sites/${s.id}`, { method: 'PATCH', headers: getHeaders(), body: JSON.stringify({ is_public: s.is_public ? 0 : 1 }) });
      const data = await res.json();
      if (data.success) fetchSites();
      else setError(data.error || '변경 실패');
    } catch (e: any) { setError('네트워크 오류: ' + e.message); }
  };

  const changeAddress = async (s: SiteItem) => {
    const next = prompt('새 주소(슬러그)를 입력하세요. 4~20자 영숫자/한글/하이픈. 비우면 자동주소로 되돌립니다.', s.custom_slug || '');
    if (next === null) return;
    try {
      const res = await fetch(`/api/sites/${s.id}`, { method: 'PATCH', headers: getHeaders(), body: JSON.stringify({ custom_slug: next.trim() }) });
      const data = await res.json();
      if (data.success) { setSuccessMsg('주소가 변경되었습니다.'); fetchSites(); }
      else setError(data.error || '변경 실패');
    } catch (e: any) { setError('네트워크 오류: ' + e.message); }
  };

  // ─────────── 편집기 ───────────
  const openEditor = async (siteId: number) => {
    setEditorId(siteId);
    setSelectedPageId(null);
    setSections([]);
    try {
      const res = await fetch(`/api/sites/${siteId}`, { headers: getHeaders() });
      const data = await res.json();
      if (data.success) {
        setEditorSite(data.site);
        setPages(data.pages);
        // 홈 또는 첫 페이지 자동 선택
        const first = data.site.home_page_id && data.pages.find((p: PageNode) => p.id === data.site.home_page_id)
          ? data.site.home_page_id
          : (data.pages[0]?.id ?? null);
        if (first) selectPage(first);
      } else setError(data.error || '사이트를 불러오지 못했습니다.');
    } catch (e: any) { setError('네트워크 오류: ' + e.message); }
  };

  const closeEditor = () => { setEditorId(null); setEditorSite(null); setPages([]); setSelectedPageId(null); setSections([]); fetchSites(); };

  const reloadEditor = async () => { if (editorId) await openEditorKeepPage(editorId); };
  const openEditorKeepPage = async (siteId: number) => {
    const keep = selectedPageId;
    try {
      const res = await fetch(`/api/sites/${siteId}`, { headers: getHeaders() });
      const data = await res.json();
      if (data.success) {
        setEditorSite(data.site);
        setPages(data.pages);
        if (keep && data.pages.find((p: PageNode) => p.id === keep)) selectPage(keep);
        else if (data.pages[0]) selectPage(data.pages[0].id);
        else { setSelectedPageId(null); setSections([]); }
      }
    } catch (e: any) { setError('네트워크 오류: ' + e.message); }
  };

  // ─────────── 페이지 ───────────
  const selectPage = async (pageId: number) => {
    setSelectedPageId(pageId);
    try {
      const res = await fetch(`/api/pages/${pageId}`, { headers: getHeaders() });
      const data = await res.json();
      if (data.success) {
        setSections((data.sections as any[]).map(s => ({ ...s, content: safeParse(s.content) })));
      } else setError(data.error || '페이지를 불러오지 못했습니다.');
    } catch (e: any) { setError('네트워크 오류: ' + e.message); }
  };

  const addPage = async (parentId: number | null) => {
    const title = prompt(parentId ? '하위 페이지 제목' : '페이지 제목');
    if (!title || !title.trim()) return;
    const slug = prompt('페이지 주소(슬러그) — 4~20자 영숫자/한글/하이픈', '');
    if (!slug || !slug.trim()) return;
    try {
      const res = await fetch(`/api/sites/${editorId}/pages`, {
        method: 'POST', headers: getHeaders(),
        body: JSON.stringify({ title: title.trim(), slug: slug.trim(), parent_id: parentId }),
      });
      const data = await res.json();
      if (data.success) { setSuccessMsg('페이지가 추가되었습니다.'); await openEditorKeepPage(editorId!); selectPage(data.id); }
      else setError(data.error || '추가 실패');
    } catch (e: any) { setError('네트워크 오류: ' + e.message); }
  };

  const renamePage = async (p: PageNode) => {
    const title = prompt('페이지 제목', p.title);
    if (title === null) return;
    try {
      const res = await fetch(`/api/pages/${p.id}`, { method: 'PATCH', headers: getHeaders(), body: JSON.stringify({ title: title.trim() }) });
      const data = await res.json();
      if (data.success) { setSuccessMsg('변경되었습니다.'); openEditorKeepPage(editorId!); }
      else setError(data.error || '변경 실패');
    } catch (e: any) { setError('네트워크 오류: ' + e.message); }
  };

  const deletePage = async (p: PageNode) => {
    if (!confirm(`'${p.title}' 페이지를 삭제할까요? 하위 페이지와 콘텐츠도 함께 삭제됩니다.`)) return;
    try {
      const res = await fetch(`/api/pages/${p.id}`, { method: 'DELETE', headers: getHeaders() });
      const data = await res.json();
      if (data.success) { setSuccessMsg('삭제되었습니다.'); if (selectedPageId === p.id) setSelectedPageId(null); openEditorKeepPage(editorId!); }
      else setError(data.error || '삭제 실패');
    } catch (e: any) { setError('네트워크 오류: ' + e.message); }
  };

  const setHome = async (p: PageNode) => {
    try {
      const res = await fetch(`/api/sites/${editorId}`, { method: 'PATCH', headers: getHeaders(), body: JSON.stringify({ home_page_id: p.id }) });
      const data = await res.json();
      if (data.success) { setSuccessMsg(`'${p.title}'을(를) 홈으로 지정했습니다.`); openEditorKeepPage(editorId!); }
      else setError(data.error || '변경 실패');
    } catch (e: any) { setError('네트워크 오류: ' + e.message); }
  };

  // ─────────── 섹션 ───────────
  const createSection = async (type: string, content: any) => {
    if (!selectedPageId) return;
    try {
      const res = await fetch(`/api/pages/${selectedPageId}/sections`, { method: 'POST', headers: getHeaders(), body: JSON.stringify({ type, content }) });
      const data = await res.json();
      if (data.success) { setSuccessMsg('섹션이 추가되었습니다.'); selectPage(selectedPageId); }
      else setError(data.error || '추가 실패');
    } catch (e: any) { setError('네트워크 오류: ' + e.message); }
  };

  const addSection = async (type: 'text' | 'youtube' | 'heading' | 'divider' | 'link' | 'image') => {
    if (!selectedPageId) return;
    if (type === 'text') return createSection('text', { text: '', format: 'markdown' });
    if (type === 'divider') return createSection('divider', {});
    if (type === 'youtube') {
      const url = prompt('유튜브 영상 주소 또는 영상 ID'); if (!url || !url.trim()) return;
      return createSection('youtube', { url: url.trim() });
    }
    if (type === 'heading') {
      const text = prompt('제목 텍스트'); if (!text || !text.trim()) return;
      return createSection('heading', { text: text.trim(), level: 2 });
    }
    if (type === 'link') {
      const label = prompt('버튼/링크 이름 (예: 신청하기)'); if (!label || !label.trim()) return;
      const url = prompt('연결할 주소 (https://...)'); if (!url || !url.trim()) return;
      return createSection('link', { label: label.trim(), url: url.trim(), style: 'button', newTab: true });
    }
    if (type === 'image') {
      const url = await uploadImage(); if (!url) return;
      return createSection('image', { url, alt: '', width: 'normal' });
    }
  };

  // 파일 선택 → R2 업로드 → /media URL 반환
  const uploadImage = (): Promise<string | null> => new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp,image/gif';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        const fd = new FormData();
        fd.append('file', file);
        // multipart 업로드는 Content-Type 자동 설정 — getHeaders에서 그것만 제외
        const h = getHeaders(); delete (h as any)['Content-Type'];
        const res = await fetch(`/api/sites/${editorId}/media`, { method: 'POST', headers: h, body: fd });
        const data = await res.json();
        if (data.success) resolve(data.url);
        else { setError(data.error || '업로드 실패'); resolve(null); }
      } catch (e: any) { setError('업로드 오류: ' + e.message); resolve(null); }
    };
    input.click();
  });

  const saveTextSection = async (sec: SectionItem, text: string) => {
    try {
      const res = await fetch(`/api/sections/${sec.id}`, { method: 'PATCH', headers: getHeaders(), body: JSON.stringify({ content: { text, format: 'markdown' } }) });
      const data = await res.json();
      if (data.success) { setSuccessMsg('저장되었습니다.'); selectPage(selectedPageId!); }
      else setError(data.error || '저장 실패');
    } catch (e: any) { setError('네트워크 오류: ' + e.message); }
  };

  const patchSection = async (sec: SectionItem, content: any) => {
    try {
      const res = await fetch(`/api/sections/${sec.id}`, { method: 'PATCH', headers: getHeaders(), body: JSON.stringify({ content }) });
      const data = await res.json();
      if (data.success) { setSuccessMsg('변경되었습니다.'); selectPage(selectedPageId!); }
      else setError(data.error || '변경 실패');
    } catch (e: any) { setError('네트워크 오류: ' + e.message); }
  };

  const editSection = async (sec: SectionItem) => {
    if (sec.type === 'youtube') {
      const url = prompt('유튜브 영상 주소 또는 영상 ID', sec.content?.videoId || ''); if (!url || !url.trim()) return;
      return patchSection(sec, { url: url.trim() });
    }
    if (sec.type === 'heading') {
      const text = prompt('제목 텍스트', sec.content?.text || ''); if (text === null) return;
      const lvl = prompt('크기: 2(큰제목) 또는 3(작은제목)', String(sec.content?.level || 2));
      return patchSection(sec, { text: (text || '').trim(), level: lvl === '3' ? 3 : 2 });
    }
    if (sec.type === 'link') {
      const label = prompt('버튼/링크 이름', sec.content?.label || ''); if (label === null) return;
      const url = prompt('연결할 주소 (https://...)', sec.content?.url || ''); if (!url || !url.trim()) return;
      const style = confirm('확인=버튼 모양 / 취소=텍스트 링크') ? 'button' : 'link';
      return patchSection(sec, { label: (label || '').trim(), url: url.trim(), style, newTab: true });
    }
    if (sec.type === 'image') {
      const url = await uploadImage(); if (!url) return;
      return patchSection(sec, { url, alt: sec.content?.alt || '', caption: sec.content?.caption || '', width: sec.content?.width || 'normal' });
    }
  };

  const setImageWidth = (sec: SectionItem, width: string) =>
    patchSection(sec, { url: sec.content?.url, alt: sec.content?.alt || '', caption: sec.content?.caption || '', width });

  const deleteSection = async (sec: SectionItem) => {
    if (!confirm('이 섹션을 삭제할까요?')) return;
    try {
      const res = await fetch(`/api/sections/${sec.id}`, { method: 'DELETE', headers: getHeaders() });
      const data = await res.json();
      if (data.success) { selectPage(selectedPageId!); }
      else setError(data.error || '삭제 실패');
    } catch (e: any) { setError('네트워크 오류: ' + e.message); }
  };

  const moveSection = async (idx: number, dir: -1 | 1) => {
    const next = [...sections];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setSections(next);
    try {
      const res = await fetch('/api/sections/reorder', { method: 'POST', headers: getHeaders(), body: JSON.stringify({ page_id: selectedPageId, order: next.map(s => s.id) }) });
      const data = await res.json();
      if (!data.success) { setError(data.error || '정렬 실패'); selectPage(selectedPageId!); }
    } catch (e: any) { setError('네트워크 오류: ' + e.message); }
  };

  const copyLink = (slug: string) => {
    const url = `${window.location.origin}/${slug}`;
    navigator.clipboard.writeText(url).then(() => setSuccessMsg('주소가 복사되었습니다: ' + url));
  };

  // 형제 페이지 정렬 (위/아래)
  const movePage = async (p: PageNode, dir: -1 | 1) => {
    const siblings = pages.filter(x => (x.parent_id ?? null) === (p.parent_id ?? null)).sort((a, b) => a.sort - b.sort);
    const i = siblings.findIndex(x => x.id === p.id);
    const j = i + dir;
    if (j < 0 || j >= siblings.length) return;
    [siblings[i], siblings[j]] = [siblings[j], siblings[i]];
    try {
      const res = await fetch('/api/pages/reorder', { method: 'POST', headers: getHeaders(), body: JSON.stringify({ order: siblings.map(s => s.id) }) });
      const data = await res.json();
      if (data.success) openEditorKeepPage(editorId!);
      else setError(data.error || '정렬 실패');
    } catch (e: any) { setError('네트워크 오류: ' + e.message); }
  };

  const saveTheme = async (theme: any) => {
    try {
      const res = await fetch(`/api/sites/${editorId}`, { method: 'PATCH', headers: getHeaders(), body: JSON.stringify({ theme }) });
      const data = await res.json();
      if (data.success) { setSuccessMsg('디자인이 저장되었습니다.'); setEditorSite(s => s ? { ...s, theme: JSON.stringify(theme) } as any : s); setShowSettings(false); }
      else setError(data.error || '저장 실패');
    } catch (e: any) { setError('네트워크 오류: ' + e.message); }
  };

  // ───────────────── 렌더 ─────────────────
  if (editorId && editorSite) {
    const slug = publicSlug(editorSite);
    const roots = pages.filter(p => p.parent_id === null).sort((a, b) => a.sort - b.sort);
    const childrenOf = (id: number) => pages.filter(p => p.parent_id === id).sort((a, b) => a.sort - b.sort);
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="light" onClick={closeEditor} startContent={<ChevronLeft className="w-4 h-4" />}>목록</Button>
            <h3 className="font-bold text-slate-800 text-base">{editorSite.title}</h3>
            <Chip size="sm" color={editorSite.is_public ? 'success' : 'default'} variant="flat">{editorSite.is_public ? '공개' : '비공개'}</Chip>
          </div>
          <div className="flex items-center gap-1.5">
            <code className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded">/{slug}</code>
            <Button size="sm" variant={showSettings ? 'solid' : 'flat'} color="secondary" onClick={() => setShowSettings(v => !v)} startContent={<Palette className="w-3.5 h-3.5" />}>디자인</Button>
            <Tooltip content="주소 복사"><Button isIconOnly size="sm" variant="light" onClick={() => copyLink(slug)}><Copy className="w-4 h-4" /></Button></Tooltip>
            <Tooltip content="새 탭에서 열기"><Button isIconOnly size="sm" variant="light" onClick={() => window.open(`/${slug}`, '_blank')}><ExternalLink className="w-4 h-4" /></Button></Tooltip>
          </div>
        </div>

        {showSettings && <ThemePanel theme={safeParse(editorSite.theme)} onSave={saveTheme} onClose={() => setShowSettings(false)} />}

        <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4">
          {/* 페이지 트리 */}
          <Card className="bg-white border border-slate-100 rounded-xl shadow-sm">
            <CardContent className="p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-500">페이지</span>
                <Button size="sm" variant="flat" color="primary" onClick={() => addPage(null)} startContent={<Plus className="w-3.5 h-3.5" />}>페이지</Button>
              </div>
              <div className="space-y-0.5">
                {roots.length === 0 && <p className="text-xs text-slate-400 py-3 text-center">페이지를 추가하세요.</p>}
                {roots.map((root, ri) => (
                  <div key={root.id}>
                    <PageRow page={root} isHome={editorSite.home_page_id === root.id} active={selectedPageId === root.id}
                      onSelect={() => selectPage(root.id)} onRename={() => renamePage(root)} onDelete={() => deletePage(root)}
                      onHome={() => setHome(root)} onAddChild={() => addPage(root.id)} canAddChild
                      onMoveUp={ri > 0 ? () => movePage(root, -1) : undefined} onMoveDown={ri < roots.length - 1 ? () => movePage(root, 1) : undefined} />
                    {childrenOf(root.id).map((ch, ci, arr) => (
                      <PageRow key={ch.id} page={ch} isHome={editorSite.home_page_id === ch.id} active={selectedPageId === ch.id} child
                        onSelect={() => selectPage(ch.id)} onRename={() => renamePage(ch)} onDelete={() => deletePage(ch)}
                        onHome={() => setHome(ch)}
                        onMoveUp={ci > 0 ? () => movePage(ch, -1) : undefined} onMoveDown={ci < arr.length - 1 ? () => movePage(ch, 1) : undefined} />
                    ))}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* 섹션 편집 */}
          <Card className="bg-white border border-slate-100 rounded-xl shadow-sm">
            <CardContent className="p-4">
              {!selectedPageId ? (
                <p className="text-sm text-slate-400 text-center py-10">왼쪽에서 페이지를 선택하세요.</p>
              ) : (
                <>
                  <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                    <span className="text-xs font-bold text-slate-500 mr-auto">콘텐츠 추가</span>
                    <Button size="sm" variant="flat" onClick={() => addSection('text')} startContent={<FileText className="w-3.5 h-3.5" />}>텍스트</Button>
                    <Button size="sm" variant="flat" onClick={() => addSection('heading')} startContent={<Heading className="w-3.5 h-3.5" />}>제목</Button>
                    <Button size="sm" variant="flat" onClick={() => addSection('image')} startContent={<ImageIcon className="w-3.5 h-3.5" />}>이미지</Button>
                    <Button size="sm" variant="flat" color="danger" onClick={() => addSection('youtube')} startContent={<MonitorPlay className="w-3.5 h-3.5" />}>유튜브</Button>
                    <Button size="sm" variant="flat" onClick={() => addSection('link')} startContent={<LinkIcon className="w-3.5 h-3.5" />}>버튼</Button>
                    <Button size="sm" variant="flat" onClick={() => addSection('divider')} startContent={<Minus className="w-3.5 h-3.5" />}>구분선</Button>
                  </div>
                  {sections.length === 0 && <p className="text-sm text-slate-400 text-center py-8">위 버튼으로 콘텐츠를 추가하세요.</p>}
                  <div className="space-y-3">
                    {sections.map((sec, idx) => (
                      <SectionEditor key={sec.id} sec={sec} idx={idx} total={sections.length}
                        onSaveText={(t) => saveTextSection(sec, t)} onEdit={() => editSection(sec)} onSetWidth={(w) => setImageWidth(sec, w)}
                        onDelete={() => deleteSection(sec)} onMove={(d) => moveSection(idx, d)} />
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // 사이트 목록 화면
  return (
    <div className="space-y-4">
      {/* 생성 폼 */}
      <Card className="bg-white border border-slate-100 rounded-xl shadow-sm">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Globe className="w-4 h-4 text-blue-500" />
            <span className="font-bold text-slate-800 text-sm">새 페이지(사이트) 만들기</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
            <Input size="sm" placeholder="사이트 제목 (예: 3학년 2반)" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
            <Input size="sm" placeholder="원하는 주소 (선택, 비우면 자동)" value={newSlug} onChange={(e) => setNewSlug(e.target.value)}
              startContent={<span className="text-xs text-slate-400">/</span>} />
            <Button size="sm" color="primary" onClick={createSite} isLoading={creating} startContent={!creating ? <Plus className="w-4 h-4" /> : undefined}>만들기</Button>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">주소는 단축주소와 동일한 풀을 공유합니다. 저장 즉시 <strong>dgedu.link/주소</strong>로 공개됩니다.</p>
        </CardContent>
      </Card>

      {/* 목록 */}
      {loading ? (
        <p className="text-sm text-slate-400 text-center py-8">불러오는 중...</p>
      ) : sites.length === 0 ? (
        <Card className="bg-white border border-slate-100 rounded-xl shadow-sm">
          <CardContent className="text-center py-10 text-slate-400 text-sm">아직 만든 페이지가 없습니다. 위에서 새로 만들어보세요.</CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {sites.map(s => {
            const slug = publicSlug(s);
            return (
              <Card key={s.id} className="bg-white border border-slate-100 rounded-xl shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-slate-800 text-sm truncate">{s.title}</h4>
                        <Chip size="sm" color={s.is_public ? 'success' : 'default'} variant="flat">{s.is_public ? '공개' : '비공개'}</Chip>
                      </div>
                      <button className="text-xs text-blue-500 hover:underline mt-1 inline-flex items-center gap-1" onClick={() => window.open(`/${slug}`, '_blank')}>
                        /{slug} <ExternalLink className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 mt-3 flex-wrap">
                    <Button size="sm" color="primary" variant="flat" onClick={() => openEditor(s.id)} startContent={<Settings className="w-3.5 h-3.5" />}>관리</Button>
                    <Tooltip content="주소 복사"><Button isIconOnly size="sm" variant="light" onClick={() => copyLink(slug)}><Copy className="w-4 h-4" /></Button></Tooltip>
                    <Tooltip content="주소 변경"><Button isIconOnly size="sm" variant="light" onClick={() => changeAddress(s)}><Edit3 className="w-4 h-4" /></Button></Tooltip>
                    <Tooltip content={s.is_public ? '비공개로 전환' : '공개로 전환'}><Button isIconOnly size="sm" variant="light" onClick={() => togglePublic(s)}>{s.is_public ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</Button></Tooltip>
                    <div className="flex-1" />
                    <Tooltip content="삭제"><Button isIconOnly size="sm" variant="light" color="danger" onClick={() => deleteSite(s)}><Trash2 className="w-4 h-4" /></Button></Tooltip>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function safeParse(s: any): any {
  if (typeof s !== 'string') return s ?? {};
  try { return JSON.parse(s); } catch { return {}; }
}

function PageRow({ page, isHome, active, child, canAddChild, onSelect, onRename, onDelete, onHome, onAddChild, onMoveUp, onMoveDown }: {
  page: PageNode; isHome: boolean; active: boolean; child?: boolean; canAddChild?: boolean;
  onSelect: () => void; onRename: () => void; onDelete: () => void; onHome: () => void; onAddChild?: () => void;
  onMoveUp?: () => void; onMoveDown?: () => void;
}) {
  return (
    <div className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 cursor-pointer ${active ? 'bg-blue-50' : 'hover:bg-slate-50'} ${child ? 'ml-4' : ''}`} onClick={onSelect}>
      {child && <CornerDownRight className="w-3 h-3 text-slate-300 shrink-0" />}
      {isHome && <Home className="w-3 h-3 text-blue-500 shrink-0" />}
      <span className={`flex-1 truncate text-sm ${active ? 'text-blue-700 font-semibold' : 'text-slate-600'}`}>{page.title}</span>
      <div className="hidden group-hover:flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
        <button className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-20" disabled={!onMoveUp} onClick={onMoveUp}><ArrowUp className="w-3.5 h-3.5" /></button>
        <button className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-20" disabled={!onMoveDown} onClick={onMoveDown}><ArrowDown className="w-3.5 h-3.5" /></button>
        {!isHome && <Tooltip content="홈으로"><button className="p-1 text-slate-400 hover:text-blue-500" onClick={onHome}><Home className="w-3.5 h-3.5" /></button></Tooltip>}
        {canAddChild && onAddChild && <Tooltip content="하위 추가"><button className="p-1 text-slate-400 hover:text-blue-500" onClick={onAddChild}><Plus className="w-3.5 h-3.5" /></button></Tooltip>}
        <Tooltip content="이름변경"><button className="p-1 text-slate-400 hover:text-blue-500" onClick={onRename}><Edit3 className="w-3.5 h-3.5" /></button></Tooltip>
        <Tooltip content="삭제"><button className="p-1 text-slate-400 hover:text-rose-500" onClick={onDelete}><Trash2 className="w-3.5 h-3.5" /></button></Tooltip>
      </div>
    </div>
  );
}

const SECTION_LABEL: Record<string, string> = { text: '텍스트', youtube: '유튜브', heading: '제목', divider: '구분선', link: '버튼/링크', image: '이미지' };

function SectionEditor({ sec, idx, total, onSaveText, onEdit, onSetWidth, onDelete, onMove }: {
  sec: SectionItem; idx: number; total: number;
  onSaveText: (t: string) => void; onEdit: () => void; onSetWidth: (w: string) => void; onDelete: () => void; onMove: (d: -1 | 1) => void;
}) {
  const [text, setText] = useState(sec.type === 'text' ? (sec.content?.text ?? '') : '');
  useEffect(() => { if (sec.type === 'text') setText(sec.content?.text ?? ''); }, [sec.id]);
  const dirty = sec.type === 'text' && text !== (sec.content?.text ?? '');

  return (
    <div className="border border-slate-150 rounded-xl p-3 bg-slate-50/40">
      <div className="flex items-center gap-2 mb-2">
        <Chip size="sm" variant="flat" color={sec.type === 'youtube' ? 'danger' : 'default'}>{SECTION_LABEL[sec.type] || sec.type}</Chip>
        <div className="flex-1" />
        <button className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30" disabled={idx === 0} onClick={() => onMove(-1)}><ArrowUp className="w-4 h-4" /></button>
        <button className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30" disabled={idx === total - 1} onClick={() => onMove(1)}><ArrowDown className="w-4 h-4" /></button>
        <button className="p-1 text-slate-400 hover:text-rose-500" onClick={onDelete}><Trash2 className="w-4 h-4" /></button>
      </div>

      {sec.type === 'text' && (
        <div>
          <textarea className="w-full min-h-[120px] text-sm border border-slate-200 rounded-lg p-2.5 focus:outline-none focus:border-blue-400 resize-y font-mono"
            placeholder="마크다운 지원: **굵게**, *기울임*, [링크](https://...), - 목록, > 인용"
            value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex justify-end mt-2">
            <Button size="sm" color="primary" variant={dirty ? 'solid' : 'flat'} isDisabled={!dirty} onClick={() => onSaveText(text)} startContent={<Check className="w-3.5 h-3.5" />}>저장</Button>
          </div>
        </div>
      )}

      {sec.type === 'youtube' && (
        <div className="flex items-center gap-2">
          <div className="flex-1 text-xs text-slate-500">영상 ID: <code className="bg-white px-1.5 py-0.5 rounded">{sec.content?.videoId || '—'}</code></div>
          <Button size="sm" variant="flat" onClick={onEdit} startContent={<Edit3 className="w-3.5 h-3.5" />}>주소 변경</Button>
        </div>
      )}

      {sec.type === 'heading' && (
        <div className="flex items-center gap-2">
          <div className="flex-1 text-sm font-bold text-slate-700 truncate">{sec.content?.text || '—'} <span className="text-[10px] text-slate-400">(H{sec.content?.level || 2})</span></div>
          <Button size="sm" variant="flat" onClick={onEdit} startContent={<Edit3 className="w-3.5 h-3.5" />}>편집</Button>
        </div>
      )}

      {sec.type === 'divider' && <div className="text-xs text-slate-400 text-center py-1">— 구분선 —</div>}

      {sec.type === 'link' && (
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0 text-xs text-slate-500 truncate"><strong className="text-slate-700">{sec.content?.label || '—'}</strong> → {sec.content?.url || '—'} <span className="text-slate-400">({sec.content?.style === 'link' ? '링크' : '버튼'})</span></div>
          <Button size="sm" variant="flat" onClick={onEdit} startContent={<Edit3 className="w-3.5 h-3.5" />}>편집</Button>
        </div>
      )}

      {sec.type === 'image' && (
        <div className="flex items-center gap-2">
          {sec.content?.url && <img src={sec.content.url} alt="" className="w-14 h-14 object-cover rounded-lg border border-slate-200" />}
          <div className="flex-1 flex items-center gap-1">
            {['normal', 'wide', 'full'].map(w => (
              <button key={w} className={`text-[11px] px-2 py-1 rounded ${sec.content?.width === w ? 'bg-blue-100 text-blue-700 font-semibold' : 'text-slate-400 hover:bg-slate-100'}`} onClick={() => onSetWidth(w)}>
                {w === 'normal' ? '보통' : w === 'wide' ? '넓게' : '전체'}
              </button>
            ))}
          </div>
          <Button size="sm" variant="flat" onClick={onEdit} startContent={<Edit3 className="w-3.5 h-3.5" />}>교체</Button>
        </div>
      )}
    </div>
  );
}

const COLOR_FIELDS: Array<{ key: string; label: string; def: string }> = [
  { key: 'primary', label: '강조색', def: '#5B8DEF' },
  { key: 'bg', label: '헤더 배경', def: '#FFFFFF' },
  { key: 'text', label: '본문 글자', def: '#1F2937' },
  { key: 'accent', label: '포인트', def: '#F472B6' },
];

function ThemePanel({ theme, onSave, onClose }: { theme: any; onSave: (t: any) => void; onClose: () => void }) {
  const [colors, setColors] = useState<any>(theme?.colors || {});
  const [headerTitle, setHeaderTitle] = useState<string>(theme?.header?.title || '');
  const [showTitle, setShowTitle] = useState<boolean>(theme?.header?.showTitle !== false);
  const [navPosition, setNavPosition] = useState<string>(theme?.header?.navPosition === 'side' ? 'side' : 'top');
  const [googleFontUrl, setGoogleFontUrl] = useState<string>(theme?.font?.googleFontUrl || '');

  const save = () => onSave({
    colors,
    font: { family: theme?.font?.family || 'Pretendard', googleFontUrl: googleFontUrl.trim() || null },
    header: { title: headerTitle.trim(), showTitle, navPosition },
  });

  return (
    <Card className="bg-white border border-purple-100 rounded-xl shadow-sm">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Palette className="w-4 h-4 text-purple-500" />
          <span className="font-bold text-slate-800 text-sm">디자인 설정</span>
          <div className="flex-1" />
          <Button size="sm" variant="light" onClick={onClose} startContent={<X className="w-4 h-4" />}>닫기</Button>
        </div>

        <div>
          <div className="text-xs font-bold text-slate-500 mb-2">색상</div>
          <div className="flex flex-wrap gap-4">
            {COLOR_FIELDS.map(f => (
              <label key={f.key} className="flex items-center gap-2 text-xs text-slate-600">
                <input type="color" value={colors[f.key] || f.def} onChange={(e) => setColors({ ...colors, [f.key]: e.target.value })}
                  className="w-8 h-8 rounded border border-slate-200 cursor-pointer" />
                {f.label}
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <div className="text-xs font-bold text-slate-500 mb-1.5">헤더 제목 (비우면 사이트명)</div>
            <Input size="sm" value={headerTitle} onChange={(e) => setHeaderTitle(e.target.value)} placeholder="헤더에 표시할 제목" />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-500 mb-1.5">메뉴 위치</div>
            <div className="flex gap-1.5">
              <Button size="sm" variant={navPosition === 'top' ? 'solid' : 'flat'} color="primary" onClick={() => setNavPosition('top')}>상단</Button>
              <Button size="sm" variant={navPosition === 'side' ? 'solid' : 'flat'} color="primary" onClick={() => setNavPosition('side')}>좌측</Button>
              <label className="flex items-center gap-1.5 text-xs text-slate-600 ml-2">
                <input type="checkbox" checked={showTitle} onChange={(e) => setShowTitle(e.target.checked)} /> 제목 표시
              </label>
            </div>
          </div>
        </div>

        <div>
          <div className="text-xs font-bold text-slate-500 mb-1.5">구글폰트 URL (선택, fonts.googleapis.com)</div>
          <Input size="sm" value={googleFontUrl} onChange={(e) => setGoogleFontUrl(e.target.value)} placeholder="https://fonts.googleapis.com/css2?family=..." />
        </div>

        <div className="flex justify-end">
          <Button size="sm" color="secondary" onClick={save} startContent={<Check className="w-4 h-4" />}>디자인 저장</Button>
        </div>
      </CardContent>
    </Card>
  );
}
