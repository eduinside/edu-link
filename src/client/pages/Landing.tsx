// src/client/pages/Landing.tsx
import React, { useState, useEffect } from 'react';
import { 
  Button, 
  Card, 
  CardContent, 
  Chip
} from '@heroui/react';
import { 
  Link2, 
  Send, 
  Copy, 
  ExternalLink, 
  Check, 
  Sparkles, 
  Info,
  ShieldCheck,
  Zap,
  Globe,
  Pin,
  Megaphone,
  ChevronDown,
  ChevronUp,
  Share2,
  Lock,
  LogIn
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface PublicLink {
  slug: string;
  custom_slug: string | null;
  title: string | null;
  original_url: string;
  created_at: string;
}

interface Notice {
  id: number;
  title: string;
  content: string;
  is_pinned: number;
  created_at: string;
}

interface User {
  id: number;
  email: string;
  name: string;
  role: string;
}

export default function Landing() {
  const navigate = useNavigate();
  
  // 로그인 회원 상태 관리
  const [user, setUser] = useState<User | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null); // null = 로딩 상태

  const [url, setUrl] = useState('');
  const [slugType, setSlugType] = useState<'random' | 'custom'>('random');
  const [customSlug, setCustomSlug] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<{ short_url: string; slug: string; original_url: string } | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  
  // 모달 상태
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);

  // 이메일 OTP 로그인 상태
  const [loginEmail, setLoginEmail] = useState('');
  const [loginName, setLoginName] = useState('');
  const [isExistingUser, setIsExistingUser] = useState<boolean | null>(null);
  const [existingUserName, setExistingUserName] = useState('');
  const [isCheckingEmail, setIsCheckingEmail] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [debugOtp, setDebugOtp] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // 이메일 존재 여부 확인 (blur 또는 submit 시)
  const checkEmailExists = async (email: string) => {
    if (!email || !email.includes('@')) return;
    setIsCheckingEmail(true);
    try {
      const res = await fetch(`/api/auth/check-email?email=${encodeURIComponent(email.trim().toLowerCase())}`);
      const data = await res.json();
      setIsExistingUser(data.exists);
      if (data.exists && data.name) setExistingUserName(data.name);
    } catch {}
    setIsCheckingEmail(false);
  };

  // 이메일 OTP 전송
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail) return;
    setAuthLoading(true);
    setAuthError('');

    // 이메일 체크가 아직 안 된 경우 먼저 체크
    let existingCheck = isExistingUser;
    if (existingCheck === null) {
      try {
        const res = await fetch(`/api/auth/check-email?email=${encodeURIComponent(loginEmail.trim().toLowerCase())}`);
        const data = await res.json();
        existingCheck = data.exists;
        setIsExistingUser(data.exists);
        if (data.exists && data.name) setExistingUserName(data.name);
      } catch {
        setAuthError('서버 통신 실패');
        setAuthLoading(false);
        return;
      }
    }
    if (!existingCheck && !loginName.trim()) {
      setAuthError('신규 가입 사용자는 이름을 입력해주세요.');
      setAuthLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/auth/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, name: loginName || undefined })
      });
      const data = await res.json();
      if (data.success) {
        setOtpSent(true);
        if (data.debug_otp) setDebugOtp(data.debug_otp);
      } else {
        setAuthError(data.error || 'OTP 전송에 실패했습니다.');
      }
    } catch {
      setAuthError('서버 통신 실패');
    } finally {
      setAuthLoading(false);
    }
  };

  // 이메일 OTP 검증 및 로그인
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode) return;
    setAuthLoading(true);
    setAuthError('');
    try {
      const res = await fetch('/api/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, code: otpCode })
      });
      const data = await res.json();
      if (data.success) {
        setShowAuthModal(false);
        setOtpSent(false);
        setLoginEmail('');
        setLoginName('');
        setIsExistingUser(null);
        setExistingUserName('');
        setOtpCode('');
        setDebugOtp('');
        
        setUser(data.user);
        setIsLoggedIn(true);
        navigate('/dashboard');
      } else {
        setAuthError(data.error || '인증번호가 올바르지 않습니다.');
      }
    } catch {
      setAuthError('서버 통신 실패');
    } finally {
      setAuthLoading(false);
    }
  };

  // 로그아웃
  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setUser(null);
      setIsLoggedIn(false);
    } catch (e) {
      console.error('로그아웃 에러:', e);
    }
  };

  const [publicLinks, setPublicLinks] = useState<PublicLink[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [expandedNoticeId, setExpandedNoticeId] = useState<number | null>(null);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  // 로그인 상태 확인
  const checkAuth = async () => {
    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();
      if (data.success) {
        setUser(data.user);
        setIsLoggedIn(true);
      } else {
        setUser(null);
        setIsLoggedIn(false);
      }
    } catch {
      setUser(null);
      setIsLoggedIn(false);
    }
  };

  // 최근 공개 링크 목록 불러오기
  const fetchPublicLinks = async () => {
    try {
      const res = await fetch('/api/links/public');
      const data = await res.json();
      if (data.success) {
        setPublicLinks(data.links);
      }
    } catch (e) {
      console.error('공개 링크 조회 실패:', e);
    }
  };

  // 공지사항 불러오기
  const fetchNotices = async () => {
    try {
      const res = await fetch('/api/notices');
      const data = await res.json();
      if (data.success) {
        setNotices(data.notices);
      }
    } catch (e) {
      console.error('공지사항 조회 실패:', e);
    }
  };

  useEffect(() => {
    checkAuth();
    fetchPublicLinks();
    fetchNotices();
  }, []);


  const handleShorten = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;

    // 비로그인 상태일 시 차단하고 로그인 안내 모달 띄우기
    if (!isLoggedIn) {
      setShowLoginModal(true);
      return;
    }

    setIsLoading(true);
    setError('');
    setResult(null);
    setCopied(false);

    try {
      const payload: any = { original_url: url };
      if (slugType === 'custom' && customSlug) {
        payload.slug = customSlug;
      }

      const res = await fetch('/api/links', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (data.success) {
        setResult({
          short_url: data.short_url,
          slug: data.slug,
          original_url: data.original_url
        });
        setUrl('');
        setCustomSlug('');
        fetchPublicLinks(); // 목록 갱신
      } else {
        setError(data.error || '단축 URL 생성 중 에러가 발생했습니다.');
      }
    } catch (e) {
      setError('서버 연결에 실패했습니다. 다시 시도해 주세요.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.short_url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyPublicLink = (slug: string, shortUrl: string) => {
    navigator.clipboard.writeText(shortUrl);
    setCopiedSlug(slug);
    setTimeout(() => setCopiedSlug(null), 2000);
  };

  const getDomain = (urlStr: string) => {
    try {
      return new URL(urlStr).hostname;
    } catch {
      return urlStr;
    }
  };

  const formatDate = (dateStr: string) => {
    const utc = dateStr.replace(' ', 'T') + (dateStr.includes('Z') || dateStr.includes('+') ? '' : 'Z');
    return new Date(utc).toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
  };

  return (
    <div className="gemini-gradient-bg min-h-screen flex flex-col justify-between relative">
      
      {/* GNB (헤더) */}
      <header className="w-full max-w-7xl mx-auto px-6 py-4 flex items-center justify-between z-10">
        <div className="flex items-center gap-2.5">
          <img 
            src="/edulink_logo.png" 
            alt="에듀링크 로고" 
            className="w-8 h-8 rounded-xl shadow-md border border-indigo-50/50 object-cover" 
          />
          <span className="font-display font-black text-xl tracking-tight bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
            에듀링크
          </span>
        </div>

        <div className="flex items-center gap-3">
          <Chip size="sm" variant="flat" color="secondary" className="px-2 font-medium">
            korea.kr / dge.go.kr 전용
          </Chip>
          
          {isLoggedIn ? (
            <div className="flex items-center gap-2">
              <Button 
                size="sm" 
                variant="light" 
                color="danger"
                className="font-medium rounded-full"
                onClick={handleLogout}
              >
                로그아웃
              </Button>
              <Button 
                size="sm" 
                color="primary"
                className="font-bold rounded-full shadow-sm"
                onClick={() => navigate('/dashboard')}
              >
                대시보드 바로가기
              </Button>
            </div>
          ) : (
            <Button 
              size="sm" 
              variant="ghost" 
              color="primary"
              className="font-medium rounded-full"
              onClick={() => setShowAuthModal(true)}
            >
              대시보드 로그인
            </Button>
          )}
        </div>
      </header>

      {/* 메인 히어로 영역 */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 max-w-5xl mx-auto w-full z-10 py-12 gap-16">
        
        {/* 입력 및 변환 섹션 */}
        <div className="flex flex-col items-center w-full max-w-3xl">
          <div className="text-center mb-8 space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/60 backdrop-blur-md border border-white/40 text-xs font-semibold text-indigo-700 shadow-sm">
              <Sparkles className="w-3.5 h-3.5" />
              <span>스마트 단축주소 플랫폼</span>
            </div>
            <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-slate-800 font-display">
              에듀링크에서 어떤 링크를 단축할까요?
            </h1>
            <p className="text-sm md:text-base text-slate-500 max-w-lg mx-auto">
              긴 주소를 입력하면 가독성이 좋고 안전한 짧은 도메인(<span className="font-semibold text-indigo-600 font-display">dgedu.link</span>)으로 변환해 드립니다.
            </p>
          </div>

          {/* Gemini 스타일 대화형 입력 바 (텍스트 크기 확대) */}
          <form onSubmit={handleShorten} className="w-full">
            <div className="glassmorphism p-2 rounded-3xl shadow-xl flex flex-col gap-2 transition-all duration-300 focus-within:shadow-indigo-100/55 focus-within:border-indigo-200">
              
              {/* 상단 입력 라인 (텍스트 크기 text-lg로 확대) */}
              <div className="flex items-center gap-3.5 px-3 py-1.5">
                <Link2 className="text-slate-400 w-6 h-6 flex-shrink-0" />
                <input 
                  type="url"
                  required
                  placeholder="단축할 원본 주소(URL)를 입력하세요..." 
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="w-full bg-transparent border-none outline-none text-slate-800 placeholder-slate-400 text-lg font-medium py-1"
                />
              </div>

              {/* 조건부 직접 입력 슬러그 필드 (줄바꿈 방지 및 flex-nowrap) */}
              {slugType === 'custom' && (
                <div className="px-3 pb-2.5 border-t border-slate-100/80 pt-3 flex items-center gap-2 flex-nowrap w-full">
                  <span className="text-sm font-extrabold text-indigo-600 font-display whitespace-nowrap select-none">
                    dgedu.link/
                  </span>
                  <input
                    type="text"
                    required
                    placeholder="커스텀 슬러그 (4~20자 영숫자/한글/하이픈)"
                    value={customSlug}
                    onChange={(e) => setCustomSlug(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-indigo-400 focus:bg-white transition-all"
                  />
                </div>
              )}

              {/* 하단 컨트롤 바 */}
              <div className="flex items-center justify-between border-t border-slate-100/60 pt-2 px-2">
                {/* 칩/토글 형태의 세미 세그먼티드 컨트롤 */}
                <div className="flex items-center gap-1.5 p-0.5 bg-slate-100/80 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setSlugType('random')}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all duration-200 cursor-pointer select-none
                      ${slugType === 'random' 
                        ? 'bg-white text-indigo-700 shadow-sm' 
                        : 'text-slate-500 hover:text-slate-800 hover:bg-white/40'
                      }
                    `}
                  >
                    ⚡ 6자 랜덤 슬러그
                  </button>
                  <button
                    type="button"
                    onClick={() => setSlugType('custom')}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all duration-200 cursor-pointer select-none
                      ${slugType === 'custom' 
                        ? 'bg-white text-indigo-700 shadow-sm' 
                        : 'text-slate-500 hover:text-slate-800 hover:bg-white/40'
                      }
                    `}
                  >
                    ✏️ 직접 입력
                  </button>
                </div>

                {/* 전송 버튼 */}
                <Button 
                  type="submit"
                  color={isLoggedIn === false ? 'default' : 'primary'} 
                  size="sm"
                  isIconOnly
                  isLoading={isLoading}
                  className="rounded-full shadow-md shadow-primary/20 hover:scale-105 transition-transform"
                >
                  {isLoggedIn === false ? <Lock className="w-3.5 h-3.5 text-slate-400" /> : <Send className="w-3.5 h-3.5" />}
                </Button>
              </div>

            </div>
          </form>

          {/* 에러 노출 */}
          {error && (
            <div className="mt-4 p-3 rounded-2xl bg-danger-50 border border-danger-100 text-xs text-danger-600 flex items-center gap-2 w-full max-w-2xl">
              <Info className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* 생성 결과 카드 (텍스트 크기 확대) */}
          {result && (
            <Card className="w-full max-w-xl mt-8 border border-emerald-100 shadow-lg bg-emerald-50/20 backdrop-blur-md overflow-hidden rounded-3xl animate-fade-in">
              <CardContent className="p-6">
                <div className="flex items-center gap-2 text-emerald-700 text-xs font-semibold mb-3">
                  <ShieldCheck className="w-4 h-4" />
                  <span>단축주소가 정상적으로 발행되었습니다</span>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-slate-400 font-semibold">변환된 짧은 주소</span>
                  <div className="flex items-center justify-between bg-white border border-slate-100 p-4 rounded-2xl shadow-sm">
                    {/* 결과 텍스트 크기를 text-2xl font-black으로 대폭 상향 */}
                    <a 
                      href={result.short_url} 
                      target="_blank" 
                      rel="noreferrer"
                      className="font-display font-black text-2xl text-indigo-600 hover:underline flex items-center gap-2 break-all"
                    >
                      {result.short_url.replace(/^https?:\/\//, '')}
                      <ExternalLink className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                    </a>
                    <Button
                      size="md"
                      color={copied ? 'success' : 'primary'}
                      variant={copied ? 'flat' : 'light'}
                      onClick={handleCopy}
                      isIconOnly
                      className="rounded-xl flex-shrink-0 ml-2 w-10 h-10 min-w-0"
                    >
                      {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                    </Button>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 text-xs text-slate-500 break-all">
                  <span className="font-semibold">원본 대상 URL: </span>
                  <span className="font-mono text-slate-400">{result.original_url}</span>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* 2단 구성: 좌측 공유페이지 카드 그리드 / 우측 공지사항 공간 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 w-full">
          
          {/* 좌측 2개 컬럼: 사용자들이 공유한 페이지 목록 */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="bg-indigo-50 p-2 rounded-xl text-indigo-600">
                  <Share2 className="w-4 h-4" />
                </div>
                <h3 className="text-base font-bold text-slate-800">공유된 페이지 목록</h3>
              </div>
              <Chip size="sm" variant="flat" color="default" className="text-slate-500 font-semibold">
                최근 {publicLinks.length}개 링크
              </Chip>
            </div>

            {publicLinks.length === 0 ? (
              <Card className="bg-white/40 border border-slate-200/30 shadow-none rounded-3xl py-12">
                <CardContent className="text-center flex flex-col items-center gap-2">
                  <Globe className="w-10 h-10 text-slate-300" />
                  <span className="text-xs text-slate-400 font-medium">아직 공개로 공유된 단축주소가 없습니다.</span>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {publicLinks.map((link) => {
                  const effectiveSlug = link.custom_slug || link.slug;
                  const shortUrl = `${window.location.protocol}//${window.location.host}/${effectiveSlug}`;
                  const isLinkCopied = copiedSlug === effectiveSlug;
                  return (
                    <Card key={link.slug} className="bg-white border border-slate-100 shadow-sm hover:shadow-md hover:border-indigo-100 transition-all duration-300 rounded-2xl group overflow-hidden">
                      <CardContent className="p-4 flex flex-col justify-between h-full gap-3">
                        <div className="space-y-1">
                          {link.title && (
                            <p className="text-xs font-bold text-slate-700 truncate w-full" title={link.title}>
                              {link.title}
                            </p>
                          )}
                          <span className="font-display font-extrabold text-lg text-indigo-600 break-all">
                            /{effectiveSlug}
                          </span>
                          <p className="text-[10px] font-mono text-slate-400 truncate w-full" title={link.original_url}>
                            {getDomain(link.original_url)}
                          </p>
                        </div>

                        <div className="flex items-center justify-between border-t border-slate-50 pt-2.5 mt-1">
                          <span className="text-[9px] text-slate-400 font-medium">
                            {formatDate(link.created_at)}
                          </span>

                          <div className="flex gap-1.5 opacity-90 group-hover:opacity-100 transition-opacity">
                            <Button
                              size="sm"
                              variant="light"
                              color={isLinkCopied ? 'success' : 'default'}
                              isIconOnly
                              className="w-7 h-7 min-w-0 p-0 rounded-lg"
                              onClick={() => handleCopyPublicLink(effectiveSlug, shortUrl)}
                            >
                              {isLinkCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5 text-slate-500" />}
                            </Button>
                            <Button
                              size="sm"
                              variant="light"
                              color="primary"
                              isIconOnly
                              className="w-7 h-7 min-w-0 p-0 rounded-lg"
                              onClick={() => window.open(`/${effectiveSlug}`, '_blank')}
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>

          {/* 우측 1개 컬럼: 공지사항 공간 */}
          <div className="flex flex-col gap-6">
            <div className="flex items-center gap-2">
              <div className="bg-purple-50 p-2 rounded-xl text-purple-600">
                <Megaphone className="w-4 h-4" />
              </div>
              <h3 className="text-base font-bold text-slate-800 font-sans">에듀링크 알림판</h3>
            </div>

            <div className="flex flex-col gap-3">
              {notices.map((notice) => {
                const isExpanded = expandedNoticeId === notice.id;
                return (
                  <Card 
                    key={notice.id} 
                    id={`notice-card-${notice.id}`}
                    className={`border transition-all duration-300 rounded-2xl cursor-pointer shadow-sm
                      ${notice.is_pinned ? 'bg-amber-50/20 border-amber-100' : 'bg-white border-slate-100'}
                      ${isExpanded ? 'ring-1 ring-indigo-200 border-indigo-200' : ''}
                    `}
                    onClick={() => setExpandedNoticeId(isExpanded ? null : notice.id)}
                  >
                    <CardContent className="p-4 flex flex-col gap-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {notice.is_pinned === 1 && (
                              <Chip 
                                size="sm" 
                                color="warning" 
                                variant="flat" 
                                startContent={<Pin className="w-3 h-3 flex-shrink-0" />}
                                className="px-1 py-0 h-5 text-[9px] font-bold text-amber-700"
                              >
                                중요
                              </Chip>
                            )}
                            <span className="text-[10px] text-slate-400 font-medium">
                              {formatDate(notice.created_at)}
                            </span>
                          </div>
                          <h4 className="text-xs font-bold text-slate-700 leading-tight">
                            {notice.title}
                          </h4>
                        </div>
                        <Button
                          size="sm"
                          variant="light"
                          isIconOnly
                          className="w-6 h-6 min-w-0 p-0 rounded-full"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedNoticeId(isExpanded ? null : notice.id);
                          }}
                        >
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
                        </Button>
                      </div>

                      {/* 확장 시 내용 표시 */}
                      {isExpanded && (
                        <div className="mt-2 pt-2.5 border-t border-slate-100 text-[11px] text-slate-600 leading-relaxed whitespace-pre-line animate-fade-in">
                          {notice.content}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>

        </div>

      </main>

      {/* 🔐 로그인 요구 안내 모달 */}
      {showLoginModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="max-w-sm w-full border border-slate-200/40 shadow-2xl rounded-3xl p-2 bg-white animate-fade-in">
            <CardContent className="p-6 text-center flex flex-col items-center gap-4">
              <div className="bg-amber-50 p-4 rounded-2xl text-amber-500">
                <Lock className="w-10 h-10" />
              </div>
              
              <div className="space-y-1.5">
                <h3 className="font-extrabold text-base text-slate-800">로그인이 필요합니다</h3>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  단축주소 생성 권한은 <strong>(2)단계 인증 사용자</strong> 이상만 부여됩니다. 계속 진행하시려면 로그인하시기 바랍니다.
                </p>
              </div>

              <div className="flex gap-2.5 w-full pt-2">
                <Button
                  size="sm"
                  variant="flat"
                  color="default"
                  className="flex-1 rounded-xl font-bold"
                  onClick={() => setShowLoginModal(false)}
                >
                  닫기
                </Button>
                <Button
                  size="sm"
                  color="primary"
                  className="flex-1 rounded-xl font-bold shadow-md shadow-primary/10"
                  startContent={<LogIn className="w-4 h-4" />}
                  onClick={() => {
                    setShowLoginModal(false);
                    setShowAuthModal(true);
                  }}
                >
                  로그인하기
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 🔐 통합 로그인 모달 (카카오 + 이메일 OTP) */}
      {showAuthModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="max-w-md w-full border border-slate-200/40 shadow-2xl rounded-3xl overflow-hidden bg-white animate-fade-in">
            <div className="bg-indigo-600 px-6 py-5 text-white flex items-center gap-3">
              <LogIn className="w-5 h-5" />
              <div>
                <h3 className="font-bold text-sm">에듀링크 로그인</h3>
                <p className="text-[10px] text-indigo-200">교육기관 임직원 전용 서비스입니다.</p>
              </div>
            </div>

            <CardContent className="p-6 space-y-4">
              {authError && (
                <div className="p-3 bg-danger-50 border border-danger-100 rounded-xl text-[10px] text-danger-600 font-bold">
                  {authError}
                </div>
              )}

              {!otpSent ? (
                <form onSubmit={handleSendOtp} className="space-y-3.5">
                  {/* 이메일 입력 */}
                  <div className="space-y-1.5 text-xs">
                    <label className="font-bold text-slate-600">이메일 주소</label>
                    <input
                      type="email"
                      required
                      placeholder="email@example.com"
                      value={loginEmail}
                      onChange={(e) => {
                        setLoginEmail(e.target.value);
                        setIsExistingUser(null);
                        setExistingUserName('');
                      }}
                      onBlur={() => checkEmailExists(loginEmail)}
                      className="w-full border border-slate-200 bg-slate-50 focus:bg-white focus:border-indigo-400 outline-none rounded-xl px-3.5 py-2 text-xs text-slate-800 transition-all"
                    />
                    {isCheckingEmail && (
                      <p className="text-[9px] text-slate-400">이메일 확인 중...</p>
                    )}
                    {isExistingUser === true && !isCheckingEmail && (
                      <div className="flex items-center gap-1.5 text-[10px] text-emerald-600 font-bold">
                        <Check className="w-3 h-3" />
                        기존 사용자 — {existingUserName}님으로 로그인합니다
                      </div>
                    )}
                    {isExistingUser === false && !isCheckingEmail && (
                      <p className="text-[10px] text-indigo-600 font-semibold">✨ 신규 가입 — 아래에 성함을 입력해주세요</p>
                    )}
                    <span className="text-[9px] text-slate-400 font-medium leading-normal">
                      💡 화이트리스트 도메인(korea.kr, dge.go.kr 등) 메일은 <strong>2단계 인증사용자</strong>로 자동 승급됩니다.
                    </span>
                  </div>

                  {/* 신규 사용자만 이름 입력 */}
                  {isExistingUser === false && (
                    <div className="space-y-1.5 text-xs">
                      <label className="font-bold text-slate-600">성함 (이름)</label>
                      <input
                        type="text"
                        required
                        placeholder="홍길동"
                        value={loginName}
                        onChange={(e) => setLoginName(e.target.value)}
                        className="w-full border border-slate-200 bg-slate-50 focus:bg-white focus:border-indigo-400 outline-none rounded-xl px-3.5 py-2 text-xs text-slate-800 transition-all"
                        autoFocus
                      />
                    </div>
                  )}

                  <Button
                    type="submit"
                    color="primary"
                    className="w-full rounded-xl font-bold py-5 text-xs shadow-md shadow-primary/20"
                    isLoading={authLoading}
                  >
                    OTP 코드 전송
                  </Button>
                </form>
              ) : (
                <form onSubmit={handleVerifyOtp} className="space-y-3.5">
                  <div className="space-y-2 text-center bg-indigo-50/50 border border-indigo-100 p-4 rounded-2xl">
                    <p className="text-[11px] text-indigo-700 font-bold">
                      {loginEmail} 주소로 인증코드가 발송되었습니다.
                    </p>
                    <p className="text-[10px] text-slate-400">
                      인증용 6자리 OTP 코드를 입력해 주세요. (5분 내 유효)
                    </p>
                    {debugOtp && (
                      <div className="mt-2 bg-amber-100 border border-amber-200 p-2 rounded-xl">
                        <span className="text-[10px] text-amber-800 font-bold">
                          🧪 모의 테스트 인증코드: <code className="bg-white px-1.5 py-0.5 rounded font-mono font-black">{debugOtp}</code>
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5 text-xs">
                    <label className="font-bold text-slate-600">인증코드 (6자리)</label>
                    <input
                      type="text"
                      required
                      maxLength={6}
                      placeholder="000000"
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/[^0-9]/g, ''))}
                      className="w-full text-center tracking-widest font-mono font-bold text-lg border border-slate-200 bg-slate-50 focus:bg-white focus:border-indigo-400 outline-none rounded-xl px-3.5 py-2 text-slate-800 transition-all"
                      autoFocus
                    />
                  </div>

                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="flat"
                      color="default"
                      className="rounded-xl font-bold text-xs"
                      onClick={() => { setOtpSent(false); setOtpCode(''); setAuthError(''); }}
                    >
                      이메일 변경
                    </Button>
                    <Button
                      type="submit"
                      color="primary"
                      className="flex-1 rounded-xl font-bold text-xs shadow-md shadow-primary/20"
                      isLoading={authLoading}
                    >
                      인증 완료 및 로그인
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>

            <div className="bg-slate-50 border-t border-slate-100 px-6 py-3.5 flex justify-end">
              <Button
                size="sm"
                variant="flat"
                color="default"
                className="rounded-xl font-bold"
                onClick={() => {
                  setShowAuthModal(false);
                  setOtpSent(false);
                  setLoginEmail('');
                  setLoginName('');
                  setIsExistingUser(null);
                  setExistingUserName('');
                  setOtpCode('');
                  setDebugOtp('');
                  setAuthError('');
                }}
              >
                취소
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* 푸터 */}
      <footer className="w-full py-6 text-center text-xs text-slate-400 border-t border-slate-200/20 z-10">
        <p>© 2026 에듀링크 (edu-link). All rights reserved.</p>
      </footer>

    </div>
  );
}
