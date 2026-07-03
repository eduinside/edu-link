import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { SignJWT } from 'jose';
import { generateRandomSlug, isValidCustomSlug } from './utils/slug';
import { authMiddleware, adminMiddleware } from './middleware/auth';
import { rateLimitMiddleware } from './middleware/rateLimit';
import { registerSiteRoutes, registerPageRoutes, registerSectionRoutes, registerMediaRoutes, registerPublishRoutes } from './routes/sites';
import { serveSiteById, lookupSiteBySlug } from './routes/siteRender';

const app = new Hono<{ Bindings: Env }>();

// ----------------------------------------------------
// [글로벌 미들웨어] 스캐너 봇 차단 (WordPress/phpMyAdmin 탐색 프로브)
// ----------------------------------------------------
const SCANNER_PATH_RE = /^\/(wp-admin|wp-login\.php|wp-content|wp-includes|wp-json|wp-cron\.php|wp-config\.php|xmlrpc\.php|phpmyadmin|\.env|\.git)(\/|$|\?)/i;

app.use('*', async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (SCANNER_PATH_RE.test(path)) {
        return c.text('Not Found', 404);
    }
    return next();
});

// ----------------------------------------------------
// [글로벌 미들웨어] CORS 설정 적용
// ----------------------------------------------------
app.use('/api/v1/*', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
    exposeHeaders: ['Content-Length', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],
    maxAge: 600,
}));


// ----------------------------------------------------
// [인증 불필요] 로그인 여부와 무관하게 동작하는 공개 엔드포인트

// 1. 헬스 체크 API
app.get('/api/health', (c) => {
    return c.json({ status: 'ok', time: new Date().toISOString() });
});

