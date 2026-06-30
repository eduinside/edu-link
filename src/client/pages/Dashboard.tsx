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
  LogIn,
  Menu,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import SurveyTab from './SurveyTab';
import PagesTab from './PagesTab';
import { FileText } from 'lucide-react';

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
  created_by?: 'web' | 'api';
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

interface UpgradeRequest {
  id: number;
  user_id: number;
  current_level: number;
  requested_level: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by: number | null;
  reviewed_at: string | null;
  created_at: string;
  // admin view extras
  email?: string;
  name?: string;
  affiliation?: string;
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
  const [activeTab, setActiveTab] = useState<'links' | 'surveys' | 'pages' | 'apikeys' | 'profile' | 'guide' | 'notices' | 'admin'>('links');
  const [linkSourceFilter, setLinkSourceFilter] = useState<'web' | 'api'>('web');
  
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

  // 승급 요청 상태 (사용자용)
  const [upgradeRequests, setUpgradeRequests] = useState<UpgradeRequest[]>([]);
  const [upgradeReqLevel, setUpgradeReqLevel] = useState(0);
  const [upgradeReqReason, setUpgradeReqReason] = useState('');
  const [isSubmittingUpgrade, setIsSubmittingUpgrade] = useState(false);

  // 승급 요청 관리 (최고관리자용)
  const [adminUpgradeRequests, setAdminUpgradeRequests] = useState<UpgradeRequest[]>([]);
  const [isProcessingRequest, setIsProcessingRequest] = useState<number | null>(null);

  // 최고관리자 서브탭
  const [adminSubTab, setAdminSubTab] = useState<'overview' | 'notices' | 'settings'>('overview');

