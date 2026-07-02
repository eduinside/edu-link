// src/client/pages/PagesTab.tsx
// 에듀링크 페이지: 대시보드 목록(요약 카드 + 표 + 액션 드로워). 편집은 /dashboard/sites/:id 로.
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, CardContent, Input } from '@heroui/react';
import {
  LayoutTemplate, Plus, Copy, ExternalLink, Trash2, Edit3, Eye, EyeOff,
  QrCode, BarChart3, FileStack, X, MoreHorizontal, Download,
} from 'lucide-react';

interface SiteItem {
  id: number;
  title: string;
  is_public: number;
  home_page_id: number | null;
  rev: number;
  published_rev?: number;
  published_at?: string | null;
  created_at?: string;
  updated_at?: string;
  click_count?: number;
  page_count?: number;
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
function fmtDate(s?: string | null): string {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' }).replace(/\.$/, '');
}

export default function PagesTab({ getHeaders, setSuccessMsg, setError }: Props) {
  const navigate = useNavigate();
  const [sites, setSites] = useState<SiteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [creating, setCreating] = useState(false);
  const [confirmDel, setConfirmDel] = useState<SiteItem | null>(null);
  const [drawer, setDrawer] = useState<SiteItem | null>(null);

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
      if (data.success) { setSuccessMsg('사이트가 생성되었습니다. 편집기로 이동합니다.'); navigate(`/dashboard/sites/${data.id}`); }
      else setError(data.error || '생성 실패');
    } catch (e: any) { setError('네트워크 오류: ' + e.message); }
    finally { setCreating(false); }
  };

  const deleteSite = async (s: SiteItem) => {
    try {
      const res = await fetch(`/api/sites/${s.id}`, { method: 'DELETE', headers: getHeaders() });
      const data = await res.json();
      if (data.success) { setSuccessMsg('삭제되었습니다.'); setDrawer(null); fetchSites(); }
      else setError(data.error || '삭제 실패');
    } catch (e: any) { setError('네트워크 오류: ' + e.message); }
    finally { setConfirmDel(null); }
  };

  const togglePublic = async (s: SiteItem) => {
    try {
      const res = await fetch(`/api/sites/${s.id}`, { method: 'PATCH', headers: getHeaders(), body: JSON.stringify({ is_public: s.is_public ? 0 : 1 }) });
      const data = await res.json();
      if (data.success) { fetchSites(); setDrawer(d => d && d.id === s.id ? { ...d, is_public: d.is_public ? 0 : 1 } : d); }
      else setError(data.error || '변경 실패');
    } catch (e: any) { setError('네트워크 오류: ' + e.message); }
  };

  const copyLink = (slug: string) => {
    const url = `${window.location.origin}/${slug}`;
    navigator.clipboard.writeText(url).then(() => setSuccessMsg('주소가 복사되었습니다: ' + url));
  };

  const totalClicks = sites.reduce((sum, s) => sum + (s.click_count || 0), 0);
  const publishedCount = sites.filter(s => (s.published_rev ?? 0) > 0).length;
  const publishRate = sites.length ? Math.round((publishedCount / sites.length) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* 요약 카드 */}
      <div className="grid grid-cols-3 gap-4">
        <SummaryCard icon={<FileStack className="w-5 h-5" />} tone="blue" value={`${sites.length}개`} label="생성한 페이지" />
        <SummaryCard icon={<BarChart3 className="w-5 h-5" />} tone="emerald" value={`${totalClicks}회`} label="누적 접속(클릭) 수" />
        <SummaryCard icon={<LayoutTemplate className="w-5 h-5" />} tone="purple" value={`${publishRate}%`} label="게시 완료 비율" />
      </div>

      {/* 생성 폼 */}
      <Card className="bg-white border border-slate-100 rounded-xl shadow-sm">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <LayoutTemplate className="w-4 h-4 text-blue-500" />
            <span className="font-bold text-slate-800 text-sm">새 페이지(사이트) 만들기</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
            <Input size="sm" placeholder="사이트 제목 (예: 3학년 2반)" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
            <Input size="sm" placeholder="원하는 주소 (선택, 비우면 자동)" value={newSlug} onChange={(e) => setNewSlug(e.target.value)}
              startContent={<span className="text-xs text-slate-400">/</span>} />
            <Button size="sm" color="primary" onClick={createSite} isLoading={creating} startContent={!creating ? <Plus className="w-4 h-4" /> : undefined}>만들기</Button>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">편집 후 <strong>‘게시’</strong>하면 <strong>dgedu.link/주소</strong>로 공개됩니다.</p>
        </CardContent>
      </Card>

      {/* 목록(표) */}
      <Card className="bg-white border border-slate-100 rounded-xl shadow-sm">
        <CardContent className="p-0">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="font-bold text-slate-800 text-sm">페이지 목록</h3>
          </div>
          {loading ? (
            <p className="text-sm text-slate-400 text-center py-10">불러오는 중...</p>
          ) : sites.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">아직 만든 페이지가 없습니다. 위에서 새로 만들어보세요.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] text-slate-400 border-b border-slate-100">
                    <th className="text-left font-semibold px-4 py-2.5">제목 / 주소</th>
                    <th className="text-center font-semibold px-2 py-2.5 whitespace-nowrap">생성일</th>
                    <th className="text-center font-semibold px-2 py-2.5 whitespace-nowrap">최종수정</th>
                    <th className="text-center font-semibold px-2 py-2.5 whitespace-nowrap">클릭</th>
                    <th className="text-center font-semibold px-2 py-2.5">상태</th>
                    <th className="text-right font-semibold px-4 py-2.5">작업</th>
                  </tr>
                </thead>
                <tbody>
                  {sites.map(s => {
                    const slug = publicSlug(s);
                    const published = (s.published_rev ?? 0) > 0;
                    return (
                      <tr key={s.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                        <td className="px-4 py-3">
                          <div className="font-bold text-slate-800 truncate max-w-[240px]">{s.title}</div>
                          <button className="text-xs text-blue-500 hover:underline inline-flex items-center gap-1" onClick={() => window.open(`/${slug}`, '_blank')}>
                            /{slug} <ExternalLink className="w-3 h-3" />
                          </button>
                        </td>
                        <td className="text-center px-2 py-3 text-slate-500 text-xs whitespace-nowrap">{fmtDate(s.created_at)}</td>
                        <td className="text-center px-2 py-3 text-slate-500 text-xs whitespace-nowrap">{fmtDate(s.updated_at)}</td>
                        <td className="text-center px-2 py-3"><span className="font-extrabold text-slate-800">{s.click_count ?? 0}</span></td>
                        <td className="text-center px-2 py-3">
                          {!published
                            ? <span className="text-[11px] font-bold text-amber-600 bg-amber-50 rounded-full px-2 py-0.5">미게시</span>
                            : s.is_public
                              ? <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 rounded-full px-2 py-0.5">게시됨</span>
                              : <span className="text-[11px] font-bold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">비공개</span>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <Button size="sm" color="primary" variant="flat" onClick={() => navigate(`/dashboard/sites/${s.id}`)} startContent={<Edit3 className="w-3.5 h-3.5" />}>편집</Button>
                            <button className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100" title="관리(QR·통계)" onClick={() => setDrawer(s)}><MoreHorizontal className="w-4 h-4" /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 액션 드로워 (QR · 통계 · 관리) */}
      <div className={`fixed inset-0 z-50 overflow-hidden transition-all duration-300 ${drawer ? 'visible' : 'invisible pointer-events-none'}`}>
        <div className={`absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity ${drawer ? 'opacity-100' : 'opacity-0'}`} onClick={() => setDrawer(null)} />
        <div className="absolute inset-y-0 right-0 flex max-w-full">
          <div className={`w-screen max-w-md bg-white border-l border-slate-200 shadow-2xl flex flex-col transition-transform duration-300 ${drawer ? 'translate-x-0' : 'translate-x-full'}`}>
            {drawer && (() => {
              const slug = publicSlug(drawer);
              const published = (drawer.published_rev ?? 0) > 0;
              return (
                <>
                  <div className="flex items-start justify-between p-5 border-b border-slate-100">
                    <div className="min-w-0">
                      <h3 className="font-extrabold text-slate-800 truncate">{drawer.title}</h3>
                      <p className="text-xs text-slate-400 mt-0.5">/{slug}</p>
                    </div>
                    <button className="p-1.5 text-slate-400 hover:text-slate-700" onClick={() => setDrawer(null)}><X className="w-5 h-5" /></button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-5 space-y-5">
                    {/* QR */}
                    <div className="flex flex-col items-center gap-2">
                      <div className="bg-white border border-slate-200 rounded-xl p-3">
                        <img src={`/qr/${encodeURIComponent(slug)}`} alt="QR" className="w-40 h-40" />
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="flat" startContent={<Download className="w-3.5 h-3.5" />} onClick={() => window.open(`/qr/${encodeURIComponent(slug)}`, '_blank')}>QR 저장</Button>
                        <Button size="sm" variant="flat" startContent={<Copy className="w-3.5 h-3.5" />} onClick={() => copyLink(slug)}>주소 복사</Button>
                      </div>
                    </div>
                    {/* 통계 */}
                    <div className="grid grid-cols-2 gap-2.5">
                      <Stat label="누적 클릭" value={`${drawer.click_count ?? 0}회`} big />
                      <Stat label="페이지 수" value={`${drawer.page_count ?? 0}개`} big />
                      <Stat label="생성일" value={fmtDate(drawer.created_at)} />
                      <Stat label="최종 수정" value={fmtDate(drawer.updated_at)} />
                      <Stat label="상태" value={!published ? '미게시' : drawer.is_public ? '게시됨' : '비공개'} />
                      <Stat label="최근 게시" value={fmtDate(drawer.published_at)} />
                    </div>
                    {/* 관리 */}
                    <div className="space-y-2 pt-1">
                      <Button className="w-full" color="primary" variant="flat" startContent={<Edit3 className="w-4 h-4" />} onClick={() => navigate(`/dashboard/sites/${drawer.id}`)}>편집기 열기</Button>
                      <Button className="w-full" variant="flat" startContent={<ExternalLink className="w-4 h-4" />} onClick={() => window.open(`/${slug}`, '_blank')}>공개 페이지 열기</Button>
                      <Button className="w-full" variant="flat" startContent={drawer.is_public ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />} onClick={() => togglePublic(drawer)}>
                        {drawer.is_public ? '비공개로 전환' : '공개로 전환'}
                      </Button>
                      <Button className="w-full" color="danger" variant="flat" startContent={<Trash2 className="w-4 h-4" />} onClick={() => setConfirmDel(drawer)}>삭제</Button>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      </div>

      {/* 삭제 확인 모달 */}
      {confirmDel && (
        <div className="fixed inset-0 z-[60] bg-black/30 flex items-center justify-center p-4" onClick={() => setConfirmDel(null)}>
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

const TONE: Record<string, string> = { blue: 'bg-blue-50 text-blue-600', emerald: 'bg-emerald-50 text-emerald-600', purple: 'bg-purple-50 text-purple-600' };
function SummaryCard({ icon, tone, value, label }: { icon: React.ReactNode; tone: string; value: string; label: string }) {
  return (
    <Card className="bg-white border border-slate-100 rounded-xl shadow-sm">
      <CardContent className="p-4 flex flex-col items-center gap-2 text-center">
        <div className={`p-2.5 rounded-xl ${TONE[tone]}`}>{icon}</div>
        <h3 className="text-2xl font-extrabold text-slate-800">{value}</h3>
        <p className="text-[11px] text-slate-400 font-bold">{label}</p>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="bg-slate-50 rounded-xl px-3 py-2.5">
      <p className="text-[11px] text-slate-400 font-bold mb-0.5">{label}</p>
      <p className={`text-slate-800 font-extrabold ${big ? 'text-lg' : 'text-sm'}`}>{value}</p>
    </div>
  );
}