// 2. 공지사항 목록 API
app.get('/api/notices', async (c) => {
    try {
        const { results } = await c.env.DB.prepare(
            `SELECT id, title, content, is_pinned, created_at 
             FROM notices 
             ORDER BY is_pinned DESC, created_at DESC`
        ).all();
        return c.json({ success: true, notices: results });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

// 3. 최근 공개 단축링크 목록 API (최신 목록 - 기본설정에 따라 공개)
app.get('/api/links/public', async (c) => {
    try {
        const { results } = await c.env.DB.prepare(
            `SELECT slug, custom_slug, title, original_url, click_count, created_at
             FROM urls
             WHERE is_active = 1 AND is_public = 1
             ORDER BY created_at DESC
             LIMIT 20`
        ).all();
        return c.json({ success: true, links: results });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

// 3.0b 인기 공개 링크 (클릭수 기준)
app.get('/api/links/popular', async (c) => {
    try {
        const { results } = await c.env.DB.prepare(
            `SELECT slug, custom_slug, title, original_url, click_count, created_at
             FROM urls
             WHERE is_active = 1 AND is_public = 1
             ORDER BY click_count DESC, created_at DESC
             LIMIT 20`
        ).all();
        return c.json({ success: true, links: results });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

// 3.1 페이지 제목 자동 추출 API (og:title / <title> 파싱)
app.get('/api/fetch-title', async (c) => {
    const rawUrl = c.req.query('url');
    if (!rawUrl) return c.json({ success: false, error: 'URL이 필요합니다.' }, 400);
    try { new URL(rawUrl); } catch {
        return c.json({ success: false, error: '유효하지 않은 URL입니다.' }, 400);
    }
    try {
        const res = await fetch(rawUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; EduLink/1.0; +https://dgedu.link)',
                'Accept': 'text/html,application/xhtml+xml',
            },
            signal: AbortSignal.timeout(5000),
            redirect: 'follow',
        });
        if (!res.ok) return c.json({ success: false }, 200);
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('text/html')) return c.json({ success: false }, 200);

        // <title>이 항상 <head> 안에 있으므로 처음 15KB만 읽음
        const reader = res.body?.getReader();
        let html = '';
        if (reader) {
            let bytes = 0;
            while (bytes < 15000) {
                const { done, value } = await reader.read();
                if (done) break;
                html += new TextDecoder('utf-8', { fatal: false }).decode(value);
                bytes += value.byteLength;
                if (html.includes('</title>')) break;
            }
            await reader.cancel();
        }

        let title = '';
        // og:title 우선
        const ogMatch =
            html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"'<>]+)["']/i) ||
            html.match(/<meta[^>]*content=["']([^"'<>]+)["'][^>]*property=["']og:title["']/i);
        if (ogMatch) title = ogMatch[1];
        // fallback: <title>
        if (!title) {
            const t = html.match(/<title[^>]*>([^<]+)<\/title>/i);
            if (t) title = t[1];
        }
        // HTML 엔티티 디코딩 & 정리
        title = title
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
            .replace(/\s+/g, ' ').trim().slice(0, 100);

        return c.json({ success: true, title });
    } catch {
        return c.json({ success: false }, 200);
    }
});

// 3.1b 비밀번호 확인 API (공개용)
app.post('/api/verify-password', async (c) => {
    try {
        const body = await c.req.json();
        const { slug, password } = body;
        if (!slug || !password) {
            return c.json({ success: false, error: '필수 파라미터가 누락되었습니다.' }, 400);
        }

        const urlRecord = await c.env.DB.prepare(
            "SELECT id, original_url, password, expires_at, is_active, kind FROM urls WHERE base_slug = ? OR custom_slug = ? OR slug = ?"
        )
        .bind(slug, slug, slug)
        .first<{ id: number; original_url: string; password: string | null; expires_at: string | null; is_active: number; kind: string }>();

        if (!urlRecord || urlRecord.is_active === 0) {
            return c.json({ success: false, error: '존재하지 않거나 비활성화된 링크입니다.' }, 404);
        }

        // 留뚮즺 泥댄겕
        if (urlRecord.expires_at) {
            const expireDate = new Date(urlRecord.expires_at);
            const now = new Date();
            if (now > expireDate) {
                c.executionCtx.waitUntil((async () => {
                    await c.env.DB.prepare("UPDATE urls SET is_active = 0 WHERE slug = ?").bind(slug).run();
                    await c.env.URL_CACHE.delete(slug);
                })());
                return c.json({ success: false, error: '만료된 단축 링크입니다.' }, 410);
            }
        }

        if (urlRecord.password !== password) {
            return c.json({ success: false, error: "비밀번호가 일치하지 않습니다." }, 401);
        }

        if (urlRecord.kind === "survey") {
            setCookie(c, "edulink_survey_" + urlRecord.id, password, {
                path: "/", secure: true, httpOnly: false, maxAge: 3600, sameSite: "Lax",
            });
            return c.json({ success: true, kind: "survey", reload: true });
        }

        return c.json({ success: true, original_url: urlRecord.original_url });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

// 3.2 [OTP Email send & login API]
app.post('/api/auth/otp/send', async (c) => {
    try {
        const { email, name, affiliation } = await c.req.json();
        if (!email || !email.trim()) {
            return c.json({ success: false, error: '\uc774\uba54\uc77c\uc744 \uc785\ub825\ud574\uc8fc\uc138\uc694.' }, 400);
        }

        const cleanEmail = email.trim().toLowerCase();

        // \uae30\uc874 \uc0ac\uc6a9\uc790 \uc5ec\ubd80 \ud655\uc778 (\uc2e0\uaddc\ub294 \uc774\ub984+\uc18c\uc18d \ud544\uc218)
        const existingUser = await c.env.DB.prepare("SELECT name, affiliation FROM users WHERE email = ?")
            .bind(cleanEmail)
            .first<{ name: string; affiliation: string }>();

        const displayName = existingUser?.name || (name ? name.trim() : null);
        const displayAffiliation = existingUser?.affiliation || (affiliation ? affiliation.trim() : null);

        if (!existingUser) {
            if (!displayName) {
                return c.json({ success: false, error: '\uc2e0\uaddc \uc0ac\uc6a9\uc790\ub294 \uc774\ub984\uc744 \uc785\ub825\ud574\uc8fc\uc138\uc694.' }, 400);
            }
            if (!displayAffiliation) {
                return c.json({ success: false, error: '\uc2e0\uaddc \uc0ac\uc6a9\uc790\ub294 \uc18c\uc18d\uc744 \uc785\ub825\ud574\uc8fc\uc138\uc694.' }, 400);
            }
        }

        // 6\uc790\ub9ac OTP \ucf54\ub4dc \uc0dd\uc131
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

        // KV \uce90\uc2dc\uc5d0 5\ubd84\uac04 \uc800\uc7a5
        const cacheKey = `otp:${cleanEmail}`;
        const cacheValue = JSON.stringify({ code: otpCode, name: displayName, affiliation: displayAffiliation || '' });

        await c.env.URL_CACHE.put(cacheKey, cacheValue, { expirationTtl: 300 });

        console.log(`[OTP \ubc1c\uc1a1] \uc774\uba54\uc77c: ${cleanEmail}, \ucf54\ub4dc: ${otpCode}`);

        const isProd = c.req.url.includes('dgedu.link');

        // \ud504\ub85c\ub355\uc158: Resend API\ub85c \uc2e4\uc81c \uc774\uba54\uc77c \ubc1c\uc1a1
        if (isProd && c.env.RESEND_API_KEY) {
            const emailHtml = `
<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"></head>
<body style="font-family:'Apple SD Gothic Neo',sans-serif;background:#f5f7fa;margin:0;padding:40px 0;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
    <div style="background:linear-gradient(135deg,#2563eb,#4f46e5);padding:32px 40px;">
      <h1 style="color:#fff;margin:0;font-size:22px;font-weight:900;letter-spacing:-0.5px;">\uc5d0\ub4c0\ub9c1\ud06c</h1>
      <p style="color:rgba(255,255,255,0.8);margin:6px 0 0;font-size:13px;">\uad50\uc721\uae30\uad00 \ub2e8\ucd95\uc8fc\uc18c \ud50c\ub7ab\ud3fc</p>
    </div>
    <div style="padding:36px 40px;">
      <p style="color:#1e293b;font-size:16px;font-weight:700;margin:0 0 8px;">${displayName}\ub2d8, \uc548\ub155\ud558\uc138\uc694!</p>
      <p style="color:#64748b;font-size:14px;line-height:1.7;margin:0 0 28px;">\uc5d0\ub4c0\ub9c1\ud06c \ub85c\uadf8\uc778 \uc778\uc99d\ucf54\ub4dc\uc785\ub2c8\ub2e4.<br>\uc544\ub798 6\uc790\ub9ac \ucf54\ub4dc\ub97c 5\ubd84 \uc774\ub0b4\uc5d0 \uc785\ub825\ud574 \uc8fc\uc138\uc694.</p>
      <div style="background:#f8fafc;border:2px solid #e2e8f0;border-radius:16px;padding:28px;text-align:center;margin-bottom:28px;">
        <p style="color:#94a3b8;font-size:12px;font-weight:600;margin:0 0 10px;letter-spacing:0.05em;text-transform:uppercase;">\uc778\uc99d\ucf54\ub4dc</p>
        <p style="color:#1e293b;font-size:40px;font-weight:900;margin:0;letter-spacing:12px;font-family:'Courier New',monospace;">${otpCode}</p>
      </div>
      <p style="color:#94a3b8;font-size:12px;line-height:1.6;margin:0;">
        \uc774 \ucf54\ub4dc\ub294 <strong>5\ubd84 \ud6c4 \ub9cc\ub8cc</strong>\ub429\ub2c8\ub2e4.<br>
        \ubcf8\uc778\uc774 \uc694\uccad\ud558\uc9c0 \uc54a\uc558\ub2e4\uba74 \uc774 \uba54\uc77c\uc744 \ubb34\uc2dc\ud558\uc138\uc694.
      </p>
    </div>
    <div style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;">
      <p style="color:#cbd5e1;font-size:11px;margin:0;text-align:center;">&copy; 2026 \uc5d0\ub4c0\ub9c1\ud06c &middot; dgedu.link</p>
    </div>
  </div>
</body>
</html>`;

            const resendRes = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${c.env.RESEND_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    from: '\uc5d0\ub4c0\ub9c1\ud06c <noreply@dgedu.link>',
                    to: [cleanEmail],
                    subject: `[\uc5d0\ub4c0\ub9c1\ud06c] \ub85c\uadf8\uc778 \uc778\uc99d\ucf54\ub4dc: ${otpCode}`,
                    html: emailHtml,
                }),
            });

            if (!resendRes.ok) {
                const errText = await resendRes.text();
                console.error(`[Resend \uc624\ub958] ${resendRes.status}: ${errText}`);
                return c.json({ success: false, error: '\uc774\uba54\uc77c \ubc1c\uc1a1\uc5d0 \uc2e4\ud328\ud588\uc2b5\ub2c8\ub2e4. \uc7a0\uc2dc \ud6c4 \ub2e4\uc2dc \uc2dc\ub3c4\ud574\uc8fc\uc138\uc694.' }, 500);
            }

            return c.json({ success: true, message: `${cleanEmail}\ub85c \uc778\uc99d\ucf54\ub4dc\ub97c \ubc1c\uc1a1\ud588\uc2b5\ub2c8\ub2e4.` });
        }

        // \ub85c\uce7c/\uac1c\ubc1c \ud658\uacbd: debug_otp \ubc18\ud658
        return c.json({
            success: true,
            message: 'OTP \ucf54\ub4dc\uac00 \uc0dd\uc131\ub428\ub2c8\ub2e4. (\uc774\uba54\uc77c \ubc1c\uc1a1 \uc2dc\ubbac\ub808\uc774\uc158)',
            debug_otp: otpCode,
        });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

app.post('/api/auth/otp/verify', async (c) => {
    try {
        const { email, code } = await c.req.json();
        if (!email || !code) {
            return c.json({ success: false, error: '이메일과 OTP 코드를 입력해 주세요.' }, 400);
        }
        
        const cleanEmail = email.trim().toLowerCase();
        const cacheKey = `otp:${cleanEmail}`;
        const cachedStr = await c.env.URL_CACHE.get(cacheKey);
        
        if (!cachedStr) {
            return c.json({ success: false, error: 'OTP 인증 시간이 만료되었거나 다시 요청해야 합니다. 다시 시도해 주세요.' }, 400);
        }
        
        const cached = JSON.parse(cachedStr);
        if (cached.code !== code.trim()) {
            return c.json({ success: false, error: 'OTP 코드가 일치하지 않습니다.' }, 400);
        }
        
        // 인증 성공: D1 사용자 생성 또는 조회
        const domain = cleanEmail.split('@')[1];
        let userRecord = await c.env.DB.prepare("SELECT id, email, name, affiliation, level FROM users WHERE email = ?")
            .bind(cleanEmail)
            .first<{ id: number; email: string; name: string; affiliation: string; level: number }>();
            
        if (!userRecord) {
            // 허용도메인 체크
            const isAllowed = await c.env.DB.prepare("SELECT id FROM allowed_domains WHERE domain = ?")
                .bind(domain)
                .first();
            
            // 허용도메인이면 level 2 (인증사용자), 아니면 level 1 (일반)
            const level = isAllowed ? 2 : 1;
            
            const insert = await c.env.DB.prepare(
                "INSERT INTO users (email, name, affiliation, level) VALUES (?, ?, ?, ?)"
            ).bind(cleanEmail, cached.name, cached.affiliation || '', level).run();

            userRecord = {
                id: Number(insert.meta.last_row_id),
                email: cleanEmail,
                name: cached.name,
                affiliation: cached.affiliation || '',
                level
            };
        }
        
        // 로그인 세션 유지를 위한 JWT 생성
        const secret = new TextEncoder().encode(c.env.JWT_SECRET || 'edulink_jwt_secret_key_2026_xyz');
        const sessionToken = await new SignJWT({ id: userRecord.id, email: userRecord.email, name: userRecord.name, affiliation: userRecord.affiliation, level: userRecord.level })
            .setProtectedHeader({ alg: 'HS256' })
            .setExpirationTime('7d')
            .sign(secret);
            
        // 쿠키 설정
        const isSecure2 = c.req.url.startsWith('https');
        setCookie(c, 'edulink_token', sessionToken, {
            path: '/',
            secure: isSecure2,
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 60, // 7 days
            sameSite: 'Lax'
        });
        
        // 인증 OTP 캐시 삭제
        await c.env.URL_CACHE.delete(cacheKey);
        
        return c.json({ success: true, user: userRecord });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

app.post('/api/auth/google/mock', async (c) => {
    try {
        const { email, name } = await c.req.json();
        if (!email || !name || !email.trim() || !name.trim()) {
            return c.json({ success: false, error: '이메일과 이름은 모두 채워야 합니다.' }, 400);
        }
        
        const cleanEmail = email.trim().toLowerCase();
        const domain = cleanEmail.split('@')[1];
        
        let userRecord = await c.env.DB.prepare("SELECT id, email, name, level FROM users WHERE email = ?")
            .bind(cleanEmail)
            .first<{ id: number; email: string; name: string; level: number }>();
            
        if (!userRecord) {
            // 허용도메인 체크
            const isAllowed = await c.env.DB.prepare("SELECT id FROM allowed_domains WHERE domain = ?")
                .bind(domain)
                .first();
                
            const level = isAllowed ? 2 : 1;
            
            const insert = await c.env.DB.prepare(
                "INSERT INTO users (email, name, level) VALUES (?, ?, ?)"
            ).bind(cleanEmail, name.trim(), level).run();
            
            userRecord = {
                id: Number(insert.meta.last_row_id),
                email: cleanEmail,
                name: name.trim(),
                level
            };
        }
        
        // JWT ?앹꽦
        const secret = new TextEncoder().encode(c.env.JWT_SECRET || 'edulink_jwt_secret_key_2026_xyz');
        const sessionToken = await new SignJWT({ id: userRecord.id, email: userRecord.email, name: userRecord.name, level: userRecord.level })
            .setProtectedHeader({ alg: 'HS256' })
            .setExpirationTime('7d')
            .sign(secret);
            
        // 쿠키 설정
        const isSecure1 = c.req.url.startsWith('https');
        setCookie(c, 'edulink_token', sessionToken, {
            path: '/',
            secure: isSecure1,
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 60,
            sameSite: 'Lax'
        });
        
        return c.json({ success: true, user: userRecord });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

app.post('/api/auth/logout', async (c) => {
    deleteCookie(c, 'edulink_token', {
        path: '/',
        httpOnly: true
    });
    return c.json({ success: true, message: '로그아웃 되었습니다.' });
});

// ----------------------------------------------------
// [인증 라우트] Cloudflare Access 인증이 필요한 내부 API 그룹
// ----------------------------------------------------
// 이메일 존재 여부 확인 (공개 API - 로그인 모달 UX)
app.get('/api/auth/check-email', async (c) => {
    const email = c.req.query('email');
    if (!email || !email.trim()) return c.json({ exists: false });
    const cleanEmail = email.trim().toLowerCase();
    const user = await c.env.DB.prepare("SELECT name, affiliation FROM users WHERE email = ?")
        .bind(cleanEmail)
        .first<{ name: string; affiliation: string }>();
    return c.json({ exists: !!user, name: user?.name ?? null, affiliation: user?.affiliation ?? null });
});

// 카카오 OAuth 로그인 시작
app.get('/api/auth/kakao', (c) => {
    const clientId = c.env.KAKAO_CLIENT_ID;
    if (!clientId) return c.redirect('/?kakao_error=not_configured', 302);
    const redirectUri = 'https://dgedu.link/api/auth/kakao/callback';
    const kakaoAuthUrl = `https://kauth.kakao.com/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=profile_nickname,account_email`;
    return c.redirect(kakaoAuthUrl, 302);
});

// 카카오 OAuth 콜백
app.get('/api/auth/kakao/callback', async (c) => {
    const code = c.req.query('code');
    const error = c.req.query('error');
    if (error || !code) return c.redirect('/?kakao_error=1', 302);

    const clientId = c.env.KAKAO_CLIENT_ID!;
    const redirectUri = 'https://dgedu.link/api/auth/kakao/callback';

    try {
        // 1. 인가 코드 → 액세스 토큰
        const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: clientId,
                redirect_uri: redirectUri,
                code,
            }).toString(),
        });
        if (!tokenRes.ok) {
            console.error('Kakao token error:', await tokenRes.text());
            return c.redirect('/?kakao_error=2', 302);
        }
        const tokenData: any = await tokenRes.json();

        // 2. 사용자 정보 조회
        const userRes = await fetch('https://kapi.kakao.com/v2/user/me', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        if (!userRes.ok) {
            console.error('Kakao user info error:', await userRes.text());
            return c.redirect('/?kakao_error=3', 302);
        }
        const userData: any = await userRes.json();

        const kakaoId: string = String(userData.id);
        const kakaoEmail: string = userData.kakao_account?.email || `kakao_${kakaoId}@kakao.local`;
        const kakaoName: string = userData.kakao_account?.profile?.nickname
            || userData.properties?.nickname || '커카오사용자';

        // 3. 기존 사용자 조회 또는 신규 생성
        let userRecord = await c.env.DB.prepare("SELECT id, email, name, level FROM users WHERE email = ?")
            .bind(kakaoEmail)
            .first<{ id: number; email: string; name: string; level: number }>();

        if (!userRecord) {
            const domain = kakaoEmail.split('@')[1];
            const isAllowed = await c.env.DB.prepare("SELECT id FROM allowed_domains WHERE domain = ?")
                .bind(domain).first();
            const level = isAllowed ? 2 : 1;
            const insert = await c.env.DB.prepare("INSERT INTO users (email, name, level) VALUES (?, ?, ?)")
                .bind(kakaoEmail, kakaoName, level).run();
            userRecord = { id: Number(insert.meta.last_row_id), email: kakaoEmail, name: kakaoName, level };
        }

        // 4. JWT 세션 쿠키 발급
        const secret = new TextEncoder().encode(c.env.JWT_SECRET || 'edulink_jwt_secret_key_2026_xyz');
        const sessionToken = await new SignJWT({
            id: userRecord.id, email: userRecord.email, name: userRecord.name, level: userRecord.level,
        })
            .setProtectedHeader({ alg: 'HS256' })
            .setExpirationTime('7d')
            .sign(secret);

        setCookie(c, 'edulink_token', sessionToken, {
            path: '/', secure: true, httpOnly: true, maxAge: 7 * 24 * 60 * 60, sameSite: 'Lax',
        });

        return c.redirect('/dashboard', 302);
    } catch (err: any) {
        console.error('Kakao login error:', err);
        return c.redirect('/?kakao_error=4', 302);
    }
});

type UserVariables = { user: { id: number; email: string; name: string; level: number } };
const api = new Hono<{ Bindings: Env; Variables: UserVariables }>();

api.use('*', async (c, next) => {
    if (c.req.path.startsWith('/api/v1/')) return next();
    return authMiddleware()(c, next);
});

// 4. 내 프로필 정보 조회
api.get('/auth/me', (c) => {
    return c.json({ success: true, user: c.get('user') });
});

// 4.1 내 프로필 정보 설정 (사용자 이름 변경)
api.patch('/auth/profile', async (c) => {
    const user = c.get('user');
    try {
        const { name, affiliation } = await c.req.json();
        if (!name || !name.trim()) {
            return c.json({ success: false, error: '이름을 입력해주세요.' }, 400);
        }
        const aff = typeof affiliation === 'string' ? affiliation.trim() : '';

        await c.env.DB.prepare("UPDATE users SET name = ?, affiliation = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(name.trim(), aff, user.id)
            .run();

        return c.json({ success: true, message: '프로필이 업데이트되었습니다.', name: name.trim(), affiliation: aff });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

// 4.2 등급 승급 요청 제출 (level 1, 2 사용자)
api.post('/auth/upgrade-request', async (c) => {
    const user = c.get('user');
    if (user.level >= 3) {
        return c.json({ success: false, error: '3단계 이상 사용자는 승급 요청을 제출할 수 없습니다.' }, 400);
    }
    try {
        const { requested_level, reason } = await c.req.json();
        const numericLevel = Number(requested_level);
        if (isNaN(numericLevel) || numericLevel <= user.level || numericLevel > 3) {
            return c.json({ success: false, error: '유효하지 않은 요청 등급입니다.' }, 400);
        }
        if (!reason || !reason.trim()) {
            return c.json({ success: false, error: '요청 사유를 입력해주세요.' }, 400);
        }
        // 이미 대기 중인 요청이 있으면 차단
        const existing = await c.env.DB.prepare(
            "SELECT id FROM upgrade_requests WHERE user_id = ? AND status = 'pending'"
        ).bind(user.id).first();
        if (existing) {
            return c.json({ success: false, error: '이미 처리 대기 중인 승급 요청이 있습니다.' }, 400);
        }
        await c.env.DB.prepare(
            "INSERT INTO upgrade_requests (user_id, current_level, requested_level, reason) VALUES (?, ?, ?, ?)"
        ).bind(user.id, user.level, numericLevel, reason.trim()).run();
        return c.json({ success: true, message: '승급 요청이 제출되었습니다. 최고관리자 검토 후 처리됩니다.' });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

// 4.3 내 등급 승급 요청 현황 조회
api.get('/auth/upgrade-request', async (c) => {
    const user = c.get('user');
    try {
        const { results } = await c.env.DB.prepare(
            "SELECT * FROM upgrade_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 5"
        ).bind(user.id).all();
        return c.json({ success: true, requests: results });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

// 5. 내 단축 링크 목록 조회 (is_public 컬럼 추가 반환)
api.get('/links', async (c) => {
    const user = c.get('user');
    try {
        const { results } = await c.env.DB.prepare(
            `SELECT id, slug, base_slug, custom_slug, original_url, title, description, click_count, is_active, is_public, expires_at, password, created_at, created_by
             FROM urls
             WHERE user_id = ? AND (kind IS NULL OR kind = 'link')
             ORDER BY created_at DESC`
        )
        .bind(user.id)
        .all();
        return c.json({ success: true, links: results });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

// 5b. 설문지 목록 조회 (level >= 3)
api.get('/surveys', async (c) => {
    const user = c.get('user');
    if (user.level < 3) {
        return c.json({ success: false, error: '설문지 기능은 고급사용자(레벨 3) 이상 권한이 필요합니다.' }, 403);
    }
    try {
        const { results } = await c.env.DB.prepare(
            `SELECT id, slug, base_slug, custom_slug, title, survey_config, response_limit, response_count, is_active, expires_at, password, created_at
             FROM urls
             WHERE user_id = ? AND kind = 'survey'
             ORDER BY created_at DESC`
        ).bind(user.id).all();
        return c.json({ success: true, surveys: results });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

// 5c. 설문지 생성
api.post('/surveys', async (c) => {
    const user = c.get('user');
    if (user.level < 3) {
        return c.json({ success: false, error: '설문지 기능은 고급사용자(레벨 3) 이상 권한이 필요합니다.' }, 403);
    }
    try {
        const body = await c.req.json();
        const { title, survey_config, response_limit, expires_at, password } = body;
        const inputCustomSlug = body.custom_slug ?? body.slug ?? null;
        if (!title || !String(title).trim()) {
            return c.json({ success: false, error: '설문 제목이 필요합니다.' }, 400);
        }
        if (!survey_config || typeof survey_config !== 'object') {
            return c.json({ success: false, error: 'survey_config가 필요합니다.' }, 400);
        }
        if (password && !/^\d{6}$/.test(password)) {
            return c.json({ success: false, error: '비밀번호는 숫자 6자리여야 합니다.' }, 400);
        }

        const reservedSlugs = await c.env.DB.prepare("SELECT slug FROM reserved_slugs").all<{ slug: string }>();
        const reservedSet = new Set(reservedSlugs.results.map(r => r.slug.toLowerCase()));

        let customSlug: string | null = null;
        if (inputCustomSlug && String(inputCustomSlug).trim()) {
            let cs = String(inputCustomSlug).trim();
            try { cs = decodeURIComponent(cs).normalize('NFC'); } catch { cs = cs.normalize('NFC'); }
            if (!isValidCustomSlug(cs)) {
                return c.json({ success: false, error: '슬러그는 4~20자의 영숫자, 한글, 하이픈만 사용할 수 있습니다.' }, 400);
            }
            if (reservedSet.has(cs.toLowerCase())) {
                return c.json({ success: false, error: '사용할 수 없는 예약 슬러그입니다.' }, 400);
            }
            const dup = await c.env.DB.prepare(
                "SELECT id FROM urls WHERE base_slug = ? OR custom_slug = ? OR slug = ?"
            ).bind(cs, cs, cs).first();
            if (dup) return c.json({ success: false, error: '이미 사용 중인 슬러그입니다.' }, 400);
            customSlug = cs;
        }

        let baseSlug = '';
        for (let i = 0; i < 10; i++) {
            const cand = generateRandomSlug(6);
            if (reservedSet.has(cand.toLowerCase())) continue;
            const dup = await c.env.DB.prepare(
                "SELECT id FROM urls WHERE base_slug = ? OR custom_slug = ? OR slug = ?"
            ).bind(cand, cand, cand).first();
            if (!dup) { baseSlug = cand; break; }
        }
        if (!baseSlug) {
            return c.json({ success: false, error: '슬러그 생성에 실패했습니다.' }, 500);
        }

        const limitVal = Number.isFinite(Number(response_limit)) && Number(response_limit) > 0 ? Number(response_limit) : null;
        const expiration = expires_at ? expires_at : null;
        const pass = password ? password : null;

        const result = await c.env.DB.prepare(
            `INSERT INTO urls (slug, base_slug, custom_slug, original_url, title, description, is_public, expires_at, password, user_id, kind, survey_config, response_limit)
             VALUES (?, ?, ?, '', ?, '', 0, ?, ?, ?, 'survey', ?, ?)`
        ).bind(baseSlug, baseSlug, customSlug, String(title).trim(), expiration, pass, user.id, JSON.stringify(survey_config), limitVal).run();

        return c.json({
            success: true,
            id: result.meta.last_row_id,
            base_slug: baseSlug,
            custom_slug: customSlug,
            slug: customSlug || baseSlug,
        });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

// 5d. 설문지 수정
api.patch('/surveys/:id', async (c) => {
    const user = c.get('user');
    if (user.level < 3) {
        return c.json({ success: false, error: '설문지 기능은 고급사용자(레벨 3) 이상 권한이 필요합니다.' }, 403);
    }
    const id = c.req.param('id');
    try {
        const body = await c.req.json();
        const { title, survey_config, response_limit, expires_at, password, is_active, custom_slug } = body;

        const row = await c.env.DB.prepare(
            "SELECT id, base_slug, custom_slug, password, expires_at FROM urls WHERE id = ? AND user_id = ? AND kind = 'survey'"
        ).bind(id, user.id).first<{ id: number; base_slug: string; custom_slug: string | null; password: string | null; expires_at: string | null }>();
        if (!row) return c.json({ success: false, error: '설문을 찾을 수 없거나 권한이 없습니다.' }, 404);

        if (password !== undefined && password !== null && password !== '' && !/^\d{6}$/.test(password)) {
            return c.json({ success: false, error: '비밀번호는 숫자 6자리여야 합니다.' }, 400);
        }

        let updatedCustomSlug = row.custom_slug;
        if (custom_slug !== undefined) {
            if (!custom_slug || String(custom_slug).trim() === '') {
                updatedCustomSlug = null;
            } else {
                let cs = String(custom_slug).trim();
                try { cs = decodeURIComponent(cs).normalize('NFC'); } catch { cs = cs.normalize('NFC'); }
                if (cs === row.base_slug) {
                    updatedCustomSlug = null;
                } else {
                    if (!isValidCustomSlug(cs)) {
                        return c.json({ success: false, error: '슬러그는 4~20자의 영숫자, 한글, 하이픈만 사용할 수 있습니다.' }, 400);
                    }
                    const reserved = await c.env.DB.prepare("SELECT slug FROM reserved_slugs").all<{ slug: string }>();
                    if (new Set(reserved.results.map(r => r.slug.toLowerCase())).has(cs.toLowerCase())) {
                        return c.json({ success: false, error: '사용할 수 없는 예약 슬러그입니다.' }, 400);
                    }
                    const dup = await c.env.DB.prepare(
                        "SELECT id FROM urls WHERE (base_slug = ? OR custom_slug = ? OR slug = ?) AND id != ?"
                    ).bind(cs, cs, cs, id).first();
                    if (dup) return c.json({ success: false, error: '이미 사용 중인 슬러그입니다.' }, 400);
                    updatedCustomSlug = cs;
                }
            }
        }

        const activeStatus = is_active !== undefined ? (is_active ? 1 : 0) : 1;
        const pass = password === '' ? null : (password !== undefined ? password : row.password);
        const expiration = expires_at === '' ? null : (expires_at !== undefined ? expires_at : row.expires_at);
        const cfg = survey_config !== undefined ? JSON.stringify(survey_config) : null;
        const limitVal = response_limit === '' || response_limit === null ? null
            : (response_limit !== undefined && Number.isFinite(Number(response_limit)) && Number(response_limit) > 0 ? Number(response_limit) : null);

        if (cfg !== null) {
            await c.env.DB.prepare(
                `UPDATE urls SET custom_slug = ?, title = ?, survey_config = ?, response_limit = ?, expires_at = ?, password = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?`
            ).bind(updatedCustomSlug, title ?? '', cfg, limitVal, expiration, pass, activeStatus, id).run();
        } else {
            await c.env.DB.prepare(
                `UPDATE urls SET custom_slug = ?, title = ?, response_limit = ?, expires_at = ?, password = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?`
            ).bind(updatedCustomSlug, title ?? '', limitVal, expiration, pass, activeStatus, id).run();
        }

        return c.json({ success: true });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

// 5e. 설문지 삭제
api.delete('/surveys/:id', async (c) => {
    const user = c.get('user');
    if (user.level < 3) {
        return c.json({ success: false, error: '설문지 기능은 고급사용자(레벨 3) 이상 권한이 필요합니다.' }, 403);
    }
    const id = c.req.param('id');
    try {
        const r = await c.env.DB.prepare("DELETE FROM urls WHERE id = ? AND user_id = ? AND kind = 'survey'")
            .bind(id, user.id).run();
        if (r.meta.changes === 0) return c.json({ success: false, error: '설문을 찾을 수 없습니다.' }, 404);
        return c.json({ success: true });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

// 5f. 설문 응답 결과 (JSON)
api.get('/surveys/:id/responses', async (c) => {
    const user = c.get('user');
    if (user.level < 3) return c.json({ success: false, error: '권한이 없습니다.' }, 403);
    const id = c.req.param('id');
    try {
        const survey = await c.env.DB.prepare(
            "SELECT id, title, survey_config FROM urls WHERE id = ? AND user_id = ? AND kind = 'survey'"
        ).bind(id, user.id).first<{ id: number; title: string; survey_config: string }>();
        if (!survey) return c.json({ success: false, error: '설문을 찾을 수 없습니다.' }, 404);

        const { results } = await c.env.DB.prepare(
            "SELECT id, answers_json, submitted_at FROM survey_responses WHERE url_id = ? ORDER BY submitted_at DESC"
        ).bind(id).all<{ id: number; answers_json: string; submitted_at: string }>();

        const responses = results.map(r => ({ id: r.id, submitted_at: r.submitted_at, answers: JSON.parse(r.answers_json) }));
        return c.json({ success: true, survey: { ...survey, survey_config: JSON.parse(survey.survey_config) }, responses });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

// 5g. 설문 응답 CSV 다운로드
api.get('/surveys/:id/responses.csv', async (c) => {
    const user = c.get('user');
    if (user.level < 3) return c.text('forbidden', 403);
    const id = c.req.param('id');
    try {
        const survey = await c.env.DB.prepare(
            "SELECT id, title, survey_config FROM urls WHERE id = ? AND user_id = ? AND kind = 'survey'"
        ).bind(id, user.id).first<{ id: number; title: string; survey_config: string }>();
        if (!survey) return c.text('not found', 404);

        const config = JSON.parse(survey.survey_config) as { questions: Array<{ id: string; label: string; type: string }> };
        const questions = config.questions || [];

        const { results } = await c.env.DB.prepare(
            "SELECT answers_json, submitted_at FROM survey_responses WHERE url_id = ? ORDER BY submitted_at ASC"
        ).bind(id).all<{ answers_json: string; submitted_at: string }>();

        const escapeCsv = (v: any) => {
            if (v === null || v === undefined) return '';
            const s = Array.isArray(v) ? v.join(' | ')
                : (typeof v === 'object' ? JSON.stringify(v) : String(v));
            if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
            return s;
        };
        const header = ['제출일시', ...questions.map(q => q.label)];
        const lines = [header.map(escapeCsv).join(',')];
        for (const r of results) {
            const ans = JSON.parse(r.answers_json) as Record<string, any>;
            const row = [r.submitted_at, ...questions.map(q => escapeCsv(ans[q.id]))];
            lines.push(row.join(','));
        }
        const csv = '﻿' + lines.join('\r\n');
        const filename = encodeURIComponent((survey.title || 'survey') + '_responses.csv');
        return new Response(csv, {
            headers: {
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
            },
        });
    } catch (err: any) {
        return c.text('error: ' + err.message, 500);
    }
});

// 6. 단축 링크 생성
api.post('/links', async (c) => {
    const user = c.get('user');

    if (user.level < 2) {
        return c.json({ success: false, error: '인증사용자(레벨 2) 권한 이상만 단축 링크를 발행할 수 있습니다.' }, 403);
    }

    try {
        const body = await c.req.json();
        const { original_url, title, description, is_public, expires_at, password } = body;
        // 사용자가 입력한 슬러그는 custom_slug로 처리 (이름 호환: slug 또는 custom_slug)
        const inputCustomSlug = body.custom_slug ?? body.slug ?? null;

        if (!original_url) {
            return c.json({ success: false, error: 'original_url이 필요합니다.' }, 400);
        }
        try { new URL(original_url); } catch {
            return c.json({ success: false, error: '유효하지 않은 URL 형식입니다.' }, 400);
        }

        if (password && !/^\d{6}$/.test(password)) {
            return c.json({ success: false, error: '비밀번호는 숫자 6자리여야 합니다.' }, 400);
        }

        const reservedSlugs = await c.env.DB.prepare("SELECT slug FROM reserved_slugs").all<{ slug: string }>();
        const reservedSet = new Set(reservedSlugs.results.map(r => r.slug.toLowerCase()));

        // custom_slug 검증 (사용자가 입력한 경우만)
        let customSlug: string | null = null;
        if (inputCustomSlug && String(inputCustomSlug).trim()) {
            let cs = String(inputCustomSlug).trim();
            try { cs = decodeURIComponent(cs).normalize('NFC'); } catch { cs = cs.normalize('NFC'); }
            if (!isValidCustomSlug(cs)) {
                return c.json({ success: false, error: '슬러그는 4~20자의 영숫자, 한글, 하이픈만 사용할 수 있습니다.' }, 400);
            }
            if (reservedSet.has(cs.toLowerCase())) {
                return c.json({ success: false, error: '사용할 수 없는 예약 슬러그입니다.' }, 400);
            }
            const dup = await c.env.DB.prepare(
                "SELECT id FROM urls WHERE base_slug = ? OR custom_slug = ? OR slug = ?"
            ).bind(cs, cs, cs).first();
            if (dup) {
                return c.json({ success: false, error: '이미 사용 중인 슬러그입니다.' }, 400);
            }
            customSlug = cs;
        }

        // base_slug는 항상 자동 생성 (6자리 무작위, 중복 회피)
        let baseSlug = '';
        let attempts = 0;
        while (attempts < 10) {
            const candidate = generateRandomSlug(6);
            attempts++;
            if (reservedSet.has(candidate.toLowerCase())) continue;
            const exists = await c.env.DB.prepare(
                "SELECT id FROM urls WHERE base_slug = ? OR custom_slug = ? OR slug = ?"
            ).bind(candidate, candidate, candidate).first();
            if (!exists) { baseSlug = candidate; break; }
        }
        if (!baseSlug) {
            return c.json({ success: false, error: '슬러그 생성에 실패했습니다. 다시 시도해주세요.' }, 500);
        }

        // title이 비어있으면 og:title 자동 추출 (실패해도 무시)
        let finalTitle = (title && title.trim()) ? title.trim() : '';
        if (!finalTitle) {
            try {
                const res = await fetch(original_url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (compatible; EduLink/1.0; +https://dgedu.link)',
                        'Accept': 'text/html,application/xhtml+xml',
                    },
                    signal: AbortSignal.timeout(4000),
                    redirect: 'follow',
                });
                if (res.ok && (res.headers.get('content-type') || '').includes('text/html')) {
                    const reader = res.body?.getReader();
                    let html = '';
                    if (reader) {
                        let bytes = 0;
                        while (bytes < 15000) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            html += new TextDecoder('utf-8', { fatal: false }).decode(value);
                            bytes += value.byteLength;
                            if (html.includes('</title>')) break;
                        }
                        await reader.cancel();
                    }
                    const og = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"'<>]+)["']/i)
                        || html.match(/<meta[^>]*content=["']([^"'<>]+)["'][^>]*property=["']og:title["']/i);
                    let t = og ? og[1] : '';
                    if (!t) {
                        const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
                        if (m) t = m[1];
                    }
                    finalTitle = t
                        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
                        .replace(/\s+/g, ' ').trim().slice(0, 100);
                }
            } catch { /* ignore — title fetch is best-effort */ }
        }

        const publicFlag = is_public ? 1 : 0;
        const expiration = expires_at ? expires_at : null;
        const pass = password ? password : null;

        await c.env.DB.prepare(
            `INSERT INTO urls (slug, base_slug, custom_slug, original_url, title, description, is_public, expires_at, password, user_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(baseSlug, baseSlug, customSlug, original_url, finalTitle, description || '', publicFlag, expiration, pass, user.id).run();

        // KV 캐싱: 만료/비밀번호 없는 활성 링크만, base_slug + custom_slug 모두
        if (!pass && !expiration) {
            await c.env.URL_CACHE.put(baseSlug, original_url);
            if (customSlug) await c.env.URL_CACHE.put(customSlug, original_url);
        }

        return c.json({
            success: true,
            slug: baseSlug,
            base_slug: baseSlug,
            custom_slug: customSlug,
            title: finalTitle,
            short_url: `https://${new URL(c.req.url).host}/${customSlug || baseSlug}`,
            original_url,
        });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

// 7. 단축 링크 수정
api.patch('/links/:id', async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    
    // 권한 레벨 2 (인증사용자) 이상 필요
    if (user.level < 2) {
        return c.json({ success: false, error: '인증사용자(레벨 2) 이상만 단축 링크를 수정할 수 있습니다.' }, 403);
    }
    try {
        const body = await c.req.json();
        const { original_url, title, description, is_active, is_public, expires_at, password, custom_slug } = body;

        const link = await c.env.DB.prepare("SELECT id, slug, base_slug, custom_slug, original_url, is_public, expires_at, password FROM urls WHERE id = ? AND user_id = ?")
            .bind(id, user.id)
            .first<{ id: number; slug: string; base_slug: string; custom_slug: string | null; original_url: string; is_public: number; expires_at: string | null; password: string | null }>();

        if (!link) {
            return c.json({ success: false, error: '해당 링크를 찾을 수 없거나 권한이 없습니다.' }, 404);
        }

        if (password !== undefined && password !== null && password !== '' && !/^\d{6}$/.test(password)) {
            return c.json({ success: false, error: '비밀번호는 숫자 6자리여야 합니다.' }, 400);
        }

        let updatedUrl = link.original_url;
        if (original_url) {
            try {
                new URL(original_url);
                updatedUrl = original_url;
            } catch {
                return c.json({ success: false, error: '유효하지 않은 URL 형식입니다.' }, 400);
            }
        }

        // custom_slug 처리: base_slug는 절대 변경하지 않음
        let updatedCustomSlug = link.custom_slug ?? null;
        if (custom_slug !== undefined) {
            if (!custom_slug || custom_slug.trim() === '') {
                updatedCustomSlug = null;
            } else {
                let cs = custom_slug.trim();
                try { cs = decodeURIComponent(cs).normalize('NFC'); } catch { cs = cs.normalize('NFC'); }
                const baseS2 = link.base_slug || link.slug;
                if (cs === baseS2) {
                    updatedCustomSlug = null;
                } else {
                    if (!isValidCustomSlug(cs)) {
                        return c.json({ success: false, error: '슬러그는 4~20자의 영숫자, 한글, 하이픈만 사용할 수 있습니다.' }, 400);
                    }
                    const reserved = await c.env.DB.prepare("SELECT slug FROM reserved_slugs").all<{ slug: string }>();
                    if (new Set(reserved.results.map(r => r.slug.toLowerCase())).has(cs.toLowerCase())) {
                        return c.json({ success: false, error: '사용할 수 없는 예약 슬러그입니다.' }, 400);
                    }
                    const dup = await c.env.DB.prepare(
                        "SELECT id FROM urls WHERE (base_slug = ? OR custom_slug = ? OR slug = ?) AND id != ?"
                    ).bind(cs, cs, cs, id).first();
                    if (dup) return c.json({ success: false, error: '이미 사용 중인 슬러그입니다.' }, 400);
                    updatedCustomSlug = cs;
                }
            }
        }

        const activeStatus = is_active !== undefined ? (is_active ? 1 : 0) : 1;
        const publicStatus = is_public !== undefined ? (is_public ? 1 : 0) : link.is_public;
        const pass = password === '' ? null : (password !== undefined ? password : link.password);
        const expiration = expires_at === '' ? null : (expires_at !== undefined ? expires_at : link.expires_at);

        await c.env.DB.prepare(
            `UPDATE urls
             SET custom_slug = ?, original_url = ?, title = ?, description = ?, is_active = ?, is_public = ?, expires_at = ?, password = ?, updated_at = datetime('now')
             WHERE id = ?`
        ).bind(updatedCustomSlug, updatedUrl, title || '', description || '', activeStatus, publicStatus, expiration, pass, id).run();

        // KV 캐시 갱신
        const baseS = link.base_slug || link.slug;
        if (activeStatus === 1 && !pass && !expiration) {
            await c.env.URL_CACHE.put(baseS, updatedUrl);
            if (updatedCustomSlug) await c.env.URL_CACHE.put(updatedCustomSlug, updatedUrl);
            // 이전 custom_slug가 변경/제거된 경우 KV에서도 삭제
            if (link.custom_slug && link.custom_slug !== updatedCustomSlug) {
                await c.env.URL_CACHE.delete(link.custom_slug);
            }
        } else {
            await c.env.URL_CACHE.delete(baseS);
            if (link.custom_slug) await c.env.URL_CACHE.delete(link.custom_slug);
            if (updatedCustomSlug && updatedCustomSlug !== link.custom_slug) await c.env.URL_CACHE.delete(updatedCustomSlug);
        }

        return c.json({ success: true, message: '성공적으로 수정되었습니다.' });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});


// 슬러그 중복 체크 API
api.get('/links/check-slug', async (c) => {
    const slug = c.req.query('slug');
    const excludeId = c.req.query('exclude_id');
    if (!slug) return c.json({ success: false, available: false, error: 'slug 파라미터가 필요합니다.' }, 400);
    let cs = slug.trim();
    try { cs = decodeURIComponent(cs).normalize('NFC'); } catch { cs = cs.normalize('NFC'); }
    if (!isValidCustomSlug(cs)) {
        return c.json({ success: true, available: false, reason: 'invalid', message: '4~20자의 영숫자, 한글, 하이픈만 사용할 수 있습니다.' });
    }
    const reserved = await c.env.DB.prepare("SELECT slug FROM reserved_slugs").all<{ slug: string }>();
    if (new Set(reserved.results.map(r => r.slug.toLowerCase())).has(cs.toLowerCase())) {
        return c.json({ success: true, available: false, reason: 'reserved', message: '예약된 슬러그입니다.' });
    }
    const query = excludeId
        ? "SELECT id FROM urls WHERE (base_slug = ? OR custom_slug = ? OR slug = ?) AND id != ?"
        : "SELECT id FROM urls WHERE base_slug = ? OR custom_slug = ? OR slug = ?";
    const params = excludeId ? [cs, cs, cs, excludeId] : [cs, cs, cs];
    const dup = await c.env.DB.prepare(query).bind(...params).first();
    if (dup) return c.json({ success: true, available: false, reason: 'taken', message: '이미 사용 중인 슬러그입니다.' });
    return c.json({ success: true, available: true });
});

// 8.1 링크 일별 클릭 통계 API (최근 30일)
api.get('/links/:id/stats', async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    try {
        const link = await c.env.DB.prepare(
            "SELECT id, slug, base_slug, custom_slug, original_url, title, click_count, created_at FROM urls WHERE id = ? AND user_id = ?"
        ).bind(id, user.id).first<{ id: number; slug: string; base_slug: string | null; custom_slug: string | null; original_url: string; title: string; click_count: number; created_at: string }>();

        if (!link) {
            return c.json({ success: false, error: '링크를 찾을 수 없거나 권한이 없습니다.' }, 404);
        }

        const { results } = await c.env.DB.prepare(
            `SELECT DATE(created_at) as date, COUNT(*) as clicks
             FROM click_logs
             WHERE url_id = ?
             AND created_at >= datetime('now', '-30 days')
             GROUP BY DATE(created_at)
             ORDER BY date ASC`
        ).bind(id).all<{ date: string; clicks: number }>();

        return c.json({ success: true, link, daily_clicks: results });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

// 8. 단축 링크 삭제
api.delete('/links/:id', async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    
    if (user.level < 2) {
        return c.json({ success: false, error: '인증사용자(레벨 2) 이상만 단축 링크를 삭제할 수 있습니다.' }, 403);
    }
    try {
        const link = await c.env.DB.prepare("SELECT id, slug, base_slug, custom_slug FROM urls WHERE id = ? AND user_id = ?")
            .bind(id, user.id)
            .first<{ id: number; slug: string; base_slug: string | null; custom_slug: string | null }>();

        if (!link) {
            return c.json({ success: false, error: '해당 링크를 찾을 수 없거나 권한이 없습니다.' }, 404);
        }

        await c.env.DB.prepare("DELETE FROM urls WHERE id = ?").bind(id).run();
        await c.env.URL_CACHE.delete(link.base_slug || link.slug);
        if (link.custom_slug) await c.env.URL_CACHE.delete(link.custom_slug);

        return c.json({ success: true, message: '단축 링크가 삭제되었습니다.' });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

// 8.2 API Keys 紐⑸줉 議고쉶
api.get('/keys', async (c) => {
    const user = c.get('user');
    
    // 권한 레벨 3 (고급사용자) 이상 필요
    if (user.level < 3) {        return c.json({ success: false, error: '고급사용자(레벨 3) 이상만 API Key를 조회/생성/삭제할 수 있습니다.' }, 403);
    }
    try {
        const { results } = await c.env.DB.prepare(
            `SELECT id, key_prefix, name, is_active, last_used_at, created_at 
             FROM api_keys 
             WHERE user_id = ? 
             ORDER BY created_at DESC`
        )
        .bind(user.id)
        .all();
        return c.json({ success: true, keys: results });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

// 8.3 API Key 신규 발급
api.post('/keys', async (c) => {
    const user = c.get('user');
    
    // 권한 레벨 3 (고급사용자) 이상 필요
    if (user.level < 3) {        return c.json({ success: false, error: '고급사용자(레벨 3) 이상만 API Key를 조회/생성/삭제할 수 있습니다.' }, 403);
    }
    try {
        const body = await c.req.json();
        const { name } = body;

        // edulink_ 접두어를 붙인 32자리 랜덤 영파벳 문자 토큰 생성
        const rawToken = 'edulink_' + Array.from(crypto.getRandomValues(new Uint8Array(20)))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('')
            .slice(0, 32);
        
        // 식별용 prefix
        const key_prefix = rawToken.slice(0, 12) + '...';
        // 해시 생성 (SHA-256)
        const encoder = new TextEncoder();
        const data = encoder.encode(rawToken);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const key_hash = Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');

        // DB 저장
        await c.env.DB.prepare(
            `INSERT INTO api_keys (user_id, key_hash, key_prefix, name)
             VALUES (?, ?, ?, ?)`
        )
        .bind(user.id, key_hash, key_prefix, name || 'Default Key')
        .run();

        // 발급된 원본 API Key는 이 응답에서만 평문 전달
        return c.json({
            success: true,
            api_key: rawToken,
            key_prefix,
            name: name || 'Default Key'
        });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

// 8.4 API Key 폐기
api.delete('/keys/:id', async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    
    // 권한 레벨 3 (고급사용자) 이상 필요
    if (user.level < 3) {        return c.json({ success: false, error: '고급사용자(레벨 3) 이상만 API Key를 조회/생성/삭제할 수 있습니다.' }, 403);
    }
    try {
        // 소유권 확인 후 삭제
        const result = await c.env.DB.prepare("DELETE FROM api_keys WHERE id = ? AND user_id = ?")
            .bind(id, user.id)
            .run();
        
        if (result.meta.changes === 0) {
            return c.json({ success: false, error: '해당 API 키를 찾을 수 없거나 권한이 없습니다.' }, 404);
        }

        return c.json({ success: true, message: 'API 키가 성공적으로 폐기되었습니다.' });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

// 에듀링크 페이지: 사이트/페이지/섹션 라우트 등록 (authMiddleware 적용된 api 인스턴스에 부착)
registerSiteRoutes(api);
registerPageRoutes(api);
registerSectionRoutes(api);
registerMediaRoutes(api);
registerPublishRoutes(api);

app.route("/api", api);

// ----------------------------------------------------
// [최고관리자 영역] 최고관리자 권한(admin)이 필요한 보호된 API 그룹
// ----------------------------------------------------
const adminApi = new Hono<{ Bindings: Env; Variables: UserVariables }>();

// 관리자 미들웨어 바인딩
adminApi.use('*', adminMiddleware());

// 10.1 allowed_domains 議고쉶
adminApi.get('/domains', async (c) => {
    try {
        const { results } = await c.env.DB.prepare(
            "SELECT id, domain, created_at FROM allowed_domains ORDER BY created_at DESC"
        ).all();
        return c.json({ success: true, domains: results });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

// 10.2 allowed_domains 추가
adminApi.post('/domains', async (c) => {
    try {
        const { domain } = await c.req.json();
        if (!domain || !domain.trim()) {
            return c.json({ success: false, error: '도메인 명이 필요합니다.' }, 400);
        }
        
        await c.env.DB.prepare("INSERT INTO allowed_domains (domain) VALUES (?)")
            .bind(domain.trim().toLowerCase())
            .run();
            
        return c.json({ success: true, message: '도메인이 성공적으로 등록되었습니다.' });
    } catch (err: any) {
        if (err.message.includes('UNIQUE')) {
            return c.json({ success: false, error: '이미 등록된 도메인입니다.' }, 400);
        }
        return c.json({ success: false, error: err.message }, 500);
    }
});

// 10.3 allowed_domains 삭제
adminApi.delete('/domains/:id', async (c) => {
    const id = c.req.param('id');
    try {
        const result = await c.env.DB.prepare("DELETE FROM allowed_domains WHERE id = ?")
            .bind(id)
            .run();
            
        if (result.meta.changes === 0) {
            return c.json({ success: false, error: '해당 도메인을 찾을 수 없습니다.' }, 404);
        }
        return c.json({ success: true, message: '도메인이 삭제되었습니다.' });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

// 10.4 공지사항 추가
adminApi.post('/notices', async (c) => {
    try {
        const { title, content, is_pinned } = await c.req.json();
        if (!title || !content) {
            return c.json({ success: false, error: '제목과 내용을 모두 입력해 주세요.' }, 400);
        }
        
        const pinned = is_pinned ? 1 : 0;
        await c.env.DB.prepare(
            "INSERT INTO notices (title, content, is_pinned) VALUES (?, ?, ?)"
        )
        .bind(title, content, pinned)
        .run();
        
        return c.json({ success: true, message: '공지사항이 등록되었습니다.' });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

// 10.5 공지사항 수정/삭제
adminApi.patch('/notices/:id', async (c) => {
    const id = c.req.param('id');
    try {
        const { title, content, is_pinned } = await c.req.json();
        if (!title?.trim() || !content?.trim()) {
            return c.json({ success: false, error: '제목과 내용을 입력해주세요.' }, 400);
        }
        const result = await c.env.DB.prepare(
            "UPDATE notices SET title = ?, content = ?, is_pinned = ?, updated_at = datetime('now') WHERE id = ?"
        ).bind(title.trim(), content.trim(), is_pinned ? 1 : 0, id).run();
        if (result.meta.changes === 0) {
            return c.json({ success: false, error: '해당 공지사항을 찾을 수 없습니다.' }, 404);
        }
        return c.json({ success: true, message: '공지사항이 수정되었습니다.' });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

adminApi.delete('/notices/:id', async (c) => {
    const id = c.req.param('id');
    try {
        const result = await c.env.DB.prepare("DELETE FROM notices WHERE id = ?")
            .bind(id)
            .run();
            
        if (result.meta.changes === 0) {
            return c.json({ success: false, error: '해당 공지사항을 찾을 수 없습니다.' }, 404);
        }
        return c.json({ success: true, message: '공지사항이 삭제되었습니다.' });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});
// 10.6 사용자 목록 조회 (어드민용)
adminApi.get('/users', async (c) => {
    try {
        const { results } = await c.env.DB.prepare(
            "SELECT id, email, name, affiliation, level, created_at FROM users ORDER BY created_at DESC"
        ).all();
        return c.json({ success: true, users: results });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

// 10.7 사용자 등급 설정 (최고관리자 전용)
adminApi.patch('/users/:id', async (c) => {
    const id = c.req.param('id');
    try {
        const { level } = await c.req.json();
        const numericLevel = Number(level);
        if (isNaN(numericLevel) || numericLevel < 1 || numericLevel > 4) {
            return c.json({ success: false, error: '유효하지 않은 권한 등급입니다. (1~4)' }, 400);
        }
        
        // 본인 등급 변경 차단 (최고관리자 권한 해제 방지)
        const self = c.get('user');
        if (self && String(self.id) === String(id)) {
            return c.json({ success: false, error: '본인의 권한 등급은 변경할 수 없습니다.' }, 400);
        }

        const result = await c.env.DB.prepare("UPDATE users SET level = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(numericLevel, id)
            .run();
            
        if (result.meta.changes === 0) {
            return c.json({ success: false, error: '해당 사용자를 찾을 수 없습니다.' }, 404);
        }
        
        return c.json({ success: true, message: `사용자 권한 등급이 ${numericLevel}단계로 변경되었습니다.` });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});
// 10.8 승급 요청 목록 조회 (최고관리자)
adminApi.get('/upgrade-requests', async (c) => {
    try {
        const { results } = await c.env.DB.prepare(
            `SELECT r.*, u.email, u.name, u.affiliation
             FROM upgrade_requests r
             JOIN users u ON r.user_id = u.id
             ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC`
        ).all();
        return c.json({ success: true, requests: results });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

// 10.9 승급 요청 승인 / 거절 (최고관리자)
adminApi.patch('/upgrade-requests/:id', async (c) => {
    const id = c.req.param('id');
    const admin = c.get('user');
    try {
        const { action } = await c.req.json(); // 'approve' | 'reject'
        if (action !== 'approve' && action !== 'reject') {
            return c.json({ success: false, error: '유효하지 않은 액션입니다.' }, 400);
        }
        const req = await c.env.DB.prepare(
            "SELECT * FROM upgrade_requests WHERE id = ?"
        ).bind(id).first() as any;
        if (!req) {
            return c.json({ success: false, error: '요청을 찾을 수 없습니다.' }, 404);
        }
        if (req.status !== 'pending') {
            return c.json({ success: false, error: '이미 처리된 요청입니다.' }, 400);
        }
        const newStatus = action === 'approve' ? 'approved' : 'rejected';
        await c.env.DB.prepare(
            "UPDATE upgrade_requests SET status = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?"
        ).bind(newStatus, admin.id, id).run();
        if (action === 'approve') {
            await c.env.DB.prepare(
                "UPDATE users SET level = ?, updated_at = datetime('now') WHERE id = ?"
            ).bind(req.requested_level, req.user_id).run();
        }
        const msg = action === 'approve'
            ? `승급 요청이 승인되었습니다. (${req.requested_level}단계로 변경)`
            : '승급 요청이 거절되었습니다.';
        return c.json({ success: true, message: msg });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

app.route("/api/admin", adminApi);



// ----------------------------------------------------
// [媛쒕컻?먯슜 OpenAPI ?곸뿭] API Key 諛?Rate Limiting 諛붿씤??// ----------------------------------------------------


// CORS & Rate Limit 결합 (API Key마다 IP마다 분당 최대 15회 사용)

// 8.5 외부용 단축 URL 생성 API
app.post('/api/v1/shorten', async (c) => {
    try {
        // ?몄쬆 ?섎떒 ?뺤씤 (?ㅻ뜑 Authorization ?먮뒗 x-api-key)
        let token = c.req.header('x-api-key') || '';
        const authHeader = c.req.header('Authorization');
        
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        }

        if (!token) {
            return c.json({ success: false, error: 'API Key 인증이 누락되었습니다. x-api-key 또는 Bearer 토큰을 헤더에 넣어 주세요.' }, 401);
        }

        // SHA-256 해시 조회
        const encoder = new TextEncoder();        const data = encoder.encode(token);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const keyHash = Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');

        // D1에서 발급된 키의 유효 사용자 찾기
        const keyRecord = await c.env.DB.prepare(`SELECT k.id, k.user_id, k.name, u.level FROM api_keys k JOIN users u ON k.user_id = u.id WHERE k.key_hash = ? AND k.is_active = 1`
        )
        .bind(keyHash)
        .first<{ id: number; user_id: number; name: string; level: number }>();

        if (!keyRecord) {
            return c.json({ success: false, error: '유효하지 않거나 비활성화된 API Key입니다.' }, 401);
        }

        if (keyRecord.level < 3) {
            return c.json({ success: false, error: '해당 API Key 소유자의 권한 레벨이 부족합니다.' }, 403);
        }

        const body = await c.req.json();
        const { original_url, title, description, is_public, expires_at, password } = body;
        let { slug } = body;

        if (!original_url) {
            return c.json({ success: false, error: 'original_url이 필요합니다.' }, 400);
        }
        try {
            new URL(original_url);
        } catch {
            return c.json({ success: false, error: '유효하지 않은 URL 형식입니다.' }, 400);
        }

        if (password && !/^\d{6}$/.test(password)) {
            return c.json({ success: false, error: '비밀번호는 숫자 6자리여야 합니다.' }, 400);
        }

        const reservedSlugs = await c.env.DB.prepare("SELECT slug FROM reserved_slugs").all<{ slug: string }>();
        const reservedSet = new Set(reservedSlugs.results.map(r => r.slug.toLowerCase()));

        if (slug) {
            slug = slug.trim();
            try {
                slug = decodeURIComponent(slug).normalize('NFC');
            } catch {
                slug = slug.normalize('NFC');
            }
            if (!isValidCustomSlug(slug)) {
                return c.json({ success: false, error: '슬러그는 4~20자의 한글, 영숫자, 하이픈만 허용됩니다.' }, 400);
            }
            if (reservedSet.has(slug.toLowerCase())) {
                return c.json({ success: false, error: '사용할 수 없는 예약된 슬러그입니다.' }, 400);
            }
            
            const exists = await c.env.DB.prepare("SELECT id FROM urls WHERE slug = ?").bind(slug).first();
            if (exists) {
                return c.json({ success: false, error: '이미 사용 중인 슬러그입니다.' }, 409);
            }
        } else {
            // ?쒕뜡 ?앹꽦
            let attempts = 0;
            let generated = '';
            let isUnique = false;

            while (attempts < 5 && !isUnique) {
                generated = generateRandomSlug(6);
                attempts++;

                if (reservedSet.has(generated.toLowerCase())) continue;

                const exists = await c.env.DB.prepare("SELECT id FROM urls WHERE slug = ?").bind(generated).first();
                if (!exists) {
                    isUnique = true;
                }
            }

            if (!isUnique) {
                return c.json({ success: false, error: '슬러그 생성에 실패했습니다. 다시 시도해 주세요.' }, 500);
            }
            slug = generated;
        }

        const publicFlag = is_public ? 1 : 0;
        const expiration = expires_at ? expires_at : null;
        const pass = password ? password : null;

        // D1 DB 기록 (is_public, expires_at, password, base_slug, created_by 추가)
        await c.env.DB.prepare(
            `INSERT INTO urls (slug, base_slug, original_url, title, description, is_public, expires_at, password, user_id, created_by) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')`
        ).bind(slug, slug, original_url, title || keyRecord.name, description || 'Generated via Developer API', publicFlag, expiration, pass, keyRecord.user_id).run();

        // KV 캐시 업데이트
        if (!pass && !expiration) {
            await c.env.URL_CACHE.put(slug, original_url);
        } else {
            await c.env.URL_CACHE.delete(slug);
        }

        // API 키 마지막 사용 기록 업데이트 (waitUntil 사용 비동기 처리)
        c.executionCtx.waitUntil(
            c.env.DB.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE key_hash = ?")
                .bind(keyHash)
                .run()
        );

        return c.json({
            success: true,
            slug,
            short_url: `https://${new URL(c.req.url).host}/${slug}`,
            original_url
        });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});



// ----------------------------------------------------
// [edumaps 연동] 리소스 카드 클릭/다운로드 카운터 (공개, 인증 불필요)
// ----------------------------------------------------

app.use('/api/v1/resource-stats/*', rateLimitMiddleware({ limit: 60, windowSec: 60 }));

// 클릭/다운로드 카운트 증가 (fire-and-forget: DB 쓰기는 waitUntil로 미뤄 응답을 막지 않음)
app.post('/api/v1/resource-stats/hit', async (c) => {
    try {
        const body = await c.req.json().catch(() => null);
        const resourceId = typeof body?.resource_id === 'string' ? body.resource_id.trim() : '';
        const kind = body?.kind;

        if (!resourceId || resourceId.length > 64) {
            return c.json({ success: false, error: 'resource_id가 유효하지 않습니다.' }, 400);
        }
        if (kind !== 'click' && kind !== 'download') {
            return c.json({ success: false, error: "kind는 'click' 또는 'download'여야 합니다." }, 400);
        }

        // kind는 컬럼명에 대응되므로 문자열 조립 대신 두 SQL문 중 하나를 그대로 선택한다 (SQL 인젝션 방지)
        const sql = kind === 'click'
            ? `INSERT INTO resource_stats (resource_id, click_count, download_count, updated_at)
               VALUES (?, 1, 0, datetime('now'))
               ON CONFLICT(resource_id) DO UPDATE SET
                   click_count = click_count + 1,
                   updated_at = datetime('now')`
            : `INSERT INTO resource_stats (resource_id, click_count, download_count, updated_at)
               VALUES (?, 0, 1, datetime('now'))
               ON CONFLICT(resource_id) DO UPDATE SET
                   download_count = download_count + 1,
                   updated_at = datetime('now')`;

        c.executionCtx.waitUntil(
            c.env.DB.prepare(sql).bind(resourceId).run().catch((err) => {
                console.error('resource_stats hit error:', err);
            })
        );

        return c.json({ success: true });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

// 인기 리소스 조회 (edumaps 랜딩 하단 "많이 찾는 자료" 섹션용) - 리소스 메타데이터는 안 돌려주고 id/카운트만 반환
app.get('/api/v1/resource-stats/top', async (c) => {
    try {
        const metric = c.req.query('metric') === 'download' ? 'download' : 'click';
        const limitParam = parseInt(c.req.query('limit') || '10', 10);
        const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 50) : 10;

        const sql = metric === 'download'
            ? `SELECT resource_id, click_count, download_count FROM resource_stats ORDER BY download_count DESC LIMIT ?`
            : `SELECT resource_id, click_count, download_count FROM resource_stats ORDER BY click_count DESC LIMIT ?`;

        const { results } = await c.env.DB.prepare(sql).bind(limit).all();
        return c.json({ success: true, items: results });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});



// ----------------------------------------------------
// [공개 리디렉션 및 SPA 서빙]
// ----------------------------------------------------

// /qr/:slug 및 /:slug.qr — DB 확인 후 외부 QR 이미지로 302 리다이렉트
async function handleQrRequest(slug: string, requestUrl: string, env: Env): Promise<Response> {
    try {
        const record = await env.DB.prepare(
            "SELECT is_active FROM urls WHERE base_slug = ? OR custom_slug = ? OR slug = ?"
        ).bind(slug, slug, slug).first<{ is_active: number }>();

        if (record && record.is_active === 1) {
            const host = new URL(requestUrl).host;
            const shortUrl = `https://${host}/${slug}`;
            const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=600x600&ecc=H&margin=10&format=png&data=${encodeURIComponent(shortUrl)}`;
            // Worker가 직접 fetch → PNG 바이트를 dgedu.link 도메인으로 반환 (사용자 망에서 외부 API 차단 무관)
            const qrRes = await fetch(qrApiUrl);
            if (qrRes.ok) {
                return new Response(qrRes.body, {
                    headers: {
                        'Content-Type': 'image/png',
                        'Cache-Control': 'public, max-age=86400',
                    },
                });
            }
        }
    } catch (e) {
        console.error('[qr] DB error:', e);
    }

    return new Response(
        '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>QR 오류</title></head>' +
        '<body style="display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif;background:#0f1117;color:#fff">' +
        '<div style="text-align:center"><h2 style="color:#f87171;margin:0 0 12px">존재하지 않는 단축주소입니다</h2>' +
        '<p style="color:#94a3b8;font-size:13px;margin:0">/' + slug + ' 슬러그를 찾을 수 없습니다.</p></div></body></html>',
        { status: 404, headers: { 'Content-Type': 'text/html; charset=UTF-8' } }
    );
}

app.get('/qr/:slug', async (c) => {
    let slug = c.req.param('slug');
    try { slug = decodeURIComponent(slug).normalize('NFC'); } catch { slug = slug.normalize('NFC'); }
    return handleQrRequest(slug, c.req.url, c.env);
});

app.get('/:slug{[^/]+\\.qr}', async (c) => {
    let raw = c.req.param('slug');
    try { raw = decodeURIComponent(raw).normalize('NFC'); } catch { raw = raw.normalize('NFC'); }
    const slug = raw.replace(/\.qr$/i, '');
    return handleQrRequest(slug, c.req.url, c.env);
});

// 설문 응답 제출 (공개)
app.post('/survey/:slug/submit', async (c) => {
    let slug = c.req.param('slug');
    try { slug = decodeURIComponent(slug).normalize('NFC'); } catch { slug = slug.normalize('NFC'); }
    try {
        const row = await c.env.DB.prepare(
            "SELECT id, user_id, title, password, expires_at, is_active, kind, survey_config, response_limit, response_count FROM urls WHERE base_slug = ? OR custom_slug = ? OR slug = ?"
        ).bind(slug, slug, slug).first<{ id: number; user_id: number; title: string; password: string | null; expires_at: string | null; is_active: number; kind: string; survey_config: string; response_limit: number | null; response_count: number }>();
        if (!row || row.kind !== 'survey' || row.is_active === 0) {
            return c.json({ success: false, error: '설문을 찾을 수 없습니다.' }, 404);
        }
        if (row.expires_at && new Date() > new Date(row.expires_at)) {
            return c.json({ success: false, error: '설문 기간이 종료되었습니다.' }, 410);
        }
        if (row.response_limit && row.response_count >= row.response_limit) {
            return c.json({ success: false, error: '설문이 마감되었습니다.' }, 410);
        }
        if (row.password) {
            const cookieVal = getCookie(c, `edulink_survey_${row.id}`);
            if (cookieVal !== row.password) {
                return c.json({ success: false, error: '비밀번호 인증이 필요합니다.' }, 401);
            }
        }

        const body = await c.req.json();
        const answers = body.answers;
        if (!answers || typeof answers !== 'object') {
            return c.json({ success: false, error: '응답 데이터가 올바르지 않습니다.' }, 400);
        }

        const config = JSON.parse(row.survey_config) as { questions: Array<{ id: string; label: string; type: string; required?: boolean }>; notify_email?: boolean };
        for (const q of (config.questions || [])) {
            if (q.type === 'media') continue;
            if (q.required) {
                const v = answers[q.id];
                const empty = v === undefined || v === null || v === ''
                    || (Array.isArray(v) && v.length === 0)
                    || (typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(x => !x));
                if (empty) return c.json({ success: false, error: `필수 항목 누락: ${q.label}` }, 400);
            }
        }

        const ip = c.req.header('cf-connecting-ip') || '';
        const ua = c.req.header('user-agent') || '';
        let ipHash = '';
        try {
            const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
            ipHash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
        } catch {}

        await c.env.DB.prepare(
            "INSERT INTO survey_responses (url_id, answers_json, ip_hash, user_agent) VALUES (?, ?, ?, ?)"
        ).bind(row.id, JSON.stringify(answers), ipHash, ua).run();
        await c.env.DB.prepare("UPDATE urls SET response_count = response_count + 1 WHERE id = ?").bind(row.id).run();

        if (config.notify_email) {
            try {
                const owner = await c.env.DB.prepare(
                    "SELECT email, name FROM users WHERE id = ?"
                ).bind(row.user_id).first<{ email: string; name: string }>();
                const isProd = c.req.url.includes('dgedu.link');
                if (owner && isProd && c.env.RESEND_API_KEY) {
                    const newCount = (row.response_count || 0) + 1;
                    const rowsHtml = config.questions
                        .filter(q => q.type !== 'media')
                        .map(q => {
                            const ans = answers[q.id];
                            let ansStr = '';
                            if (Array.isArray(ans)) ansStr = ans.join(', ');
                            else if (ans !== null && ans !== undefined && typeof ans === 'object') {
                                ansStr = Object.entries(ans as Record<string, unknown>).filter(([, v]) => v).map(([k]) => k).join(', ');
                            } else {
                                ansStr = String(ans ?? '');
                            }
                            return `<tr>
  <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#475569;font-weight:600;width:35%;vertical-align:top;">${q.label}</td>
  <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#1e293b;vertical-align:top;">${ansStr || '<span style="color:#94a3b8">-</span>'}</td>
</tr>`;
                        }).join('');

                    const notifyHtml = `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"></head>
<body style="font-family:'Apple SD Gothic Neo',sans-serif;background:#f5f7fa;margin:0;padding:40px 0;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
    <div style="background:linear-gradient(135deg,#2563eb,#4f46e5);padding:28px 36px;">
      <h1 style="color:#fff;margin:0;font-size:20px;font-weight:900;letter-spacing:-0.5px;">에듀링크</h1>
      <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:12px;">설문 응답 알림</p>
    </div>
    <div style="padding:28px 36px;">
      <p style="color:#1e293b;font-size:15px;font-weight:700;margin:0 0 4px;">${owner.name || owner.email}님, 새 응답이 도착했습니다!</p>
      <p style="color:#64748b;font-size:13px;margin:0 0 20px;">설문 <strong>${row.title}</strong>에 ${newCount}번째 응답이 제출되었습니다.</p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
        ${rowsHtml}
      </table>
    </div>
    <div style="background:#f8fafc;padding:16px 36px;border-top:1px solid #e2e8f0;">
      <p style="color:#cbd5e1;font-size:11px;margin:0;text-align:center;">&copy; 2026 에듀링크 &middot; dgedu.link</p>
    </div>
  </div>
</body>
</html>`;

                    await fetch('https://api.resend.com/emails', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${c.env.RESEND_API_KEY}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            from: '에듀링크 <noreply@dgedu.link>',
                            to: [owner.email],
                            subject: `[에듀링크] "${row.title}" 새 응답 #${newCount}`,
                            html: notifyHtml,
                        }),
                    });
                }
            } catch (e) {
                console.error('[survey notify]', e);
            }
        }

        return c.json({ success: true });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

// robots.txt — ASSETS에서 직접 서빙
app.get('/robots.txt', (c) => c.env.ASSETS.fetch(c.req.raw));

// sitemap.xml — DB에서 관리자 공식 링크를 동적으로 포함
app.get('/sitemap.xml', async (c) => {
    const host = new URL(c.req.url).origin; // e.g. https://dgedu.link

    // 관리자(user_id 1·2)가 등록한 공개 커스텀 단축링크 조회
    let adminLinks: { custom_slug: string; title: string; updated_at: string }[] = [];
    try {
        const { results } = await c.env.DB.prepare(
            `SELECT custom_slug, title, updated_at
               FROM urls
              WHERE user_id IN (1, 2)
                AND kind     = 'link'
                AND created_by = 'web'
                AND custom_slug IS NOT NULL
                AND is_active = 1
                AND is_public = 1
              ORDER BY updated_at DESC`
        ).all<{ custom_slug: string; title: string; updated_at: string }>();
        adminLinks = results;
    } catch (e) {
        console.error('[sitemap] DB query failed:', e);
    }

    const urlEntries = [
        // 랜딩 페이지
        `  <url>\n    <loc>${host}/</loc>\n    <changefreq>monthly</changefreq>\n    <priority>1.0</priority>\n  </url>`,
        // 관리자 공식 링크
        ...adminLinks.map(({ custom_slug, updated_at }) => {
            const lastmod = updated_at ? updated_at.slice(0, 10) : '';
            return `  <url>\n    <loc>${host}/${encodeURIComponent(custom_slug)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>`;
        }),
    ].join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlEntries}\n</urlset>`;

    return new Response(xml, {
        headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
        },
    });
});

// 9. /{slug} 리다이렉트 怨좎냽 由щ뵒?됱뀡
app.get('/:slug', async (c) => {
    let slug = c.req.param('slug');
    try {
        slug = decodeURIComponent(slug).normalize('NFC');
    } catch {
        slug = slug.normalize('NFC');
    }
    const userAgent = c.req.header('user-agent') || '';
    const referer = c.req.header('referer') || '';
    const country = c.req.header('cf-ipcountry') || 'unknown';
    const cfConnectingIp = c.req.header('cf-connecting-ip') || 'unknown';

    try {
        // 예약 슬러그 체크 (SPA 라우트 보호)
        let reservedSet = new Set<string>();
        try {
            const { results } = await c.env.DB.prepare("SELECT slug FROM reserved_slugs").all<{ slug: string }>();
            reservedSet = new Set(results.map(r => r.slug.toLowerCase()));
        } catch (e) {
            console.error('[redirect] reserved_slugs load failed:', e);
        }

        if (reservedSet.has(slug.toLowerCase())) {
            return c.env.ASSETS.fetch(c.req.raw);
        }

        // 1. KV 캐시 확인 (만료/비밀번호 없는 활성 링크만 캐싱됨)
        let destination = await c.env.URL_CACHE.get(slug);
        let urlRecord: { id: number; original_url: string; is_active: number; expires_at: string | null; password: string | null; kind?: string; survey_config?: string | null; response_limit?: number | null; response_count?: number; site_id?: number | null } | null = null;

        if (!destination) {
            // 2. D1 DB 조회 (base_slug, custom_slug, slug 모두 검색)
            urlRecord = await c.env.DB.prepare(
                "SELECT id, original_url, is_active, expires_at, password, kind, survey_config, response_limit, response_count, site_id FROM urls WHERE base_slug = ? OR custom_slug = ? OR slug = ?"
            )
            .bind(slug, slug, slug)
            .first<{ id: number; original_url: string; is_active: number; expires_at: string | null; password: string | null; kind: string; survey_config: string | null; response_limit: number | null; response_count: number; site_id: number | null }>();

            if (urlRecord) {
                // 에듀링크 페이지(사이트) — 게시 스냅샷 홈 서빙
                if (urlRecord.kind === 'site' && urlRecord.site_id) {
                    return await serveSiteById(c, urlRecord.site_id, slug, []);
                }
                // 비활성 링크 처리
                if (urlRecord.is_active === 0) {
                    if (urlRecord.kind === 'survey') {
                        let inactiveMsg = '';
                        try { inactiveMsg = JSON.parse(urlRecord.survey_config || '{}').inactive_message || ''; } catch {}
                        return c.html(getSurveyClosedHtml('설문이 종료되었습니다.', inactiveMsg || undefined));
                    }
                    return c.redirect('/');
                }

                // 만료일시 처리 (비밀번호/만료일 기능 유지)
                if (urlRecord.expires_at) {
                    const expireDate = new Date(urlRecord.expires_at);
                    const now = new Date();
                    if (now > expireDate) {
                        try {
                            c.executionCtx.waitUntil((async () => {
                                await c.env.DB.prepare("UPDATE urls SET is_active = 0 WHERE id = ?").bind(urlRecord!.id).run();
                                await c.env.URL_CACHE.delete(slug);
                            })());
                        } catch {}
                        if (urlRecord.kind === 'survey') {
                            let inactiveMsg2 = '';
                            try { inactiveMsg2 = JSON.parse(urlRecord.survey_config || '{}').inactive_message || ''; } catch {}
                            return c.html(getSurveyClosedHtml('설문 응답 기간이 종료되었습니다.', inactiveMsg2 || undefined));
                        }
                        return c.redirect('/');
                    }
                }

                // 설문지 처리 (단축 링크 패턴 공유, 사용자 접속 결과만 다름)
                if (urlRecord.kind === 'survey') {
                    if (urlRecord.response_limit && (urlRecord.response_count ?? 0) >= urlRecord.response_limit) {
                        let inactiveMsg3 = '';
                        try { inactiveMsg3 = JSON.parse(urlRecord.survey_config || '{}').inactive_message || ''; } catch {}
                        return c.html(getSurveyClosedHtml('설문이 마감되었습니다. (최대 응답 수에 도달)', inactiveMsg3 || undefined));
                    }
                    // 비밀번호 체크 (쿠키 매칭)
                    if (urlRecord.password) {
                        const cookieName = `edulink_survey_${urlRecord.id}`;
                        const cookieVal = getCookie(c, cookieName);
                        if (cookieVal !== urlRecord.password) {
                            return c.html(getPasswordPageHtml(slug));
                        }
                    }
                    return c.html(getSurveyPageHtml(urlRecord.id, slug, urlRecord.survey_config || '{}'));
                }

                // 비밀번호 보호 처리 (비밀번호 기능 유지)
                if (urlRecord.password) {
                    return c.html(getPasswordPageHtml(slug));
                }

                destination = urlRecord.original_url;

                // 만료/비밀번호 없는 활성 링크만 KV에 캐싱
                if (!urlRecord.expires_at && !urlRecord.password) {
                    await c.env.URL_CACHE.put(slug, destination);
                }
            }
        }

        if (destination) {
            // 클릭 분석 기록 (비동기 — 실패해도 리다이렉트는 진행)
            try {
                c.executionCtx.waitUntil((async () => {
                    try {
                        if (!urlRecord) {
                            urlRecord = await c.env.DB.prepare(
                                "SELECT id FROM urls WHERE base_slug = ? OR custom_slug = ? OR slug = ?"
                            )
                            .bind(slug, slug, slug)
                            .first<{ id: number; original_url: string; is_active: number; expires_at: string | null; password: string | null }>();
                        }
                        if (urlRecord) {
                            await c.env.DB.prepare("UPDATE urls SET click_count = click_count + 1 WHERE id = ?")
                                .bind(urlRecord.id).run();

                            let deviceType = 'desktop';
                            if (/mobile/i.test(userAgent)) deviceType = 'mobile';
                            else if (/tablet/i.test(userAgent)) deviceType = 'tablet';

                            const encoder = new TextEncoder();
                            const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(cfConnectingIp));
                            const ipHash = Array.from(new Uint8Array(hashBuffer))
                                .map(b => b.toString(16).padStart(2, '0')).join('');

                            await c.env.DB.prepare(
                                `INSERT INTO click_logs (url_id, ip_hash, country, referer, user_agent, device_type) VALUES (?, ?, ?, ?, ?, ?)`
                            ).bind(urlRecord.id, ipHash, country, referer, userAgent, deviceType).run();
                        }
                    } catch (e) {
                        console.error('[redirect] click analytics failed:', e);
                    }
                })());
            } catch (e) {
                console.error('[redirect] waitUntil failed:', e);
            }

            // 307 리다이렉트 (캐시 방지)
            return new Response(null, {
                status: 307,
                headers: {
                    'Location': destination,
                    'Cache-Control': 'no-store',
                },
            });
        }
    } catch (err) {
        console.error('[redirect] handler error:', err);
    }

    return c.env.ASSETS.fetch(c.req.raw);
});

// 9.4 미디어 서빙 (R2 프록시) — 업로드된 이미지 공개 제공
app.get('/media/*', async (c) => {
    const key = c.req.path.replace(/^\/media\//, '');
    if (!key || !c.env.MEDIA) return c.notFound();
    const obj = await c.env.MEDIA.get(key);
    if (!obj) return c.notFound();
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set('etag', obj.httpEtag);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    return new Response(obj.body, { headers });
});

// 9.5 에듀링크 페이지 하위 경로 (dgedu.link/{slug}/{depth1}[/{depth2}])
async function handleSiteSubPage(c: any, segs: string[]) {
    let slug = c.req.param('slug');
    try { slug = decodeURIComponent(slug).normalize('NFC'); } catch { slug = slug.normalize('NFC'); }

    // 예약 슬러그(앱 라우트)는 SPA로
    try {
        const { results } = await c.env.DB.prepare("SELECT slug FROM reserved_slugs").all();
        if (new Set((results as Array<{ slug: string }>).map((r) => r.slug.toLowerCase())).has(slug.toLowerCase())) {
            return c.env.ASSETS.fetch(c.req.raw);
        }
    } catch { /* noop */ }

    const info = await lookupSiteBySlug(c, slug);
    if (!info) return c.env.ASSETS.fetch(c.req.raw); // 사이트가 아니면 SPA fallback
    return await serveSiteById(c, info.siteId, slug, segs);
}

app.get('/:slug/:p1', (c) => handleSiteSubPage(c, [c.req.param('p1')]));
app.get('/:slug/:p1/:p2', (c) => handleSiteSubPage(c, [c.req.param('p1'), c.req.param('p2')]));

// 10. SPA ?대갚 ?쒕튃
app.all('*', (c) => {
    return c.env.ASSETS.fetch(c.req.raw);
});

// HTML 템플릿 생성 헬퍼 함수
function getPasswordPageHtml(slug: string): string {
    return `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>보호된 링크 - 에듀링크</title>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700;900&display=swap" rel="stylesheet">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Noto Sans KR', sans-serif; }
        body {
            background: linear-gradient(135deg, #f5f7fa 0%, #e4e8f0 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .card {
            background: rgba(255, 255, 255, 0.85);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 255, 255, 0.4);
            border-radius: 24px;
            padding: 40px 30px;
            max-width: 400px;
            width: 100%;
            text-align: center;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.06);
        }
        .logo {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 24px;
        }
        .logo img {
            width: 32px;
            height: 32px;
            border-radius: 8px;
            box-shadow: 0 4px 10px rgba(0,0,0,0.05);
            object-cover: cover;
        }
        .logo span {
            font-size: 20px;
            font-weight: 900;
            background: linear-gradient(to right, #2563eb, #4f46e5);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        h2 { font-size: 18px; font-weight: 700; color: #1e293b; margin-bottom: 8px; }
        p { font-size: 13px; color: #64748b; line-height: 1.6; margin-bottom: 24px; }
        .input-group {
            display: flex;
            justify-content: space-between;
            gap: 8px;
            margin-bottom: 24px;
        }
        .digit-input {
            width: 48px;
            height: 56px;
            border: 2px solid #e2e8f0;
            border-radius: 12px;
            font-size: 24px;
            font-weight: 700;
            text-align: center;
            color: #1e293b;
            background: #f8fafc;
            outline: none;
            transition: all 0.2s;
        }
        .digit-input:focus {
            border-color: #4f46e5;
            background: #fff;
            box-shadow: 0 0 0 4px rgba(79, 70, 229, 0.1);
        }
        .btn {
            width: 100%;
            padding: 14px;
            background: #4f46e5;
            color: white;
            border: none;
            border-radius: 14px;
            font-size: 14px;
            font-weight: 700;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(79, 70, 229, 0.25);
            transition: all 0.2s;
        }
        .btn:hover { background: #4338ca; transform: translateY(-1px); }
        .btn:active { transform: translateY(0); }
        .error-msg {
            color: #ef4444;
            font-size: 12px;
            font-weight: 500;
            margin-top: 12px;
            display: none;
        }
    </style>
</head>
<body>
    <div class="card">
        <div class="logo">
            <img src="/edulink_logo.png" alt="로고">
            <span>에듀링크</span>
        </div>
        <h2>비밀번호를 입력하세요</h2>
        <p>이 링크는 비밀번호로 보호되어 있습니다.<br>인증용 6자리 숫자 코드를 입력해 주세요.</p>
        <div class="input-group" id="inputGroup">
            <input type="password" maxlength="1" class="digit-input" pattern="[0-9]*" inputmode="numeric">
            <input type="password" maxlength="1" class="digit-input" pattern="[0-9]*" inputmode="numeric">
            <input type="password" maxlength="1" class="digit-input" pattern="[0-9]*" inputmode="numeric">
            <input type="password" maxlength="1" class="digit-input" pattern="[0-9]*" inputmode="numeric">
            <input type="password" maxlength="1" class="digit-input" pattern="[0-9]*" inputmode="numeric">
            <input type="password" maxlength="1" class="digit-input" pattern="[0-9]*" inputmode="numeric">
        </div>
        <button class="btn" id="submitBtn">확인 및 이동</button>
        <div class="error-msg" id="errorMsg">비밀번호가 일치하지 않습니다.</div>
    </div>

    <script>
        const inputs = document.querySelectorAll('.digit-input');
        const submitBtn = document.getElementById('submitBtn');
        const errorMsg = document.getElementById('errorMsg');
        const slug = "${slug}";

        inputs.forEach((input, index) => {
            input.addEventListener('input', (e) => {
                if (e.target.value.length === 1 && index < inputs.length - 1) {
                    inputs[index + 1].focus();
                }
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace' && e.target.value.length === 0 && index > 0) {
                    inputs[index - 1].focus();
                }
            });
        });

        submitBtn.addEventListener('click', async () => {
            const password = Array.from(inputs).map(input => input.value).join('');
            if (password.length !== 6) {
                showError('비밀번호 6자리를 모두 입력해 주세요.');
                return;
            }

            try {
                const res = await fetch('/api/verify-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ slug, password })
                });
                const data = await res.json();
                if (data.success && data.original_url) {
                    window.location.replace(data.original_url);
                } else if (data.success && data.reload) {
                    window.location.reload();
                } else {
                    showError(data.error || '비밀번호가 올바르지 않습니다.');
                }
            } catch (e) {
                showError('서버 오류가 발생했습니다. 다시 시도해 주세요.');
            }
        });

        function showError(msg) {
            errorMsg.innerText = msg;
            errorMsg.style.display = 'block';
            inputs.forEach(input => {
                input.style.borderColor = '#ef4444';
                input.value = '';
            });
            inputs[0].focus();
        }
        
        inputs[0].focus();
    </script>
</body>
</html>`;
}

function getSurveyClosedHtml(message: string, customMsg?: string): string {
  const displayMsg = customMsg || message;
  const escMsg = displayMsg.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>설문 종료 · 에듀링크</title><link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700;900&display=swap" rel="stylesheet"><style>*{box-sizing:border-box;margin:0;padding:0;font-family:'Noto Sans KR',sans-serif}body{background:linear-gradient(135deg,#f5f7fa,#e4e8f0);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.card{background:#fff;border-radius:24px;padding:48px 32px;max-width:480px;width:100%;text-align:center;box-shadow:0 20px 40px rgba(0,0,0,.06)}h2{font-size:18px;color:#1e293b;margin-bottom:12px}p{font-size:13px;color:#64748b;line-height:1.8;white-space:pre-wrap}a{color:#4f46e5;text-decoration:underline}</style></head><body><div class="card"><h2>📋 ${escMsg}</h2><p>관리자에게 문의해 주세요.</p></div></body></html>`;
}

const SURVEY_THEMES: Record<string, { primary: string; dark: string; shadow: string; bgFrom: string; bgTo: string; ring: string; addrBtn: string }> = {
    indigo:  { primary:'#4f46e5', dark:'#4338ca', shadow:'rgba(79,70,229,.25)',   bgFrom:'#f5f7fa', bgTo:'#e4e8f0', ring:'rgba(79,70,229,.1)',   addrBtn:'#4f46e5' },
    emerald: { primary:'#059669', dark:'#047857', shadow:'rgba(5,150,105,.25)',   bgFrom:'#ecfdf5', bgTo:'#d1fae5', ring:'rgba(5,150,105,.1)',   addrBtn:'#059669' },
    rose:    { primary:'#e11d48', dark:'#be123c', shadow:'rgba(225,29,72,.25)',   bgFrom:'#fff1f2', bgTo:'#fce7f3', ring:'rgba(225,29,72,.1)',   addrBtn:'#e11d48' },
    amber:   { primary:'#d97706', dark:'#b45309', shadow:'rgba(217,119,6,.25)',   bgFrom:'#fffbeb', bgTo:'#fef3c7', ring:'rgba(217,119,6,.1)',   addrBtn:'#d97706' },
    sky:     { primary:'#0284c7', dark:'#0369a1', shadow:'rgba(2,132,199,.25)',   bgFrom:'#f0f9ff', bgTo:'#e0f2fe', ring:'rgba(2,132,199,.1)',   addrBtn:'#0284c7' },
};

function getSurveyPageHtml(urlId: number, slug: string, configJson: string): string {
    // 테마 CSS 변수 결정
    let parsedTheme = 'indigo';
    try { parsedTheme = JSON.parse(configJson).theme || 'indigo'; } catch {}
    const t = SURVEY_THEMES[parsedTheme] || SURVEY_THEMES['indigo'];
    const themeVars = `
:root {
  --p:${t.primary};--pd:${t.dark};--ps:${t.shadow};
  --bg-from:${t.bgFrom};--bg-to:${t.bgTo};--ring:${t.ring};
}`;
    return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>EduLink Survey</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&display=swap" rel="stylesheet">
<script src="//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js"></script>
<style>
${themeVars}
*{box-sizing:border-box;margin:0;padding:0;font-family:'Noto Sans KR',sans-serif}
body{background:linear-gradient(135deg,var(--bg-from),var(--bg-to));min-height:100vh;padding:24px 16px;color:#1e293b}
.wrap{max-width:640px;margin:0 auto}
.card{background:#fff;border-radius:24px;padding:32px 28px;box-shadow:0 20px 40px rgba(0,0,0,.06);margin-bottom:20px}
.logo{display:flex;align-items:center;gap:8px;margin-bottom:24px;justify-content:center}
.logo img{width:28px;height:28px;border-radius:6px}
.logo span{font-size:16px;font-weight:900;color:var(--p)}
h1{font-size:22px;font-weight:900;color:#1e293b;margin-bottom:12px;text-align:center}
.intro-text,.outro-text{font-size:14px;color:#475569;line-height:1.8;white-space:pre-wrap;text-align:center}
.intro-text a,.outro-text a{color:var(--p);text-decoration:underline}
.intro-banner{background:#fff;border-radius:24px;padding:32px 28px;box-shadow:0 20px 40px rgba(0,0,0,.06);margin-bottom:20px;text-align:center}
.intro-banner .intro-title{font-size:20px;font-weight:900;color:#1e293b;margin-bottom:10px}
.intro-banner .intro-body{font-size:13px;color:#475569;line-height:1.8;white-space:pre-wrap}
.intro-banner .intro-body a{color:var(--p);text-decoration:underline}
.q-block{background:#fff;border-radius:20px;padding:20px;margin-bottom:14px;box-shadow:0 4px 12px rgba(0,0,0,.04);border:1px solid #f1f5f9}
.q-label{font-size:14px;font-weight:700;color:#1e293b;margin-bottom:6px;display:flex;align-items:baseline;gap:6px}
.q-desc{font-size:12px;color:#64748b;line-height:1.7;margin-bottom:12px;white-space:pre-wrap}
.q-desc a{color:var(--p);text-decoration:underline}
.req{color:#ef4444;font-size:12px}
.q-media{width:100%;border-radius:12px;margin-bottom:12px;display:block}
.q-media-img{max-width:100%;border-radius:12px;margin-bottom:12px;display:block}
input[type=text],input[type=tel],input[type=email],input[type=number],textarea{width:100%;padding:12px 14px;border:2px solid #e2e8f0;border-radius:12px;font-size:14px;outline:none;background:#f8fafc;color:#1e293b;font-family:inherit}
textarea{min-height:96px;resize:vertical}
input:focus,textarea:focus{border-color:var(--p);background:#fff;box-shadow:0 0 0 4px var(--ring)}
.choice{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:10px;margin-bottom:8px;cursor:pointer;font-size:13px;transition:all .15s}
.choice:hover{background:#f8fafc;border-color:#cbd5e1}
.choice input{margin:0;accent-color:var(--p)}
.rating{display:flex;gap:6px;flex-wrap:wrap}
.rating button{flex:1;min-width:40px;padding:12px 8px;border:2px solid #e2e8f0;border-radius:10px;background:#f8fafc;color:#475569;font-weight:700;cursor:pointer;transition:all .15s}
.rating button.active{background:var(--p);color:#fff;border-color:var(--p)}
.addr-row{display:flex;gap:8px;margin-bottom:8px}
.addr-row input{flex:1}
.addr-row button{padding:10px 14px;background:var(--p);color:#fff;border:none;border-radius:10px;font-weight:700;cursor:pointer;white-space:nowrap}
.submit-btn{width:100%;padding:16px;background:var(--p);color:#fff;border:none;border-radius:14px;font-size:15px;font-weight:700;cursor:pointer;box-shadow:0 4px 12px var(--ps);transition:all .2s;margin-top:8px}
.submit-btn:hover{background:var(--pd);transform:translateY(-1px)}
.submit-btn:disabled{background:#cbd5e1;cursor:not-allowed;transform:none}
.error{color:#ef4444;font-size:12px;margin-top:8px;display:none}
.error.show{display:block}
.hidden{display:none}
.outro-btns{display:flex;gap:10px;justify-content:center;margin-top:20px;flex-wrap:wrap}
.btn-secondary{padding:12px 24px;border:2px solid #e2e8f0;background:#fff;color:#475569;border-radius:12px;font-size:13px;font-weight:700;cursor:pointer;transition:all .15s}
.btn-secondary:hover{border-color:var(--p);color:var(--p)}
.already-card{background:#fff;border-radius:24px;padding:32px 28px;box-shadow:0 20px 40px rgba(0,0,0,.06);margin-bottom:20px;text-align:center}
.already-card h2{font-size:18px;font-weight:900;color:#1e293b;margin-bottom:10px}
.already-card p{font-size:13px;color:#64748b;line-height:1.7;margin-bottom:16px}
</style>
</head>
<body>
<div class="wrap">
  <div class="logo"><img src="/edulink_logo.png" alt=""><span id="logoLabel">에듀링크 설문</span></div>

  <!-- 이미 응답한 브라우저 안내 -->
  <div id="alreadyScreen" class="already-card hidden">
    <h2>&#x2705; 이미 응답하셨습니다</h2>
    <p>이 브라우저에서 이미 응답을 제출하셨습니다.<br>동일한 브라우저에서는 중복 응답이 제한됩니다.</p>
  </div>

  <!-- 설문 폼 (인트로 + 질문 통합) -->
  <div id="formScreen">
    <!-- 인트로 배너 (제목 + 안내문) -->
    <div class="intro-banner">
      <div class="intro-title" id="formTitle"></div>
      <div class="intro-body" id="introText"></div>
    </div>
    <div id="questions"></div>
    <div class="card" style="padding:16px">
      <button class="submit-btn" id="submitBtn">응답 제출</button>
      <div class="error" id="errorMsg"></div>
    </div>
  </div>

  <div id="outroScreen" class="card hidden">
    <h1>&#x2705; 응답이 제출되었습니다</h1>
    <div class="outro-text" id="outroText" style="margin-top:16px"></div>
    <div class="outro-btns">
      <button class="btn-secondary" id="resubmitBtn">추가 응답하기</button>
      <button class="btn-secondary" id="editBtn">다시 작성하기</button>
    </div>
  </div>
</div>

<script>
const SLUG = ${JSON.stringify(slug)};
const CONFIG = ${configJson};
const questions = CONFIG.questions || [];
const BROWSER_KEY = 'survey_resp_' + SLUG;

const formScreen  = document.getElementById('formScreen');
const outroScreen = document.getElementById('outroScreen');
const alreadyScreen = document.getElementById('alreadyScreen');
const errorMsg    = document.getElementById('errorMsg');

// ── 페이지 타이틀 동적 설정 (인코딩 안전) ────────────────
const surveyTitle = CONFIG.title || '에듀링크 설문';
document.title = surveyTitle + ' · 에듀링크';

// ── URL 자동 링크화 ──────────────────────────────────────
function linkify(text) {
  const parts = text.split(/(https?:\\/\\/[^\\s]+)/g);
  return parts.map((p, i) => {
    if (i % 2 === 1) {
      const e = p.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
      return '<a href="' + e + '" target="_blank" rel="noopener noreferrer">' + e + '</a>';
    }
    return p.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  }).join('');
}

// ── 미디어 임베드 ─────────────────────────────────────────
function buildMediaEl(url) {
  if (!url || !url.trim()) return null;
  url = url.trim();
  // YouTube: watch?v=, youtu.be/, shorts/, embed/
  const ytMatch = url.match(/(?:youtube\\.com\\/(?:watch\\?v=|shorts\\/|embed\\/)|youtu\\.be\\/)([\\w-]{11})/);
  if (ytMatch) {
    const iframe = document.createElement('iframe');
    iframe.src = 'https://www.youtube.com/embed/' + ytMatch[1];
    iframe.className = 'q-media';
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
    iframe.style.cssText = 'width:100%;height:360px;border:none;border-radius:12px;margin-bottom:12px;display:block';
    return iframe;
  }
  if (/\\.(mp4|webm|ogg)(\\?|$)/i.test(url)) {
    const vid = document.createElement('video');
    vid.src = url;
    vid.controls = true;
    vid.className = 'q-media';
    return vid;
  }
  if (/\\.(jpe?g|png|gif|webp|svg)(\\?|$)/i.test(url)) {
    const img = document.createElement('img');
    img.src = url;
    img.className = 'q-media-img';
    img.loading = 'lazy';
    return img;
  }
  return null;
}

// ── 브라우저 1회 제한 체크 ───────────────────────────────
if (CONFIG.one_response_per_browser && localStorage.getItem(BROWSER_KEY)) {
  formScreen.classList.add('hidden');
  alreadyScreen.classList.remove('hidden');
}

// ── 제목 · 인트로 · 아웃트로 설정 ──────────────────────
document.getElementById('formTitle').textContent = surveyTitle;
document.getElementById('introText').innerHTML = linkify(CONFIG.intro || '아래 설문에 응답해 주세요.');
document.getElementById('outroText').innerHTML = linkify(CONFIG.outro || '응답해 주셔서 감사합니다.');

// ── 질문 렌더링 즉시 실행 ────────────────────────────────
renderQuestions();

// ── 추가 응답 / 다시 작성하기 ───────────────────────────
document.getElementById('resubmitBtn').addEventListener('click', () => {
  window.location.reload();
});
document.getElementById('editBtn').addEventListener('click', () => {
  outroScreen.classList.add('hidden');
  formScreen.classList.remove('hidden');
  document.getElementById('submitBtn').disabled = false;
  document.getElementById('submitBtn').textContent = '응답 제출';
  window.scrollTo({top:0,behavior:'smooth'});
});

function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);}

function renderQuestions(){
  const container = document.getElementById('questions');
  container.innerHTML = '';
  let displayNum = 0;
  questions.forEach((q) => {
    const block = document.createElement('div');
    block.className = 'q-block';
    block.dataset.qid = q.id;
    if (q.type !== 'media') displayNum++;
    const reqHtml = q.required ? '<span class="req">*</span>' : '';

    // 미디어 임베드 (createElement로 삽입 — innerHTML보다 안정적)
    const mediaEl = q.media_url ? buildMediaEl(q.media_url) : null;
    // 문항 안내문 (URL 자동 링크)
    const descHtml = q.description ? '<div class="q-desc">' + linkify(q.description) + '</div>' : '';

    let body = '';
    switch(q.type){
      case 'short':
        body = '<input type="text" data-input>'; break;
      case 'long':
        body = '<textarea data-input></textarea>'; break;
      case 'single':
        body = (q.options||[]).map(o=>'<label class="choice"><input type="radio" name="q_'+q.id+'" value="'+esc(o)+'" data-input> <span>'+esc(o)+'</span></label>').join(''); break;
      case 'multi':
        body = (q.options||[]).map(o=>'<label class="choice"><input type="checkbox" name="q_'+q.id+'" value="'+esc(o)+'" data-input> <span>'+esc(o)+'</span></label>').join(''); break;
      case 'rating': {
        const scale = q.scale || 5;
        body = '<div class="rating">';
        for(let i=1;i<=scale;i++) body += '<button type="button" data-val="'+i+'">'+i+'</button>';
        body += '</div>';
        break;
      }
      case 'phone':
        body = '<input type="tel" data-input placeholder="010-0000-0000" inputmode="numeric" autocomplete="tel">'; break;
      case 'email':
        body = '<input type="email" data-input placeholder="example@email.com">'; break;
      case 'address':
        body = '<div class="addr-row"><input type="text" data-input-zone placeholder="우편번호" readonly><button type="button" data-addr-btn>주소 검색</button></div>'
             + '<div class="addr-row"><input type="text" data-input-addr placeholder="기본 주소" readonly></div>'
             + '<div class="addr-row"><input type="text" data-input-detail placeholder="상세 주소"></div>';
        break;
      case 'media': body = ''; break;
      default: body = '<input type="text" data-input>';
    }
    // 미디어 전용 항목: 미디어 요소만 표시, 라벨/응답칸 없음
    if (q.type === 'media') {
      if (mediaEl) block.appendChild(mediaEl);
      block.dataset.mediaOnly = '1';
      container.appendChild(block);
      return;
    }
    // 일반 항목: innerHTML 먼저, 그 뒤 미디어 요소를 맨 앞에 삽입
    block.innerHTML = '<div class="q-label">' + displayNum + '. ' + esc(q.label||'') + ' ' + reqHtml + '</div>'
      + descHtml
      + body;
    if (mediaEl) block.insertBefore(mediaEl, block.firstChild);
    container.appendChild(block);

    if(q.type === 'rating'){
      block.querySelectorAll('.rating button').forEach(b=>{
        b.addEventListener('click', ()=>{
          block.querySelectorAll('.rating button').forEach(x=>x.classList.remove('active'));
          b.classList.add('active');
          block.dataset.value = b.dataset.val;
        });
      });
    }
    if(q.type === 'address'){
      block.querySelector('[data-addr-btn]').addEventListener('click', ()=>{
        if(typeof daum === 'undefined' || !daum.Postcode){ alert('주소 검색 스크립트 로드 실패'); return; }
        new daum.Postcode({ oncomplete: (data)=>{
          block.querySelector('[data-input-zone]').value = data.zonecode;
          block.querySelector('[data-input-addr]').value = data.roadAddress || data.jibunAddress;
          block.querySelector('[data-input-detail]').focus();
        }}).open();
      });
    }
    if(q.type === 'phone'){
      const inp = block.querySelector('[data-input]');
      inp.addEventListener('input', e=>{
        let v = e.target.value.replace(/\\D/g,'').slice(0,11);
        if(v.length === 11) {
          // 011자리: 000-0000-0000
          v = v.replace(/(\\d{3})(\\d{4})(\\d{4})/, '$1-$2-$3');
        } else if(v.length === 10) {
          // 10자리: 000-000-0000
          v = v.replace(/(\\d{3})(\\d{3})(\\d{4})/, '$1-$2-$3');
        } else if(v.length >= 7) {
          v = v.replace(/(\\d{3})(\\d{3,4})(\\d{0,4})/, '$1-$2-$3').replace(/-$/,'');
        } else if(v.length >= 4) {
          v = v.replace(/(\\d{3})(\\d{0,4})/, '$1-$2');
        }
        e.target.value = v;
      });
    }
  });
}

function collectAnswers(){
  const out = {};
  document.querySelectorAll('.q-block').forEach(block=>{
    const qid = block.dataset.qid;
    const q = questions.find(x=>x.id===qid);
    if(!q || q.type === 'media') return;
    if(q.type === 'single'){
      const sel = block.querySelector('input[type=radio]:checked');
      out[qid] = sel ? sel.value : '';
    } else if(q.type === 'multi'){
      out[qid] = Array.from(block.querySelectorAll('input[type=checkbox]:checked')).map(x=>x.value);
    } else if(q.type === 'rating'){
      out[qid] = block.dataset.value ? Number(block.dataset.value) : '';
    } else if(q.type === 'address'){
      out[qid] = {
        zonecode: block.querySelector('[data-input-zone]').value,
        address: block.querySelector('[data-input-addr]').value,
        detail: block.querySelector('[data-input-detail]').value,
      };
    } else {
      const el = block.querySelector('[data-input]');
      out[qid] = el ? el.value.trim() : '';
    }
  });
  return out;
}

document.getElementById('submitBtn').addEventListener('click', async ()=>{
  const answers = collectAnswers();
  for(const q of questions){
    if(q.type === 'media') continue;
    if(q.required){
      const v = answers[q.id];
      const empty = v === undefined || v === null || v === ''
        || (Array.isArray(v) && v.length === 0)
        || (typeof v === 'object' && !Array.isArray(v) && !v.address);
      if(empty){
        errorMsg.textContent = '필수 항목을 입력해 주세요: ' + q.label;
        errorMsg.classList.add('show');
        errorMsg.scrollIntoView({behavior:'smooth',block:'center'});
        return;
      }
    }
  }
  errorMsg.classList.remove('show');
  const btn = document.getElementById('submitBtn');
  btn.disabled = true; btn.textContent = '제출 중...';
  try {
    const res = await fetch('/survey/' + encodeURIComponent(SLUG) + '/submit', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ answers })
    });
    const data = await res.json();
    if(data.success){
      if(CONFIG.one_response_per_browser) {
        try { localStorage.setItem(BROWSER_KEY, '1'); } catch(e){}
        // 중복 응답 제한 설정 시 아웃트로의 "추가 응답하기" 숨김
        const resubmitBtn = document.getElementById('resubmitBtn');
        if(resubmitBtn) resubmitBtn.style.display = 'none';
      }
      formScreen.classList.add('hidden');
      outroScreen.classList.remove('hidden');
      window.scrollTo({top:0,behavior:'smooth'});
    } else {
      errorMsg.textContent = data.error || '제출에 실패했습니다.';
      errorMsg.classList.add('show');
      btn.disabled = false; btn.textContent = '응답 제출';
    }
  } catch(e){
    errorMsg.textContent = '서버 오류가 발생했습니다.';
    errorMsg.classList.add('show');
    btn.disabled = false; btn.textContent = '응답 제출';
  }
});
</script>
</body>
</html>`;
}

function getQrPageHtml(slug: string, shortUrl: string): string {
    return `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>QR 코드 · /${slug} · 에듀링크</title>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700;900&display=swap" rel="stylesheet">
    <style>
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body {
            width: 100%; height: 100%;
            font-family: 'Noto Sans KR', sans-serif;
            background: #0f1117;
            color: #fff;
            overflow: hidden;
        }

        /* 전체 레이아웃 */
        .page {
            width: 100vw;
            height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            position: relative;
            background: radial-gradient(ellipse at center, #1a1f2e 0%, #0a0d14 100%);
        }

        /* 배경 블러 효과 */
        .bg-glow {
            position: absolute;
            width: 520px;
            height: 520px;
            border-radius: 50%;
            background: rgba(79, 70, 229, 0.12);
            filter: blur(80px);
            pointer-events: none;
            z-index: 0;
        }

        /* 메인 QR 래퍼 */
        .qr-wrapper {
            position: relative;
            z-index: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 0;
        }

        /* 상단 로고 */
        .brand {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 28px;
        }
        .brand-dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
            box-shadow: 0 0 12px rgba(99, 102, 241, 0.7);
        }
        .brand-name {
            font-size: 15px;
            font-weight: 700;
            letter-spacing: 0.08em;
            color: rgba(255,255,255,0.6);
            text-transform: uppercase;
        }

        /* QR 이미지 프레임 */
        .qr-frame {
            background: #ffffff;
            border-radius: 28px;
            padding: 22px;
            box-shadow:
                0 0 0 1px rgba(255,255,255,0.08),
                0 30px 80px rgba(0,0,0,0.6),
                0 0 60px rgba(99,102,241,0.15);
        }
        .qr-frame img {
            display: block;
            width: min(72vw, 72vh, 400px);
            height: min(72vw, 72vh, 400px);
            max-width: 400px;
            max-height: 400px;
            border-radius: 8px;
        }

        /* URL 표시 */
        .url-label {
            margin-top: 28px;
            display: flex;
            align-items: center;
            gap: 8px;
            background: rgba(255,255,255,0.06);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 100px;
            padding: 9px 20px;
            backdrop-filter: blur(8px);
        }
        .url-label .dot {
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: #4ade80;
            flex-shrink: 0;
            box-shadow: 0 0 8px rgba(74,222,128,0.6);
        }
        .url-label span {
            font-size: 13px;
            font-weight: 700;
            color: rgba(255,255,255,0.85);
            letter-spacing: 0.02em;
            word-break: break-all;
            max-width: 50vw;
        }

        /* 하단 버튼 그룹 */
        .actions {
            position: fixed;
            bottom: 32px;
            left: 50%;
            transform: translateX(-50%);
            display: flex;
            gap: 12px;
            z-index: 10;
        }
        .btn {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 12px 22px;
            border: none;
            border-radius: 100px;
            font-size: 13px;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
            font-family: 'Noto Sans KR', sans-serif;
            white-space: nowrap;
        }
        .btn:hover { transform: translateY(-2px) scale(1.03); }
        .btn:active { transform: scale(0.97); }
        .btn-copy {
            background: rgba(255,255,255,0.1);
            color: rgba(255,255,255,0.9);
            border: 1px solid rgba(255,255,255,0.15);
            backdrop-filter: blur(12px);
        }
        .btn-copy:hover { background: rgba(255,255,255,0.18); }
        .btn-download {
            background: linear-gradient(135deg, #4f46e5, #7c3aed);
            color: white;
            box-shadow: 0 4px 20px rgba(79, 70, 229, 0.4);
        }
        .btn-download:hover { box-shadow: 0 8px 28px rgba(79, 70, 229, 0.55); }

        /* 토스트 */
        .toast {
            position: fixed;
            top: 28px;
            left: 50%;
            transform: translateX(-50%) translateY(-20px);
            background: rgba(30,41,59,0.95);
            border: 1px solid rgba(255,255,255,0.1);
            color: white;
            padding: 10px 22px;
            border-radius: 100px;
            font-size: 12px;
            font-weight: 600;
            opacity: 0;
            transition: all 0.3s ease;
            pointer-events: none;
            backdrop-filter: blur(10px);
            white-space: nowrap;
            z-index: 100;
        }
        .toast.show {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }

        /* 모바일 최적화 */
        @media (max-width: 480px) {
            .qr-frame { padding: 16px; border-radius: 20px; }
            .qr-frame img { width: 78vw; height: 78vw; }
            .url-label span { font-size: 11px; }
            .btn { padding: 11px 16px; font-size: 12px; }
        }
    </style>
</head>
<body>
    <div class="page">
        <div class="bg-glow"></div>
        <div class="qr-wrapper">
            <div class="brand">
                <div class="brand-dot"></div>
                <span class="brand-name">edulink</span>
            </div>
            <div class="qr-frame">
                <img id="qrImg"
                    src="https://api.qrserver.com/v1/create-qr-code/?size=600x600&margin=10&data=${encodeURIComponent(shortUrl)}"
                    alt="QR 코드 · ${shortUrl}"
                    loading="eager"
                >
            </div>
            <div class="url-label">
                <div class="dot"></div>
                <span>${shortUrl.replace(/^https?:\/\//, '')}</span>
            </div>
        </div>
    </div>

    <div class="actions">
        <button class="btn btn-copy" id="copyBtn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
        </button>
        <button class="btn btn-download" id="downloadBtn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            QR 저장
        </button>
    </div>

    <div class="toast" id="toast"></div>

    <script>
        const shortUrl = "${shortUrl}";
        const slug = "${slug}";
        const toast = document.getElementById('toast');

        function showToast(msg) {
            toast.textContent = msg;
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 2200);
        }

        document.getElementById('copyBtn').addEventListener('click', () => {
            navigator.clipboard.writeText(shortUrl)
                .then(() => showToast('단축 주소가 복사되었습니다.'))
                .catch(() => showToast('복사 실패. 주소창에서 직접 복사해 주세요.'));
        });

        document.getElementById('downloadBtn').addEventListener('click', async () => {
            try {
                const img = document.getElementById('qrImg');
                const res = await fetch(img.src);
                const blob = await res.blob();
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = 'edulink_qr_' + slug + '.png';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(a.href);
                showToast('QR 코드가 저장되었습니다.');
            } catch {
                window.open(document.getElementById('qrImg').src, '_blank');
            }
        });
    </script>
</body>
</html>`;
}

export default app;