  // 공지사항 수정 상태
  const [editingNotice, setEditingNotice] = useState<Notice | null>(null);
  const [editNoticeTitle, setEditNoticeTitle] = useState('');
  const [editNoticeContent, setEditNoticeContent] = useState('');
  const [editNoticePinned, setEditNoticePinned] = useState(false);
  const [isSavingNotice, setIsSavingNotice] = useState(false);

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
        } else if (data.user.level < 3 && (activeTab === 'apikeys' || activeTab === 'surveys' || activeTab === 'pages')) {
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

  // 내 승급 요청 현황 조회
  const fetchUpgradeRequests = async () => {
    try {
      const res = await fetch('/api/auth/upgrade-request', { headers: getHeaders() });
      const data = await res.json();
      if (data.success) setUpgradeRequests(data.requests);
    } catch { /* 무시 */ }
  };

  // 승급 요청 제출
  const handleSubmitUpgradeRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!upgradeReqLevel || !upgradeReqReason.trim()) return;
    setIsSubmittingUpgrade(true);
    setError('');
    setSuccessMsg('');
    try {
      const res = await fetch('/api/auth/upgrade-request', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ requested_level: upgradeReqLevel, reason: upgradeReqReason })
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMsg(data.message);
        setUpgradeReqReason('');
        setUpgradeReqLevel(0);
        fetchUpgradeRequests();
      } else {
        setError(data.error || '승급 요청 실패');
      }
    } catch {
      setError('서버 연결 실패');
    } finally {
      setIsSubmittingUpgrade(false);
    }
  };

  // 관리자: 승급 요청 목록 조회
  const fetchAdminUpgradeRequests = async () => {
    try {
      const res = await fetch('/api/admin/upgrade-requests', { headers: getHeaders() });
      const data = await res.json();
      if (data.success) setAdminUpgradeRequests(data.requests);
    } catch { /* 무시 */ }
  };

  // 관리자: 승급 요청 처리
  const handleProcessUpgradeRequest = async (reqId: number, action: 'approve' | 'reject') => {
    setIsProcessingRequest(reqId);
    setError('');
    setSuccessMsg('');
    try {
      const res = await fetch(`/api/admin/upgrade-requests/${reqId}`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({ action })
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMsg(data.message);
        fetchAdminUpgradeRequests();
        fetchAdminData();
      } else {
        setError(data.error || '처리 실패');
      }
    } catch {
      setError('서버 연결 실패');
    } finally {
      setIsProcessingRequest(null);
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
      fetchAdminUpgradeRequests();
    }
    if (activeTab === 'profile' && user && user.level <= 2) {
      fetchUpgradeRequests();
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

  // 공지 수정 핸들러
  const handleEditNotice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingNotice) return;
    setIsSavingNotice(true);
    setError('');
    setSuccessMsg('');
    try {
      const res = await fetch(`/api/admin/notices/${editingNotice.id}`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({ title: editNoticeTitle, content: editNoticeContent, is_pinned: editNoticePinned })
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMsg('공지사항이 수정되었습니다.');
        setEditingNotice(null);
        fetchAdminData();
      } else {
        setError(data.error || '공지 수정 실패');
      }
    } catch {
      setError('서버 연결 실패');
    } finally {
      setIsSavingNotice(false);
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

  const filteredLinks = links.filter(link => {
    if (linkSourceFilter === 'api') {
      return link.created_by === 'api';
    }
    return link.created_by !== 'api';
  });

  return (
    <div className="h-screen bg-paper flex overflow-hidden">
      
      {/* 1. 사이드바 내비게이션 (edu-portal Codeit 디자인) */}
      <aside
        className={`flex shrink-0 flex-col overflow-x-hidden border-r border-slate-200 bg-white transition-[width] duration-200 z-20 ${
          isSidebarOpen ? 'w-60' : 'w-[62px]'
        }`}
      >
        {/* 로고 헤더 */}
        <div className={`flex items-center gap-2.5 pb-2 pt-4 ${isSidebarOpen ? 'px-3.5' : 'justify-center px-2'}`}>
          <img
            src="/edulink_logo.png"
            alt="에듀링크 로고"
            className="size-9 shrink-0 rounded-lg object-cover"
          />
          {isSidebarOpen && (
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-900">에듀링크</div>
              <div className="truncate text-xs text-slate-500">교육 단축주소 플랫폼</div>
            </div>
          )}
        </div>

        {/* 1차 네비게이션 */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2.5 py-2">
          {[
            { key: 'links', label: '단축주소 관리', Icon: LayoutDashboard, show: !!user && user.level >= 2, danger: false, onClick: () => setActiveTab('links') },
            { key: 'surveys', label: '설문 관리', Icon: FileText, show: !!user && user.level >= 3, danger: false, onClick: () => setActiveTab('surveys') },
            { key: 'pages', label: '페이지 관리', Icon: Globe, show: !!user && user.level >= 3, danger: false, onClick: () => setActiveTab('pages') },
            { key: 'apikeys', label: '개발자 도구', Icon: Terminal, show: !!user && user.level >= 3, danger: false, onClick: () => setActiveTab('apikeys') },
            { key: 'profile', label: '개인정보관리', Icon: User, show: true, danger: false, onClick: () => { setActiveTab('profile'); if (user) { setNewProfileName(user.name); setNewProfileAffiliation(user.affiliation || ''); } } },
            { key: 'guide', label: '활용방법', Icon: BookOpen, show: true, danger: false, onClick: () => setActiveTab('guide') },
            { key: 'notices', label: '공지사항', Icon: Megaphone, show: true, danger: false, onClick: () => { setActiveTab('notices'); fetchNotices(); } },
            { key: 'admin', label: '최고관리자 모드', Icon: ShieldAlert, show: user?.level === 4, danger: true, onClick: () => setActiveTab('admin') },
          ]
            .filter((it) => it.show)
            .map((it) => {
              const active = activeTab === it.key;
              const Icon = it.Icon;
              const activeCls = it.danger ? 'bg-rose-50 text-rose-600' : 'bg-brand-50 text-brand-700';
              return (
                <button
                  key={it.key}
                  onClick={it.onClick}
                  title={isSidebarOpen ? undefined : it.label}
                  className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    active ? activeCls : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Icon className="size-4.5 shrink-0" strokeWidth={2} />
                  {isSidebarOpen && <span className="flex-1 truncate text-left">{it.label}</span>}
                </button>
              );
            })}
        </nav>

        {/* 최하단 고정: 사용자 정보 */}
        <div className="border-t border-slate-200 p-2.5">
          <div className={`flex items-center gap-2.5 rounded-lg px-2 py-2 ${isSidebarOpen ? '' : 'justify-center'}`}>
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">
              {user?.name?.charAt(0) ?? '?'}
            </span>
            {isSidebarOpen && user && (
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold text-slate-800">{user.name}</span>
                  <span className="shrink-0 rounded-md bg-brand-50 px-1.5 text-[10px] font-bold text-brand-700">Lv.{user.level}</span>
                </div>
                <div className="truncate text-xs text-slate-500">{user.email}</div>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* 2. 본문 영역 */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 z-10">
          <button
            onClick={() => setIsSidebarOpen((v) => !v)}
            className="grid size-9 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
            aria-label="사이드바 토글"
            title="사이드바 토글"
          >
            <Menu className="size-5" />
          </button>

          <h1 className="text-base font-semibold text-slate-900">
            {activeTab === 'links' && '단축주소 관리'}
            {activeTab === 'surveys' && '설문 관리'}
            {activeTab === 'pages' && '페이지 관리'}
            {activeTab === 'apikeys' && '개발자 도구 (API Keys)'}
            {activeTab === 'profile' && '개인정보관리'}
            {activeTab === 'guide' && '에듀링크 활용방법'}
            {activeTab === 'notices' && '에듀링크 공지사항'}
            {activeTab === 'admin' && '최고관리자 대시보드'}
          </h1>

          <div className="ml-auto flex items-center gap-1.5">
            {!window.location.host.includes('dgedu.link') && (
              <div
                className="hidden items-center gap-1.5 rounded-lg bg-slate-100 p-1 md:flex"
                title="개발/테스트 환경 전용 — 다른 권한 등급의 UX 미리보기"
              >
                <span className="px-1.5 text-[10px] font-bold text-slate-500">🧪 모의 권한:</span>
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
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-700 outline-none focus:border-brand-400 cursor-pointer"
                >
                  <option value="default">실제 로그인 계정</option>
                  <option value="login">1-일반회원 (Gmail 등)</option>
                  <option value="authenticated">2-인증사용자 (교직원 등)</option>
                  <option value="developer">3-고급사용자 (연동계정)</option>
                  <option value="admin">4-최고관리자 (전체제어)</option>
                </select>
              </div>
            )}

            {user && (
              <span
                title={
                  user.level === 4 ? '모든 권한 + 도메인·사용자·승급 요청 관리' :
                  user.level === 3 ? '단축주소 + 설문 + API Key 발급/외부 연동 가능' :
                  user.level === 2 ? '단축주소 생성·관리 가능' :
                  '조회만 가능 — 인증 후 승급 요청 필요'
                }
                className={`hidden cursor-help items-center rounded-full px-2.5 py-1 text-xs font-medium sm:inline-flex ${
                  user.level === 4 ? 'bg-rose-50 text-rose-600' :
                  user.level === 3 ? 'bg-violet-50 text-violet-700' :
                  user.level === 2 ? 'bg-brand-50 text-brand-700' :
                  'bg-slate-100 text-slate-500'
                }`}
              >
                {
                  user.level === 4 ? '👑 최고관리자' :
                  user.level === 3 ? '⚡ 고급사용자' :
                  user.level === 2 ? '🛡️ 인증사용자' : '👤 일반회원'
                }
              </span>
            )}

            <button
              onClick={() => navigate('/')}
              className="grid size-9 shrink-0 place-items-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100"
              aria-label="홈페이지 이동"
              title="에듀링크 홈페이지로 이동"
            >
              <Globe className="size-4.5" />
            </button>

            <button
              onClick={async () => {
                try {
                  await fetch('/api/auth/logout', { method: 'POST' });
                  navigate('/');
                } catch (e) {
                  console.error(e);
                  navigate('/');
                }
              }}
              className="grid size-9 shrink-0 place-items-center rounded-lg text-slate-600 transition-colors hover:bg-rose-50 hover:text-rose-600"
              aria-label="로그아웃"
              title="현재 세션을 종료하고 로그아웃합니다"
            >
              <LogOut className="size-4.5" />
            </button>
          </div>
        </header>

        {/* 3. 본문 영역 스크롤뷰 */}
        <div className="flex-1 overflow-y-auto p-8 max-w-7xl w-full mx-auto space-y-8">
          {activeTab === 'links' && (
            <>
              {user && user.level < 2 && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-start gap-3 mb-6 animate-fade-in">
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
                <Card className="bg-white border border-slate-100 rounded-xl shadow-sm">
                  <CardContent className="p-4 flex flex-col items-center gap-2 text-center">
                    <div className="bg-blue-50 p-2.5 rounded-xl text-blue-600">
                      <Link2 className="w-5 h-5" />
                    </div>
                    <h3 className="text-2xl font-extrabold text-slate-800 font-display">{links.length}개</h3>
                    <p className="text-[11px] text-slate-400 font-bold">생성된 단축주소</p>
                  </CardContent>
                </Card>

                <Card className="bg-white border border-slate-100 rounded-xl shadow-sm">
                  <CardContent className="p-4 flex flex-col items-center gap-2 text-center">
                    <div className="bg-emerald-50 p-2.5 rounded-xl text-emerald-600">
                      <BarChart3 className="w-5 h-5" />
                    </div>
                    <h3 className="text-2xl font-extrabold text-slate-800 font-display">{totalClicks}회</h3>
                    <p className="text-[11px] text-slate-400 font-bold">누적 접속(클릭) 수</p>
                  </CardContent>
                </Card>

                <Card className="bg-white border border-slate-100 rounded-xl shadow-sm">
                  <CardContent className="p-4 flex flex-col items-center gap-2 text-center">
                    <div className="bg-purple-50 p-2.5 rounded-xl text-purple-600">
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
                  <Card className="bg-white border border-slate-100 rounded-xl shadow-sm overflow-hidden">
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
                        <Tooltip content={user && user.level < 2 ? '인증사용자(Lv.2) 이상만 생성 가능' : '상세 설정 드로어가 열립니다'} delay={200}>
                          <Button
                            type="submit"
                            color={user && user.level < 2 ? 'default' : 'primary'}
                            className="rounded-xl font-bold px-6 h-10 flex-shrink-0 shadow-md shadow-primary/10"
                            disabled={user && user.level < 2}
                          >
                            단축주소 생성
                          </Button>
                        </Tooltip>
                      </form>
                    </CardContent>
                  </Card>

                  {/* 단축 링크 목록 — 테이블 */}
                  <div className="space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <h4 className="font-bold text-sm text-slate-800">단축 링크 목록</h4>
                      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200/40">
                        <Tooltip content="대시보드에서 직접 생성한 단축주소" delay={200}>
                        <button
                          type="button"
                          onClick={() => setLinkSourceFilter('web')}
                          className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                            linkSourceFilter === 'web'
                              ? 'bg-white text-brand-600 shadow-sm'
                              : 'text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          <Link2 className="w-3 h-3" />
                          일반 링크
                          <span className={`ml-1 text-[9px] px-1.5 py-0.2 rounded-full font-bold ${
                            linkSourceFilter === 'web'
                              ? 'bg-brand-50 text-brand-600'
                              : 'bg-slate-200 text-slate-500'
                          }`}>
                            {links.filter(l => l.created_by !== 'api').length}
                          </span>
                        </button>
                        </Tooltip>
                        <Tooltip content="API Key로 외부에서 생성한 단축주소" delay={200}>
                        <button
                          type="button"
                          onClick={() => setLinkSourceFilter('api')}
                          className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                            linkSourceFilter === 'api'
                              ? 'bg-white text-brand-600 shadow-sm'
                              : 'text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          <Terminal className="w-3 h-3" />
                          API 생성 링크
                          <span className={`ml-1 text-[9px] px-1.5 py-0.2 rounded-full font-bold ${
                            linkSourceFilter === 'api'
                              ? 'bg-brand-50 text-brand-600'
                              : 'bg-slate-200 text-slate-500'
                          }`}>
                            {links.filter(l => l.created_by === 'api').length}
                          </span>
                        </button>
                        </Tooltip>
                      </div>
                    </div>

                    {filteredLinks.length === 0 ? (
                      <Card className="bg-white border border-slate-100 rounded-xl py-16 shadow-sm">
                        <CardContent className="text-center flex flex-col items-center gap-2">
                          <Link2 className="w-12 h-12 text-slate-200" />
                          <p className="text-xs text-slate-400 font-medium">
                            {linkSourceFilter === 'api' 
                              ? '아직 API로 생성된 단축 링크가 존재하지 않습니다.'
                              : '아직 대시보드에서 직접 생성한 단축 링크가 존재하지 않습니다.'
                            }
                          </p>
                        </CardContent>
                      </Card>
                    ) : (
                      <div className="bg-white border border-slate-100 rounded-xl shadow-sm overflow-hidden">
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
                              {filteredLinks.map((link) => {
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
                                        <div className="font-mono text-[10px] text-brand-500 mt-0.5">
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
                                        <Tooltip content={isCopied ? '복사됨!' : '단축주소 클립보드에 복사'} delay={200}>
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

                                        <Tooltip content="새 탭에서 단축주소 열기" delay={200}>
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
                                            onClick={() => setQrModalLink(link)}
                                            className="rounded-lg w-7 h-7 min-w-0 p-0"
                                          >
                                            <QrCode className="w-3 h-3" />
                                          </Button>
                                        </Tooltip>

                                        <Tooltip content="접속 통계 보기 (최근 30일 클릭 차트)" delay={200}>
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

                                        <Tooltip content="제목·URL·비밀번호·만료일 편집" delay={200}>
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

                                        <Tooltip content="단축주소 영구 삭제" delay={200}>
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
                                  <p className="text-[10px] text-brand-600 font-bold font-display">
                                    dgedu.link/{editingLink.base_slug || editingLink.slug}
                                    {editingLink.custom_slug && <span className="text-slate-400 font-normal"> · /{editingLink.custom_slug}</span>}
                                  </p>
                                </div>
                                <Chip size="sm" variant="flat" color="secondary">수정 모드</Chip>
                              </div>
 
                              <form onSubmit={handleUpdateLink} id="editForm" className="space-y-4 text-xs">
                                {/* 슬러그 섹션 */}
                                <div className="space-y-2 p-3 rounded-lg bg-slate-50 border border-slate-100">
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
                                      className="rounded text-brand-600 focus:ring-brand-500 w-3.5 h-3.5"
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
                                          className="px-3 py-1 text-[11px] font-bold rounded-lg bg-brand-600 text-white disabled:opacity-40 hover:bg-brand-700 transition-colors whitespace-nowrap"
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
                                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-400"
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
                                      className="rounded text-brand-600 focus:ring-brand-500 w-3.5 h-3.5"
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
                                      className="rounded text-brand-600 focus:ring-brand-500 w-3.5 h-3.5"
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
                                      className="rounded text-brand-600 focus:ring-brand-500 w-3.5 h-3.5"
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
                                className="flex-1 rounded-lg font-bold"
                                onClick={() => setEditingLink(null)}
                              >
                                취소
                              </Button>
                              <Button
                                type="submit"
                                form="editForm"
                                color="primary"
                                className="flex-1 rounded-lg font-bold shadow-md shadow-primary/10"
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
                                <p className="text-[10px] text-brand-600 font-bold font-display">세부 설정 후 생성합니다</p>
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
                                    className="rounded text-brand-600 focus:ring-brand-500 w-3.5 h-3.5"
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
                                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-400"
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
                                    className="rounded text-brand-600 focus:ring-brand-500 w-3.5 h-3.5"
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
                                    className="rounded text-brand-600 focus:ring-brand-500 w-3.5 h-3.5"
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
                              className="flex-1 rounded-lg font-bold"
                              onClick={() => setIsCreateDrawerOpen(false)}
                            >
                              취소
                            </Button>
                            <Button
                              type="submit"
                              form="createForm"
                              color="primary"
                              className="flex-1 rounded-lg font-bold shadow-md shadow-primary/10"
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
                                  <TrendingUp className="w-4 h-4 text-brand-600 flex-shrink-0" />
                                  접속 통계
                                </h3>
                                <p className="text-[10px] text-brand-600 font-bold font-mono truncate">
                                  dgedu.link/{statsDrawerLink.base_slug || statsDrawerLink.slug}
                                  {statsDrawerLink.custom_slug && <span className="text-slate-400 font-normal"> · /{statsDrawerLink.custom_slug}</span>}
                                </p>
                              </div>
                              <Tooltip content="통계 패널 닫기" delay={300}>
                                <Button
                                  size="sm" variant="light" isIconOnly
                                  onClick={() => setStatsDrawerLink(null)}
                                  className="rounded-lg w-7 h-7 min-w-0 p-0 text-slate-400 flex-shrink-0 ml-2"
                                >✕</Button>
                              </Tooltip>
                            </div>

                            {/* 컨텐츠 */}
                            <div className="flex-1 overflow-y-auto p-6 space-y-6">
                              {/* 기본 정보 */}
                              <div className="bg-slate-50 rounded-xl p-4 space-y-3 text-xs">
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
                                    className="text-brand-600 font-mono text-[10px] text-right break-all hover:underline max-w-[240px]"
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
                                    <BarChart3 className="w-3.5 h-3.5 text-brand-500" />
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
                                    <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
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

          {/* 설문 관리 탭 */}
          {activeTab === 'surveys' && (
            user && user.level < 3 ? (
              <Card className="bg-white border border-slate-100 rounded-xl p-6 shadow-sm">
                <CardContent className="text-center flex flex-col items-center gap-4 py-8">
                  <div className="bg-amber-50 p-4 rounded-xl text-amber-500">
                    <ShieldAlert className="w-10 h-10" />
                  </div>
                  <div className="space-y-1.5 max-w-md mx-auto">
                    <h3 className="font-bold text-base text-slate-800">설문 기능 권한이 제한되어 있습니다</h3>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      설문지 생성·관리는 <strong>(3)단계 고급사용자</strong> 등급 이상부터 사용 가능합니다.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <SurveyTab
                getHeaders={getHeaders}
                setSuccessMsg={setSuccessMsg}
                setError={setError}
                setQrModalLink={setQrModalLink}
                userEmail={user?.email}
              />
            )
          )}

          {/* 페이지 관리 탭 */}
          {activeTab === 'pages' && (
            user && user.level < 3 ? (
              <Card className="bg-white border border-slate-100 rounded-xl p-6 shadow-sm">
                <CardContent className="text-center flex flex-col items-center gap-4 py-8">
                  <div className="bg-amber-50 p-4 rounded-xl text-amber-500">
                    <ShieldAlert className="w-10 h-10" />
                  </div>
                  <div className="space-y-1.5 max-w-md mx-auto">
                    <h3 className="font-bold text-base text-slate-800">페이지 기능 권한이 제한되어 있습니다</h3>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      페이지(사이트) 생성·관리는 <strong>(3)단계 고급사용자</strong> 등급 이상부터 사용 가능합니다.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <PagesTab
                getHeaders={getHeaders}
                setSuccessMsg={setSuccessMsg}
                setError={setError}
              />
            )
          )}

          {/* API Keys 탭 */}
          {activeTab === 'apikeys' && (
            user && user.level < 3 ? (
              <Card className="bg-white border border-slate-100 rounded-xl p-6 shadow-sm">
                <CardContent className="text-center flex flex-col items-center gap-4 py-8">
                  <div className="bg-amber-50 p-4 rounded-xl text-amber-500">
                    <ShieldAlert className="w-10 h-10" />
                  </div>
                  <div className="space-y-1.5 max-w-md mx-auto">
                    <h3 className="font-bold text-base text-slate-800">개발자 도구 권한이 제한되어 있습니다</h3>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      API Key 발급 및 외부 연동 OpenAPI 가이드는 <strong>(3)단계 고급사용자</strong> 등급 이상부터 액세스하실 수 있습니다.<br />
                      현재 등급은 <strong>{user.level === 2 ? '2단계: 인증사용자' : '1단계: 일반회원'}</strong>이며, 최고관리자에게 승급 인증을 요청해 주시기 바랍니다.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 items-start">
                
                <Card className="bg-white border border-slate-100 rounded-xl shadow-sm xl:sticky xl:top-8">
                  <CardContent className="p-6 space-y-4">
                    <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                      <KeyRound className="w-4 h-4 text-brand-600" />
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
                        className="w-full rounded-lg font-bold mt-2 shadow-md shadow-primary/20"
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
                      <Card className="bg-white border border-slate-100 rounded-xl py-12 shadow-sm">
                        <CardContent className="text-center flex flex-col items-center gap-2">
                          <KeyRound className="w-10 h-10 text-slate-200" />
                          <p className="text-xs text-slate-400 font-medium">아직 발급받은 API 키가 존재하지 않습니다.</p>
                        </CardContent>
                      </Card>
                    ) : (
                      <div className="space-y-3">
                        {apiKeys.map((key) => {
                          return (
                            <Card key={key.id} className="bg-white border border-slate-100 rounded-xl shadow-sm">
                              <CardContent className="p-4 flex items-center justify-between gap-4 text-xs">
                                <div className="space-y-1 flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-slate-800 truncate">{key.name}</span>
                                    <Chip size="sm" variant="flat" color="secondary" className="px-1.5 h-5 text-[9px] font-bold">
                                      ACTIVE
                                    </Chip>
                                  </div>
                                  <div className="flex items-center gap-3 text-[10px] text-slate-400">
                                    <span>키 식별: <code className="bg-slate-50 px-1 py-0.5 rounded font-mono font-bold text-brand-600">{key.key_prefix}</code></span>
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

                  <Card className="bg-slate-900 border border-slate-800 text-slate-300 rounded-xl shadow-lg">
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
                          <pre className="bg-slate-950 p-3 rounded-xl font-mono text-[10px] text-emerald-400 overflow-x-auto">
  {`Content-Type: application/json
  x-api-key: edulink_your_api_key_here`}
                          </pre>

                          <p className="text-[10px] text-slate-400">Request Body (JSON):</p>
                          <pre className="bg-slate-950 p-3 rounded-xl font-mono text-[10px] text-blue-400 overflow-x-auto">
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
              <Card className="bg-white border border-slate-100 rounded-xl shadow-sm">
                <CardContent className="p-6 space-y-5 text-xs">
                  <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                    <User className="w-4 h-4 text-brand-600" />
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
                      className="w-full rounded-lg font-bold mt-2 shadow-md shadow-primary/10"
                      isLoading={isUpdatingProfile}
                    >
                      변경사항 저장
                    </Button>
                  </form>
                </CardContent>
              </Card>

              {/* 등급 정보 상세 테이블 카드 */}
              <Card className="bg-white border border-slate-100 rounded-xl shadow-sm lg:col-span-2">
                <CardContent className="p-6 space-y-4">
                  <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                    <ShieldCheck className="w-4 h-4 text-brand-600" />
                    <h4 className="font-bold text-sm text-slate-800">회원등급 가이드</h4>
                  </div>

                  <div className="space-y-2 text-xs">
                    <p className="text-slate-500 mb-3 leading-normal">
                      에듀링크는 공공 및 교직원 전용 서비스를 위해 회원 등급제를 운영하고 있습니다.
                    </p>

                    <div className="space-y-3">
                      <div className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 ${user.level === 1 ? 'bg-brand-50/30 border-brand-100 shadow-sm' : 'bg-slate-50/50 border-slate-100'}`}>
                        <div className="space-y-1">
                          <h5 className="font-bold text-slate-800 flex items-center gap-1.5">
                            <Chip size="sm" variant="flat" color="default" className="h-5 text-[9px] font-bold">1단계</Chip>
                            일반회원 (일반 로그인)
                          </h5>
                          <p className="text-[10px] text-slate-400 leading-relaxed">외부 일반 이메일로 가입한 경우 해당되며, 타인의 단축주소 연결 및 조회 기능만 제공됩니다.</p>
                        </div>
                        {user.level === 1 && <Chip size="sm" color="primary" variant="solid" className="font-black text-[9px]">내 등급</Chip>}
                      </div>

                      <div className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 ${user.level === 2 ? 'bg-brand-50/30 border-brand-100 shadow-sm' : 'bg-slate-50/50 border-slate-100'}`}>
                        <div className="space-y-1">
                          <h5 className="font-bold text-slate-800 flex items-center gap-1.5">
                            <Chip size="sm" variant="flat" color="primary" className="h-5 text-[9px] font-bold">2단계</Chip>
                            인증사용자 (기관 인증)
                          </h5>
                          <p className="text-[10px] text-slate-400 leading-relaxed">공공/교육청 메일로 자동 승급되거나 수동 인증된 사용자로, 단축주소 발행, 수정, 삭제, QR 및 통계를 활용할 수 있습니다.</p>
                        </div>
                        {user.level === 2 && <Chip size="sm" color="primary" variant="solid" className="font-black text-[9px]">내 등급</Chip>}
                      </div>

                      <div className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 ${user.level === 3 ? 'bg-brand-50/30 border-brand-100 shadow-sm' : 'bg-slate-50/50 border-slate-100'}`}>
                        <div className="space-y-1">
                          <h5 className="font-bold text-slate-800 flex items-center gap-1.5">
                            <Chip size="sm" variant="flat" color="secondary" className="h-5 text-[9px] font-bold">3단계</Chip>
                            고급사용자 (설문·API 연동 권한)
                          </h5>
                          <p className="text-[10px] text-slate-400 leading-relaxed">2단계 권한 외에 설문지 생성·관리 및 외부 시스템 연동을 위한 API Key 발급 권한을 제공받습니다.</p>
                        </div>
                        {user.level === 3 && <Chip size="sm" color="primary" variant="solid" className="font-black text-[9px]">내 등급</Chip>}
                      </div>

                      <div className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 ${user.level === 4 ? 'bg-brand-50/30 border-brand-100 shadow-sm' : 'bg-slate-50/50 border-slate-100'}`}>
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

              {/* 승급 요청 카드 (1단계, 2단계 사용자만 표시) */}
              {user.level <= 2 && (
                <div className="lg:col-span-3 grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* 요청 제출 폼 */}
                  <Card className="bg-white border border-slate-100 rounded-xl shadow-sm">
                    <CardContent className="p-6 space-y-5 text-xs">
                      <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                        <ShieldAlert className="w-4 h-4 text-amber-500" />
                        <h4 className="font-bold text-sm text-slate-800">상위 등급 승급 요청</h4>
                      </div>
                      <p className="text-slate-500 leading-relaxed">
                        현재 등급보다 높은 권한이 필요한 경우, 아래 양식을 작성하여 최고관리자에게 승급 요청을 제출하세요.
                      </p>
                      <form onSubmit={handleSubmitUpgradeRequest} className="space-y-4">
                        <div className="space-y-1.5">
                          <label className="font-bold text-slate-600">요청 등급</label>
                          <select
                            required
                            value={upgradeReqLevel}
                            onChange={(e) => setUpgradeReqLevel(Number(e.target.value))}
                            className="w-full bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 py-2.5 px-3 outline-none focus:bg-white focus:border-brand-400 transition-colors"
                          >
                            <option value={0} disabled>— 요청할 등급 선택 —</option>
                            {user.level < 2 && <option value={2}>2단계: 인증사용자 (링크 생성·관리)</option>}
                            {user.level < 3 && <option value={3}>3단계: 고급사용자 (설문·API Key 발급)</option>}
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <label className="font-bold text-slate-600">요청 사유</label>
                          <textarea
                            required
                            rows={4}
                            placeholder="승급이 필요한 이유, 소속 기관, 활용 목적 등을 구체적으로 작성해 주세요."
                            value={upgradeReqReason}
                            onChange={(e) => setUpgradeReqReason(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 py-2.5 px-3 outline-none focus:bg-white focus:border-brand-400 transition-colors resize-none leading-relaxed"
                          />
                        </div>
                        <Button
                          type="submit"
                          color="warning"
                          variant="flat"
                          className="w-full rounded-lg font-bold mt-1"
                          isLoading={isSubmittingUpgrade}
                          isDisabled={!upgradeReqLevel || !upgradeReqReason.trim()}
                        >
                          승급 요청 제출
                        </Button>
                      </form>
                    </CardContent>
                  </Card>

                  {/* 내 요청 현황 */}
                  <Card className="bg-white border border-slate-100 rounded-xl shadow-sm">
                    <CardContent className="p-6 space-y-4 text-xs">
                      <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                        <Info className="w-4 h-4 text-slate-400" />
                        <h4 className="font-bold text-sm text-slate-800">내 승급 요청 현황</h4>
                      </div>
                      {upgradeRequests.length === 0 ? (
                        <p className="text-slate-400 text-center py-6">제출된 요청이 없습니다.</p>
                      ) : (
                        <div className="space-y-3">
                          {upgradeRequests.map((r) => (
                            <div key={r.id} className="p-3.5 rounded-xl border border-slate-100 bg-slate-50/50 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-slate-700">{r.requested_level}단계 승급 요청</span>
                                <Chip
                                  size="sm"
                                  variant="flat"
                                  color={r.status === 'approved' ? 'success' : r.status === 'rejected' ? 'danger' : 'warning'}
                                  className="font-bold text-[9px] h-5"
                                >
                                  {r.status === 'approved' ? '승인됨' : r.status === 'rejected' ? '거절됨' : '대기 중'}
                                </Chip>
                              </div>
                              <p className="text-slate-500 leading-relaxed line-clamp-2">{r.reason}</p>
                              <p className="text-[10px] text-slate-400">{formatDate(r.created_at)}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}

            </div>
          )}

          {/* 활용방법 탭 */}
          {activeTab === 'guide' && (
            <div className="space-y-6 animate-fade-in max-w-3xl">
              <div className="bg-gradient-to-r from-blue-600 to-brand-600 p-8 rounded-xl text-white space-y-2.5 shadow-lg shadow-brand-100/50">
                <h3 className="text-xl font-bold font-sans">에듀링크(edu-link) 활용방법</h3>
                <p className="text-xs text-brand-100 leading-relaxed">
                  단축주소·설문지 생성부터 API 연동까지, 에듀링크의 주요 기능을 한눈에 확인하세요.
                </p>
              </div>

              {/* 회원 등급 안내 */}
              <div className="bg-white border border-slate-100 rounded-xl p-8 space-y-4 shadow-sm">
                <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-600 flex items-center justify-center text-xs font-bold">★</span>
                  회원 등급 안내
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500">
                        <th className="text-left px-3 py-2 rounded-l-lg font-semibold">등급</th>
                        <th className="text-left px-3 py-2 font-semibold">단축주소</th>
                        <th className="text-left px-3 py-2 font-semibold">설문지</th>
                        <th className="text-left px-3 py-2 font-semibold">API 연동</th>
                        <th className="text-left px-3 py-2 rounded-r-lg font-semibold">관리</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      <tr className="text-slate-600">
                        <td className="px-3 py-2.5 font-semibold">
                          <span className="inline-flex items-center gap-1">
                            <span className="w-4 h-4 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center text-[10px] font-bold">1</span>
                            일반 회원
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-green-600">✓ 생성·관리</td>
                        <td className="px-3 py-2.5 text-slate-400">—</td>
                        <td className="px-3 py-2.5 text-slate-400">—</td>
                        <td className="px-3 py-2.5 text-slate-400">—</td>
                      </tr>
                      <tr className="text-slate-600">
                        <td className="px-3 py-2.5 font-semibold">
                          <span className="inline-flex items-center gap-1">
                            <span className="w-4 h-4 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-[10px] font-bold">2</span>
                            인증 회원
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-green-600">✓ 생성·관리</td>
                        <td className="px-3 py-2.5 text-slate-400">—</td>
                        <td className="px-3 py-2.5 text-slate-400">—</td>
                        <td className="px-3 py-2.5 text-slate-400">—</td>
                      </tr>
                      <tr className="text-slate-600">
                        <td className="px-3 py-2.5 font-semibold">
                          <span className="inline-flex items-center gap-1">
                            <span className="w-4 h-4 rounded-full bg-brand-100 text-brand-600 flex items-center justify-center text-[10px] font-bold">3</span>
                            고급사용자
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-green-600">✓ 생성·관리</td>
                        <td className="px-3 py-2.5 text-green-600">✓ 생성·관리</td>
                        <td className="px-3 py-2.5 text-green-600">✓ API Key</td>
                        <td className="px-3 py-2.5 text-slate-400">—</td>
                      </tr>
                      <tr className="text-slate-600">
                        <td className="px-3 py-2.5 font-semibold">
                          <span className="inline-flex items-center gap-1">
                            <span className="w-4 h-4 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center text-[10px] font-bold">4</span>
                            최고관리자
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-green-600">✓ 전체 관리</td>
                        <td className="px-3 py-2.5 text-green-600">✓ 전체 관리</td>
                        <td className="px-3 py-2.5 text-green-600">✓ API Key</td>
                        <td className="px-3 py-2.5 text-green-600">✓ 전체 권한</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  등급 상향은 대시보드 우측 하단의 <span className="font-semibold text-brand-500">등급업 신청</span> 버튼을 통해 요청할 수 있습니다.
                </p>
              </div>

              {/* 단축주소 기능 */}
              <div className="bg-white border border-slate-100 rounded-xl p-8 space-y-5 shadow-sm">
                <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-600 flex items-center justify-center text-xs font-bold">🔗</span>
                  단축주소 기능
                </h4>
                <div className="space-y-4 text-xs text-slate-700">
                  <div className="border-l-4 border-brand-400 pl-4 py-1 space-y-1">
                    <h5 className="font-bold text-slate-800">단축주소 생성</h5>
                    <p className="text-slate-500 leading-relaxed">
                      대시보드 메인 화면의 주소 입력란에 원본 URL을 입력 후 '단축주소 생성' 버튼을 클릭합니다. 6자리 랜덤 슬러그가 자동 부여되며, 원하는 키워드(한글 포함)를 직접 지정할 수도 있습니다. og:title / &lt;title&gt; 태그 기반으로 페이지 제목이 자동 추출됩니다.
                    </p>
                  </div>
                  <div className="border-l-4 border-brand-400 pl-4 py-1 space-y-1">
                    <h5 className="font-bold text-slate-800">비밀번호 및 만료일</h5>
                    <p className="text-slate-500 leading-relaxed">
                      6자리 숫자 PIN으로 링크를 보호하거나, 특정 일시 이후 자동 비활성화되는 만료일을 설정할 수 있습니다.
                    </p>
                  </div>
                  <div className="border-l-4 border-brand-400 pl-4 py-1 space-y-1">
                    <h5 className="font-bold text-slate-800">접속 통계 및 QR 코드</h5>
                    <p className="text-slate-500 leading-relaxed">
                      링크별 일별 클릭 수를 30일 바 차트로 확인할 수 있으며, QR 코드 뷰어에서 이미지 다운로드·공유도 지원합니다.
                    </p>
                  </div>
                  <div className="border-l-4 border-brand-400 pl-4 py-1 space-y-1">
                    <h5 className="font-bold text-slate-800">공개 목록 노출</h5>
                    <p className="text-slate-500 leading-relaxed">
                      링크를 '공개'로 설정하면 에듀링크 메인 페이지의 최근 링크 목록에 표시됩니다. '비공개'로 설정하면 URL을 아는 사람만 접속할 수 있습니다.
                    </p>
                  </div>
                </div>
              </div>

              {/* 설문지 기능 */}
              <div className="bg-white border border-slate-100 rounded-xl p-8 space-y-5 shadow-sm">
                <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center text-xs font-bold">📋</span>
                  설문지 기능 <span className="text-[10px] bg-brand-50 text-brand-500 px-2 py-0.5 rounded-full font-semibold">Lv.3 이상</span>
                </h4>
                <div className="space-y-4 text-xs text-slate-700">
                  <div className="border-l-4 border-purple-400 pl-4 py-1 space-y-1">
                    <h5 className="font-bold text-slate-800">설문지 생성</h5>
                    <p className="text-slate-500 leading-relaxed">
                      '설문 관리' 탭에서 설문을 생성하면 단축주소와 동일한 슬러그 패턴(예: dgedu.link/내슬러그)으로 공유할 수 있습니다. 응답자는 URL 이동 없이 같은 페이지에서 설문을 완료합니다.
                    </p>
                  </div>
                  <div className="border-l-4 border-purple-400 pl-4 py-1 space-y-1">
                    <h5 className="font-bold text-slate-800">질문 유형</h5>
                    <p className="text-slate-500 leading-relaxed">
                      단답형 · 장문형 · 단일선택 · 다중선택 · 만족도(1~5 / 1~7) · 전화번호 · 이메일 · 주소(카카오 우편번호) 등 8가지 질문 유형을 지원합니다. 각 질문에 설명과 미디어(YouTube·이미지·동영상)를 첨부할 수 있습니다.
                    </p>
                  </div>
                  <div className="border-l-4 border-purple-400 pl-4 py-1 space-y-1">
                    <h5 className="font-bold text-slate-800">고급 설정</h5>
                    <p className="text-slate-500 leading-relaxed">
                      비밀번호 보호, 종료일(자동 마감), 최대 응답 수, 브라우저당 1회 응답 제한, 비활성 안내 문구, 커스텀 슬러그 등을 설정할 수 있습니다.
                    </p>
                  </div>
                  <div className="border-l-4 border-purple-400 pl-4 py-1 space-y-1">
                    <h5 className="font-bold text-slate-800">테마 선택</h5>
                    <p className="text-slate-500 leading-relaxed">
                      인디고 · 에메랄드 · 로즈 · 앰버 · 스카이 5가지 색상 테마 중 선택하여 설문 페이지의 분위기를 맞출 수 있습니다.
                    </p>
                  </div>
                  <div className="border-l-4 border-purple-400 pl-4 py-1 space-y-1">
                    <h5 className="font-bold text-slate-800">응답 수집 및 내보내기</h5>
                    <p className="text-slate-500 leading-relaxed">
                      대시보드 설문 관리 탭에서 누적 응답 수가 30초마다 자동 갱신되며, '결과 보기'를 클릭하면 응답 그리드를 확인할 수 있습니다. CSV 다운로드 기능으로 엑셀에서도 분석이 가능합니다.
                    </p>
                  </div>
                </div>
              </div>

              {/* API 연동 */}
              <div className="bg-white border border-slate-100 rounded-xl p-8 space-y-5 shadow-sm">
                <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-xs font-bold">⚡</span>
                  개발자 도구 (API 연동) <span className="text-[10px] bg-brand-50 text-brand-500 px-2 py-0.5 rounded-full font-semibold">Lv.3 이상</span>
                </h4>
                <div className="space-y-4 text-xs text-slate-700">
                  <div className="border-l-4 border-green-400 pl-4 py-1 space-y-1">
                    <h5 className="font-bold text-slate-800">API Key 발급</h5>
                    <p className="text-slate-500 leading-relaxed">
                      '개발자 도구' 탭에서 고유 API Key를 발급받아 외부 시스템에서 단축주소를 프로그래밍 방식으로 생성·조회·삭제할 수 있습니다. API 호출은 분당 15회로 제한됩니다.
                    </p>
                  </div>
                  <div className="border-l-4 border-green-400 pl-4 py-1 space-y-1">
                    <h5 className="font-bold text-slate-800">주요 엔드포인트</h5>
                    <p className="text-slate-500 leading-relaxed">
                      <code className="bg-slate-50 px-1.5 py-0.5 rounded text-[11px] font-mono">GET /api/v1/links</code> — 내 단축주소 목록<br/>
                      <code className="bg-slate-50 px-1.5 py-0.5 rounded text-[11px] font-mono">POST /api/v1/links</code> — 단축주소 생성<br/>
                      <code className="bg-slate-50 px-1.5 py-0.5 rounded text-[11px] font-mono">DELETE /api/v1/links/:id</code> — 단축주소 삭제<br/>
                      상세 명세는 개발자 도구 탭의 'API 문서' 링크를 참고하세요.
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
                <Card className="bg-white border border-slate-100 rounded-xl py-16 shadow-sm">
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
                        className={`border transition-all duration-300 rounded-xl cursor-pointer shadow-sm
                          ${notice.is_pinned ? 'bg-amber-50/20 border-amber-100' : 'bg-white border-slate-100'}
                          ${isExpanded ? 'ring-1 ring-brand-200 border-brand-200' : ''}
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
                            <Tooltip content={isExpanded ? '접기' : '본문 펼치기'} delay={300}>
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
                            </Tooltip>
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
            <div className="space-y-6 animate-fade-in">

              {/* 관리자 서브탭 헤더 */}
              <div className="flex items-center gap-1 bg-slate-100/70 p-1 rounded-xl w-fit">
                {([
                  { key: 'overview', label: '통계 및 회원', icon: <BarChart3 className="w-3.5 h-3.5" /> },
                  { key: 'notices',  label: '공지사항',     icon: <Megaphone  className="w-3.5 h-3.5" /> },
                  { key: 'settings', label: '시스템 설정',  icon: <Settings   className="w-3.5 h-3.5" /> },
                ] as const).map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setAdminSubTab(t.key)}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200
                      ${adminSubTab === t.key
                        ? 'bg-white text-slate-800 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    {t.icon}
                    {t.label}
                    {t.key === 'overview' && adminUpgradeRequests.filter(r => r.status === 'pending').length > 0 && (
                      <span className="bg-red-500 text-white text-[9px] font-black rounded-full w-4 h-4 flex items-center justify-center">
                        {adminUpgradeRequests.filter(r => r.status === 'pending').length}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* ───────── 1탭: 통계 및 회원 ───────── */}
              {adminSubTab === 'overview' && (
                <div className="space-y-8">

                  {/* 통계 카드 4종 */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {[
                      { label: '전체 회원', value: adminUsers.length, sub: '명', color: 'bg-brand-50 border-brand-100', textColor: 'text-brand-600' },
                      { label: '인증사용자 이상', value: adminUsers.filter(u => u.level >= 2).length, sub: '명', color: 'bg-blue-50 border-blue-100', textColor: 'text-blue-600' },
                      { label: '승급 대기', value: adminUpgradeRequests.filter(r => r.status === 'pending').length, sub: '건', color: 'bg-amber-50 border-amber-100', textColor: 'text-amber-600' },
                      { label: '공지사항', value: adminNotices.length, sub: '건', color: 'bg-rose-50 border-rose-100', textColor: 'text-rose-600' },
                    ].map((stat) => (
                      <Card key={stat.label} className={`border ${stat.color} rounded-xl shadow-sm`}>
                        <CardContent className="p-5 space-y-1">
                          <p className="text-[11px] font-bold text-slate-500">{stat.label}</p>
                          <p className={`text-2xl font-black ${stat.textColor}`}>{stat.value}<span className="text-sm font-bold ml-1">{stat.sub}</span></p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  {/* 승급 요청 관리 */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <ShieldAlert className="w-4 h-4 text-amber-500" />
                        <h4 className="font-bold text-sm text-slate-800">등급 승급 요청 관리</h4>
                        {adminUpgradeRequests.filter(r => r.status === 'pending').length > 0 && (
                          <Chip size="sm" color="warning" variant="flat" className="font-bold text-[10px]">
                            대기 중 {adminUpgradeRequests.filter(r => r.status === 'pending').length}건
                          </Chip>
                        )}
                      </div>
                      <Button size="sm" variant="light" className="text-[10px] font-bold text-slate-400 h-7 px-2" onClick={() => { fetchAdminUpgradeRequests(); fetchAdminData(); }}>
                        새로고침
                      </Button>
                    </div>
                    {adminUpgradeRequests.length === 0 ? (
                      <Card className="bg-white border border-slate-100 rounded-xl shadow-sm">
                        <CardContent className="p-8 text-center text-xs text-slate-400">제출된 승급 요청이 없습니다.</CardContent>
                      </Card>
                    ) : (
                      <Card className="bg-white border border-slate-100 rounded-xl shadow-sm overflow-hidden">
                        <div className="overflow-x-auto w-full">
                          <table className="w-full border-collapse text-left text-xs">
                            <thead>
                              <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 font-bold">
                                <th className="p-3.5">신청자</th>
                                <th className="p-3.5">소속</th>
                                <th className="p-3.5">이메일</th>
                                <th className="p-3.5">현재→요청</th>
                                <th className="p-3.5">요청 사유</th>
                                <th className="p-3.5">신청일시</th>
                                <th className="p-3.5">상태</th>
                                <th className="p-3.5 text-center">처리</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-slate-700">
                              {adminUpgradeRequests.map((r) => (
                                <tr key={r.id} className={`hover:bg-slate-50/50 transition-colors ${r.status !== 'pending' ? 'opacity-40' : ''}`}>
                                  <td className="p-3.5 font-bold">{r.name}</td>
                                  <td className="p-3.5 text-slate-500">{r.affiliation || <span className="text-slate-300">—</span>}</td>
                                  <td className="p-3.5 font-mono text-[10px]">{r.email}</td>
                                  <td className="p-3.5">
                                    <div className="flex items-center gap-1">
                                      <Chip size="sm" variant="flat" color={r.current_level === 2 ? 'primary' : 'default'} className="font-bold text-[9px] h-5 px-1">{r.current_level}단계</Chip>
                                      <span className="text-slate-300">→</span>
                                      <Chip size="sm" variant="flat" color={r.requested_level === 3 ? 'secondary' : 'primary'} className="font-bold text-[9px] h-5 px-1">{r.requested_level}단계</Chip>
                                    </div>
                                  </td>
                                  <td className="p-3.5 max-w-[200px]"><p className="text-slate-500 line-clamp-2 leading-relaxed">{r.reason}</p></td>
                                  <td className="p-3.5 text-slate-400 text-[10px]">{formatDate(r.created_at)}</td>
                                  <td className="p-3.5">
                                    <Chip size="sm" variant="flat" color={r.status === 'approved' ? 'success' : r.status === 'rejected' ? 'danger' : 'warning'} className="font-bold text-[9px] h-5">
                                      {r.status === 'approved' ? '승인됨' : r.status === 'rejected' ? '거절됨' : '대기 중'}
                                    </Chip>
                                  </td>
                                  <td className="p-3.5 text-center">
                                    {r.status === 'pending' ? (
                                      <div className="flex items-center justify-center gap-1">
                                        <Tooltip content={`${r.name}의 등급을 ${r.current_level}단계 → ${r.requested_level}단계로 승급`} delay={200}>
                                          <Button size="sm" color="success" variant="flat" className="h-7 px-2 text-[10px] font-bold rounded-lg" isLoading={isProcessingRequest === r.id} onClick={() => handleProcessUpgradeRequest(r.id, 'approve')}>승인</Button>
                                        </Tooltip>
                                        <Tooltip content="요청을 거절하고 현재 등급 유지" delay={200}>
                                          <Button size="sm" color="danger" variant="flat" className="h-7 px-2 text-[10px] font-bold rounded-lg" isLoading={isProcessingRequest === r.id} onClick={() => handleProcessUpgradeRequest(r.id, 'reject')}>거절</Button>
                                        </Tooltip>
                                      </div>
                                    ) : (
                                      <span className="text-[10px] text-slate-300 font-bold">처리 완료</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </Card>
                    )}
                  </div>

                  {/* 사용자 권한 등급 관리 */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-brand-500" />
                        <h4 className="font-bold text-sm text-slate-800">사용자 권한 등급 관리</h4>
                      </div>
                      <span className="text-xs text-slate-400">총 {adminUsers.length}명</span>
                    </div>
                    <Card className="bg-white border border-slate-100 rounded-xl shadow-sm overflow-hidden">
                      <div className="overflow-x-auto w-full">
                        <table className="w-full border-collapse text-left text-xs">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 font-bold">
                              <th className="p-3.5">ID</th>
                              <th className="p-3.5">사용자명</th>
                              <th className="p-3.5">소속</th>
                              <th className="p-3.5">이메일</th>
                              <th className="p-3.5">가입일시</th>
                              <th className="p-3.5">현재 등급</th>
                              <th className="p-3.5 text-center">등급 조정</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 text-slate-700">
                            {adminUsers.map((u) => {
                              const isSelf = user && u.id === user.id;
                              return (
                                <tr key={u.id} className="hover:bg-slate-50/50 transition-colors">
                                  <td className="p-3.5 font-mono font-bold text-slate-400">{u.id}</td>
                                  <td className="p-3.5 font-bold">{u.name}{isSelf && <span className="ml-1 text-[9px] text-brand-600 font-bold">(본인)</span>}</td>
                                  <td className="p-3.5 text-slate-500">{u.affiliation || <span className="text-slate-300">—</span>}</td>
                                  <td className="p-3.5 font-mono text-[10px]">{u.email}</td>
                                  <td className="p-3.5 text-slate-400">{formatDate(u.created_at || null)}</td>
                                  <td className="p-3.5">
                                    <Chip size="sm" variant="flat" color={u.level === 4 ? 'danger' : u.level === 3 ? 'secondary' : u.level === 2 ? 'primary' : 'default'} className="font-bold px-1.5 h-5 text-[9px]">
                                      {u.level === 4 ? '4-최고관리자' : u.level === 3 ? '3-고급사용자' : u.level === 2 ? '2-인증사용자' : '1-일반회원'}
                                    </Chip>
                                  </td>
                                  <td className="p-3.5 text-center">
                                    {isSelf ? (
                                      <span className="text-[10px] text-slate-300 font-bold">본인 조정 불가</span>
                                    ) : (
                                      <select value={u.level} onChange={(e) => handleUpdateUserLevel(u.id, Number(e.target.value))} className="bg-slate-50 border border-slate-200 rounded-lg text-[10px] font-bold text-slate-700 py-1.5 px-2 outline-none cursor-pointer focus:bg-white focus:border-brand-400">
                                        <option value={1}>1-일반회원</option>
                                        <option value={2}>2-인증사용자</option>
                                        <option value={3}>3-고급사용자</option>
                                        <option value={4}>4-최고관리자</option>
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

              {/* ───────── 2탭: 공지사항 ───────── */}
              {adminSubTab === 'notices' && (
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">

                  {/* 작성 / 수정 폼 */}
                  <Card className="lg:col-span-2 bg-white border border-slate-100 rounded-xl shadow-sm lg:sticky lg:top-8">
                    <CardContent className="p-6 space-y-4 text-xs">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                        <div className="flex items-center gap-2">
                          <Megaphone className="w-4 h-4 text-rose-500" />
                          <h4 className="font-bold text-sm text-slate-800">
                            {editingNotice ? '공지사항 수정' : '새 공지사항 작성'}
                          </h4>
                        </div>
                        {editingNotice && (
                          <Button size="sm" variant="light" className="text-[10px] h-6 px-2 text-slate-400" onClick={() => setEditingNotice(null)}>
                            취소
                          </Button>
                        )}
                      </div>

                      <form onSubmit={editingNotice ? handleEditNotice : handleAddNotice} className="space-y-4">
                        <div className="space-y-1.5">
                          <label className="font-bold text-slate-600">공지 제목</label>
                          <Input
                            size="sm"
                            required
                            placeholder="공지사항 제목을 입력하세요"
                            value={editingNotice ? editNoticeTitle : newNoticeTitle}
                            onChange={(e) => editingNotice ? setEditNoticeTitle(e.target.value) : setNewNoticeTitle(e.target.value)}
                            className="w-full"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="font-bold text-slate-600">공지 내용</label>
                          <textarea
                            required
                            rows={6}
                            placeholder="내용을 자세히 입력하세요..."
                            value={editingNotice ? editNoticeContent : newNoticeContent}
                            onChange={(e) => editingNotice ? setEditNoticeContent(e.target.value) : setNewNoticeContent(e.target.value)}
                            className="w-full border border-slate-200 bg-slate-50 focus:bg-white focus:border-brand-400 outline-none rounded-lg p-3 text-xs text-slate-800 transition-all resize-none leading-relaxed"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="noticePinToggle"
                            checked={editingNotice ? editNoticePinned : newNoticePinned}
                            onChange={(e) => editingNotice ? setEditNoticePinned(e.target.checked) : setNewNoticePinned(e.target.checked)}
                            className="w-3.5 h-3.5 rounded"
                          />
                          <label htmlFor="noticePinToggle" className="font-bold text-slate-600 select-none cursor-pointer">
                            목록 최상단 고정 (중요 공지)
                          </label>
                        </div>
                        <Button
                          type="submit"
                          color={editingNotice ? 'primary' : 'danger'}
                          isLoading={isSavingNotice}
                          className="w-full rounded-lg font-bold shadow-md text-white"
                        >
                          {editingNotice ? '수정 저장' : '공지사항 등록'}
                        </Button>
                      </form>
                    </CardContent>
                  </Card>

                  {/* 공지 목록 */}
                  <div className="lg:col-span-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-sm text-slate-800">등록된 공지 목록</h4>
                      <span className="text-xs text-slate-400">총 {adminNotices.length}건</span>
                    </div>
                    {adminNotices.length === 0 ? (
                      <Card className="bg-white border border-slate-100 rounded-xl shadow-sm">
                        <CardContent className="p-10 text-center text-xs text-slate-400">등록된 공지사항이 없습니다.</CardContent>
                      </Card>
                    ) : (
                      <div className="space-y-2">
                        {adminNotices.map((n) => (
                          <Card key={n.id} className={`border rounded-xl shadow-sm transition-all ${editingNotice?.id === n.id ? 'border-brand-300 bg-brand-50/20' : 'border-slate-100 bg-white'}`}>
                            <CardContent className="p-4 text-xs">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0 space-y-1.5">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    {n.is_pinned === 1 && (
                                      <Chip size="sm" color="warning" variant="flat" className="h-5 text-[9px] font-bold px-1.5">📌 고정</Chip>
                                    )}
                                    <span className="text-[10px] text-slate-400">{formatDate(n.created_at)}</span>
                                  </div>
                                  <h5 className="font-bold text-slate-800 truncate">{n.title}</h5>
                                  <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">{n.content}</p>
                                </div>
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  <Tooltip content="공지사항 편집" delay={200}>
                                    <Button
                                      size="sm" variant="flat" color="primary" isIconOnly
                                      className="rounded-lg w-8 h-8 min-w-0 p-0"
                                      onClick={() => {
                                        setEditingNotice(n);
                                        setEditNoticeTitle(n.title);
                                        setEditNoticeContent(n.content);
                                        setEditNoticePinned(n.is_pinned === 1);
                                      }}
                                    >
                                      <Edit3 className="w-3.5 h-3.5" />
                                    </Button>
                                  </Tooltip>
                                  <Tooltip content="공지사항 삭제" delay={200}>
                                    <Button
                                      size="sm" variant="flat" color="danger" isIconOnly
                                      className="rounded-lg w-8 h-8 min-w-0 p-0"
                                      onClick={() => handleDeleteNotice(n.id)}
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                  </Tooltip>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </div>

                </div>
              )}

              {/* ───────── 3탭: 시스템 설정 ───────── */}
              {adminSubTab === 'settings' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">

                  {/* Zero Trust 허용 도메인 */}
                  <Card className="bg-white border border-slate-100 rounded-xl shadow-sm">
                    <CardContent className="p-6 space-y-4 text-xs">
                      <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                        <Globe className="w-4 h-4 text-brand-500" />
                        <div>
                          <h4 className="font-bold text-sm text-slate-800">Zero Trust 허용 도메인</h4>
                          <p className="text-[10px] text-slate-400 mt-0.5">2단계 자동 승급 이메일 도메인 관리</p>
                        </div>
                      </div>
                      <form onSubmit={handleAddDomain} className="space-y-3">
                        <div className="space-y-1.5">
                          <label className="font-bold text-slate-600">이메일 도메인</label>
                          <Input size="sm" required placeholder="예: dge.go.kr" value={newDomain} onChange={(e) => setNewDomain(e.target.value)} className="w-full" />
                        </div>
                        <Button type="submit" color="primary" variant="flat" className="w-full rounded-lg font-bold">도메인 등록</Button>
                      </form>
                      <div className="pt-3 border-t border-slate-100 space-y-2">
                        <label className="font-bold text-slate-500">현재 허용 도메인 ({adminDomains.length}개)</label>
                        <div className="space-y-1.5 max-h-60 overflow-y-auto">
                          {adminDomains.length === 0 ? (
                            <p className="text-slate-300 text-center py-3">등록된 도메인이 없습니다.</p>
                          ) : adminDomains.map((d) => (
                            <div key={d.id} className="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-lg">
                              <span className="font-mono font-bold text-slate-700">{d.domain}</span>
                              <Tooltip content="도메인 삭제" delay={200}>
                                <Button size="sm" variant="light" color="danger" isIconOnly className="w-5 h-5 min-w-0 p-0 rounded-md" onClick={() => handleDeleteDomain(d.id)}>
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </Tooltip>
                            </div>
                          ))}
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* 향후 설정 확장 영역 */}
                  <Card className="bg-white border border-dashed border-slate-200 rounded-xl shadow-sm">
                    <CardContent className="p-6 flex flex-col items-center justify-center gap-3 text-center min-h-[200px]">
                      <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
                        <Settings className="w-5 h-5 text-slate-300" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-400">추가 설정 영역</p>
                        <p className="text-[10px] text-slate-300 mt-1">향후 기능 확장 시 이 공간에 추가됩니다.</p>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-white border border-dashed border-slate-200 rounded-xl shadow-sm">
                    <CardContent className="p-6 flex flex-col items-center justify-center gap-3 text-center min-h-[200px]">
                      <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
                        <Terminal className="w-5 h-5 text-slate-300" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-400">시스템 로그</p>
                        <p className="text-[10px] text-slate-300 mt-1">향후 기능 확장 시 이 공간에 추가됩니다.</p>
                      </div>
                    </CardContent>
                  </Card>

                </div>
              )}

            </div>
          )}

        </div>
      </main>

      {/* QR 코드 드로어 */}
      <QrDrawer link={qrModalLink} onClose={() => setQrModalLink(null)} />

      {/* 🗝 발급 키 1회 노출 모달 */}
      {showKeyResultModal && generatedKeyResult && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="max-w-md w-full border border-slate-200/40 shadow-2xl rounded-xl p-2 bg-white animate-fade-in">
            <CardContent className="p-6 flex flex-col gap-4 text-xs">
              <div className="flex items-center gap-2 text-brand-700 text-sm font-bold border-b border-slate-100 pb-3">
                <ShieldCheck className="w-5 h-5 text-emerald-500" />
                <span>API Key가 성공적으로 생성되었습니다</span>
              </div>
              
              <p className="text-[11px] text-slate-500 leading-relaxed">
                보안상의 사유로 아래의 API Key는 **이 화면을 닫으면 다시 조회할 수 없습니다**. 지금 즉시 복사하여 안전한 곳에 저장해 주시기 바랍니다.
              </p>

              <div className="bg-slate-50 border border-slate-100 p-3.5 rounded-xl flex items-center justify-between font-mono font-bold text-slate-800 break-all select-all">
                <span>{generatedKeyResult}</span>
                <Tooltip content={keyResultCopied ? '복사됨!' : 'API Key 클립보드에 복사'} delay={200}>
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
                </Tooltip>
              </div>

              <Button
                color="primary"
                className="w-full rounded-lg font-bold shadow-md shadow-primary/20"
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
                fill={d.clicks > 0 ? '#3692ff' : '#e2e8f0'}
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
                    <QrCode className="w-4 h-4 text-brand-600 flex-shrink-0" />
                    QR 코드
                  </h3>
                  <p className="text-[10px] text-brand-600 font-bold font-mono truncate">
                    dgedu.link/{qrSlug}
                    {link.custom_slug && <span className="text-slate-400 font-normal"> · /{link.custom_slug}</span>}
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
                {/* QR 이미지 */}
                <div className="bg-white border-2 border-slate-100 rounded-xl p-4 shadow-sm">
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
                  <code className="text-sm font-mono font-bold text-brand-600 break-all">{shortUrl}</code>
                </div>

                {/* 복사 + 다운로드 버튼 */}
                <div className="w-full flex gap-2">
                  <Button
                    size="sm"
                    variant={copied ? 'solid' : 'flat'}
                    color={copied ? 'success' : 'default'}
                    className={`flex-1 rounded-lg font-bold text-xs transition-all duration-300 ${copied ? 'scale-[1.02]' : ''}`}
                    startContent={copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    onClick={handleCopy}
                  >
                    {copied ? '복사됨!' : '주소 복사'}
                  </Button>
                  <Button
                    size="sm"
                    color="primary"
                    className="flex-1 rounded-lg font-bold text-xs"
                    onClick={handleDownload}
                    isLoading={downloading}
                  >
                    ⬇ PNG 저장
                  </Button>
                </div>

                {/* 링크 기본 정보 */}
                <div className="w-full bg-slate-50 rounded-xl p-4 space-y-3 text-xs">
                  {link.title && (
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-slate-400 font-bold flex-shrink-0">제목</span>
                      <span className="text-slate-800 font-semibold text-right break-words max-w-[240px]">{link.title}</span>
                    </div>
                  )}
                  {/* 설문은 원본 주소 행 생략 */}
                  {(link as any).kind !== 'survey' && link.original_url && (
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-slate-400 font-bold flex-shrink-0">원본 주소</span>
                      <a
                        href={link.original_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand-600 font-mono text-[10px] text-right break-all hover:underline max-w-[240px]"
                      >
                        {link.original_url}
                      </a>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-3 pt-1 border-t border-slate-100">
                    {(link as any).kind === 'survey' ? (
                      <>
                        <span className="text-slate-400 font-bold">누적 응답</span>
                        <span className="text-slate-800 font-extrabold text-base">
                          {(link as any).response_count ?? 0}
                          <span className="text-xs font-normal text-slate-400 ml-1">건</span>
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-slate-400 font-bold">누적 클릭</span>
                        <span className="text-slate-800 font-extrabold text-base">
                          {link.click_count ?? 0}
                          <span className="text-xs font-normal text-slate-400 ml-1">회</span>
                        </span>
                      </>
                    )}
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
