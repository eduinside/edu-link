// src/client/pages/NotFound.tsx
import React from 'react';
import { Button, Card, CardContent } from '@heroui/react';
import { Link2Off, Home, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function NotFound() {
  const navigate = useNavigate();

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
          
          <p className="text-xs text-slate-500 max-w-sm mb-6 leading-relaxed">
            단축주소가 삭제되었거나 만료되었을 수 있습니다. 주소의 슬러그가 올바른지 다시 한번 확인해주시기 바랍니다.
          </p>

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
