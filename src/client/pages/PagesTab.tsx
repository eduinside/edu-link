// src/client/pages/PagesTab.tsx
// 에듀링크 페이지: 대시보드 목록(요약 카드 + 표 + 액션 드로워). 편집은 /dashboard/sites/:id 로.
import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, CardContent, Input, Tooltip, Chip } from '@heroui/react';
import {
  LayoutTemplate, Plus, Copy, ExternalLink, Trash2, Edit3, Eye, EyeOff,
  QrCode, BarChart3, FileStack, X, Download, Check, TrendingUp,
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
  url_id?: number;
  is_active?: number;
}

interface Props {
  getHeaders: () => Record<string, string>;
  setSuccessMsg: (m: string) => void;
  setError: (m: string) => void;
}

function publicSlug(s: SiteItem): string {
  return s.custom_slug || s.base_slug || s.slug;
}

function fmtDate(dateStr?: string | null): string {
  if (!dateStr) return '—';
  // DB는 UTC 저장, Z를 붙여 명시적으로 UTC 파싱 후 KST 표시
  const utc = dateStr.replace(' ', 'T') + (dateStr.includes('Z') || dateStr.includes('+') ? '' : 'Z');
  const d = new Date(utc);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export default function PagesTab({ getHeaders, setSuccessMsg, setError }: Props) {
  const navigate = useNavigate();
  const [sites, setSites] = useState<SiteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [creating, setCreating] = useState(false);
  const [confirmDel, setConfirmDel] = useState<SiteItem | null>(null);

  // States for copy action, QR drawer, and Stats drawer
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [qrModalLink, setQrModalLink] = useState<SiteItem | null>(null);
  const [statsDrawerLink, setStatsDrawerLink] = useState<SiteItem | null>(null);
  const [statsData, setStatsData] = useState<{ daily_clicks: { date: string; clicks: number }[] } | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);

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
      if (data.success) {
        setSuccessMsg('삭제되었습니다.');
        setStatsDrawerLink(null);
        fetchSites();
      }
      else setError(data.error || '삭제 실패');
    } catch (e: any) { setError('네트워크 오류: ' + e.message); }
    finally { setConfirmDel(null); }
  };

  const togglePublic = async (s: SiteItem) => {
    try {
      const res = await fetch(`/api/sites/${s.id}`, { method: 'PATCH', headers: getHeaders(), body: JSON.stringify({ is_public: s.is_public ? 0 : 1 }) });
      const data = await res.json();
      if (data.success) {
        fetchSites();
        setStatsDrawerLink(prev => prev && prev.id === s.id ? { ...prev, is_public: prev.is_public ? 0 : 1 } : prev);
      }
      else setError(data.error || '변경 실패');
    } catch (e: any) { setError('네트워크 오류: ' + e.message); }
  };

  const openStats = async (site: SiteItem) => {
    if (!site.url_id) return;
    setStatsDrawerLink(site);
    setStatsData(null);
    setIsLoadingStats(true);
    try {
      const res = await fetch(`/api/links/${site.url_id}/stats`, { headers: getHeaders() });
      const data = await res.json();
      if (data.success) {
        setStatsData({ daily_clicks: data.daily_clicks });
      }
    } catch { /* ignore */ }
    setIsLoadingStats(false);
  };

  const copyLink = (id: number, slug: string) => {
    const url = `${window.location.origin}/${slug}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(id);
      setSuccessMsg('주소가 복사되었습니다: ' + url);
      setTimeout(() => setCopiedId(null), 1800);
    });
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
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-100 text-slate-500 font-bold">
                    <th className="text-left p-3 pl-5 whitespace-nowrap">슬러그</th>
                    <th className="text-left p-3 whitespace-nowrap">제목 / 원본 주소</th>
                    <th className="text-left p-3 whitespace-nowrap">클릭</th>
                    <th className="text-left p-3 whitespace-nowrap">생성일</th>
                    <th className="text-left p-3 whitespace-nowrap">상태</th>
                    <th className="text-right p-3 pr-4 whitespace-nowrap">작업</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {sites.map(s => {
                    const slug = publicSlug(s);
                    const openUrl = `${window.location.protocol}//${window.location.host}/${slug}`;
                    const isCopied = copiedId === s.url_id;
                    const published = (s.published_rev ?? 0) > 0;
                    return (
                      <tr key={s.id} className="hover:bg-slate-50/60 transition-colors group">
                        {/* 슬러그 */}
                        <td className="p-3 pl-5 align-middle">
                          <div className="font-mono font-bold text-slate-800 text-[11px]">
                            /{s.base_slug || s.slug}
                          </div>
                          {s.custom_slug && (
                            <div className="font-mono text-[10px] text-blue-500 mt-0.5">
                              /{s.custom_slug}
                            </div>
                          )}
                        </td>

                        {/* 제목 / 원본 주소 */}
                        <td className="p-3 align-middle max-w-xs">
                          {s.title ? (
                            <div className="font-semibold text-slate-700 truncate max-w-[240px]" title={s.title}>
                              {s.title}
                            </div>
                          ) : (
                            <div className="text-slate-300 italic text-[10px]">제목 없음</div>
                          )}
                          <a
                            href={openUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-[10px] text-slate-400 truncate max-w-[240px] mt-0.5 block hover:text-blue-500 hover:underline"
                            title={openUrl}
                          >
                            {openUrl}
                          </a>
                        </td>

                        {/* 클릭 수 */}
                        <td className="p-3 align-middle whitespace-nowrap">
                          <span className="font-extrabold text-slate-800">{s.click_count ?? 0}</span>
                          <span className="text-slate-400 ml-0.5">회</span>
                        </td>

                        {/* 생성일 */}
                        <td className="p-3 align-middle whitespace-nowrap text-slate-400">
                          {fmtDate(s.created_at)}
                        </td>

                        {/* 상태 */}
                        <td className="p-3 align-middle">
                          <div className="flex flex-col gap-1">
                            <Chip
                              size="sm"
                              color={s.is_active === 1 ? 'success' : 'default'}
                              variant="flat"
                              className="px-1.5 h-4 text-[9px] font-bold"
                            >
                              {s.is_active === 1 ? '활성' : '비활성'}
                            </Chip>
                            <Chip
                              size="sm"
                              color={!published ? 'warning' : s.is_public === 1 ? 'secondary' : 'default'}
                              variant="flat"
                              className="px-1.5 h-4 text-[9px] font-bold"
                            >
                              {!published ? '미게시' : s.is_public === 1 ? '공개' : '비공개'}
                            </Chip>
                          </div>
                        </td>

                        {/* 작업 버튼 */}
                        <td className="p-3 pr-4 align-middle">
                          <div className="flex items-center justify-end gap-1">
                            <Tooltip content={isCopied ? '복사됨!' : '페이지 주소 클립보드에 복사'} delay={200}>
                              <Button
                                size="sm"
                                variant="flat"
                                color={isCopied ? 'success' : 'default'}
                                isIconOnly
                                onClick={() => copyLink(s.url_id ?? s.id, slug)}
                                className="rounded-lg w-7 h-7 min-w-0 p-0"
                              >
                                {isCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                              </Button>
                            </Tooltip>

                            <Tooltip content="새 탭에서 페이지 열기" delay={200}>
                              <Button
                                size="sm"
                                variant="flat"
                                color="default"
                                isIconOnly
                                onClick={() => window.open(openUrl, '_blank')}
                                className="rounded-lg w-7 h-7 min-w-0 p-0"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </Button>
                            </Tooltip>

                            <Tooltip content="QR 코드 보기 및 PNG 저장" delay={200}>
                              <Button
                                size="sm"
                                variant="flat"
                                color="secondary"
                                isIconOnly
                                onClick={() => setQrModalLink(s)}
                                className="rounded-lg w-7 h-7 min-w-0 p-0"
                              >
                                <QrCode className="w-3 h-3" />
                              </Button>
                            </Tooltip>

                            <Tooltip content="접속 통계 및 페이지 관리" delay={200}>
                              <Button
                                size="sm"
                                variant="flat"
                                color="primary"
                                isIconOnly
                                onClick={() => openStats(s)}
                                className="rounded-lg w-7 h-7 min-w-0 p-0"
                              >
                                <TrendingUp className="w-3 h-3" />
                              </Button>
                            </Tooltip>

                            <Tooltip content="페이지 디자인 편집기 열기" delay={200}>
                              <Button
                                size="sm"
                                variant="flat"
                                color="default"
                                isIconOnly
                                onClick={() => navigate(`/dashboard/sites/${s.id}`)}
                                className="rounded-lg w-7 h-7 min-w-0 p-0"
                              >
                                <Edit3 className="w-3 h-3" />
                              </Button>
                            </Tooltip>

                            <Tooltip content="페이지 영구 삭제" delay={200}>
                              <Button
                                size="sm"
                                variant="flat"
                                color="danger"
                                isIconOnly
                                onClick={() => setConfirmDel(s)}
                                className="rounded-lg w-7 h-7 min-w-0 p-0"
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </Tooltip>
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

      {/* QR 드로어 */}
      <QrDrawer site={qrModalLink} onClose={() => setQrModalLink(null)} />

      {/* 통계 및 관리 드로어 */}
      <StatsDrawer
        site={statsDrawerLink}
        onClose={() => setStatsDrawerLink(null)}
        isLoadingStats={isLoadingStats}
        statsData={statsData}
        togglePublic={togglePublic}
      />

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

// SVG 클릭 통계 차트 컴포넌트
function StatsBarChart({ dailyClicks }: { dailyClicks: { date: string; clicks: number }[] }) {
  const DAYS = 30;
  const today = new Date();

  const dates = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (DAYS - 1 - i));
    return d.toISOString().split('T')[0];
  });

  const clickMap: Record<string, number> = {};
  dailyClicks.forEach(({ date, clicks }) => { clickMap[date] = clicks; });

  const data = dates.map(date => ({ date, clicks: clickMap[date] || 0 }));
  const maxClicks = Math.max(...data.map(d => d.clicks), 1);
  const totalClicks = data.reduce((s, d) => s + d.clicks, 0);

  if (totalClicks === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3 text-slate-300 border border-dashed border-slate-200 rounded-xl">
        <BarChart3 className="w-8 h-8" />
        <p className="text-xs text-slate-400">최근 30일 간 접속 기록이 없습니다.</p>
      </div>
    );
  }

  const W = 340;
  const BAR_AREA_H = 90;
  const LABEL_OFFSET = 14;
  const H = BAR_AREA_H + LABEL_OFFSET + 6;
  const barW = Math.floor((W - 8) / DAYS) - 1;
  const step = (W - 8) / DAYS;

  return (
    <div className="space-y-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ overflow: 'visible' }}>
        <line x1={0} y1={4} x2={W} y2={4} stroke="#e2e8f0" strokeWidth={0.5} strokeDasharray="2 2" />
        <text x={2} y={3} fontSize={6.5} fill="#94a3b8" dominantBaseline="auto">{maxClicks}회</text>

        {data.map((d, i) => {
          const barH = Math.max((d.clicks / maxClicks) * BAR_AREA_H, d.clicks > 0 ? 3 : 0.5);
          const x = 4 + i * step;
          const y = BAR_AREA_H - barH + 4;
          const showLabel = i === 0 || i === DAYS - 1 || (i + 1) % 6 === 0;
          const dateObj = new Date(d.date + 'T00:00:00');
          const label = `${dateObj.getMonth() + 1}/${dateObj.getDate()}`;

          return (
            <g key={d.date}>
              <rect
                x={x}
                y={y}
                width={Math.max(barW, 2)}
                height={barH}
                rx={1.5}
                fill={d.clicks > 0 ? '#3b82f6' : '#e2e8f0'}
                opacity={d.clicks > 0 ? 0.82 : 0.6}
              />
              {showLabel && (
                <text
                  x={x + barW / 2}
                  y={BAR_AREA_H + LABEL_OFFSET + 2}
                  textAnchor="middle"
                  fontSize={6.5}
                  fill="#94a3b8"
                >
                  {label}
                </text>
              )}
              {d.clicks > 0 && (
                <title>{d.date}: {d.clicks}회</title>
              )}
            </g>
          );
        })}
      </svg>
      <p className="text-[10px] text-slate-400 text-center">
        기간 내 총 <strong className="text-slate-700 font-extrabold">{totalClicks}회</strong> 접속
      </p>
    </div>
  );
}

