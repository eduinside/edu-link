// src/client/pages/PagesTab.tsx
// 에듀링크 페이지: 대시보드 목록/생성/진입 (편집은 전용 편집기 /dashboard/sites/:id 로 이관, Step 14)
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, CardContent, Chip, Input, Tooltip } from '@heroui/react';
import { Globe, Plus, Copy, ExternalLink, Trash2, Edit3, Eye, EyeOff, Settings } from 'lucide-react';

interface SiteItem {
  id: number;
  title: string;
  is_public: number;
  home_page_id: number | null;
  rev: number;
  published_rev?: number;
  published_at?: string | null;
  slug: string;
  base_slug: string;
  custom_slug: string | null;
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
  const navigate = useNavigate();
  const [sites, setSites] = useState<SiteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [creating, setCreating] = useState(false);
  const [confirmDel, setConfirmDel] = useState<SiteItem | null>(null);

  const fetchSites = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/sites', { headers: getHeaders() });
      const data = await res.json();
      if (data.success) setSites(data.sites);
      else setError(data.error || '사이트 목록을 불러오지 못했습니다.');
    } catch (e: any) { setError('네트워크 오류: ' + e.message); }
    finally { setLoading(false); }
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
        setSuccessMsg('사이트가 생성되었습니다. 편집기로 이동합니다.');
        setNewTitle(''); setNewSlug('');
        navigate(`/dashboard/sites/${data.id}`);
      } else setError(data.error || '생성 실패');
    } catch (e: any) { setError('네트워크 오류: ' + e.message); }
    finally { setCreating(false); }
  };

  const deleteSite = async (s: SiteItem) => {
    try {
      const res = await fetch(`/api/sites/${s.id}`, { method: 'DELETE', headers: getHeaders() });
      const data = await res.json();
      if (data.success) { setSuccessMsg('삭제되었습니다.'); fetchSites(); }
      else setError(data.error || '삭제 실패');
    } catch (e: any) { setError('네트워크 오류: ' + e.message); }
    finally { setConfirmDel(null); }
  };

  const togglePublic = async (s: SiteItem) => {
    try {
      const res = await fetch(`/api/sites/${s.id}`, { method: 'PATCH', headers: getHeaders(), body: JSON.stringify({ is_public: s.is_public ? 0 : 1 }) });
      const data = await res.json();
      if (data.success) fetchSites();
      else setError(data.error || '변경 실패');
    } catch (e: any) { setError('네트워크 오류: ' + e.message); }
  };

  const copyLink = (slug: string) => {
    const url = `${window.location.origin}/${slug}`;
    navigator.clipboard.writeText(url).then(() => setSuccessMsg('주소가 복사되었습니다: ' + url));
  };

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
          <p className="text-[11px] text-slate-400 mt-2">주소는 단축주소와 동일한 풀을 공유합니다. 편집 후 <strong>‘게시’</strong>하면 <strong>dgedu.link/주소</strong>로 공개됩니다.</p>
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
            const published = (s.published_rev ?? 0) > 0;
            return (
              <Card key={s.id} className="bg-white border border-slate-100 rounded-xl shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-slate-800 text-sm truncate">{s.title}</h4>
                        {!published
                          ? <Chip size="sm" color="warning" variant="flat">미게시</Chip>
                          : <Chip size="sm" color={s.is_public ? 'success' : 'default'} variant="flat">{s.is_public ? '게시됨' : '비공개'}</Chip>}
                      </div>
                      <button className="text-xs text-blue-500 hover:underline mt-1 inline-flex items-center gap-1" onClick={() => window.open(`/${slug}`, '_blank')}>
                        /{slug} <ExternalLink className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 mt-3 flex-wrap">
                    <Button size="sm" color="primary" variant="flat" onClick={() => navigate(`/dashboard/sites/${s.id}`)} startContent={<Edit3 className="w-3.5 h-3.5" />}>편집</Button>
                    <Tooltip content="주소 복사"><Button isIconOnly size="sm" variant="light" onClick={() => copyLink(slug)}><Copy className="w-4 h-4" /></Button></Tooltip>
                    <Tooltip content={s.is_public ? '비공개로 전환' : '공개로 전환'}><Button isIconOnly size="sm" variant="light" onClick={() => togglePublic(s)}>{s.is_public ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</Button></Tooltip>
                    <div className="flex-1" />
                    <Tooltip content="삭제"><Button isIconOnly size="sm" variant="light" color="danger" onClick={() => setConfirmDel(s)}><Trash2 className="w-4 h-4" /></Button></Tooltip>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* 삭제 확인 모달 */}
      {confirmDel && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={() => setConfirmDel(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-slate-800 mb-2">‘{confirmDel.title}’ 삭제</h3>
            <p className="text-sm text-slate-500 mb-4">모든 페이지·콘텐츠가 함께 삭제되고 주소(/{publicSlug(confirmDel)})는 회수됩니다. 되돌릴 수 없습니다.</p>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="light" onClick={() => setConfirmDel(null)}>취소</Button>
              <Button size="sm" color="danger" onClick={() => deleteSite(confirmDel)} startContent={<Trash2 className="w-4 h-4" />}>삭제</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
