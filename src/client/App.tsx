import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Landing from './pages/Landing';
import Dashboard from './pages/Dashboard';
import NotFound from './pages/NotFound';

// 전용 편집기는 지연 로딩(대시보드 초기 번들 경량화)
const SiteEditor = lazy(() => import('./pages/SiteEditor'));

function EditorFallback() {
  return <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>편집기를 불러오는 중…</div>;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/dashboard/sites/:id" element={<Suspense fallback={<EditorFallback />}><SiteEditor /></Suspense>} />
        <Route path="/dashboard/:tab" element={<Dashboard />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
