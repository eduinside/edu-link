// src/client/pages/NotFound.tsx
import React, { useEffect, useState } from 'react';
import { Button, Card, CardContent } from '@heroui/react';
import { Link2Off, Home, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function NotFound() {
  const navigate = useNavigate();
  const [stillHere, setStillHere] = useState(false);

  // 핵심 해결책: 현재 path가 단축주소 슬러그 형식이면
  // React Router 클라이언트 라우팅을 우회하고 서버로 강제 full-reload
  // (SPA 내부에서 어떤 식으로든 client-side navigation으로 진입한 경우 발생)
  useEffect(() => {
    const path = window.location.pathname;
    const search = window.location.search;
    // /로 시작하고 한 segment짜리 슬러그 형식 (영숫자/한글/하이픈)
    const slugLike = /^\/[A-Za-z0-9가-힣\-_]{1,40}$/.test(path);
    if (slugLike) {
      // sessionStorage 가드로 무한 루프 방지
      const guardKey = 'notfound_reload_' + path;
      if (!sessionStorage.getItem(guardKey)) {
        sessionStorage.setItem(guardKey, '1');
        // 서버 단축주소 처리를 위해 강제 full reload
        window.location.replace(path + search);
        return;
      } else {
        // 이미 한 번 reload했는데도 여기 도달 → 실제 존재하지 않는 슬러그
        setStillHere(true);
        sessionStorage.removeItem(guardKey);
      }
    } else {
      setStillHere(true);
    }
  }, []);

  if (!stillHere) {
    return (
      <div className="gemini-gradient-bg min-h-screen flex items-center justify-center p-4">
        <p className="text-slate-500 text-sm">단축주소로 이동 중...</p>
      </div>
    );
  }

  return (
    <div className="gemini-gradient-bg min-h-screen flex items-center justify-center p-4">
      <Card className="max-w-md w-full border border-slate-200/40 shadow-xl glassmorphism rounded-3xl p-4">
        <CardContent className="text-center flex flex-col items-center py-8">
          <div className="bg-danger-50 p-4 rounded-2xl text-danger-500 mb-4">
            <Link2Off className="w-12 h-12" />
          </div>

          <h1 className="text-2xl font-extrabold text-slate-800 tracking-tight mb-2">
            연결할 수 없는 주소입니다
          </h1>

          <p className="text-xs text-slate-500 max-w-sm mb-2 leading-relaxed">
            단축주소가 삭제되었거나 만료되었을 수 있습니다. 주소의 슬러그가 올바른지 다시 한번 확인해주시기 바랍니다.
          </p>

          <code className="text-[10px] text-slate-400 font-mono mb-6">{window.location.pathname}</code>

          <div className="flex gap-3 w-full">
            <Button
              size="sm"
              variant="flat"
              color="default"
              className="flex-1 rounded-xl font-medium"
              startContent={<ArrowLeft className="w-4 h-4" />}
              onClick={() => navigate(-1)}
            >
              이전으로
            </Button>
            <Button
              size="sm"
              color="primary"
              className="flex-1 rounded-xl font-medium shadow-md shadow-primary/10"
              startContent={<Home className="w-4 h-4" />}
              onClick={() => navigate('/')}
            >
              홈으로 이동
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
