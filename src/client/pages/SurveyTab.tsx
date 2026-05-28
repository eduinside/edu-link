// src/client/pages/SurveyTab.tsx
import React, { useEffect, useState } from 'react';
import { Button, Card, CardContent, Chip, Input, Tooltip } from '@heroui/react';
import {
  FileText, Plus, Copy, ExternalLink, Trash2, Edit3, Check, BarChart3,
  Download, QrCode, ArrowUp, ArrowDown, X
} from 'lucide-react';

type QuestionType = 'short' | 'long' | 'single' | 'multi' | 'rating' | 'phone' | 'email' | 'address';

interface Question {
  id: string;
  type: QuestionType;
  label: string;
  required: boolean;
  options?: string[];
  scale?: number;
}

interface SurveyConfig {
  title: string;
  intro: string;
  outro: string;
  questions: Question[];
}

interface SurveyItem {
  id: number;
  slug: string;
  base_slug: string;
  custom_slug: string | null;
  title: string;
  survey_config: string; // JSON string
  response_limit: number | null;
  response_count: number;
  is_active: number;
  expires_at: string | null;
  password: string | null;
  created_at: string;
}

interface Props {
  getHeaders: () => Record<string, string>;
  setSuccessMsg: (m: string) => void;
  setError: (m: string) => void;
  setQrModalLink: (link: any) => void;
}

const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  short: '단답',
  long: '서술',
  single: '선택(단일)',
  multi: '다중선택',
  rating: '만족도',
  phone: '휴대전화',
  email: '이메일',
  address: '주소(한국)',
};

const QUESTION_TYPE_TOOLTIP: Record<QuestionType, string> = {
  short: '한 줄 단답 입력 (이름, 키워드 등)',
  long: '여러 줄 서술형 입력 (의견, 후기 등)',
  single: '여러 선택지 중 하나만 선택 (라디오)',
  multi: '여러 선택지 중 여러 개 선택 가능 (체크박스)',
  rating: '1~N 점수 척도 (만족도/평점)',
  phone: '휴대전화 번호 — 자동 하이픈 입력',
  email: '이메일 주소 — 형식 검증',
  address: '카카오 우편번호 검색 — 도로명/지번 + 상세주소',
};

const DEFAULT_CONFIG: SurveyConfig = {
  title: '',
  intro: '아래 설문에 응답해 주세요.',
  outro: '응답해 주셔서 감사합니다.',
  questions: [],
};

function genQid() {
  return 'q_' + Math.random().toString(36).slice(2, 9);
}

function formatDate(s: string | null | undefined) {
  if (!s) return '-';
  try { return new Date(s.replace(' ', 'T') + 'Z').toLocaleString('ko-KR'); }
  catch { return s; }
}

