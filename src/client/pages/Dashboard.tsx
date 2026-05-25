// src/client/pages/Dashboard.tsx
import React, { useState, useEffect, useRef } from 'react';
import { 
  Button, 
  Card, 
  CardContent, 
  Chip,
  Input,
  Tooltip
} from '@heroui/react';
import { 
  Link2, 
  Plus, 
  Copy, 
  ExternalLink, 
  Trash2, 
  Edit3, 
  Check, 
  LogOut, 
  BarChart3,
  TrendingUp,
  LayoutDashboard,
  KeyRound, 
  Settings,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  Info,
  ShieldCheck,
  Globe,
  Terminal,
  Eye,
  EyeOff,
  QrCode,
  User,
  BookOpen,
  Megaphone,
  ChevronDown,
  ChevronUp,
  LogIn
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface LinkItem {
  id: number;
  slug: string;
  base_slug: string;
  custom_slug: string | null;
  original_url: string;
  title: string;
  description: string;
  click_count: number;
  is_active: number;
  is_public: number; // 0: 비공개, 1: 공개
  expires_at: string | null;
  password: string | null;
  created_at: string;
}

interface ApiKeyItem {
  id: number;
  key_prefix: string;
  name: string;
  is_active: number;
  last_used_at: string | null;
  created_at: string;
}

interface User {
  id: number;
  email: string;
  name: string;
  affiliation?: string;
  level: number;
  created_at?: string;
}

interface Notice {
  id: number;
  title: string;
  content: string;
  is_pinned: number;
  created_at: string;
}

export default function Dashboard() {
  const navigate = useNavigate();

  // 현재일시를 YYYY-MM-DDTHH:MM 형식으로 반환하는 헬퍼
  // datetime-local input용 KST 문자열 반환 (offsetMs: 미래 오프셋)
  const getKSTDateTimeString = (offsetMs = 0) => {
    const kst = new Date(Date.now() + offsetMs + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 16);
  };
  const getCurrentDateTimeString = () => getKSTDateTimeString(0);

  // expires_at 모드 → UTC 문자열 변환 (서버 전송용)
  const resolveExpiresAt = (mode: string, customVal: string): string | null => {
    if (mode === '24h') return new Date(Date.now() + 24*60*60*1000).toISOString().replace('T',' ').split('.')[0];
    if (mode === '7d')  return new Date(Date.now() + 7*24*60*60*1000).toISOString().replace('T',' ').split('.')[0];
    if (mode === 'custom' && customVal) {
      // datetime-local 값(KST)을 UTC로 변환
      return new Date(customVal).toISOString().replace('T',' ').split('.')[0];
    }
    return null;
  };

  const [user, setUser] = useState<User | null>(null);
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<'links' | 'apikeys' | 'profile' | 'guide' | 'notices' | 'admin'>('links');
  
  // 새 단축 링크 상태
  const [newUrl, setNewUrl] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [isFetchingNewTitle, setIsFetchingNewTitle] = useState(false);
  const [newDesc, setNewDesc] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [useCustomSlug, setUseCustomSlug] = useState(false);
  const [newPublic, setNewPublic] = useState(false); // 기본 비공개
  const [newExpiresAt, setNewExpiresAt] = useState(getCurrentDateTimeString());
  const [newPassword, setNewPassword] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isCreateDrawerOpen, setIsCreateDrawerOpen] = useState(false);
  const [newExpiresMode, setNewExpiresMode] = useState<'none'|'24h'|'7d'|'custom'>('none');
  const [useNewPassword, setUseNewPassword] = useState(false);

  // QR 모달
  const [qrModalLink, setQrModalLink] = useState<LinkItem | null>(null);

  // 통계 드로어
  const [statsDrawerLink, setStatsDrawerLink] = useState<LinkItem | null>(null);
  const [statsData, setStatsData] = useState<{ daily_clicks: { date: string; clicks: number }[] } | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  
  // API Key 발급 상태
  const [newKeyName, setNewKeyName] = useState('');
  const [isGeneratingKey, setIsGeneratingKey] = useState(false);
  const [generatedKeyResult, setGeneratedKeyResult] = useState<string | null>(null);
  const [showKeyResultModal, setShowKeyResultModal] = useState(false);

  // 편집 상태
  const [editingLink, setEditingLink] = useState<LinkItem | null>(null);
  const [editUrl, setEditUrl] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [isFetchingEditTitle, setIsFetchingEditTitle] = useState(false);
  const [editDesc, setEditDesc] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [editPublic, setEditPublic] = useState(false);
  const [editExpiresAt, setEditExpiresAt] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [editExpiresMode, setEditExpiresMode] = useState<'none'|'24h'|'7d'|'custom'>('none');
  const [useEditPassword, setUseEditPassword] = useState(false);
  // 편집용 커스텀 슬러그
  const [useEditCustomSlug, setUseEditCustomSlug] = useState(false);
  const [editCustomSlugInput, setEditCustomSlugInput] = useState('');
  const [slugCheckState, setSlugCheckState] = useState<'idle' | 'checking' | 'ok' | 'taken' | 'invalid'>('idle');
  const [slugCheckMsg, setSlugCheckMsg] = useState('');

  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [keyResultCopied, setKeyResultCopied] = useState(false);

  // 최고관리자(admin) 전용 상태
  const [adminDomains, setAdminDomains] = useState<{id: number; domain: string; created_at: string}[]>([]);
  const [adminNotices, setAdminNotices] = useState<Notice[]>([]);
  const [newDomain, setNewDomain] = useState('');
  const [newNoticeTitle, setNewNoticeTitle] = useState('');
  const [newNoticeContent, setNewNoticeContent] = useState('');
  const [newNoticePinned, setNewNoticePinned] = useState(false);
  
  // 최고관리자용 사용자 관리 상태
  const [adminUsers, setAdminUsers] = useState<User[]>([]);

  // 개인정보수정 상태
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileAffiliation, setNewProfileAffiliation] = useState('');
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);

  // 활용방법 / 공지사항 상태
  const [dashboardNotices, setDashboardNotices] = useState<Notice[]>([]);
  const [expandedNoticeId, setExpandedNoticeId] = useState<number | null>(null);

  // 모의 테스트용 권한 상태
  const [mockRole, setMockRole] = useState<string | null>(localStorage.getItem('mock_role'));

  // URL → 제목 자동완성용 타이머 ref
  const newTitleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editTitleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // URL 입력 시 og:title / <title> 자동 완성
  const handleNewUrlChange = (url: string) => {
    setNewUrl(url);
    if (newTitleTimerRef.current) clearTimeout(newTitleTimerRef.current);
    if (!url) return;
    newTitleTimerRef.current = setTimeout(async () => {
      try { new URL(url); } catch { return; }
      setIsFetchingNewTitle(true);
      try {
        const res = await fetch(`/api/fetch-title?url=${encodeURIComponent(url)}`);
        const data = await res.json();
        if (data.success && data.title) {
          setNewTitle(prev => prev ? prev : data.title);
        }
      } catch { /* 무시 */ }
      setIsFetchingNewTitle(false);
    }, 800);
  };

  const handleEditUrlChange = (url: string) => {
    setEditUrl(url);
    if (editTitleTimerRef.current) clearTimeout(editTitleTimerRef.current);
    if (!url) return;
    editTitleTimerRef.current = setTimeout(async () => {
      try { new URL(url); } catch { return; }
      setIsFetchingEditTitle(true);
      try {
        const res = await fetch(`/api/fetch-title?url=${encodeURIComponent(url)}`);
        const data = await res.json();
        if (data.success && data.title) {
          setEditTitle(prev => prev ? prev : data.title);
        }
      } catch { /* 무시 */ }
      setIsFetchingEditTitle(false);
    }, 800);
  };

  // fetch 시 mock 헤더 주입용 헬퍼
  const getHeaders = (extra = {}) => {
    const headers: any = {
      'Content-Type': 'application/json',
      ...extra
    };
    if (mockRole) {
      headers['x-mock-role'] = mockRole;
    }
    return headers;
  };

  // 최고관리자 전용 데이터 로드
  const fetchAdminData = async () => {
    try {
      const headers = getHeaders();
      const resD = await fetch('/api/admin/domains', { headers });
      const dataD = await resD.json();
      if (dataD.success) setAdminDomains(dataD.domains);

      const resN = await fetch('/api/notices');
      const dataN = await resN.json();
      if (dataN.success) setAdminNotices(dataN.notices);
      
      const resU = await fetch('/api/admin/users', { headers });
      const dataU = await resU.json();
      if (dataU.success) setAdminUsers(dataU.users);
    } catch (e) {
      console.error('관리자 데이터 로드 실패', e);
    }
  };

  // 사용자 정보 조회
  const fetchUser = async () => {
    try {
      const res = await fetch('/api/auth/me', { headers: getHeaders() });
      const data = await res.json();
      if (data.success) {
        setUser(data.user);
        setNewProfileName(data.user.name);
        setNewProfileAffiliation(data.user.affiliation || '');
        
        // 모의권한 및 등급 수준에 맞추어 활성 탭 자동 조율
        if (data.user.level < 2) {
          // 1단계 일반회원은 단축주소 생성이 불가하므로 개인정보관리 탭을 보여줍니다.
          setActiveTab('profile');
        } else if (data.user.level < 3 && activeTab === 'apikeys') {
          setActiveTab('links');
        } else if (data.user.level < 4 && activeTab === 'admin') {
          setActiveTab('links');
        }
      } else {
        navigate('/');
      }
    } catch {
      navigate('/');
    }
  };

  // 내 단축 링크 목록 조회
  const fetchLinks = async () => {
    try {
      const res = await fetch('/api/links', { headers: getHeaders() });
      const data = await res.json();
      if (data.success) {
        setLinks(data.links);
      }
    } catch (e) {
      console.error('링크 조회 실패:', e);
    }
  };

  // 내 API Keys 조회
  const fetchApiKeys = async () => {
    try {
      const res = await fetch('/api/keys', { headers: getHeaders() });
      const data = await res.json();
      if (data.success) {
        setApiKeys(data.keys);
      }
    } catch (e) {
      console.error('API 키 조회 실패:', e);
    }
  };

  // 공지사항 조회
  const fetchNotices = async () => {
    try {
      const res = await fetch('/api/notices');
      const data = await res.json();
      if (data.success) {
        setDashboardNotices(data.notices);
      }
    } catch (e) {
      console.error('공지사항 조회 실패:', e);
    }
  };

  // 최고관리자용 사용자 등급 수정
  const handleUpdateUserLevel = async (userId: number, newLevel: number) => {
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({ level: newLevel })
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMsg(data.message || '사용자 권한 등급이 성공적으로 수정되었습니다.');
        fetchAdminData();
      } else {
        setError(data.error || '등급 수정 실패');
      }
    } catch {
      setError('서버 연결 실패');
    }
  };

  // 개인정보 수정
  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProfileName || !newProfileName.trim()) return;
    setIsUpdatingProfile(true);
    setError('');
    setSuccessMsg('');
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({ name: newProfileName, affiliation: newProfileAffiliation })
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMsg('개인정보가 성공적으로 변경되었습니다.');
        if (user) {
          setUser({ ...user, name: data.name, affiliation: data.affiliation });
        }
      } else {
        setError(data.error || '프로필 수정 실패');
      }
    } catch {
      setError('서버 연결 실패');
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  useEffect(() => {
    fetchUser();
    fetchLinks();
    fetchApiKeys();
  }, []);

  useEffect(() => {
    if (activeTab === 'admin' && user?.level === 4) {
      fetchAdminData();
    }
  }, [activeTab, user]);

  const handleCreateLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUrl) return;

    if (newPassword && !/^\d{6}$/.test(newPassword)) {
      setError('비밀번호는 숫자 6자리여야 합니다.');
      return;
    }

    setIsCreating(true);
    setError('');
    setSuccessMsg('');

    try {
      const payload: any = {
        original_url: newUrl,
        title: newTitle,
        description: newDesc,
        is_public: newPublic,
        expires_at: resolveExpiresAt(newExpiresMode, newExpiresAt),
        password: useNewPassword ? (newPassword || null) : null
      };
      if (useCustomSlug && newSlug) {
        // 사용자 입력은 custom_slug로 전송. base_slug는 서버가 자동 생성.
        payload.custom_slug = newSlug;
      }

      const res = await fetch('/api/links', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (data.success) {
        setSuccessMsg(`단축주소 /${data.slug} 가 정상 생성되었습니다.`);
        setNewUrl('');
        setNewTitle('');
        setNewDesc('');
        setNewSlug('');
        setUseCustomSlug(false);
        setNewPublic(false);
        setNewExpiresAt(getCurrentDateTimeString());
        setNewExpiresMode('none');
        setUseNewPassword(false);
        setNewPassword('');
        setIsCreateDrawerOpen(false);
        fetchLinks();
      } else {
        setError(data.error || '생성 중 오류가 발생했습니다.');
      }
    } catch (e) {
      setError('서버 연결 실패');
    } finally {
      setIsCreating(false);
    }
  };

  const handleUpdateLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLink) return;

    if (editPassword && !/^\d{6}$/.test(editPassword)) {
      setError('비밀번호는 숫자 6자리여야 합니다.');
      return;
    }
    if (useEditCustomSlug && editCustomSlugInput.trim() && slugCheckState !== 'ok') {
      setError('슬러그 중복 확인을 먼저 완료해주세요.');
      return;
    }

    setIsSaving(true);
    setError('');

    try {
      const res = await fetch(`/api/links/${editingLink.id}`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({
          custom_slug: useEditCustomSlug ? (editCustomSlugInput.trim() || null) : null,
          original_url: editUrl,
          title: editTitle,
          description: editDesc,
          is_active: editActive,
          is_public: editPublic,
          expires_at: resolveExpiresAt(editExpiresMode, editExpiresAt),
          password: useEditPassword ? (editPassword || null) : ''
        })
      });

      const data = await res.json();
      if (data.success) {
        setSuccessMsg('링크 수정이 완료되었습니다.');
        setEditingLink(null);
        fetchLinks();
      } else {
        setError(data.error || '수정 중 오류가 발생했습니다.');
      }
    } catch (e) {
      setError('서버 연결 실패');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteLink = async (id: number) => {
    if (!confirm('정말 이 단축 링크를 삭제하시겠습니까? 삭제 즉시 연결이 영구 중단됩니다.')) return;

    try {
      const res = await fetch(`/api/links/${id}`, {
        method: 'DELETE',
        headers: getHeaders()
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMsg('단축 링크가 완전히 삭제되었습니다.');
        fetchLinks();
      } else {
        alert(data.error || '삭제 실패');
      }
    } catch {
      alert('서버 연결 실패');
    }
  };

  // API Key 신규 발급
  const handleGenerateApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsGeneratingKey(true);
    setError('');
    setSuccessMsg('');

    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ name: newKeyName || 'Default Key' })
      });
      const data = await res.json();
      if (data.success) {
        setGeneratedKeyResult(data.api_key);
        setShowKeyResultModal(true);
        setNewKeyName('');
        fetchApiKeys();
      } else {
        setError(data.error || 'API 키 생성 실패');
      }
    } catch {
      setError('서버 연결 실패');
    } finally {
      setIsGeneratingKey(false);
    }
  };

  // API Key 삭제/폐기
  const handleDeleteApiKey = async (id: number) => {
    if (!confirm('이 API Key를 폐기하시겠습니까? 폐기 즉시 외부 연동 서비스의 호출이 불가능해집니다.')) return;

    try {
      const res = await fetch(`/api/keys/${id}`, {
        method: 'DELETE',
        headers: getHeaders()
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMsg('API 키가 안전하게 폐기되었습니다.');
        fetchApiKeys();
      } else {
        alert(data.error || '폐기 실패');
      }
    } catch {
      alert('서버 연결 실패');
    }
  };

  // 10.1 허용 도메인 추가
  const handleAddDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDomain) return;
    setError('');
    setSuccessMsg('');

    try {
      const res = await fetch('/api/admin/domains', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ domain: newDomain })
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMsg('새 기관 도메인이 성공적으로 등록되었습니다.');
        setNewDomain('');
        fetchAdminData();
      } else {
        setError(data.error || '도메인 등록 실패');
      }
    } catch {
      setError('서버 연결 실패');
    }
  };

  // 10.2 허용 도메인 삭제
  const handleDeleteDomain = async (id: number) => {
    if (!confirm('해당 이메일 도메인을 삭제하시겠습니까? 삭제 시 해당 도메인 메일 사용자의 신규 로그인이 불가능해집니다.')) return;
    setError('');
    setSuccessMsg('');

    try {
      const res = await fetch(`/api/admin/domains/${id}`, {
        method: 'DELETE',
        headers: getHeaders()
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMsg('도메인이 정상 삭제되었습니다.');
        fetchAdminData();
      } else {
        setError(data.error || '도메인 삭제 실패');
      }
    } catch {
      setError('서버 연결 실패');
    }
  };

  // 10.3 공지사항 추가
  const handleAddNotice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoticeTitle || !newNoticeContent) return;
    setError('');
    setSuccessMsg('');

    try {
      const res = await fetch('/api/admin/notices', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          title: newNoticeTitle,
          content: newNoticeContent,
          is_pinned: newNoticePinned
        })
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMsg('새 공지사항이 등록되었습니다.');
        setNewNoticeTitle('');
        setNewNoticeContent('');
        setNewNoticePinned(false);
        fetchAdminData();
      } else {
        setError(data.error || '공지 등록 실패');
      }
    } catch {
      setError('서버 연결 실패');
    }
  };

  // 10.4 공지사항 삭제
  const handleDeleteNotice = async (id: number) => {
    if (!confirm('이 공지사항을 영구 삭제하시겠습니까?')) return;
    setError('');
    setSuccessMsg('');

    try {
      const res = await fetch(`/api/admin/notices/${id}`, {
        method: 'DELETE',
        headers: getHeaders()
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMsg('공지사항이 안전하게 삭제되었습니다.');
        fetchAdminData();
      } else {
        setError(data.error || '공지 삭제 실패');
      }
    } catch {
      setError('서버 연결 실패');
    }
  };

  const startEdit = (link: LinkItem) => {
    setEditingLink(link);
    setEditUrl(link.original_url);
    setEditTitle(link.title || '');
    setEditDesc(link.description || '');
    setEditActive(link.is_active === 1);
    setEditPublic(link.is_public === 1);
    const hasExpiry = !!link.expires_at;
    setEditExpiresMode(hasExpiry ? 'custom' : 'none');
    setEditExpiresAt(link.expires_at || getCurrentDateTimeString());
    const hasPassword = !!link.password;
    setUseEditPassword(hasPassword);
    setEditPassword(link.password || '');
    // 커스텀 슬러그 초기화
    const hasCustom = !!link.custom_slug;
    setUseEditCustomSlug(hasCustom);
    setEditCustomSlugInput(link.custom_slug || '');
    setSlugCheckState(hasCustom ? 'ok' : 'idle');
    setSlugCheckMsg('');
  };

  const checkSlugAvailability = async (slug: string, excludeId: number) => {
    if (!slug.trim()) { setSlugCheckState('idle'); setSlugCheckMsg(''); return; }
    setSlugCheckState('checking');
    setSlugCheckMsg('');
    try {
      const res = await fetch(`/api/links/check-slug?slug=${encodeURIComponent(slug.trim())}&exclude_id=${excludeId}`, { headers: getHeaders() });
      const data = await res.json();
      if (data.available) {
        setSlugCheckState('ok');
        setSlugCheckMsg('사용 가능한 슬러그입니다.');
      } else {
        setSlugCheckState(data.reason === 'invalid' ? 'invalid' : 'taken');
        setSlugCheckMsg(data.message || '사용할 수 없습니다.');
      }
    } catch {
      setSlugCheckState('idle');
      setSlugCheckMsg('확인 실패');
    }
  };

  const openStats = async (link: LinkItem) => {
    setStatsDrawerLink(link);
    setStatsData(null);
    setIsLoadingStats(true);
    try {
      const res = await fetch(`/api/links/${link.id}/stats`, { headers: getHeaders() });
      const data = await res.json();
      if (data.success) {
        setStatsData({ daily_clicks: data.daily_clicks });
      }
    } catch { /* ignore */ }
    setIsLoadingStats(false);
  };

  const copyToClipboard = (id: number, slug: string) => {
    const shortUrl = `${window.location.protocol}//${window.location.host}/${slug}`;
    navigator.clipboard.writeText(shortUrl);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const copyGeneratedKey = () => {
    if (!generatedKeyResult) return;
    navigator.clipboard.writeText(generatedKeyResult);
    setKeyResultCopied(true);
    setTimeout(() => setKeyResultCopied(false), 2000);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '사용 이력 없음';
    // DB는 UTC 저장, Z를 붙여 명시적으로 UTC 파싱 후 KST 표시
    const utc = dateStr.replace(' ', 'T') + (dateStr.includes('Z') || dateStr.includes('+') ? '' : 'Z');
    return new Date(utc).toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul',
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
  };

  const totalClicks = links.reduce((sum, item) => sum + item.click_count, 0);

  return (
    <div className="h-screen bg-slate-50 flex overflow-hidden">
      
      {/* 1. 사이드바 내비게이션 */}
      <aside 
        className={`bg-white border-r border-slate-200 flex flex-col justify-between transition-all duration-300 z-20 
          ${isSidebarOpen ? 'w-64' : 'w-20'}
        `}
      >
        <div className="flex flex-col">
          <div className="h-16 flex items-center justify-between px-4 border-b border-slate-100">
            {isSidebarOpen ? (
              <div className="flex items-center gap-2.5">
                <img 
                  src="/edulink_logo.png" 
                  alt="에듀링크 로고" 
                  className="w-8 h-8 rounded-xl shadow-md border border-indigo-50/50 object-cover" 
                />
                <span className="font-display font-black text-base text-slate-800">에듀링크</span>
              </div>
            ) : (
              <img 
                src="/edulink_logo.png" 
                alt="에듀링크 로고" 
                className="w-8 h-8 rounded-xl shadow-md border border-indigo-50/50 object-cover mx-auto cursor-pointer hover:scale-105 transition-transform" 
                onClick={() => setIsSidebarOpen(true)}
                title="사이드바 열기"
              />
            )}
            
            {isSidebarOpen && (
              <Button 
                size="sm" 
                variant="light" 
                isIconOnly 
                className="rounded-full"
                onClick={() => setIsSidebarOpen(false)}
              >
                <ChevronLeft className="w-4 h-4 text-slate-400" />
              </Button>
            )}
          </div>

          <nav className="p-3 space-y-1">
            {user && user.level >= 2 && (
              <Button 
                variant={activeTab === 'links' ? 'flat' : 'light'}
                color={activeTab === 'links' ? 'primary' : 'default'}
                className={`w-full rounded-xl justify-start ${isSidebarOpen ? 'px-4' : 'px-0 justify-center'}`}
                onClick={() => setActiveTab('links')}
                startContent={<LayoutDashboard className="w-4 h-4 flex-shrink-0" />}
              >
                {isSidebarOpen && <span>단축주소 관리</span>}
              </Button>
            )}

            {user && user.level >= 3 && (
              <Button 
                variant={activeTab === 'apikeys' ? 'flat' : 'light'}
                color={activeTab === 'apikeys' ? 'primary' : 'default'}
                className={`w-full rounded-xl justify-start ${isSidebarOpen ? 'px-4' : 'px-0 justify-center'}`}
                onClick={() => setActiveTab('apikeys')}
                startContent={<Terminal className="w-4 h-4 flex-shrink-0" />}
              >
                {isSidebarOpen && <span>개발자 도구</span>}
              </Button>
            )}

            <Button 
              variant={activeTab === 'profile' ? 'flat' : 'light'}
              color={activeTab === 'profile' ? 'primary' : 'default'}
              className={`w-full rounded-xl justify-start ${isSidebarOpen ? 'px-4' : 'px-0 justify-center'}`}
              onClick={() => {
                setActiveTab('profile');
                if (user) {
                  setNewProfileName(user.name);
                  setNewProfileAffiliation(user.affiliation || '');
                }
              }}
              startContent={<User className="w-4 h-4 flex-shrink-0" />}
            >
              {isSidebarOpen && <span>개인정보관리</span>}
            </Button>

            <Button 
              variant={activeTab === 'guide' ? 'flat' : 'light'}
              color={activeTab === 'guide' ? 'primary' : 'default'}
              className={`w-full rounded-xl justify-start ${isSidebarOpen ? 'px-4' : 'px-0 justify-center'}`}
              onClick={() => setActiveTab('guide')}
              startContent={<BookOpen className="w-4 h-4 flex-shrink-0" />}
            >
              {isSidebarOpen && <span>활용방법</span>}
            </Button>

            <Button 
              variant={activeTab === 'notices' ? 'flat' : 'light'}
              color={activeTab === 'notices' ? 'primary' : 'default'}
              className={`w-full rounded-xl justify-start ${isSidebarOpen ? 'px-4' : 'px-0 justify-center'}`}
              onClick={() => {
                setActiveTab('notices');
                fetchNotices();
              }}
              startContent={<Megaphone className="w-4 h-4 flex-shrink-0" />}
            >
              {isSidebarOpen && <span>공지사항</span>}
            </Button>

            {user?.level === 4 && (
              <Button 
                variant={activeTab === 'admin' ? 'flat' : 'light'}
                color={activeTab === 'admin' ? 'danger' : 'default'}
                className={`w-full rounded-xl justify-start ${isSidebarOpen ? 'px-4' : 'px-0 justify-center'}`}
                onClick={() => setActiveTab('admin')}
                startContent={<ShieldAlert className="w-4 h-4 flex-shrink-0" />}
              >
                {isSidebarOpen && <span>최고관리자 모드</span>}
              </Button>
            )}
          </nav>
        </div>

        <div className="p-3 border-t border-slate-100 flex flex-col gap-2">
          {isSidebarOpen && user && (
            <div className="px-3 py-2 bg-slate-50 rounded-2xl flex items-center gap-2 overflow-hidden">
              <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center font-bold text-xs text-indigo-700 flex-shrink-0">
                {user.name.charAt(0)}
              </div>
              <div className="flex-1 truncate">
                <div className="flex items-center justify-between gap-1">
                  <p className="text-[11px] font-bold text-slate-800 truncate">{user.name}</p>
                  <span className="text-[8px] bg-indigo-100 text-indigo-700 font-bold px-1.5 rounded-md flex-shrink-0">Lv.{user.level}</span>
                </div>
                <p className="text-[9px] text-slate-400 truncate">{user.email}</p>
              </div>
            </div>
          )}

          <Button 
            variant="flat" 
            color="danger" 
            className={`w-full rounded-xl justify-start ${isSidebarOpen ? 'px-4' : 'px-0 justify-center'}`}
            onClick={async () => {
              try {
                await fetch('/api/auth/logout', { method: 'POST' });
                navigate('/');
              } catch (e) {
                console.error(e);
                navigate('/');
              }
            }}
            startContent={<LogOut className="w-4 h-4" />}
          >
            {isSidebarOpen && <span>로그아웃</span>}
          </Button>

          <Button 
            variant="light" 
            className={`w-full rounded-xl justify-start ${isSidebarOpen ? 'px-4' : 'px-0 justify-center'}`}
            onClick={() => navigate('/')}
            startContent={<Globe className="w-4 h-4 text-slate-400" />}
          >
            {isSidebarOpen && <span>홈페이지 이동</span>}
          </Button>
        </div>
      </aside>

      {/* 2. 본문 영역 */}
      <main className="flex-1 flex flex-col">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 z-10 flex-shrink-0">
          <h2 className="text-lg font-bold text-slate-800">
            {activeTab === 'links' && '단축주소 관리'}
            {activeTab === 'apikeys' && '개발자 도구 (API Keys)'}
            {activeTab === 'profile' && '개인정보관리'}
            {activeTab === 'guide' && '에듀링크 활용방법'}
            {activeTab === 'notices' && '에듀링크 공지사항'}
            {activeTab === 'admin' && '최고관리자 대시보드'}
          </h2>

          <div className="flex items-center gap-2">
            {!window.location.host.includes('dgedu.link') && (
              <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
                <span className="text-[10px] font-bold text-slate-500 px-1.5">🧪 모의 권한:</span>
                <select
                  value={mockRole || 'default'}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === 'default') {
                      localStorage.removeItem('mock_role');
                      setMockRole(null);
                    } else {
                      localStorage.setItem('mock_role', val);
                      setMockRole(val);
                    }
                    window.location.reload();
                  }}
                  className="bg-white border border-slate-200 rounded-lg text-[10px] font-bold text-slate-700 py-1 px-2 outline-none cursor-pointer"
                >
                  <option value="default">실제 로그인 계정</option>
                  <option value="login">1-일반회원 (Gmail 등)</option>
                  <option value="authenticated">2-인증사용자 (교직원 등)</option>
                  <option value="developer">3-개발자 (연동계정)</option>
                  <option value="admin">4-최고관리자 (전체제어)</option>
                </select>
              </div>
            )}

            {user && (
              <Chip 
                size="sm" 
                variant="flat" 
                color={
                  user.level === 4 ? 'danger' :
                  user.level === 3 ? 'secondary' :
                  user.level === 2 ? 'primary' : 'default'
                } 
                className="font-semibold px-2"
              >
                {
                  user.level === 4 ? '👑 최고관리자' :
                  user.level === 3 ? '🛠️ 개발자' :
                  user.level === 2 ? '🛡️ 인증사용자' : '👤 일반회원'
                }
              </Chip>
            )}

            <Button
              size="sm"
              variant="flat"
              color="danger"
              className="font-semibold rounded-xl"
              onClick={async () => {
                try {
                  await fetch('/api/auth/logout', { method: 'POST' });
                  navigate('/');
                } catch (e) {
                  console.error(e);
                  navigate('/');
                }
              }}
              startContent={<LogOut className="w-3.5 h-3.5" />}
            >
              로그아웃
            </Button>
          </div>
        </header>

        {/* 3. 본문 영역 스크롤뷰 */}
        <div className="flex-1 overflow-y-auto p-8 max-w-7xl w-full mx-auto space-y-8">
          {activeTab === 'links' && (
            <>
              {user && user.level < 2 && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-800 flex items-start gap-3 mb-6 animate-fade-in">
                  <ShieldAlert className="w-5 h-5 flex-shrink-0 text-amber-600 mt-0.5" />
                  <div>
                    <h4 className="font-bold">단축주소 생성 권한이 제한되어 있습니다.</h4>
                    <p className="text-[11px] text-slate-500 leading-relaxed mt-1">
                      현재 회원님의 등급은 <strong>일반회원(1단계)</strong>입니다. 단축주소 생성은 <strong>(2)단계 인증사용자</strong> 이상만 가능합니다.<br />
                      화이트리스트 도메인(korea.kr, dge.go.kr 등) 메일로 다시 로그인하시거나, 최고관리자에게 수동 인증 승급 요청을 진행해 주시기 바랍니다.
                    </p>
                  </div>
                </div>
              )}

              {/* 통계 카드 — 가로 3열 */}
              <div className="grid grid-cols-3 gap-4">
                <Card className="bg-white border border-slate-100 rounded-3xl shadow-sm">
                  <CardContent className="p-4 flex flex-col items-center gap-2 text-center">
                    <div className="bg-blue-50 p-2.5 rounded-2xl text-blue-600">
                      <Link2 className="w-5 h-5" />
                    </div>
                    <h3 className="text-2xl font-extrabold text-slate-800 font-display">{links.length}개</h3>
                    <p className="text-[11px] text-slate-400 font-bold">생성된 단축주소</p>
                  </CardContent>
                </Card>

                <Card className="bg-white border border-slate-100 rounded-3xl shadow-sm">
                  <CardContent className="p-4 flex flex-col items-center gap-2 text-center">
                    <div className="bg-emerald-50 p-2.5 rounded-2xl text-emerald-600">
                      <BarChart3 className="w-5 h-5" />
                    </div>
                    <h3 className="text-2xl font-extrabold text-slate-800 font-display">{totalClicks}회</h3>
                    <p className="text-[11px] text-slate-400 font-bold">누적 접속(클릭) 수</p>
                  </CardContent>
                </Card>

                <Card className="bg-white border border-slate-100 rounded-3xl shadow-sm">
                  <CardContent className="p-4 flex flex-col items-center gap-2 text-center">
                    <div className="bg-purple-50 p-2.5 rounded-2xl text-purple-600">
                      <Globe className="w-5 h-5" />
                    </div>
                    <h3 className="text-2xl font-extrabold text-slate-800 font-display">
                      {links.length > 0 ? Math.round((links.filter(l => l.is_active === 1).length / links.length) * 100) : 0}%
                    </h3>
                    <p className="text-[11px] text-slate-400 font-bold">활성 링크 비율</p>
                  </CardContent>
                </Card>
              </div>

              {/* 링크 입력바 및 링크 목록 */}
              <div className="space-y-6">
                  
                  {/* 간이 주소 입력바 */}
                  <Card className="bg-white border border-slate-100 rounded-3xl shadow-sm overflow-hidden">
                    <CardContent className="p-4 sm:p-5">
                      <form 
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (!newUrl) return;
                          if (user && user.level < 2) {
                            setError('단축주소 생성 권한이 없습니다.');
                            return;
                          }
                          // 상세 설정을 위해 우측 생성 드로어 오픈
                          setIsCreateDrawerOpen(true);
                        }} 
                        className="flex items-center gap-3 w-full"
                      >
                        <div className="flex-1">
                          <Input
                            size="md"
                            type="url"
                            required
                            placeholder="단축할 원본 주소(URL)를 입력하세요 (https://...)"
                            value={newUrl}
                            onChange={(e) => handleNewUrlChange(e.target.value)}
                            className="w-full font-medium"
                            disabled={user && user.level < 2}
                          />
                        </div>
                        <Button
                          type="submit"
                          color={user && user.level < 2 ? 'default' : 'primary'}
                          className="rounded-2xl font-bold px-6 h-10 flex-shrink-0 shadow-md shadow-primary/10"
                          disabled={user && user.level < 2}
                        >
                          단축주소 생성
                        </Button>
                      </form>
                    </CardContent>
                  </Card>

                  {/* 단축 링크 목록 — 테이블 */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-sm text-slate-800">단축 링크 목록</h4>
                      <span className="text-xs text-slate-400">총 {links.length}개 발행됨</span>
                    </div>

                    {links.length === 0 ? (
                      <Card className="bg-white border border-slate-100 rounded-3xl py-16 shadow-sm">
                        <CardContent className="text-center flex flex-col items-center gap-2">
                          <Link2 className="w-12 h-12 text-slate-200" />
                          <p className="text-xs text-slate-400 font-medium">아직 발행하신 단축 링크가 존재하지 않습니다.</p>
                        </CardContent>
                      </Card>
                    ) : (
                      <div className="bg-white border border-slate-100 rounded-3xl shadow-sm overflow-hidden">
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
                              {links.map((link) => {
                                const openUrl = `${window.location.protocol}//${window.location.host}/${link.custom_slug || link.base_slug || link.slug}`;
                                const isCopied = copiedId === link.id;
                                return (
                                  <tr
                                    key={link.id}
                                    className="hover:bg-slate-50/60 transition-colors group"
                                  >
                                    {/* 슬러그 */}
                                    <td className="p-3 pl-5 align-middle">
                                      <div className="font-mono font-bold text-slate-800 text-[11px]">
                                        /{link.base_slug || link.slug}
                                      </div>
                                      {link.custom_slug && (
                                        <div className="font-mono text-[10px] text-indigo-500 mt-0.5">
                                          /{link.custom_slug}
                                        </div>
                                      )}
                                    </td>

                                    {/* 제목 / 원본 주소 */}
                                    <td className="p-3 align-middle max-w-xs">
                                      {link.title ? (
                                        <div className="font-semibold text-slate-700 truncate max-w-[240px]" title={link.title}>
                                          {link.title}
                                        </div>
                                      ) : (
                                        <div className="text-slate-300 italic text-[10px]">제목 없음</div>
                                      )}
                                      <div className="font-mono text-[10px] text-slate-400 truncate max-w-[240px] mt-0.5" title={link.original_url}>
                                        {link.original_url}
                                      </div>
                                    </td>

                                    {/* 클릭 수 */}
                                    <td className="p-3 align-middle whitespace-nowrap">
                                      <span className="font-extrabold text-slate-800">{link.click_count ?? 0}</span>
                                      <span className="text-slate-400 ml-0.5">회</span>
                                    </td>

                                    {/* 생성일 */}
                                    <td className="p-3 align-middle whitespace-nowrap text-slate-400">
                                      {formatDate(link.created_at)}
                                    </td>

                                    {/* 상태 */}
                                    <td className="p-3 align-middle">
                                      <div className="flex flex-col gap-1">
                                        <Chip
                                          size="sm"
                                          color={link.is_active === 1 ? 'success' : 'default'}
                                          variant="flat"
                                          className="px-1.5 h-4 text-[9px] font-bold"
                                        >
                                          {link.is_active === 1 ? '활성' : '비활성'}
                                        </Chip>
                                        <Chip
                                          size="sm"
                                          color={link.is_public === 1 ? 'secondary' : 'default'}
                                          variant="flat"
                                          className="px-1.5 h-4 text-[9px] font-bold"
                                        >
                                          {link.is_public === 1 ? '공개' : '비공개'}
                                        </Chip>
                                      </div>
                                    </td>

                                    {/* 작업 버튼 */}
                                    <td className="p-3 pr-4 align-middle">
                                      <div className="flex items-center justify-end gap-1">
                                        <Tooltip content={isCopied ? '복사됨!' : '주소 복사'}>
                                          <Button
                                            size="sm"
                                            variant="flat"
                                            color={isCopied ? 'success' : 'default'}
                                            isIconOnly
                                            onClick={() => copyToClipboard(link.id, link.custom_slug || link.base_slug || link.slug)}
                                            className="rounded-lg w-7 h-7 min-w-0 p-0"
                                          >
                                            {isCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                          </Button>
                                        </Tooltip>

                                        <Tooltip content="링크 열기">
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

                                        <Tooltip content="QR 코드">
                                          <Button
                                            size="sm"
                                            variant="flat"
                                            color="secondary"
                                            isIconOnly
                                            onClick={() => setQrModalLink(link)}
                                            className="rounded-lg w-7 h-7 min-w-0 p-0"
                                          >
                                            <QrCode className="w-3 h-3" />
                                          </Button>
                                        </Tooltip>

                                        <Tooltip content="통계">
                                          <Button
                                            size="sm"
                                            variant="flat"
                                            color="primary"
                                            isIconOnly
                                            onClick={() => openStats(link)}
                                            className="rounded-lg w-7 h-7 min-w-0 p-0"
                                          >
                                            <TrendingUp className="w-3 h-3" />
                                          </Button>
                                        </Tooltip>

                                        <Tooltip content="편집">
                                          <Button
                                            size="sm"
                                            variant="flat"
                                            color="default"
                                            isIconOnly
                                            onClick={() => startEdit(link)}
                                            className="rounded-lg w-7 h-7 min-w-0 p-0"
                                            disabled={user && user.level < 2}
                                          >
                                            <Edit3 className="w-3 h-3" />
                                          </Button>
                                        </Tooltip>

                                        <Tooltip content="삭제">
                                          <Button
                                            size="sm"
                                            variant="flat"
                                            color="danger"
                                            isIconOnly
                                            onClick={() => handleDeleteLink(link.id)}
                                            className="rounded-lg w-7 h-7 min-w-0 p-0"
                                            disabled={user && user.level < 2}
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
                      </div>
                    )}
                  </div>
 
                  {/* 우측 슬라이드-오버 드로어 편집기 */}
                  <div className={`fixed inset-0 z-50 overflow-hidden transition-all duration-300 ${editingLink ? 'visible pointer-events-auto' : 'invisible pointer-events-none'}`}>
                    {/* 백드롭 */}
                    <div 
                      className={`absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-300 ${editingLink ? 'opacity-100' : 'opacity-0'}`} 
                      onClick={() => setEditingLink(null)}
                    />
                    
                    <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
                      <div 
                        className={`w-screen max-w-md bg-white border-l border-slate-200 shadow-2xl flex flex-col justify-between transition-transform duration-300 transform ${editingLink ? 'translate-x-0' : 'translate-x-full'}`}
                      >
                        {editingLink && (
                          <div className="h-full flex flex-col justify-between">
                            <div className="p-6 overflow-y-auto flex-1 space-y-5">
                              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                                <div className="space-y-0.5">
                                  <h3 className="font-bold text-base text-slate-800">단축 링크 편집</h3>
                                  <p className="text-[10px] text-indigo-600 font-bold font-display">
                                    dgedu.link/{editingLink.base_slug || editingLink.slug}
                                    {editingLink.custom_slug && <span className="text-slate-400 font-normal"> · /{editingLink.custom_slug}</span>}
                                  </p>
                                </div>
                                <Chip size="sm" variant="flat" color="secondary">수정 모드</Chip>
                              </div>
 
                              <form onSubmit={handleUpdateLink} id="editForm" className="space-y-4 text-xs">
                                {/* 슬러그 섹션 */}
                                <div className="space-y-2 p-3 rounded-xl bg-slate-50 border border-slate-100">
                                  {/* 기본 슬러그 (불변) */}
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">기본 슬러그</span>
                                    <span className="text-[10px] bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded font-mono">고정</span>
                                  </div>
                                  <div className="flex items-center gap-1.5 font-mono text-sm text-slate-700 bg-white border border-slate-200 rounded-lg px-3 py-2">
                                    <span className="text-slate-400">/</span>
                                    <span className="font-bold">{editingLink.base_slug || editingLink.slug}</span>
                                  </div>

                                  {/* 커스텀 슬러그 체크박스 */}
                                  <div className="flex items-center gap-2 pt-1">
                                    <input
                                      type="checkbox"
                                      id="useEditCustomSlug"
                                      checked={useEditCustomSlug}
                                      onChange={(e) => {
                                        setUseEditCustomSlug(e.target.checked);
                                        if (!e.target.checked) {
                                          setEditCustomSlugInput('');
                                          setSlugCheckState('idle');
                                          setSlugCheckMsg('');
                                        }
                                      }}
                                      className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                                    />
                                    <label htmlFor="useEditCustomSlug" className="font-bold text-slate-600 select-none">
                                      🔗 커스텀 슬러그 설정
                                    </label>
                                  </div>

                                  {useEditCustomSlug && (
                                    <div className="space-y-1.5">
                                      <div className="flex gap-2">
                                        <Input
                                          size="sm"
                                          value={editCustomSlugInput}
                                          onChange={(e) => {
                                            setEditCustomSlugInput(e.target.value);
                                            setSlugCheckState('idle');
                                            setSlugCheckMsg('');
                                          }}
                                          placeholder="4~20자 영숫자·한글·하이픈"
                                          className="flex-1 font-mono"
                                          startContent={<span className="text-slate-400 text-xs">/</span>}
                                          color={slugCheckState === 'ok' ? 'success' : slugCheckState === 'taken' || slugCheckState === 'invalid' ? 'danger' : 'default'}
                                        />
                                        <button
                                          type="button"
                                          onClick={() => checkSlugAvailability(editCustomSlugInput, editingLink.id)}
                                          disabled={!editCustomSlugInput.trim() || slugCheckState === 'checking'}
                                          className="px-3 py-1 text-[11px] font-bold rounded-lg bg-indigo-600 text-white disabled:opacity-40 hover:bg-indigo-700 transition-colors whitespace-nowrap"
                                        >
                                          {slugCheckState === 'checking' ? '확인 중…' : '중복 확인'}
                                        </button>
                                      </div>
                                      {slugCheckMsg && (
                                        <p className={`text-[10px] font-semibold ${slugCheckState === 'ok' ? 'text-emerald-600' : 'text-red-500'}`}>
                                          {slugCheckState === 'ok' ? '✓' : '✕'} {slugCheckMsg}
                                        </p>
                                      )}
                                      <p className="text-[9px] text-slate-400">기본 슬러그는 유지되며, 커스텀 슬러그로도 접속 가능합니다.</p>
                                    </div>
                                  )}
                                </div>

                                <div className="space-y-1.5">
                                  <label className="font-bold text-slate-600">원본 주소(URL) *</label>
                                  <Input
                                    size="sm"
                                    type="url"
                                    required
                                    value={editUrl}
                                    onChange={(e) => handleEditUrlChange(e.target.value)}
                                    className="w-full"
                                  />
                                </div>

                                <div className="space-y-1.5">
                                  <label className="font-bold text-slate-600 flex items-center gap-1.5">
                                    링크 제목
                                    {isFetchingEditTitle && (
                                      <span className="text-[10px] text-primary font-normal animate-pulse">제목 불러오는 중…</span>
                                    )}
                                  </label>
                                  <Input
                                    size="sm"
                                    value={editTitle}
                                    onChange={(e) => setEditTitle(e.target.value)}
                                    placeholder={isFetchingEditTitle ? '페이지 제목 가져오는 중...' : ''}
                                    className="w-full"
                                  />
                                </div>
 
                                <div className="space-y-1.5">
                                  <label className="font-bold text-slate-600">설명</label>
                                  <Input
                                    size="sm"
                                    value={editDesc}
                                    onChange={(e) => setEditDesc(e.target.value)}
                                    className="w-full"
                                  />
                                </div>
 
                                {/* 자동 종료일시 */}
                                <div className="space-y-2 pt-2 border-t border-slate-100">
                                  <label className="font-bold text-slate-600 flex items-center gap-1">⏰ 자동 종료일시</label>
                                  <select
                                    value={editExpiresMode}
                                    onChange={(e) => {
                                      const m = e.target.value as 'none'|'24h'|'7d'|'custom';
                                      setEditExpiresMode(m);
                                      if (m === 'custom') setEditExpiresAt(editExpiresAt || getKSTDateTimeString(24*60*60*1000));
                                    }}
                                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                                  >
                                    <option value="none">없음</option>
                                    <option value="24h">24시간 이후</option>
                                    <option value="7d">7일 이후</option>
                                    <option value="custom">직접 입력</option>
                                  </select>
                                  {editExpiresMode === 'custom' && (
                                    <>
                                      <Input
                                        size="sm"
                                        type="datetime-local"
                                        value={editExpiresAt}
                                        onChange={(e) => setEditExpiresAt(e.target.value)}
                                        className="w-full"
                                      />
                                      <p className="text-[9px] text-slate-400">설정된 일시 이후에는 자동으로 비활성화 및 메인 리디렉션 처리됩니다.</p>
                                    </>
                                  )}
                                </div>
 
                                <div className="space-y-2 pt-2">
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      id="useEditPassword"
                                      checked={useEditPassword}
                                      onChange={(e) => {
                                        setUseEditPassword(e.target.checked);
                                        if (!e.target.checked) setEditPassword('');
                                      }}
                                      className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                                    />
                                    <label htmlFor="useEditPassword" className="font-bold text-slate-600 select-none flex items-center gap-1">
                                      🔒 비밀번호 보호 설정
                                    </label>
                                  </div>
                                  {useEditPassword && (
                                    <>
                                      <Input
                                        size="sm"
                                        type="text"
                                        placeholder="숫자 6자리 입력 (예: 123456)"
                                        maxLength={6}
                                        pattern="[0-9]*"
                                        inputMode="numeric"
                                        value={editPassword}
                                        onChange={(e) => setEditPassword(e.target.value.replace(/[^0-9]/g, ''))}
                                        className="w-full"
                                      />
                                      <p className="text-[9px] text-slate-400">접속 시 이 비밀번호를 정확히 기입해야만 목적지 주소로 연결됩니다.</p>
                                    </>
                                  )}
                                </div>
 
                                <div className="flex flex-col gap-2.5 py-2 border-t border-slate-100 mt-4">
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      id="editActive"
                                      checked={editActive}
                                      onChange={(e) => setEditActive(e.target.checked)}
                                      className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                                    />
                                    <label htmlFor="editActive" className="font-bold text-slate-600 select-none">
                                      링크 활성화 상태 (체크 해제 시 접속 차단)
                                    </label>
                                  </div>
 
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      id="editPublic"
                                      checked={editPublic}
                                      onChange={(e) => setEditPublic(e.target.checked)}
                                      className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                                    />
                                    <label htmlFor="editPublic" className="font-bold text-slate-600 select-none">
                                      메인 화면(루트) 전체 목록에 공개하기
                                    </label>
                                  </div>
                                </div>
                              </form>
                            </div>
 
                            <div className="p-6 border-t border-slate-100 bg-slate-50 flex gap-3">
                              <Button
                                variant="flat"
                                color="default"
                                className="flex-1 rounded-xl font-bold"
                                onClick={() => setEditingLink(null)}
                              >
                                취소
                              </Button>
                              <Button
                                type="submit"
                                form="editForm"
                                color="primary"
                                className="flex-1 rounded-xl font-bold shadow-md shadow-primary/10"
                                isLoading={isSaving}
                              >
                                변경사항 저장
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 단축주소 생성 드로어 */}
                  <div className={`fixed inset-0 z-50 overflow-hidden transition-all duration-300 ${isCreateDrawerOpen ? 'visible pointer-events-auto' : 'invisible pointer-events-none'}`}>
                    {/* 백드롭 */}
                    <div
                      className={`absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-300 ${isCreateDrawerOpen ? 'opacity-100' : 'opacity-0'}`}
                      onClick={() => setIsCreateDrawerOpen(false)}
                    />

                    <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
                      <div
                        className={`w-screen max-w-md bg-white border-l border-slate-200 shadow-2xl flex flex-col justify-between transition-transform duration-300 transform ${isCreateDrawerOpen ? 'translate-x-0' : 'translate-x-full'}`}
                      >
                        <div className="h-full flex flex-col justify-between">
                          {/* 드로어 헤더 */}
                          <div className="p-6 overflow-y-auto flex-1 space-y-5">
                            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                              <div className="space-y-0.5">
                                <h3 className="font-bold text-base text-slate-800">단축주소 생성</h3>
                                <p className="text-[10px] text-indigo-600 font-bold font-display">세부 설정 후 생성합니다</p>
                              </div>
                              <Chip size="sm" variant="flat" color="primary">새 링크</Chip>
                            </div>

                            <form onSubmit={handleCreateLink} id="createForm" className="space-y-4 text-xs">
                              {/* 원본 URL */}
                              <div className="space-y-1.5">
                                <label className="font-bold text-slate-600">원본 주소(URL) *</label>
                                <Input
                                  size="sm"
                                  type="url"
                                  required
                                  placeholder="https://..."
                                  value={newUrl}
                                  onChange={(e) => handleNewUrlChange(e.target.value)}
                                  className="w-full"
                                />
                              </div>

                              {/* 링크 제목 */}
                              <div className="space-y-1.5">
                                <label className="font-bold text-slate-600 flex items-center gap-1.5">
                                  링크 제목 (선택)
                                  {isFetchingNewTitle && (
                                    <span className="text-[10px] text-primary font-normal animate-pulse">제목 불러오는 중…</span>
                                  )}
                                </label>
                                <Input
                                  size="sm"
                                  placeholder={isFetchingNewTitle ? '페이지 제목 가져오는 중...' : '예: 학교 홈페이지'}
                                  value={newTitle}
                                  onChange={(e) => setNewTitle(e.target.value)}
                                  className="w-full"
                                />
                              </div>

                              {/* 설명 */}
                              <div className="space-y-1.5">
                                <label className="font-bold text-slate-600">설명 (선택)</label>
                                <Input
                                  size="sm"
                                  placeholder="간단한 메모"
                                  value={newDesc}
                                  onChange={(e) => setNewDesc(e.target.value)}
                                  className="w-full"
                                />
                              </div>

                              {/* 커스텀 슬러그 */}
                              <div className="space-y-1.5 pt-2 border-t border-slate-100">
                                <div className="flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    id="useCustomSlug"
                                    checked={useCustomSlug}
                                    onChange={(e) => setUseCustomSlug(e.target.checked)}
                                    className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                                  />
                                  <label htmlFor="useCustomSlug" className="font-bold text-slate-600 select-none">
                                    커스텀 슬러그 직접 지정
                                  </label>
                                </div>
                                {useCustomSlug && (
                                  <Input
                                    size="sm"
                                    placeholder="4~20자 영숫자·한글·하이픈"
                                    value={newSlug}
                                    onChange={(e) => setNewSlug(e.target.value)}
                                    className="w-full font-mono"
                                    startContent={<span className="text-slate-400 text-xs">/</span>}
                                  />
                                )}
                              </div>

                              {/* 자동 종료일시 */}
                              <div className="space-y-2 pt-2 border-t border-slate-100">
                                <label className="font-bold text-slate-600 flex items-center gap-1">⏰ 자동 종료일시</label>
                                <select
                                  value={newExpiresMode}
                                  onChange={(e) => {
                                    const m = e.target.value as 'none'|'24h'|'7d'|'custom';
                                    setNewExpiresMode(m);
                                    if (m === 'custom') setNewExpiresAt(newExpiresAt || getKSTDateTimeString(24*60*60*1000));
                                  }}
                                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                                >
                                  <option value="none">없음</option>
                                  <option value="24h">24시간 이후</option>
                                  <option value="7d">7일 이후</option>
                                  <option value="custom">직접 입력</option>
                                </select>
                                {newExpiresMode === 'custom' && (
                                  <>
                                    <Input
                                      size="sm"
                                      type="datetime-local"
                                      value={newExpiresAt}
                                      onChange={(e) => setNewExpiresAt(e.target.value)}
                                      className="w-full"
                                    />
                                    <p className="text-[9px] text-slate-400">설정된 일시 이후 자동 비활성화됩니다.</p>
                                  </>
                                )}
                              </div>

                              {/* 비밀번호 */}
                              <div className="space-y-2 pt-2">
                                <div className="flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    id="useNewPassword"
                                    checked={useNewPassword}
                                    onChange={(e) => {
                                      setUseNewPassword(e.target.checked);
                                      if (!e.target.checked) setNewPassword('');
                                    }}
                                    className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                                  />
                                  <label htmlFor="useNewPassword" className="font-bold text-slate-600 select-none flex items-center gap-1">
                                    🔒 비밀번호 보호 설정
                                  </label>
                                </div>
                                {useNewPassword && (
                                  <>
                                    <Input
                                      size="sm"
                                      type="text"
                                      placeholder="숫자 6자리 입력 (예: 123456)"
                                      maxLength={6}
                                      pattern="[0-9]*"
                                      inputMode="numeric"
                                      value={newPassword}
                                      onChange={(e) => setNewPassword(e.target.value.replace(/[^0-9]/g, ''))}
                                      className="w-full"
                                    />
                                    <p className="text-[9px] text-slate-400">접속 시 이 비밀번호를 입력해야만 목적지로 연결됩니다.</p>
                                  </>
                                )}
                              </div>

                              {/* 체크박스들 */}
                              <div className="flex flex-col gap-2.5 py-2 border-t border-slate-100 mt-4">
                                <div className="flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    id="newPublic"
                                    checked={newPublic}
                                    onChange={(e) => setNewPublic(e.target.checked)}
                                    className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                                  />
                                  <label htmlFor="newPublic" className="font-bold text-slate-600 select-none">
                                    메인 화면(루트) 전체 목록에 공개하기
                                  </label>
                                </div>
                              </div>
                            </form>
                          </div>

                          {/* 드로어 하단 버튼 */}
                          <div className="p-6 border-t border-slate-100 bg-slate-50 flex gap-3">
                            <Button
                              variant="flat"
                              color="default"
                              className="flex-1 rounded-xl font-bold"
                              onClick={() => setIsCreateDrawerOpen(false)}
                            >
                              취소
                            </Button>
                            <Button
                              type="submit"
                              form="createForm"
                              color="primary"
                              className="flex-1 rounded-xl font-bold shadow-md shadow-primary/10"
                              isLoading={isCreating}
                            >
                              단축주소 생성
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 통계 드로어 */}
                  <div className={`fixed inset-0 z-50 overflow-hidden transition-all duration-300 ${statsDrawerLink ? 'visible pointer-events-auto' : 'invisible pointer-events-none'}`}>
                    <div
                      className={`absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-300 ${statsDrawerLink ? 'opacity-100' : 'opacity-0'}`}
                      onClick={() => setStatsDrawerLink(null)}
                    />
                    <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
                      <div className={`w-screen max-w-md bg-white border-l border-slate-200 shadow-2xl flex flex-col transition-transform duration-300 transform ${statsDrawerLink ? 'translate-x-0' : 'translate-x-full'}`}>
                        {statsDrawerLink && (
                          <div className="h-full flex flex-col">
                            {/* 헤더 */}
                            <div className="p-6 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
                              <div className="space-y-0.5 min-w-0">
                                <h3 className="font-bold text-base text-slate-800 flex items-center gap-2">
                                  <TrendingUp className="w-4 h-4 text-indigo-600 flex-shrink-0" />
                                  접속 통계
                                </h3>
                                <p className="text-[10px] text-indigo-600 font-bold font-mono truncate">
                                  dgedu.link/{statsDrawerLink.base_slug || statsDrawerLink.slug}
                                  {statsDrawerLink.custom_slug && <span className="text-slate-400 font-normal"> · /{statsDrawerLink.custom_slug}</span>}
                                </p>
                              </div>
                              <Button
                                size="sm" variant="light" isIconOnly
                                onClick={() => setStatsDrawerLink(null)}
                                className="rounded-lg w-7 h-7 min-w-0 p-0 text-slate-400 flex-shrink-0 ml-2"
                              >✕</Button>
                            </div>

                            {/* 컨텐츠 */}
                            <div className="flex-1 overflow-y-auto p-6 space-y-6">
                              {/* 기본 정보 */}
                              <div className="bg-slate-50 rounded-2xl p-4 space-y-3 text-xs">
                                <div className="flex items-start justify-between gap-3">
                                  <span className="text-slate-400 font-bold flex-shrink-0">제목</span>
                                  <span className="text-slate-800 font-semibold text-right break-words max-w-[240px]">
                                    {statsDrawerLink.title || <span className="text-slate-300 italic font-normal">없음</span>}
                                  </span>
                                </div>
                                <div className="flex items-start justify-between gap-3">
                                  <span className="text-slate-400 font-bold flex-shrink-0">원본 주소</span>
                                  <a
                                    href={statsDrawerLink.original_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-indigo-600 font-mono text-[10px] text-right break-all hover:underline max-w-[240px]"
                                  >
                                    {statsDrawerLink.original_url}
                                  </a>
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-slate-400 font-bold">생성일시</span>
                                  <span className="text-slate-600 font-semibold">{formatDate(statsDrawerLink.created_at)}</span>
                                </div>
                                <div className="flex items-center justify-between gap-3 pt-1 border-t border-slate-100">
                                  <span className="text-slate-500 font-bold flex items-center gap-1.5">
                                    <BarChart3 className="w-3.5 h-3.5 text-indigo-500" />
                                    누적 클릭
                                  </span>
                                  <span className="text-slate-800 font-extrabold text-lg">{statsDrawerLink.click_count ?? 0}<span className="text-xs font-normal text-slate-400 ml-1">회</span></span>
                                </div>
                              </div>

                              {/* 일별 접속 그래프 */}
                              <div className="space-y-3">
                                <h4 className="font-bold text-sm text-slate-800">최근 30일 일별 접속 현황</h4>
                                {isLoadingStats ? (
                                  <div className="flex items-center justify-center py-14">
                                    <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                                  </div>
                                ) : (
                                  <StatsBarChart dailyClicks={statsData?.daily_clicks || []} />
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                </div>
            </>
          )}

          {/* API Keys 탭 */}
          {activeTab === 'apikeys' && (
            user && user.level < 3 ? (
              <Card className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm">
                <CardContent className="text-center flex flex-col items-center gap-4 py-8">
                  <div className="bg-amber-50 p-4 rounded-2xl text-amber-500">
                    <ShieldAlert className="w-10 h-10" />
                  </div>
                  <div className="space-y-1.5 max-w-md mx-auto">
                    <h3 className="font-bold text-base text-slate-800">개발자 도구 권한이 제한되어 있습니다</h3>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      API Key 발급 및 외부 연동 OpenAPI 가이드는 <strong>(3)단계 개발자</strong> 등급 이상부터 액세스하실 수 있습니다.<br />
                      현재 등급은 <strong>{user.level === 2 ? '2단계: 인증사용자' : '1단계: 일반회원'}</strong>이며, 최고관리자에게 승급 인증을 요청해 주시기 바랍니다.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 items-start">
                
                <Card className="bg-white border border-slate-100 rounded-3xl shadow-sm xl:sticky xl:top-8">
                  <CardContent className="p-6 space-y-4">
                    <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                      <KeyRound className="w-4 h-4 text-indigo-600" />
                      <h4 className="font-bold text-sm text-slate-800">새 API Key 발급</h4>
                    </div>

                    <form onSubmit={handleGenerateApiKey} className="space-y-4 text-xs">
                      <div className="space-y-1.5">
                        <label className="font-bold text-slate-600">키 이름 (용도 구분용)</label>
                        <Input
                          size="sm"
                          required
                          placeholder="예: 학교 홈페이지 연동 API"
                          value={newKeyName}
                          onChange={(e) => setNewKeyName(e.target.value)}
                          className="w-full"
                        />
                      </div>

                      <p className="text-[10px] text-slate-400 leading-relaxed">
                        발급된 API 키는 **단 1회만 노출**됩니다. 발급 즉시 안전한 장소에 복사해 두시기 바랍니다.
                      </p>

                      <Button
                        type="submit"
                        color="primary"
                        className="w-full rounded-xl font-bold mt-2 shadow-md shadow-primary/20"
                        isLoading={isGeneratingKey}
                      >
                        키 발급하기
                      </Button>
                    </form>
                  </CardContent>
                </Card>

                <div className="xl:col-span-2 space-y-6">
                  
                  <div className="space-y-3">
                    <h4 className="font-bold text-sm text-slate-800">내 API Keys</h4>

                    {apiKeys.length === 0 ? (
                      <Card className="bg-white border border-slate-100 rounded-3xl py-12 shadow-sm">
                        <CardContent className="text-center flex flex-col items-center gap-2">
                          <KeyRound className="w-10 h-10 text-slate-200" />
                          <p className="text-xs text-slate-400 font-medium">아직 발급받은 API 키가 존재하지 않습니다.</p>
                        </CardContent>
                      </Card>
                    ) : (
                      <div className="space-y-3">
                        {apiKeys.map((key) => {
                          return (
                            <Card key={key.id} className="bg-white border border-slate-100 rounded-2xl shadow-sm">
                              <CardContent className="p-4 flex items-center justify-between gap-4 text-xs">
                                <div className="space-y-1 flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-slate-800 truncate">{key.name}</span>
                                    <Chip size="sm" variant="flat" color="secondary" className="px-1.5 h-5 text-[9px] font-bold">
                                      ACTIVE
                                    </Chip>
                                  </div>
                                  <div className="flex items-center gap-3 text-[10px] text-slate-400">
                                    <span>키 식별: <code className="bg-slate-50 px-1 py-0.5 rounded font-mono font-bold text-indigo-600">{key.key_prefix}</code></span>
                                    <span>발급일: {formatDate(key.created_at)}</span>
                                  </div>
                                </div>

                                <div className="flex items-center gap-6">
                                  <div className="text-right text-[10px] text-slate-400">
                                    <p className="font-bold">마지막 사용</p>
                                    <p className="font-mono text-slate-500 font-semibold">{formatDate(key.last_used_at)}</p>
                                  </div>

                                  <Tooltip content="API Key 삭제">
                                    <Button
                                      size="sm"
                                      variant="flat"
                                      color="danger"
                                      isIconOnly
                                      onClick={() => handleDeleteApiKey(key.id)}
                                      className="rounded-lg w-8 h-8 min-w-0 p-0"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                  </Tooltip>
                                </div>
                              </CardContent>
                            </Card>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <Card className="bg-slate-900 border border-slate-800 text-slate-300 rounded-3xl shadow-lg">
                    <CardContent className="p-6 space-y-4">
                      <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                        <Terminal className="w-4 h-4 text-emerald-400" />
                        <h4 className="font-bold text-sm text-slate-100 font-sans">OpenAPI v1 단축주소 연동 가이드</h4>
                      </div>

                      <div className="space-y-4 text-xs leading-relaxed">
                        <p className="text-[11px] text-slate-400">
                          발급된 API Key를 헤더에 포함하여 단축주소 생성 API를 외부 서비스에서 호출할 수 있습니다. (Rate Limit: 분당 최대 15회)
                        </p>

                        <div className="space-y-2">
                          <div className="flex items-center gap-1.5 font-bold text-slate-200">
                            <Chip size="sm" color="success" variant="flat" className="h-5 text-[9px] font-bold">POST</Chip>
                            <span className="font-mono">/api/v1/shorten</span>
                          </div>
                          
                          <p className="text-[10px] text-slate-400">Headers:</p>
                          <pre className="bg-slate-950 p-3 rounded-2xl font-mono text-[10px] text-emerald-400 overflow-x-auto">
  {`Content-Type: application/json
  x-api-key: edulink_your_api_key_here`}
                          </pre>

                          <p className="text-[10px] text-slate-400">Request Body (JSON):</p>
                          <pre className="bg-slate-950 p-3 rounded-2xl font-mono text-[10px] text-blue-400 overflow-x-auto">
  {`{
    "original_url": "https://school.go.kr/notice/123",
    "slug": "notice-123" (선택, 4~20자 영숫자/한글/하이픈),
    "is_public": true (선택, 메인 공개 여부 - 기본 false),
    "title": "연동 공지 링크" (선택),
    "description": "API 생성 주소" (선택)
  }`}
                          </pre>
                        </div>

                      </div>
                    </CardContent>
                  </Card>

                </div>

              </div>
            )
          )}

          {/* 개인정보관리 탭 */}
          {activeTab === 'profile' && user && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start animate-fade-in">
              
              {/* 성함 변경 카드 */}
              <Card className="bg-white border border-slate-100 rounded-3xl shadow-sm">
                <CardContent className="p-6 space-y-5 text-xs">
                  <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                    <User className="w-4 h-4 text-indigo-600" />
                    <h4 className="font-bold text-sm text-slate-800">개인정보 수정</h4>
                  </div>

                  <form onSubmit={handleUpdateProfile} className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="font-bold text-slate-600">이메일 주소 (수정 불가)</label>
                      <Input
                        size="sm"
                        value={user.email}
                        disabled
                        className="w-full opacity-70 cursor-not-allowed"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="font-bold text-slate-600">사용자명 (성함)</label>
                      <Input
                        size="sm"
                        required
                        placeholder="이름 입력"
                        value={newProfileName}
                        onChange={(e) => setNewProfileName(e.target.value)}
                        className="w-full"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="font-bold text-slate-600">소속 (학교/기관명)</label>
                      <Input
                        size="sm"
                        placeholder="대구광역시교육청 / 대구○○초등학교"
                        value={newProfileAffiliation}
                        onChange={(e) => setNewProfileAffiliation(e.target.value)}
                        className="w-full"
                      />
                    </div>

                    <Button
                      type="submit"
                      color="primary"
                      className="w-full rounded-xl font-bold mt-2 shadow-md shadow-primary/10"
                      isLoading={isUpdatingProfile}
                    >
                      변경사항 저장
                    </Button>
                  </form>
                </CardContent>
              </Card>

              {/* 등급 정보 상세 테이블 카드 */}
              <Card className="bg-white border border-slate-100 rounded-3xl shadow-sm lg:col-span-2">
                <CardContent className="p-6 space-y-4">
                  <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                    <ShieldCheck className="w-4 h-4 text-indigo-600" />
                    <h4 className="font-bold text-sm text-slate-800">회원등급 가이드</h4>
                  </div>

                  <div className="space-y-2 text-xs">
                    <p className="text-slate-500 mb-3 leading-normal">
                      에듀링크는 공공 및 교직원 전용 서비스를 위해 회원 등급제를 운영하고 있습니다.
                    </p>

                    <div className="space-y-3">
                      <div className={`p-3.5 rounded-2xl border flex items-center justify-between gap-3 ${user.level === 1 ? 'bg-indigo-50/30 border-indigo-100 shadow-sm' : 'bg-slate-50/50 border-slate-100'}`}>
                        <div className="space-y-1">
                          <h5 className="font-bold text-slate-800 flex items-center gap-1.5">
                            <Chip size="sm" variant="flat" color="default" className="h-5 text-[9px] font-bold">1단계</Chip>
                            일반회원 (일반 로그인)
                          </h5>
                          <p className="text-[10px] text-slate-400 leading-relaxed">외부 일반 이메일로 가입한 경우 해당되며, 타인의 단축주소 연결 및 조회 기능만 제공됩니다.</p>
                        </div>
                        {user.level === 1 && <Chip size="sm" color="primary" variant="solid" className="font-black text-[9px]">내 등급</Chip>}
                      </div>

                      <div className={`p-3.5 rounded-2xl border flex items-center justify-between gap-3 ${user.level === 2 ? 'bg-indigo-50/30 border-indigo-100 shadow-sm' : 'bg-slate-50/50 border-slate-100'}`}>
                        <div className="space-y-1">
                          <h5 className="font-bold text-slate-800 flex items-center gap-1.5">
                            <Chip size="sm" variant="flat" color="primary" className="h-5 text-[9px] font-bold">2단계</Chip>
                            인증사용자 (기관 인증)
                          </h5>
                          <p className="text-[10px] text-slate-400 leading-relaxed">공공/교육청 메일로 자동 승급되거나 수동 인증된 사용자로, 단축주소 발행, 수정, 삭제, QR 및 통계를 활용할 수 있습니다.</p>
                        </div>
                        {user.level === 2 && <Chip size="sm" color="primary" variant="solid" className="font-black text-[9px]">내 등급</Chip>}
                      </div>

                      <div className={`p-3.5 rounded-2xl border flex items-center justify-between gap-3 ${user.level === 3 ? 'bg-indigo-50/30 border-indigo-100 shadow-sm' : 'bg-slate-50/50 border-slate-100'}`}>
                        <div className="space-y-1">
                          <h5 className="font-bold text-slate-800 flex items-center gap-1.5">
                            <Chip size="sm" variant="flat" color="secondary" className="h-5 text-[9px] font-bold">3단계</Chip>
                            개발자 (API 연동 권한)
                          </h5>
                          <p className="text-[10px] text-slate-400 leading-relaxed">2단계 권한 외에 외부 시스템 및 학교 홈페이지와 API로 연동할 수 있도록 API Key 발급 권한을 제공받습니다.</p>
                        </div>
                        {user.level === 3 && <Chip size="sm" color="primary" variant="solid" className="font-black text-[9px]">내 등급</Chip>}
                      </div>

                      <div className={`p-3.5 rounded-2xl border flex items-center justify-between gap-3 ${user.level === 4 ? 'bg-indigo-50/30 border-indigo-100 shadow-sm' : 'bg-slate-50/50 border-slate-100'}`}>
                        <div className="space-y-1">
                          <h5 className="font-bold text-slate-800 flex items-center gap-1.5">
                            <Chip size="sm" variant="flat" color="danger" className="h-5 text-[9px] font-bold">4단계</Chip>
                            최고관리자 (전체 제어)
                          </h5>
                          <p className="text-[10px] text-slate-400 leading-relaxed">에듀링크 전체 데이터 및 사용자 가입 레벨 승급 수동 인증, 허용 도메인 관리, 전체 공지사항을 총괄 제어합니다.</p>
                        </div>
                        {user.level === 4 && <Chip size="sm" color="primary" variant="solid" className="font-black text-[9px]">내 등급</Chip>}
                      </div>
                    </div>

                  </div>
                </CardContent>
              </Card>

            </div>
          )}

          {/* 활용방법 탭 */}
          {activeTab === 'guide' && (
            <div className="space-y-6 animate-fade-in max-w-3xl">
              <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-8 rounded-3xl text-white space-y-2.5 shadow-lg shadow-indigo-100/50">
                <h3 className="text-xl font-bold font-sans">에듀링크(edu-link) 활용방법</h3>
                <p className="text-xs text-indigo-100 leading-relaxed">
                  에듀링크 서비스의 간단한 활용 방법 안내입니다. 상세 가이드는 추후 업데이트 예정입니다.
                </p>
              </div>

              <div className="bg-white border border-slate-100 rounded-3xl p-8 space-y-6 shadow-sm">
                <div className="space-y-4 text-xs text-slate-700">
                  <div className="border-l-4 border-indigo-500 pl-4 py-1 space-y-1">
                    <h4 className="font-bold text-slate-800 text-sm">1. 단축주소 생성 방법</h4>
                    <p className="text-slate-500 leading-relaxed">
                      대시보드 메인 화면의 주소 입력란에 줄이고자 하는 원본 URL을 입력한 후 '단축주소 생성' 버튼을 클릭합니다. 필요한 경우 원하는 단축 키워드(슬러그)를 직접 지정할 수 있습니다. (한글 슬러그 지원)
                    </p>
                  </div>

                  <div className="border-l-4 border-indigo-500 pl-4 py-1 space-y-1">
                    <h4 className="font-bold text-slate-800 text-sm">2. 비밀번호 및 만료일 설정</h4>
                    <p className="text-slate-500 leading-relaxed">
                      링크를 생성하거나 수정할 때 6자리 숫자로 된 비밀번호를 지정하여 보안 링크를 만들 수 있으며, 지정한 일시가 지나면 링크가 자동으로 폭파되어 리디렉션이 차단되도록 만료일을 설정할 수 있습니다.
                    </p>
                  </div>

                  <div className="border-l-4 border-indigo-500 pl-4 py-1 space-y-1">
                    <h4 className="font-bold text-slate-800 text-sm">3. QR 코드 및 공유</h4>
                    <p className="text-slate-500 leading-relaxed">
                      생성된 링크 우측의 QR 코드 아이콘을 누르면, 모바일에서 바로 스캔하여 접속하거나 이미지로 다운로드할 수 있는 전용 QR 코드 뷰어 페이지가 제공됩니다.
                    </p>
                  </div>

                  <div className="border-l-4 border-indigo-500 pl-4 py-1 space-y-1">
                    <h4 className="font-bold text-slate-800 text-sm">4. 개발자 도구 (API 연동)</h4>
                    <p className="text-slate-500 leading-relaxed">
                      3단계 개발자 권한 이상의 계정은 개발자 도구 탭에서 고유 API Key를 발급받아, 학교 홈페이지나 외부 시스템에서 직접 단축주소를 API 호출을 통해 대량 생성 및 연동할 수 있습니다.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 공지사항 탭 */}
          {activeTab === 'notices' && (
            <div className="space-y-6 animate-fade-in">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                <Megaphone className="w-4 h-4 text-purple-600" />
                <h4 className="font-bold text-sm text-slate-800">에듀링크 공지사항</h4>
              </div>

              {dashboardNotices.length === 0 ? (
                <Card className="bg-white border border-slate-100 rounded-3xl py-16 shadow-sm">
                  <CardContent className="text-center flex flex-col items-center gap-2">
                    <Megaphone className="w-12 h-12 text-slate-200" />
                    <p className="text-xs text-slate-400 font-medium">등록된 공지사항이 아직 존재하지 않습니다.</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="max-w-3xl space-y-3">
                  {dashboardNotices.map((notice) => {
                    const isExpanded = expandedNoticeId === notice.id;
                    return (
                      <Card 
                        key={notice.id} 
                        className={`border transition-all duration-300 rounded-2xl cursor-pointer shadow-sm
                          ${notice.is_pinned ? 'bg-amber-50/20 border-amber-100' : 'bg-white border-slate-100'}
                          ${isExpanded ? 'ring-1 ring-indigo-200 border-indigo-200' : ''}
                        `}
                        onClick={() => setExpandedNoticeId(isExpanded ? null : notice.id)}
                      >
                        <CardContent className="p-4 flex flex-col gap-2">
                          <div className="flex items-start justify-between gap-2 text-xs">
                            <div className="flex-1 space-y-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {notice.is_pinned === 1 && (
                                  <Chip 
                                    size="sm" 
                                    color="warning" 
                                    variant="flat" 
                                    className="px-1.5 py-0 h-5 text-[9px] font-bold text-amber-700"
                                  >
                                    📌 중요 고정
                                  </Chip>
                                )}
                                <span className="text-[10px] text-slate-400 font-medium">
                                  등록일시: {formatDate(notice.created_at)}
                                </span>
                              </div>
                              <h4 className="font-bold text-slate-800">
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
              )}
            </div>
          )}

          {/* 최고관리자 탭 */}
          {activeTab === 'admin' && user?.level === 4 && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start animate-fade-in">
              
              {/* 좌측: 도메인 설정 관리 */}
              <Card className="bg-white border border-slate-100 rounded-3xl shadow-sm lg:sticky lg:top-8">
                <CardContent className="p-6 space-y-4 text-xs">
                  <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                    <Globe className="w-4 h-4 text-red-500" />
                    <h4 className="font-bold text-sm text-slate-800">Zero Trust 허용 도메인 추가</h4>
                  </div>

                  <form onSubmit={handleAddDomain} className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="font-bold text-slate-600">이메일 도메인 명</label>
                      <Input
                        size="sm"
                        required
                        placeholder="예: dge.go.kr"
                        value={newDomain}
                        onChange={(e) => setNewDomain(e.target.value)}
                        className="w-full"
                      />
                    </div>
                    <Button
                      type="submit"
                      color="danger"
                      className="w-full rounded-xl font-bold mt-2 shadow-md shadow-danger/10 text-white"
                    >
                      도메인 등록
                    </Button>
                  </form>

                  <div className="pt-4 border-t border-slate-100 space-y-2">
                    <label className="font-bold text-slate-500">현재 허용 도메인 목록</label>
                    <div className="space-y-1.5">
                      {adminDomains.map((d) => (
                        <div key={d.id} className="flex items-center justify-between bg-slate-50 p-2 rounded-xl text-[11px]">
                          <span className="font-mono font-bold text-slate-700">{d.domain}</span>
                          <Button
                            size="sm"
                            variant="light"
                            color="danger"
                            isIconOnly
                            className="w-5 h-5 min-w-0 p-0 rounded-md"
                            onClick={() => handleDeleteDomain(d.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* 우측: 공지사항 관리 */}
              <div className="lg:col-span-2 space-y-6">
                
                {/* 1. 공지 등록 */}
                <Card className="bg-white border border-slate-100 rounded-3xl shadow-sm">
                  <CardContent className="p-6 space-y-4 text-xs">
                    <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                      <Settings className="w-4 h-4 text-red-500" />
                      <h4 className="font-bold text-sm text-slate-800">에듀링크 공지사항 작성</h4>
                    </div>

                    <form onSubmit={handleAddNotice} className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="font-bold text-slate-600">공지 제목</label>
                        <Input
                          size="sm"
                          required
                          placeholder="공지사항 제목을 입력하세요"
                          value={newNoticeTitle}
                          onChange={(e) => setNewNoticeTitle(e.target.value)}
                          className="w-full"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="font-bold text-slate-600">공지 내용</label>
                        <textarea
                          required
                          rows={4}
                          placeholder="내용을 자세히 입력하세요..."
                          value={newNoticeContent}
                          onChange={(e) => setNewNoticeContent(e.target.value)}
                          className="w-full border border-slate-200 bg-slate-50 focus:bg-white focus:border-indigo-400 outline-none rounded-xl p-3 text-xs text-slate-800 transition-all"
                        />
                      </div>

                      <div className="flex items-center gap-2 py-1">
                        <input
                          type="checkbox"
                          id="noticePin"
                          checked={newNoticePinned}
                          onChange={(e) => setNewNoticePinned(e.target.checked)}
                          className="rounded text-red-600 focus:ring-red-500 w-3.5 h-3.5"
                        />
                        <label htmlFor="noticePin" className="font-bold text-slate-600 select-none">
                          이 공지를 목록 최상단에 고정하기 (중요 공지)
                        </label>
                      </div>

                      <Button
                        type="submit"
                        color="danger"
                        className="w-full rounded-xl font-bold mt-2 shadow-md shadow-danger/10 text-white"
                      >
                        공지사항 등록
                      </Button>
                    </form>
                  </CardContent>
                </Card>

                {/* 2. 공지 리스트 */}
                <div className="space-y-3">
                  <h4 className="font-bold text-sm text-slate-800">등록된 공지 목록</h4>
                  <div className="space-y-2">
                    {adminNotices.map((n) => (
                      <Card key={n.id} className="bg-white border border-slate-100 rounded-2xl shadow-sm">
                        <CardContent className="p-4 flex items-start justify-between gap-4 text-xs">
                          <div className="space-y-1.5 flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {n.is_pinned === 1 && (
                                <Chip size="sm" color="warning" variant="flat" className="h-5 text-[9px] font-bold px-1.5">
                                  📌 고정됨
                                </Chip>
                              )}
                              <span className="text-[10px] text-slate-400">{formatDate(n.created_at)}</span>
                            </div>
                            <h5 className="font-bold text-slate-800 truncate">{n.title}</h5>
                            <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">{n.content}</p>
                          </div>
                          <Button
                            size="sm"
                            variant="flat"
                            color="danger"
                            isIconOnly
                            className="rounded-lg w-8 h-8 min-w-0 p-0 flex-shrink-0"
                            onClick={() => handleDeleteNotice(n.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              </div>

              {/* 어드민 사용자 등급 관리 섹션 */}
              <div className="lg:col-span-3 space-y-3 pt-6 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-sm text-slate-800">사용자 권한 등급 관리</h4>
                  <span className="text-xs text-slate-400">가입된 총 사용자 수: {adminUsers.length}명</span>
                </div>

                <Card className="bg-white border border-slate-100 rounded-3xl shadow-sm overflow-hidden">
                  <div className="overflow-x-auto w-full">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 font-bold">
                          <th className="p-4">ID</th>
                          <th className="p-4">사용자명</th>
                          <th className="p-4">소속</th>
                          <th className="p-4">이메일</th>
                          <th className="p-4">가입일시</th>
                          <th className="p-4">현재 등급</th>
                          <th className="p-4 text-center">권한 등급 조정</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700">
                        {adminUsers.map((u) => {
                          const isSelf = user && u.id === user.id;
                          return (
                          <tr key={u.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="p-4 font-mono font-bold">{u.id}</td>
                            <td className="p-4 font-bold">{u.name}{isSelf && <span className="ml-1 text-[9px] text-indigo-600 font-bold">(본인)</span>}</td>
                            <td className="p-4 text-slate-600">{u.affiliation || <span className="text-slate-300">—</span>}</td>
                            <td className="p-4 font-mono">{u.email}</td>
                            <td className="p-4 text-slate-400">{formatDate(u.created_at || null)}</td>
                            <td className="p-4">
                              <Chip
                                size="sm"
                                variant="flat"
                                color={
                                  u.level === 4 ? 'danger' :
                                  u.level === 3 ? 'secondary' :
                                  u.level === 2 ? 'primary' : 'default'
                                }
                                className="font-bold px-1.5 h-5 text-[9px]"
                              >
                                {
                                  u.level === 4 ? '4-최고관리자' :
                                  u.level === 3 ? '3-개발자' :
                                  u.level === 2 ? '2-인증사용자' : '1-일반회원'
                                }
                              </Chip>
                            </td>
                            <td className="p-4 text-center">
                              {isSelf ? (
                                <span className="text-[10px] text-slate-400 font-bold">본인 등급 조정 불가</span>
                              ) : (
                                <select
                                  value={u.level}
                                  onChange={(e) => handleUpdateUserLevel(u.id, Number(e.target.value))}
                                  className="bg-slate-50 border border-slate-200 rounded-lg text-[10px] font-bold text-slate-700 py-1.5 px-2 outline-none cursor-pointer focus:bg-white focus:border-indigo-400"
                                >
                                  <option value={1}>1-일반회원 (연결만)</option>
                                  <option value={2}>2-인증사용자 (링크생성)</option>
                                  <option value={3}>3-개발자 (+API키)</option>
                                  <option value={4}>4-최고관리자 (모든권한)</option>
                                </select>
                              )}
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>

            </div>
          )}

        </div>
      </main>

      {/* QR 코드 드로어 */}
      <QrDrawer link={qrModalLink} onClose={() => setQrModalLink(null)} />

      {/* 🗝 발급 키 1회 노출 모달 */}
      {showKeyResultModal && generatedKeyResult && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="max-w-md w-full border border-slate-200/40 shadow-2xl rounded-3xl p-2 bg-white animate-fade-in">
            <CardContent className="p-6 flex flex-col gap-4 text-xs">
              <div className="flex items-center gap-2 text-indigo-700 text-sm font-bold border-b border-slate-100 pb-3">
                <ShieldCheck className="w-5 h-5 text-emerald-500" />
                <span>API Key가 성공적으로 생성되었습니다</span>
              </div>
              
              <p className="text-[11px] text-slate-500 leading-relaxed">
                보안상의 사유로 아래의 API Key는 **이 화면을 닫으면 다시 조회할 수 없습니다**. 지금 즉시 복사하여 안전한 곳에 저장해 주시기 바랍니다.
              </p>

              <div className="bg-slate-50 border border-slate-100 p-3.5 rounded-2xl flex items-center justify-between font-mono font-bold text-slate-800 break-all select-all">
                <span>{generatedKeyResult}</span>
                <Button
                  size="sm"
                  color={keyResultCopied ? 'success' : 'primary'}
                  variant={keyResultCopied ? 'flat' : 'light'}
                  onClick={copyGeneratedKey}
                  isIconOnly
                  className="rounded-lg ml-2 flex-shrink-0"
                >
                  {keyResultCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                </Button>
              </div>

              <Button
                color="primary"
                className="w-full rounded-xl font-bold shadow-md shadow-primary/20"
                onClick={() => {
                  setShowKeyResultModal(false);
                  setGeneratedKeyResult(null);
                }}
              >
                키 복사 완료 및 창 닫기
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

    </div>
  );
}

// 일별 클릭 통계 바 차트 (SVG 기반, 외부 라이브러리 없음)
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
      <div className="flex flex-col items-center justify-center py-12 gap-3 text-slate-300">
        <BarChart3 className="w-10 h-10" />
        <p className="text-xs text-slate-400">최근 30일 간 접속 기록이 없습니다.</p>
      </div>
    );
  }

  // SVG 크기 계산
  const W = 340;
  const BAR_AREA_H = 90;
  const LABEL_OFFSET = 14;
  const H = BAR_AREA_H + LABEL_OFFSET + 6;
  const barW = Math.floor((W - 8) / DAYS) - 1;
  const step = (W - 8) / DAYS;

  return (
    <div className="space-y-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ overflow: 'visible' }}>
        {/* 최대값 기준선 */}
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
                fill={d.clicks > 0 ? '#6366f1' : '#e2e8f0'}
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

// QR 드로어 — 우측 슬라이드 드로어 + 복사 애니메이션 + PNG 다운로드 + 원본 슬러그 기준
function QrDrawer({ link, onClose }: { link: LinkItem | null; onClose: () => void }) {
  const qrSlug = link ? (link.base_slug || link.slug) : '';
  const shortUrl = link ? `${window.location.protocol}//${window.location.host}/${qrSlug}` : '';
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

  // 화면에 렌더된 <img>를 canvas로 그려서 PNG 다운로드 (서버 응답 무관)
  const handleDownload = async () => {
    if (downloading || !link) return;
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
    <div className={`fixed inset-0 z-50 overflow-hidden transition-all duration-300 ${link ? 'visible pointer-events-auto' : 'invisible pointer-events-none'}`}>
      <div
        className={`absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-300 ${link ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
        <div className={`w-screen max-w-md bg-white border-l border-slate-200 shadow-2xl flex flex-col transition-transform duration-300 transform ${link ? 'translate-x-0' : 'translate-x-full'}`}>
          {link && (
            <div className="h-full flex flex-col">
              {/* 헤더 */}
              <div className="p-6 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
                <div className="space-y-0.5 min-w-0">
                  <h3 className="font-bold text-base text-slate-800 flex items-center gap-2">
                    <QrCode className="w-4 h-4 text-indigo-600 flex-shrink-0" />
                    QR 코드
                  </h3>
                  <p className="text-[10px] text-indigo-600 font-bold font-mono truncate">
                    dgedu.link/{qrSlug}
                    {link.custom_slug && <span className="text-slate-400 font-normal"> · /{link.custom_slug}</span>}
                  </p>
                </div>
                <Button
                  size="sm" variant="light" isIconOnly
                  onClick={onClose}
                  className="rounded-lg w-7 h-7 min-w-0 p-0 text-slate-400 flex-shrink-0 ml-2"
                >✕</Button>
              </div>

              {/* 컨텐츠 */}
              <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center gap-6">
                {/* QR 이미지 */}
                <div className="bg-white border-2 border-slate-100 rounded-2xl p-4 shadow-sm">
                  <img
                    ref={imgRef}
                    src={`/qr/${qrSlug}`}
                    alt={`QR for /${qrSlug}`}
                    className="w-64 h-64 block"
                  />
                </div>

                {/* 단축주소 표시 */}
                <div className="w-full text-center space-y-1">
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">단축주소 (원본 슬러그)</p>
                  <code className="text-sm font-mono font-bold text-indigo-600 break-all">{shortUrl}</code>
                </div>

                {/* 복사 + 다운로드 버튼 */}
                <div className="w-full flex gap-2">
                  <Button
                    size="sm"
                    variant={copied ? 'solid' : 'flat'}
                    color={copied ? 'success' : 'default'}
                    className={`flex-1 rounded-xl font-bold text-xs transition-all duration-300 ${copied ? 'scale-[1.02]' : ''}`}
                    startContent={copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    onClick={handleCopy}
                  >
                    {copied ? '복사됨!' : '주소 복사'}
                  </Button>
                  <Button
                    size="sm"
                    color="primary"
                    className="flex-1 rounded-xl font-bold text-xs"
                    onClick={handleDownload}
                    isLoading={downloading}
                  >
                    ⬇ PNG 저장
                  </Button>
                </div>

                {/* 링크 기본 정보 */}
                <div className="w-full bg-slate-50 rounded-2xl p-4 space-y-3 text-xs">
                  {link.title && (
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-slate-400 font-bold flex-shrink-0">제목</span>
                      <span className="text-slate-800 font-semibold text-right break-words max-w-[240px]">{link.title}</span>
                    </div>
                  )}
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-slate-400 font-bold flex-shrink-0">원본 주소</span>
                    <a
                      href={link.original_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-600 font-mono text-[10px] text-right break-all hover:underline max-w-[240px]"
                    >
                      {link.original_url}
                    </a>
                  </div>
                  <div className="flex items-center justify-between gap-3 pt-1 border-t border-slate-100">
                    <span className="text-slate-400 font-bold">누적 클릭</span>
                    <span className="text-slate-800 font-extrabold text-base">{link.click_count ?? 0}<span className="text-xs font-normal text-slate-400 ml-1">회</span></span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