// QR 드로어 컴포넌트
function QrDrawer({ site, onClose }: { site: SiteItem | null; onClose: () => void }) {
  const qrSlug = site ? (site.base_slug || site.slug) : '';
  const shortUrl = site ? `${window.location.protocol}//${window.location.host}/${qrSlug}` : '';
  const imgRef = useRef<HTMLImageElement>(null);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shortUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  const handleDownload = async () => {
    if (downloading || !site) return;
    setDownloading(true);
    try {
      const img = imgRef.current;
      if (!img || !img.complete || img.naturalWidth === 0) {
        await new Promise((r) => setTimeout(r, 300));
      }
      const target = imgRef.current!;
      const canvas = document.createElement('canvas');
      canvas.width = target.naturalWidth || 600;
      canvas.height = target.naturalHeight || 600;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(target, 0, 0);
        canvas.toBlob((blob) => {
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${qrSlug}-qr.png`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }, 'image/png');
      }
    } finally {
      setTimeout(() => setDownloading(false), 600);
    }
  };

  return (
    <div className={`fixed inset-0 z-50 overflow-hidden transition-all duration-300 ${site ? 'visible pointer-events-auto' : 'invisible pointer-events-none'}`}>
      <div
        className={`absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-300 ${site ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
        <div className={`w-screen max-w-md bg-white border-l border-slate-200 shadow-2xl flex flex-col transition-transform duration-300 transform ${site ? 'translate-x-0' : 'translate-x-full'}`}>
          {site && (
            <div className="h-full flex flex-col">
              {/* 헤더 */}
              <div className="p-6 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
                <div className="space-y-0.5 min-w-0">
                  <h3 className="font-bold text-base text-slate-800 flex items-center gap-2">
                    <QrCode className="w-4 h-4 text-blue-600 flex-shrink-0" />
                    QR 코드
                  </h3>
                  <p className="text-[10px] text-blue-600 font-bold font-mono truncate">
                    dgedu.link/{qrSlug}
                    {site.custom_slug && <span className="text-slate-400 font-normal"> · /{site.custom_slug}</span>}
                  </p>
                </div>
                <Tooltip content="QR 패널 닫기" delay={300}>
                  <Button
                    size="sm" variant="light" isIconOnly
                    onClick={onClose}
                    className="rounded-lg w-7 h-7 min-w-0 p-0 text-slate-400 flex-shrink-0 ml-2"
                  >✕</Button>
                </Tooltip>
              </div>

              {/* 컨텐츠 */}
              <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center gap-6">
                <div className="bg-white border-2 border-slate-100 rounded-xl p-4 shadow-sm">
                  <img
                    ref={imgRef}
                    src={`/qr/${encodeURIComponent(qrSlug)}`}
                    alt="QR Code"
                    className="w-48 h-48 object-contain"
                    crossOrigin="anonymous"
                  />
                </div>
                <div className="flex gap-2 w-full max-w-xs">
                  <Button
                    className="flex-1"
                    size="sm"
                    variant="flat"
                    color="default"
                    startContent={<Download className="w-3.5 h-3.5" />}
                    onClick={handleDownload}
                    isLoading={downloading}
                  >
                    PNG 저장
                  </Button>
                  <Button
                    className="flex-1"
                    size="sm"
                    variant="flat"
                    color={copied ? 'success' : 'default'}
                    startContent={copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    onClick={handleCopy}
                  >
                    {copied ? '복사됨!' : '주소 복사'}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// 통계 및 관리 드로어 컴포넌트
function StatsDrawer({
  site,
  onClose,
  isLoadingStats,
  statsData,
  togglePublic
}: {
  site: SiteItem | null;
  onClose: () => void;
  isLoadingStats: boolean;
  statsData: { daily_clicks: { date: string; clicks: number }[] } | null;
  togglePublic: (s: SiteItem) => Promise<void>;
}) {
  const [togglingPublic, setTogglingPublic] = useState(false);

  const handleTogglePublic = async () => {
    if (!site) return;
    setTogglingPublic(true);
    try {
      await togglePublic(site);
    } finally {
      setTogglingPublic(false);
    }
  };

  const slug = site ? (site.custom_slug || site.base_slug || site.slug) : '';
  const openUrl = site ? `${window.location.protocol}//${window.location.host}/${slug}` : '';
  const published = site ? (site.published_rev ?? 0) > 0 : false;

  return (
    <div className={`fixed inset-0 z-50 overflow-hidden transition-all duration-300 ${site ? 'visible pointer-events-auto' : 'invisible pointer-events-none'}`}>
      <div
        className={`absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-300 ${site ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
        <div className={`w-screen max-w-md bg-white border-l border-slate-200 shadow-2xl flex flex-col transition-transform duration-300 transform ${site ? 'translate-x-0' : 'translate-x-full'}`}>
          {site && (
            <div className="h-full flex flex-col">
              {/* 헤더 */}
              <div className="p-6 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
                <div className="space-y-0.5 min-w-0">
                  <h3 className="font-bold text-base text-slate-800 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-blue-600 flex-shrink-0" />
                    접속 통계 및 관리
                  </h3>
                  <p className="text-[10px] text-blue-600 font-bold font-mono truncate">
                    dgedu.link/{site.base_slug || site.slug}
                    {site.custom_slug && <span className="text-slate-400 font-normal"> · /{site.custom_slug}</span>}
                  </p>
                </div>
                <Tooltip content="패널 닫기" delay={300}>
                  <Button
                    size="sm" variant="light" isIconOnly
                    onClick={onClose}
                    className="rounded-lg w-7 h-7 min-w-0 p-0 text-slate-400 flex-shrink-0 ml-2"
                  >✕</Button>
                </Tooltip>
              </div>

              {/* 컨텐츠 */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {/* 기본 정보 */}
                <div className="bg-slate-50 rounded-xl p-4 space-y-3 text-xs">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-slate-400 font-bold flex-shrink-0">페이지 제목</span>
                    <span className="text-slate-800 font-semibold text-right break-words max-w-[240px]">
                      {site.title || <span className="text-slate-300 italic font-normal">없음</span>}
                    </span>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-slate-400 font-bold flex-shrink-0">연결 주소</span>
                    <a
                      href={openUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 font-mono text-[10px] text-right break-all hover:underline max-w-[240px]"
                    >
                      {openUrl}
                    </a>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-400 font-bold">생성일시</span>
                    <span className="text-slate-600 font-semibold">{fmtDate(site.created_at)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-400 font-bold">하위 페이지 수</span>
                    <span className="text-slate-600 font-semibold">{site.page_count ?? 0}개</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 pt-1 border-t border-slate-100">
                    <span className="text-slate-500 font-bold flex items-center gap-1.5">
                      <BarChart3 className="w-3.5 h-3.5 text-blue-500" />
                      누적 클릭
                    </span>
                    <span className="text-slate-800 font-extrabold text-lg">
                      {site.click_count ?? 0}
                      <span className="text-xs font-normal text-slate-400 ml-1">회</span>
                    </span>
                  </div>
                </div>

                {/* 일별 접속 그래프 */}
                <div className="space-y-3">
                  <h4 className="font-bold text-sm text-slate-800">최근 30일 일별 접속 현황</h4>
                  {isLoadingStats ? (
                    <div className="flex items-center justify-center py-14">
                      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : (
                    <StatsBarChart dailyClicks={statsData?.daily_clicks || []} />
                  )}
                </div>

                {/* 관리 조작 영역 */}
                <div className="pt-4 border-t border-slate-100 space-y-2">
                  <h4 className="font-bold text-xs text-slate-400 mb-2 uppercase tracking-wider">공개 여부 설정</h4>
                  <Button
                    className="w-full"
                    variant="flat"
                    isLoading={togglingPublic}
                    startContent={site.is_public ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    onClick={handleTogglePublic}
                    disabled={!published}
                  >
                    {!published ? '게시되지 않음 (공개 전환 불가)' : site.is_public ? '비공개로 전환' : '공개로 전환'}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