export default function SurveyTab({ getHeaders, setSuccessMsg, setError, setQrModalLink }: Props) {
  const [surveys, setSurveys] = useState<SurveyItem[]>([]);
  const [editing, setEditing] = useState<SurveyItem | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formIntro, setFormIntro] = useState(DEFAULT_CONFIG.intro);
  const [formOutro, setFormOutro] = useState(DEFAULT_CONFIG.outro);
  const [formQuestions, setFormQuestions] = useState<Question[]>([]);
  const [formCustomSlug, setFormCustomSlug] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formExpiresAt, setFormExpiresAt] = useState('');
  const [formResponseLimit, setFormResponseLimit] = useState('');
  const [formActive, setFormActive] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  // Results inline panel (대시보드 화면 내 표시)
  const [resultsView, setResultsView] = useState<{ survey: any; responses: any[] } | null>(null);
  const [resultsTab, setResultsTab] = useState<'summary' | 'byQuestion' | 'individual'>('summary');
  const [individualIdx, setIndividualIdx] = useState(0);

  // 빠른 생성 입력바
  const [quickTitle, setQuickTitle] = useState('');

  // 새 문항 기본 필수 여부 (+ 버튼 클릭 시 적용)
  const [nextRequired, setNextRequired] = useState(false);

  const fetchSurveys = async () => {
    try {
      const res = await fetch('/api/surveys', { headers: getHeaders() });
      const data = await res.json();
      if (data.success) setSurveys(data.surveys || []);
      else setError(data.error || '설문 목록 조회 실패');
    } catch { setError('서버 연결 실패'); }
  };

  useEffect(() => { fetchSurveys(); }, []);

  const resetForm = () => {
    setFormTitle('');
    setFormIntro(DEFAULT_CONFIG.intro);
    setFormOutro(DEFAULT_CONFIG.outro);
    setFormQuestions([]);
    setFormCustomSlug('');
    setFormPassword('');
    setFormExpiresAt('');
    setFormResponseLimit('');
    setFormActive(true);
  };

  const startCreate = (prefillTitle = '') => {
    resetForm();
    if (prefillTitle) setFormTitle(prefillTitle);
    setEditing(null);
    setIsCreating(true);
  };

  const startEdit = (s: SurveyItem) => {
    setIsCreating(false);
    setEditing(s);
    try {
      const cfg: SurveyConfig = JSON.parse(s.survey_config || '{}');
      setFormTitle(s.title || cfg.title || '');
      setFormIntro(cfg.intro || '');
      setFormOutro(cfg.outro || '');
      setFormQuestions(cfg.questions || []);
    } catch {
      setFormTitle(s.title);
      setFormQuestions([]);
    }
    setFormCustomSlug(s.custom_slug || '');
    setFormPassword(s.password || '');
    setFormExpiresAt(s.expires_at ? s.expires_at.replace(' ', 'T').slice(0, 16) : '');
    setFormResponseLimit(s.response_limit ? String(s.response_limit) : '');
    setFormActive(s.is_active === 1);
  };

  const closeDrawer = () => {
    setIsCreating(false);
    setEditing(null);
  };

  const addQuestion = (type: QuestionType) => {
    const q: Question = {
      id: genQid(),
      type,
      label: '',
      required: nextRequired,
    };
    if (type === 'single' || type === 'multi') q.options = ['선택 1', '선택 2'];
    if (type === 'rating') q.scale = 5;
    setFormQuestions([...formQuestions, q]);
  };

  const updateQuestion = (idx: number, patch: Partial<Question>) => {
    setFormQuestions(formQuestions.map((q, i) => i === idx ? { ...q, ...patch } : q));
  };

  const removeQuestion = (idx: number) => {
    setFormQuestions(formQuestions.filter((_, i) => i !== idx));
  };

  const moveQuestion = (idx: number, dir: -1 | 1) => {
    const next = [...formQuestions];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setFormQuestions(next);
  };

  const handleSave = async () => {
    if (!formTitle.trim()) { setError('설문 제목을 입력해 주세요.'); return; }
    if (formQuestions.length === 0) { setError('최소 1개 이상의 질문을 추가해 주세요.'); return; }
    for (const q of formQuestions) {
      if (!q.label.trim()) { setError('모든 질문에 라벨을 입력해 주세요.'); return; }
      if ((q.type === 'single' || q.type === 'multi') && (!q.options || q.options.filter(o => o.trim()).length < 2)) {
        setError('선택지가 2개 이상 필요한 질문이 있습니다.'); return;
      }
    }
    if (formPassword && !/^\d{6}$/.test(formPassword)) {
      setError('비밀번호는 숫자 6자리여야 합니다.'); return;
    }

    const config: SurveyConfig = {
      title: formTitle.trim(),
      intro: formIntro,
      outro: formOutro,
      questions: formQuestions,
    };
    const expirationUtc = formExpiresAt
      ? new Date(formExpiresAt).toISOString().replace('T', ' ').split('.')[0]
      : null;
    const payload: any = {
      title: formTitle.trim(),
      survey_config: config,
      response_limit: formResponseLimit ? Number(formResponseLimit) : null,
      expires_at: expirationUtc,
      password: formPassword || null,
      custom_slug: formCustomSlug.trim() || null,
    };

    setIsSaving(true);
    setError(''); setSuccessMsg('');
    try {
      const url = editing ? `/api/surveys/${editing.id}` : '/api/surveys';
      const method = editing ? 'PATCH' : 'POST';
      if (editing) payload.is_active = formActive;
      const res = await fetch(url, { method, headers: getHeaders(), body: JSON.stringify(payload) });
      const data = await res.json();
      if (data.success) {
        setSuccessMsg(editing ? '설문이 수정되었습니다.' : '설문이 생성되었습니다.');
        closeDrawer();
        fetchSurveys();
      } else {
        setError(data.error || '저장 실패');
      }
    } catch {
      setError('서버 연결 실패');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('이 설문을 삭제하시겠습니까? 응답 데이터도 함께 삭제됩니다.')) return;
    try {
      const res = await fetch(`/api/surveys/${id}`, { method: 'DELETE', headers: getHeaders() });
      const data = await res.json();
      if (data.success) { setSuccessMsg('설문이 삭제되었습니다.'); fetchSurveys(); }
      else setError(data.error || '삭제 실패');
    } catch { setError('서버 연결 실패'); }
  };

  const openResults = async (id: number) => {
    try {
      const res = await fetch(`/api/surveys/${id}/responses`, { headers: getHeaders() });
      const data = await res.json();
      if (data.success) {
        setResultsView({ survey: data.survey, responses: data.responses });
        setResultsTab('summary');
        setIndividualIdx(0);
        setTimeout(() => {
          document.getElementById('survey-results-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 50);
      } else setError(data.error || '결과 조회 실패');
    } catch { setError('서버 연결 실패'); }
  };

  const copyToClipboard = async (id: number, slug: string) => {
    const url = `${window.location.protocol}//${window.location.host}/${slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch { setError('복사 실패'); }
  };

  const isDrawerOpen = isCreating || editing !== null;

  return (
    <>
      {/* 상단: 통계 카드 + 생성 버튼 */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card className="bg-white border border-slate-100 rounded-3xl shadow-sm">
          <CardContent className="p-4 flex flex-col items-center gap-2 text-center">
            <div className="bg-blue-50 p-2.5 rounded-2xl text-blue-600"><FileText className="w-5 h-5" /></div>
            <h3 className="text-2xl font-extrabold text-slate-800">{surveys.length}개</h3>
            <p className="text-[11px] text-slate-400 font-bold">생성된 설문</p>
          </CardContent>
        </Card>
        <Card className="bg-white border border-slate-100 rounded-3xl shadow-sm">
          <CardContent className="p-4 flex flex-col items-center gap-2 text-center">
            <div className="bg-emerald-50 p-2.5 rounded-2xl text-emerald-600"><BarChart3 className="w-5 h-5" /></div>
            <h3 className="text-2xl font-extrabold text-slate-800">
              {surveys.reduce((s, x) => s + (x.response_count || 0), 0)}회
            </h3>
            <p className="text-[11px] text-slate-400 font-bold">총 응답 수</p>
          </CardContent>
        </Card>
        <Card className="bg-white border border-slate-100 rounded-3xl shadow-sm">
          <CardContent className="p-4 flex flex-col items-center gap-2 text-center">
            <div className="bg-purple-50 p-2.5 rounded-2xl text-purple-600"><FileText className="w-5 h-5" /></div>
            <h3 className="text-2xl font-extrabold text-slate-800">
              {surveys.filter(s => s.is_active === 1).length}개
            </h3>
            <p className="text-[11px] text-slate-400 font-bold">활성 설문</p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-white border border-slate-100 rounded-3xl shadow-sm overflow-hidden mb-6">
        <CardContent className="p-4 sm:p-5">
          <form
            onSubmit={(e) => { e.preventDefault(); if (!quickTitle.trim()) return; startCreate(quickTitle.trim()); setQuickTitle(''); }}
            className="flex items-center gap-3 w-full"
          >
            <div className="flex-1">
              <Input
                size="md"
                required
                placeholder="설문 제목을 입력하세요 (예: 2026 학부모 만족도 조사)"
                value={quickTitle}
                onChange={(e) => setQuickTitle(e.target.value)}
                className="w-full font-medium"
              />
            </div>
            <Tooltip content="제목 입력 후 상세 편집 드로어가 열립니다" delay={200}>
              <Button
                type="submit"
                color="primary"
                className="rounded-2xl font-bold px-6 h-10 flex-shrink-0 shadow-md shadow-primary/10"
                startContent={<Plus className="w-4 h-4" />}
              >
                설문 만들기
              </Button>
            </Tooltip>
          </form>
        </CardContent>
      </Card>

      {surveys.length === 0 ? (
        <Card className="bg-white border border-slate-100 rounded-3xl py-16 shadow-sm">
          <CardContent className="text-center flex flex-col items-center gap-2">
            <FileText className="w-12 h-12 text-slate-200" />
            <p className="text-xs text-slate-400 font-medium">아직 생성된 설문이 없습니다.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="bg-white border border-slate-100 rounded-3xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-100 text-slate-500 font-bold">
                  <th className="text-left p-3 pl-5 whitespace-nowrap">슬러그</th>
                  <th className="text-left p-3 whitespace-nowrap">제목</th>
                  <th className="text-left p-3 whitespace-nowrap">응답수 / 한도</th>
                  <th className="text-left p-3 whitespace-nowrap">종료일</th>
                  <th className="text-left p-3 whitespace-nowrap">상태</th>
                  <th className="text-right p-3 pr-4 whitespace-nowrap">작업</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {surveys.map(s => {
                  const slugShown = s.custom_slug || s.base_slug || s.slug;
                  const isCopied = copiedId === s.id;
                  return (
                    <tr key={s.id} className="hover:bg-slate-50/60">
                      <td className="p-3 pl-5">
                        <div className="font-mono font-bold text-slate-800 text-[11px]">/{s.base_slug || s.slug}</div>
                        {s.custom_slug && <div className="font-mono text-[10px] text-indigo-500 mt-0.5">/{s.custom_slug}</div>}
                      </td>
                      <td className="p-3 max-w-xs">
                        <div className="font-semibold text-slate-700 truncate max-w-[260px]" title={s.title}>{s.title}</div>
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <span className="font-extrabold text-slate-800">{s.response_count ?? 0}</span>
                        <span className="text-slate-400"> / {s.response_limit ?? '∞'}</span>
                      </td>
                      <td className="p-3 whitespace-nowrap text-slate-400">{s.expires_at ? formatDate(s.expires_at) : '-'}</td>
                      <td className="p-3">
                        <div className="flex flex-col gap-1">
                          <Chip size="sm" variant="flat" color={s.is_active === 1 ? 'success' : 'default'} className="px-1.5 h-4 text-[9px] font-bold">
                            {s.is_active === 1 ? '활성' : '비활성'}
                          </Chip>
                          {s.password && <Chip size="sm" variant="flat" color="warning" className="px-1.5 h-4 text-[9px] font-bold">🔒 보호</Chip>}
                        </div>
                      </td>
                      <td className="p-3 pr-4">
                        <div className="flex items-center justify-end gap-1">
                          <Tooltip content={isCopied ? '복사됨!' : '주소 복사'}>
                            <Button size="sm" variant="flat" color={isCopied ? 'success' : 'default'} isIconOnly className="rounded-lg w-7 h-7 min-w-0 p-0"
                              onClick={() => copyToClipboard(s.id, slugShown)}>
                              {isCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                            </Button>
                          </Tooltip>
                          <Tooltip content="설문 열기">
                            <Button size="sm" variant="flat" isIconOnly className="rounded-lg w-7 h-7 min-w-0 p-0"
                              onClick={() => window.open(`/${slugShown}`, '_blank')}>
                              <ExternalLink className="w-3 h-3" />
                            </Button>
                          </Tooltip>
                          <Tooltip content="QR 코드">
                            <Button size="sm" variant="flat" color="secondary" isIconOnly className="rounded-lg w-7 h-7 min-w-0 p-0"
                              onClick={() => setQrModalLink({ id: s.id, slug: slugShown, base_slug: s.base_slug, custom_slug: s.custom_slug, title: s.title } as any)}>
                              <QrCode className="w-3 h-3" />
                            </Button>
                          </Tooltip>
                          <Tooltip content="결과 보기">
                            <Button size="sm" variant="flat" color="primary" isIconOnly className="rounded-lg w-7 h-7 min-w-0 p-0"
                              onClick={() => openResults(s.id)}>
                              <BarChart3 className="w-3 h-3" />
                            </Button>
                          </Tooltip>
                          <Tooltip content="CSV 다운로드">
                            <Button size="sm" variant="flat" isIconOnly className="rounded-lg w-7 h-7 min-w-0 p-0"
                              onClick={() => window.open(`/api/surveys/${s.id}/responses.csv`, '_blank')}>
                              <Download className="w-3 h-3" />
                            </Button>
                          </Tooltip>
                          <Tooltip content="편집">
                            <Button size="sm" variant="flat" isIconOnly className="rounded-lg w-7 h-7 min-w-0 p-0"
                              onClick={() => startEdit(s)}>
                              <Edit3 className="w-3 h-3" />
                            </Button>
                          </Tooltip>
                          <Tooltip content="삭제">
                            <Button size="sm" variant="flat" color="danger" isIconOnly className="rounded-lg w-7 h-7 min-w-0 p-0"
                              onClick={() => handleDelete(s.id)}>
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
        </div>
      )}

      {/* Editor drawer */}
      <div className={`fixed inset-0 z-50 ${isDrawerOpen ? 'visible' : 'invisible pointer-events-none'}`}>
        <div className={`absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity ${isDrawerOpen ? 'opacity-100' : 'opacity-0'}`}
          onClick={closeDrawer} />
        <div className={`absolute inset-y-0 right-0 max-w-full flex pl-10`}>
          <div className={`w-screen max-w-xl bg-white border-l border-slate-200 shadow-2xl flex flex-col transition-transform ${isDrawerOpen ? 'translate-x-0' : 'translate-x-full'}`}>
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-bold text-base text-slate-800">{editing ? '설문 편집' : '새 설문 만들기'}</h3>
              <Button size="sm" variant="light" isIconOnly onClick={closeDrawer}><X className="w-4 h-4" /></Button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-600 mb-1.5">제목 *</label>
                <Input size="sm" value={formTitle} onChange={e => setFormTitle(e.target.value)} placeholder="설문 제목" />
              </div>
              <div>
                <label className="block font-bold text-slate-600 mb-1.5">설문 안내 (intro)</label>
                <textarea className="w-full border border-slate-200 rounded-xl p-2 text-xs" rows={3}
                  value={formIntro} onChange={e => setFormIntro(e.target.value)} />
              </div>
              <div>
                <label className="block font-bold text-slate-600 mb-1.5">종료 안내 (outro)</label>
                <textarea className="w-full border border-slate-200 rounded-xl p-2 text-xs" rows={2}
                  value={formOutro} onChange={e => setFormOutro(e.target.value)} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-600 mb-1.5">커스텀 슬러그 (선택)</label>
                  <Input size="sm" value={formCustomSlug} onChange={e => setFormCustomSlug(e.target.value)} placeholder="4~20자" />
                </div>
                <div>
                  <label className="block font-bold text-slate-600 mb-1.5">비밀번호 (6자리, 선택)</label>
                  <Input size="sm" value={formPassword} onChange={e => setFormPassword(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" />
                </div>
                <div>
                  <label className="block font-bold text-slate-600 mb-1.5">종료일 (선택)</label>
                  <input type="datetime-local" className="w-full border border-slate-200 rounded-xl p-2 text-xs"
                    value={formExpiresAt} onChange={e => setFormExpiresAt(e.target.value)} />
                </div>
                <div>
                  <label className="block font-bold text-slate-600 mb-1.5">최대 응답 수 (선택)</label>
                  <Input size="sm" type="number" value={formResponseLimit} onChange={e => setFormResponseLimit(e.target.value)} placeholder="빈 값=무제한" />
                </div>
              </div>

              {editing && (
                <div className="flex items-center gap-2 p-2 bg-slate-50 rounded-xl">
                  <input type="checkbox" id="formActive" checked={formActive} onChange={e => setFormActive(e.target.checked)} />
                  <label htmlFor="formActive" className="font-bold text-slate-600">활성화</label>
                </div>
              )}

              <div className="pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-bold text-slate-700">질문 ({formQuestions.length}개)</h4>
                  <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={nextRequired}
                      onChange={e => setNextRequired(e.target.checked)}
                      className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                    />
                    추가할 문항을 <span className={nextRequired ? 'text-indigo-600' : 'text-slate-400'}>필수</span>로 설정
                  </label>
                </div>
                <div className="flex flex-wrap gap-1 mb-3">
                  {(Object.keys(QUESTION_TYPE_LABEL) as QuestionType[]).map(t => (
                    <Tooltip key={t} content={QUESTION_TYPE_TOOLTIP[t]} delay={200}>
                      <Button size="sm" variant="flat" className="rounded-lg text-[10px] h-7 px-2" onClick={() => addQuestion(t)}>
                        + {QUESTION_TYPE_LABEL[t]}{nextRequired && <span className="text-red-500 ml-0.5">*</span>}
                      </Button>
                    </Tooltip>
                  ))}
                </div>
                <div className="space-y-2">
                  {formQuestions.map((q, idx) => (
                    <div key={q.id} className="border border-slate-200 rounded-xl p-3 bg-slate-50/40">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10px] font-bold text-indigo-600">Q{idx + 1}</span>
                        <Chip size="sm" variant="flat" className="text-[9px] h-4 px-1.5">{QUESTION_TYPE_LABEL[q.type]}</Chip>
                        <div className="flex-1" />
                        <Button size="sm" variant="light" isIconOnly className="w-6 h-6 min-w-0" onClick={() => moveQuestion(idx, -1)}><ArrowUp className="w-3 h-3" /></Button>
                        <Button size="sm" variant="light" isIconOnly className="w-6 h-6 min-w-0" onClick={() => moveQuestion(idx, 1)}><ArrowDown className="w-3 h-3" /></Button>
                        <Button size="sm" variant="light" color="danger" isIconOnly className="w-6 h-6 min-w-0" onClick={() => removeQuestion(idx)}><Trash2 className="w-3 h-3" /></Button>
                      </div>
                      <Input size="sm" placeholder="질문 라벨" value={q.label} onChange={e => updateQuestion(idx, { label: e.target.value })} />
                      {(q.type === 'single' || q.type === 'multi') && (
                        <textarea
                          className="mt-2 w-full border border-slate-200 rounded-lg p-2 text-[11px] font-mono"
                          rows={3}
                          placeholder="선택지 한 줄에 하나씩"
                          value={(q.options || []).join('\n')}
                          onChange={e => updateQuestion(idx, { options: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) })}
                        />
                      )}
                      {q.type === 'rating' && (
                        <div className="mt-2 flex items-center gap-2">
                          <label className="text-[11px] font-bold text-slate-600">척도 최댓값</label>
                          <Input size="sm" type="number" className="w-20" value={String(q.scale || 5)}
                            onChange={e => updateQuestion(idx, { scale: Math.max(2, Math.min(10, Number(e.target.value) || 5)) })} />
                        </div>
                      )}
                      <label className="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-slate-600">
                        <input type="checkbox" checked={q.required} onChange={e => updateQuestion(idx, { required: e.target.checked })} />
                        필수 응답
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 flex gap-2">
              <Button variant="flat" className="flex-1 rounded-xl" onClick={closeDrawer}>취소</Button>
              <Button color="primary" className="flex-1 rounded-xl font-bold" onClick={handleSave} disabled={isSaving}>
                {isSaving ? '저장 중...' : (editing ? '저장' : '생성')}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Results inline panel (대시보드 내) — 3탭: 통계 / 문항별 / 개별 */}
      {resultsView && (
        <ResultsPanel
          data={resultsView}
          tab={resultsTab}
          setTab={setResultsTab}
          idx={individualIdx}
          setIdx={setIndividualIdx}
          onClose={() => setResultsView(null)}
        />
      )}
    </>
  );
}

// ───────────────────────────────────────────────────────────
// Results panel: 통계 / 문항별 / 개별 응답 (Google Forms 스타일)
// ───────────────────────────────────────────────────────────
interface ResultsPanelProps {
  data: { survey: any; responses: any[] };
  tab: 'summary' | 'byQuestion' | 'individual';
  setTab: (t: 'summary' | 'byQuestion' | 'individual') => void;
  idx: number;
  setIdx: (n: number) => void;
  onClose: () => void;
}

function answerToString(q: Question, v: any): string {
  if (v === null || v === undefined || v === '') return '';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return `[${v.zonecode || ''}] ${v.address || ''} ${v.detail || ''}`.trim();
  return String(v);
}

function ResultsPanel({ data, tab, setTab, idx, setIdx, onClose }: ResultsPanelProps) {
  const { survey, responses } = data;
  const questions: Question[] = survey.survey_config.questions || [];
  const total = responses.length;

  // 집계 — 단일/다중/만족도만 그래프, 텍스트류는 응답 수만
  const aggregate = (q: Question) => {
    if (q.type === 'single' || q.type === 'multi') {
      const counts: Record<string, number> = {};
      (q.options || []).forEach(o => counts[o] = 0);
      let answered = 0;
      responses.forEach(r => {
        const v = r.answers[q.id];
        if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) return;
        answered++;
        const vals = Array.isArray(v) ? v : [v];
        vals.forEach((x: string) => { counts[x] = (counts[x] || 0) + 1; });
      });
      return { kind: 'choice' as const, counts, answered };
    }
    if (q.type === 'rating') {
      const scale = q.scale || 5;
      const counts: Record<number, number> = {};
      for (let i = 1; i <= scale; i++) counts[i] = 0;
      let sum = 0, answered = 0;
      responses.forEach(r => {
        const v = Number(r.answers[q.id]);
        if (!v) return;
        counts[v] = (counts[v] || 0) + 1;
        sum += v; answered++;
      });
      return { kind: 'rating' as const, counts, answered, avg: answered ? sum / answered : 0, scale };
    }
    // text-like
    const answered = responses.filter(r => {
      const v = r.answers[q.id];
      return v !== undefined && v !== null && v !== '' && !(typeof v === 'object' && !v.address && !v.zonecode);
    }).length;
    return { kind: 'text' as const, answered };
  };

  const current = responses[idx];

  return (
    <div id="survey-results-panel" className="mt-6 bg-white border border-slate-100 rounded-3xl shadow-sm overflow-hidden">
      <div className="p-5 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h3 className="font-bold text-base text-slate-800">{survey.title} — 응답 결과</h3>
          <p className="text-[11px] text-slate-400 mt-0.5">총 {total}건</p>
        </div>
        <div className="flex items-center gap-2">
          <Tooltip content="전체 응답을 한글 CSV(UTF-8)로 다운로드" delay={200}>
            <Button size="sm" variant="flat" startContent={<Download className="w-3.5 h-3.5" />}
              onClick={() => window.open(`/api/surveys/${survey.id}/responses.csv`, '_blank')}>
              CSV 다운로드
            </Button>
          </Tooltip>
          <Tooltip content="결과 패널 닫기" delay={200}>
            <Button size="sm" variant="light" isIconOnly onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </Tooltip>
        </div>
      </div>

      {/* 탭 헤더 */}
      <div className="px-5 pt-3 border-b border-slate-100">
        <div className="flex gap-1">
          {[
            { k: 'summary', label: '통계', tip: '응답 수 / 질문 수 / 선택지·만족도 분포 그래프' },
            { k: 'byQuestion', label: '문항별 응답', tip: '질문 한 개에 대한 모든 응답을 한 번에 보기' },
            { k: 'individual', label: '개별 응답', tip: '응답자 1명의 전체 답변을 한 페이지로 보기' },
          ].map(t => (
            <Tooltip key={t.k} content={t.tip} delay={200}>
              <button
                onClick={() => setTab(t.k as any)}
                className={`px-4 py-2 text-xs font-bold rounded-t-lg border-b-2 transition-colors ${
                  tab === t.k
                    ? 'text-indigo-600 border-indigo-600 bg-indigo-50/50'
                    : 'text-slate-500 border-transparent hover:text-slate-700'
                }`}
              >
                {t.label}
              </button>
            </Tooltip>
          ))}
        </div>
      </div>

      {total === 0 ? (
        <div className="text-center py-16 text-xs text-slate-400">아직 응답이 없습니다.</div>
      ) : (
        <div className="p-5 max-h-[640px] overflow-y-auto">
          {/* === 통계 탭 === */}
          {tab === 'summary' && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="bg-blue-50 rounded-2xl p-4 text-center">
                  <div className="text-2xl font-extrabold text-blue-700">{total}</div>
                  <div className="text-[11px] text-blue-600 font-bold mt-1">총 응답</div>
                </div>
                <div className="bg-emerald-50 rounded-2xl p-4 text-center">
                  <div className="text-2xl font-extrabold text-emerald-700">{questions.length}</div>
                  <div className="text-[11px] text-emerald-600 font-bold mt-1">질문 수</div>
                </div>
                <div className="bg-purple-50 rounded-2xl p-4 text-center">
                  <div className="text-2xl font-extrabold text-purple-700">
                    {total > 0 ? formatDate(responses[0].submitted_at).split(' ')[0] : '-'}
                  </div>
                  <div className="text-[11px] text-purple-600 font-bold mt-1">최근 응답</div>
                </div>
              </div>
              {questions.map((q, qi) => {
                const agg = aggregate(q);
                return (
                  <div key={q.id} className="border border-slate-100 rounded-2xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="font-bold text-slate-800 text-sm">{qi + 1}. {q.label}</div>
                      <span className="text-[10px] text-slate-400 font-bold">응답 {agg.answered}건</span>
                    </div>
                    {agg.kind === 'choice' && (
                      <ChoiceBars counts={agg.counts} total={agg.answered} />
                    )}
                    {agg.kind === 'rating' && (
                      <div>
                        <div className="text-[11px] text-slate-500 mb-2">
                          평균 <span className="font-extrabold text-indigo-600 text-sm">{agg.avg.toFixed(2)}</span> / {agg.scale}
                        </div>
                        <ChoiceBars
                          counts={Object.fromEntries(Object.entries(agg.counts).map(([k,v])=>[`${k}점`,v]))}
                          total={agg.answered}
                        />
                      </div>
                    )}
                    {agg.kind === 'text' && (
                      <p className="text-[11px] text-slate-400">텍스트 응답은 "문항별 응답" 탭에서 전체를 확인하세요.</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* === 문항별 응답 탭 === */}
          {tab === 'byQuestion' && (
            <div className="space-y-4">
              {questions.map((q, qi) => (
                <div key={q.id} className="border border-slate-100 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
                    <div className="font-bold text-slate-800 text-sm">{qi + 1}. {q.label}</div>
                    <Chip size="sm" variant="flat" className="text-[10px] h-5 px-2">{QUESTION_TYPE_LABEL[q.type]}</Chip>
                  </div>
                  <div className="space-y-1.5 max-h-64 overflow-y-auto">
                    {responses.map(r => {
                      const s = answerToString(q, r.answers[q.id]);
                      return (
                        <div key={r.id} className="flex items-start gap-3 text-xs py-1.5 px-2 rounded-lg hover:bg-slate-50">
                          <span className="text-[10px] text-slate-400 font-mono whitespace-nowrap pt-0.5">{formatDate(r.submitted_at)}</span>
                          <span className={`flex-1 ${s ? 'text-slate-700' : 'text-slate-300 italic'}`}>{s || '(무응답)'}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* === 개별 응답 탭 === */}
          {tab === 'individual' && current && (
            <div>
              <div className="flex items-center justify-between mb-4 bg-slate-50 rounded-2xl p-3">
                <Button size="sm" variant="flat" isDisabled={idx <= 0} onClick={() => setIdx(Math.max(0, idx - 1))}>
                  ← 이전
                </Button>
                <div className="text-center">
                  <div className="text-sm font-bold text-slate-800">응답 #{idx + 1} / {total}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">제출: {formatDate(current.submitted_at)}</div>
                </div>
                <Button size="sm" variant="flat" isDisabled={idx >= total - 1} onClick={() => setIdx(Math.min(total - 1, idx + 1))}>
                  다음 →
                </Button>
              </div>
              <div className="space-y-3">
                {questions.map((q, qi) => {
                  const v = current.answers[q.id];
                  const s = answerToString(q, v);
                  return (
                    <div key={q.id} className="border border-slate-100 rounded-2xl p-4">
                      <div className="text-[11px] text-slate-400 font-bold mb-1">{qi + 1}. {QUESTION_TYPE_LABEL[q.type]}</div>
                      <div className="font-semibold text-slate-700 text-sm mb-2">{q.label}</div>
                      <div className={`text-sm ${s ? 'text-indigo-700 font-medium' : 'text-slate-300 italic'}`}>
                        {s || '(무응답)'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChoiceBars({ counts, total }: { counts: Record<string, number>; total: number }) {
  const entries = Object.entries(counts);
  const max = Math.max(...entries.map(([, n]) => n), 1);
  return (
    <div className="space-y-1.5">
      {entries.map(([label, n]) => {
        const pct = total > 0 ? Math.round((n / total) * 100) : 0;
        const w = max > 0 ? (n / max) * 100 : 0;
        return (
          <div key={label} className="flex items-center gap-3 text-xs">
            <div className="w-24 truncate text-slate-600 font-medium" title={label}>{label}</div>
            <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
              <div className="bg-indigo-500 h-full rounded-full transition-all" style={{ width: `${w}%` }} />
            </div>
            <div className="w-20 text-right text-slate-700 font-bold">
              {n}<span className="text-slate-400 font-normal"> ({pct}%)</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
