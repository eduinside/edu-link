import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { SignJWT } from 'jose';
import { generateRandomSlug, isValidCustomSlug } from './utils/slug';
import { authMiddleware, adminMiddleware } from './middleware/auth';
import { rateLimitMiddleware } from './middleware/rateLimit';

const app = new Hono<{ Bindings: Env }>();

// ----------------------------------------------------
// [湲濡쒕쾶 誘몃뱾?⑥뼱] CORS ?ㅼ젙 ?곸슜
// ----------------------------------------------------
app.use('/api/v1/*', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
    exposeHeaders: ['Content-Length', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],
    maxAge: 600,
}));


// ----------------------------------------------------
// [?쇰툝由??곸뿭] 鍮꾩씤利??ъ슜?먮룄 ?묎렐 媛?ν븳 ?붾뱶?ъ씤??// ----------------------------------------------------

// 1. ?ъ뒪 泥댄겕 API
app.get('/api/health', (c) => {
    return c.json({ status: 'ok', time: new Date().toISOString() });
});

// 2. 怨듭??ы빆 紐⑸줉 API
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

// 3. 理쒓렐 怨듭쑀???⑥텞二쇱냼 紐⑸줉 API (?쒕뵫 ?몄텧??- 怨듦컻?ㅼ젙??嫄대쭔 ?몄텧)
app.get('/api/links/public', async (c) => {
    try {
        const { results } = await c.env.DB.prepare(
            `SELECT slug, custom_slug, title, original_url, created_at
             FROM urls
             WHERE is_active = 1 AND is_public = 1
             ORDER BY created_at DESC
             LIMIT 10`
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
            return c.json({ success: false, error: '?꾩닔 ?뚮씪誘명꽣媛 ?꾨씫?섏뿀?듬땲??' }, 400);
        }

        const urlRecord = await c.env.DB.prepare(
            "SELECT original_url, password, expires_at, is_active FROM urls WHERE slug = ?"
        )
        .bind(slug)
        .first<{ original_url: string; password: string | null; expires_at: string | null; is_active: number }>();

        if (!urlRecord || urlRecord.is_active === 0) {
            return c.json({ success: false, error: '議댁옱?섏? ?딄굅??鍮꾪솢?깊솕??留곹겕?낅땲??' }, 404);
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
                return c.json({ success: false, error: '留뚮즺???⑥텞 留곹겕?낅땲??' }, 410);
            }
        }

        if (urlRecord.password !== password) {
            return c.json({ success: false, error: '鍮꾨?踰덊샇媛 ?쇱튂?섏? ?딆뒿?덈떎.' }, 401);
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
            return c.json({ success: false, error: '?대찓?쇨낵 OTP 肄붾뱶瑜??낅젰??二쇱꽭??' }, 400);
        }
        
        const cleanEmail = email.trim().toLowerCase();
        const cacheKey = `otp:${cleanEmail}`;
        const cachedStr = await c.env.URL_CACHE.get(cacheKey);
        
        if (!cachedStr) {
            return c.json({ success: false, error: 'OTP ?몄쬆 ?쒓컙??留뚮즺?섏뿀嫄곕굹 ?붿껌 ?대젰???놁뒿?덈떎. ?ㅼ떆 ?쒕룄??二쇱꽭??' }, 400);
        }
        
        const cached = JSON.parse(cachedStr);
        if (cached.code !== code.trim()) {
            return c.json({ success: false, error: 'OTP 肄붾뱶媛 ?쇱튂?섏? ?딆뒿?덈떎.' }, 400);
        }
        
        // ?몄쬆 ?깃났: D1 ?ъ슜???앹꽦 ?먮뒗 議고쉶
        const domain = cleanEmail.split('@')[1];
        let userRecord = await c.env.DB.prepare("SELECT id, email, name, affiliation, level FROM users WHERE email = ?")
            .bind(cleanEmail)
            .first<{ id: number; email: string; name: string; affiliation: string; level: number }>();
            
        if (!userRecord) {
            // ?붿씠?몃━?ㅽ듃 ?꾨찓??泥댄겕
            const isAllowed = await c.env.DB.prepare("SELECT id FROM allowed_domains WHERE domain = ?")
                .bind(domain)
                .first();
            
            // ?붿씠?몃━?ㅽ듃?대㈃ level 2 (?몄쬆?ъ슜??, ?꾨땲硫?level 1 (濡쒓렇??
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
        
        // 濡쒓렇???몄뀡 荑좏궎 諛쒗뻾???꾪븳 JWT ?앹꽦
        const secret = new TextEncoder().encode(c.env.JWT_SECRET || 'edulink_jwt_secret_key_2026_xyz');
        const sessionToken = await new SignJWT({ id: userRecord.id, email: userRecord.email, name: userRecord.name, affiliation: userRecord.affiliation, level: userRecord.level })
            .setProtectedHeader({ alg: 'HS256' })
            .setExpirationTime('7d')
            .sign(secret);
            
        // 荑좏궎 ?ㅼ젙
        const isSecure2 = c.req.url.startsWith('https');
        setCookie(c, 'edulink_token', sessionToken, {
            path: '/',
            secure: isSecure2,
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 60, // 7 days
            sameSite: 'Lax'
        });
        
        // ?몄쬆 ??罹먯떆 ??젣
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
            return c.json({ success: false, error: '?대찓?쇨낵 ?ъ슜?먮챸??紐⑤몢 ?쒓났?댁빞 ?⑸땲??' }, 400);
        }
        
        const cleanEmail = email.trim().toLowerCase();
        const domain = cleanEmail.split('@')[1];
        
        let userRecord = await c.env.DB.prepare("SELECT id, email, name, level FROM users WHERE email = ?")
            .bind(cleanEmail)
            .first<{ id: number; email: string; name: string; level: number }>();
            
        if (!userRecord) {
            // ?붿씠?몃━?ㅽ듃 ?꾨찓??泥댄겕
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
            
        // 荑좏궎 ?ㅼ젙
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
    return c.json({ success: true, message: '濡쒓렇?꾩썐 ?섏뿀?듬땲??' });
});

// ----------------------------------------------------
// [?몄쬆 ?곸뿭] Cloudflare Access ?몄쬆???꾩슂???대? API 洹몃９
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

//api 寃쎈줈 蹂댄샇
api.use('*', authMiddleware());

// 4. ???꾨줈???뺣낫 議고쉶
api.get('/auth/me', (c) => {
    return c.json({ success: true, user: c.get('user') });
});

// 4.1 ???꾨줈???뺣낫 ?섏젙 (?ъ슜?먮챸 蹂寃?
api.patch('/auth/profile', async (c) => {
    const user = c.get('user');
    try {
        const { name } = await c.req.json();
        if (!name || !name.trim()) {
            return c.json({ success: false, error: '?ъ슜?먮챸???낅젰??二쇱꽭??' }, 400);
        }
        
        await c.env.DB.prepare("UPDATE users SET name = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(name.trim(), user.id)
            .run();
            
        return c.json({ success: true, message: '?꾨줈???뺣낫媛 ?낅뜲?댄듃?섏뿀?듬땲??', name: name.trim() });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

// 5. ???⑥텞 留곹겕 紐⑸줉 議고쉶 (is_public 而щ읆 異붽? 諛섑솚)
api.get('/links', async (c) => {
    const user = c.get('user');
    try {
        const { results } = await c.env.DB.prepare(
            `SELECT id, slug, base_slug, custom_slug, original_url, title, description, click_count, is_active, is_public, expires_at, password, created_at 
             FROM urls 
             WHERE user_id = ? 
             ORDER BY created_at DESC`
        )
        .bind(user.id)
        .all();
        return c.json({ success: true, links: results });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

// 6. ?⑥텞 留곹겕 ?앹꽦
api.post('/links', async (c) => {
    const user = c.get('user');
    
    if (user.level < 2) {
        return c.json({ success: false, error: '?몄쬆?ъ슜???덈꺼 2) 沅뚰븳 ?댁긽留??⑥텞 留곹겕瑜?諛쒗뻾?????덉뒿?덈떎.' }, 403);
    }

    try {
        const body = await c.req.json();
        const { original_url, title, description, is_public, expires_at, password } = body;
        let { slug } = body;

        if (!original_url) {
            return c.json({ success: false, error: 'original_url???꾩슂?⑸땲??' }, 400);
        }
        try {
            new URL(original_url);
        } catch {
            return c.json({ success: false, error: '?좏슚?섏? ?딆? URL ?뺤떇?낅땲??' }, 400);
        }

        if (password && !/^\d{6}$/.test(password)) {
            return c.json({ success: false, error: '鍮꾨?踰덊샇???レ옄 6?먮━?ъ빞 ?⑸땲??' }, 400);
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
                return c.json({ success: false, error: '?щ윭洹몃뒗 4~20?먯쓽 ?곸닽?? ?쒓? 諛??섏씠?덈쭔 ?ъ슜?????덉뒿?덈떎.' }, 400);
            }
            if (reservedSet.has(slug.toLowerCase())) {
                return c.json({ success: false, error: '?ъ슜?????녿뒗 ?덉빟???щ윭洹몄엯?덈떎.' }, 400);
            }

            const exists = await c.env.DB.prepare("SELECT id FROM urls WHERE slug = ?")
                .bind(slug)
                .first();
            if (exists) {
                return c.json({ success: false, error: '?대? ?ъ슜 以묒씤 ?щ윭洹몄엯?덈떎.' }, 400);
            }
        } else {
            let attempts = 0;
            let generated = '';
            let isUnique = false;

            while (attempts < 5 && !isUnique) {
                generated = generateRandomSlug(6);
                attempts++;

                if (reservedSet.has(generated.toLowerCase())) continue;

                const exists = await c.env.DB.prepare("SELECT id FROM urls WHERE slug = ?")
                    .bind(generated)
                    .first();
                if (!exists) {
                    isUnique = true;
                }
            }

            if (!isUnique) {
                return c.json({ success: false, error: '?щ윭洹??앹꽦???ㅽ뙣?덉뒿?덈떎. ?ㅼ떆 ?쒕룄??二쇱꽭??' }, 500);
            }
            slug = generated;
        }

        const publicFlag = is_public ? 1 : 0;
        const expiration = expires_at ? expires_at : null;
        const pass = password ? password : null;

        // D1 DB ???(expires_at, password 異붽?)
        await c.env.DB.prepare(
            `INSERT INTO urls (slug, base_slug, original_url, title, description, is_public, expires_at, password, user_id) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(slug, slug, original_url, title || '', description || '', publicFlag, expiration, pass, user.id).run();

        // 蹂댁븞/鍮꾨?踰덊샇/留뚮즺 泥섎━ 嫄댁? 罹먯떛 諛곗젣
        if (!pass && !expiration) {
            await c.env.URL_CACHE.put(slug, original_url);
        } else {
            await c.env.URL_CACHE.delete(slug);
        }

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

// 7. ?⑥텞 留곹겕 ?섏젙
api.patch('/links/:id', async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    
    // 沅뚰븳 ?덈꺼 2 (?몄쬆?ъ슜??
    if (user.level < 2) {
        return c.json({ success: false, error: '?몄쬆?ъ슜???덈꺼 2) 沅뚰븳 ?댁긽留??⑥텞 留곹겕瑜??몄쭛?????덉뒿?덈떎.' }, 403);
    }
    try {
        const body = await c.req.json();
        const { original_url, title, description, is_active, is_public, expires_at, password, custom_slug } = body;

        const link = await c.env.DB.prepare("SELECT id, slug, base_slug, custom_slug, original_url, is_public, expires_at, password FROM urls WHERE id = ? AND user_id = ?")
            .bind(id, user.id)
            .first<{ id: number; slug: string; base_slug: string; custom_slug: string | null; original_url: string; is_public: number; expires_at: string | null; password: string | null }>();

        if (!link) {
            return c.json({ success: false, error: '?대떦 留곹겕瑜?李얠쓣 ???녾굅??沅뚰븳???놁뒿?덈떎.' }, 404);
        }

        if (password !== undefined && password !== null && password !== '' && !/^\d{6}$/.test(password)) {
            return c.json({ success: false, error: '鍮꾨?踰덊샇???レ옄 6?먮━?ъ빞 ?⑸땲??' }, 400);
        }

        let updatedUrl = link.original_url;
        if (original_url) {
            try {
                new URL(original_url);
                updatedUrl = original_url;
            } catch {
                return c.json({ success: false, error: '?좏슚?섏? ?딆? URL ?뺤떇?낅땲??' }, 400);
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

// 8. ?⑥텞 留곹겕 ??젣
api.delete('/links/:id', async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    
    if (user.level < 2) {
        return c.json({ success: false, error: '?몄쬆?ъ슜???덈꺼 2) 沅뚰븳 ?댁긽留??⑥텞 留곹겕瑜???젣?????덉뒿?덈떎.' }, 403);
    }
    try {
        const link = await c.env.DB.prepare("SELECT id, slug, base_slug, custom_slug FROM urls WHERE id = ? AND user_id = ?")
            .bind(id, user.id)
            .first<{ id: number; slug: string; base_slug: string | null; custom_slug: string | null }>();

        if (!link) {
            return c.json({ success: false, error: '?대떦 留곹겕瑜?李얠쓣 ???녾굅??沅뚰븳???놁뒿?덈떎.' }, 404);
        }

        await c.env.DB.prepare("DELETE FROM urls WHERE id = ?").bind(id).run();
        await c.env.URL_CACHE.delete(link.base_slug || link.slug);
        if (link.custom_slug) await c.env.URL_CACHE.delete(link.custom_slug);

        return c.json({ success: true, message: '?⑥텞 留곹겕媛 ??젣?섏뿀?듬땲??' });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

// 8.2 API Keys 紐⑸줉 議고쉶
api.get('/keys', async (c) => {
    const user = c.get('user');
    
    // 沅뚰븳 ?덈꺼 3 (媛쒕컻??
    if (user.level < 3) {        return c.json({ success: false, error: '媛쒕컻???덈꺼 3) 沅뚰븳 ?댁긽留?API Key瑜?議고쉶/?앹꽦/?먭린?????덉뒿?덈떎.' }, 403);
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

// 8.3 API Key ?좉퇋 諛쒓툒
api.post('/keys', async (c) => {
    const user = c.get('user');
    
    // 沅뚰븳 ?덈꺼 3 (媛쒕컻??
    if (user.level < 3) {        return c.json({ success: false, error: '媛쒕컻???덈꺼 3) 沅뚰븳 ?댁긽留?API Key瑜?議고쉶/?앹꽦/?먭린?????덉뒿?덈떎.' }, 403);
    }
    try {
        const body = await c.req.json();
        const { name } = body;

        // edulink_ ?묐몢?ш? 遺숈? 32?먮━ ?쒕뜡 ?뚰뙆踰??レ옄 ?좏겙 ?앹꽦
        const rawToken = 'edulink_' + Array.from(crypto.getRandomValues(new Uint8Array(20)))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('')
            .slice(0, 32);
        
        // ?묐몢??
        const key_prefix = rawToken.slice(0, 12) + '...';
        // ?댁떆 ?앹꽦 (SHA-256)
        const encoder = new TextEncoder();
        const data = encoder.encode(rawToken);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const key_hash = Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');

        // DB ???
        await c.env.DB.prepare(
            `INSERT INTO api_keys (user_id, key_hash, key_prefix, name)
             VALUES (?, ?, ?, ?)`
        )
        .bind(user.id, key_hash, key_prefix, name || 'Default Key')
        .run();

        // 諛쒓툒???됰Ц API Key??蹂댁븞??????踰덈쭔 ?몄텧
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

// 8.4 API Key ?먭린
api.delete('/keys/:id', async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    
    // 沅뚰븳 ?덈꺼 3 (媛쒕컻??
    if (user.level < 3) {        return c.json({ success: false, error: '媛쒕컻???덈꺼 3) 沅뚰븳 ?댁긽留?API Key瑜?議고쉶/?앹꽦/?먭린?????덉뒿?덈떎.' }, 403);
    }
    try {
        // ?뚯쑀沅??뺤씤 諛???젣
        const result = await c.env.DB.prepare("DELETE FROM api_keys WHERE id = ? AND user_id = ?")
            .bind(id, user.id)
            .run();
        
        if (result.meta.changes === 0) {
            return c.json({ success: false, error: '?대떦 API ?ㅻ? 李얠쓣 ???녾굅??沅뚰븳???놁뒿?덈떎.' }, 404);
        }

        return c.json({ success: true, message: 'API ?ㅺ? ?깃났?곸쑝濡??먭린?섏뿀?듬땲??' });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

app.route("/api", api);

// ----------------------------------------------------
// [理쒓퀬愿由ъ옄 ?곸뿭] 理쒓퀬愿由ъ옄 沅뚰븳(admin)???꾩슂???대? API 洹몃９
// ----------------------------------------------------
const adminApi = new Hono<{ Bindings: Env; Variables: UserVariables }>();

// 愿由ъ옄 誘몃뱾?⑥뼱 諛붿씤??adminApi.use('*', authMiddleware());
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

// 10.2 allowed_domains 異붽?
adminApi.post('/domains', async (c) => {
    try {
        const { domain } = await c.req.json();
        if (!domain || !domain.trim()) {
            return c.json({ success: false, error: '?꾨찓??紐낆씠 ?꾩슂?⑸땲??' }, 400);
        }
        
        await c.env.DB.prepare("INSERT INTO allowed_domains (domain) VALUES (?)")
            .bind(domain.trim().toLowerCase())
            .run();
            
        return c.json({ success: true, message: '?꾨찓?몄씠 ?깃났?곸쑝濡??깅줉?섏뿀?듬땲??' });
    } catch (err: any) {
        if (err.message.includes('UNIQUE')) {
            return c.json({ success: false, error: '?대? ?깅줉???꾨찓?몄엯?덈떎.' }, 400);
        }
        return c.json({ success: false, error: err.message }, 500);
    }
});

// 10.3 allowed_domains ??젣
adminApi.delete('/domains/:id', async (c) => {
    const id = c.req.param('id');
    try {
        const result = await c.env.DB.prepare("DELETE FROM allowed_domains WHERE id = ?")
            .bind(id)
            .run();
            
        if (result.meta.changes === 0) {
            return c.json({ success: false, error: '?대떦 ?꾨찓?몄쓣 李얠쓣 ???놁뒿?덈떎.' }, 404);
        }
        return c.json({ success: true, message: '?꾨찓?몄씠 ??젣?섏뿀?듬땲??' });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

// 10.4 怨듭??ы빆 異붽?
adminApi.post('/notices', async (c) => {
    try {
        const { title, content, is_pinned } = await c.req.json();
        if (!title || !content) {
            return c.json({ success: false, error: '?쒕ぉ怨??댁슜??紐⑤몢 ?낅젰??二쇱꽭??' }, 400);
        }
        
        const pinned = is_pinned ? 1 : 0;
        await c.env.DB.prepare(
            "INSERT INTO notices (title, content, is_pinned) VALUES (?, ?, ?)"
        )
        .bind(title, content, pinned)
        .run();
        
        return c.json({ success: true, message: '怨듭??ы빆???깅줉?섏뿀?듬땲??' });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

// 10.5 怨듭??ы빆 ??젣
adminApi.delete('/notices/:id', async (c) => {
    const id = c.req.param('id');
    try {
        const result = await c.env.DB.prepare("DELETE FROM notices WHERE id = ?")
            .bind(id)
            .run();
            
        if (result.meta.changes === 0) {
            return c.json({ success: false, error: '?대떦 怨듭??ы빆??李얠쓣 ???놁뒿?덈떎.' }, 404);
        }
        return c.json({ success: true, message: '怨듭??ы빆????젣?섏뿀?듬땲??' });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});
// 10.6 ?ъ슜??紐⑸줉 議고쉶 (?대뱶誘쇱슜)
adminApi.get('/users', async (c) => {
    try {
        const { results } = await c.env.DB.prepare(
            "SELECT id, email, name, level, created_at FROM users ORDER BY created_at DESC"
        ).all();
        return c.json({ success: true, users: results });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

// 10.7 ?ъ슜???깃툒 ?섏젙 (?대뱶誘쇱슜 ?섎룞?몄쬆)
adminApi.patch('/users/:id', async (c) => {
    const id = c.req.param('id');
    try {
        const { level } = await c.req.json();
        const numericLevel = Number(level);
        if (isNaN(numericLevel) || numericLevel < 1 || numericLevel > 4) {
            return c.json({ success: false, error: '?щ컮瑜댁? ?딆? 沅뚰븳 ?깃툒?낅땲?? (1~4)' }, 400);
        }
        
        const result = await c.env.DB.prepare("UPDATE users SET level = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(numericLevel, id)
            .run();
            
        if (result.meta.changes === 0) {
            return c.json({ success: false, error: '?대떦 ?ъ슜?먮? 李얠쓣 ???놁뒿?덈떎.' }, 404);
        }
        
        return c.json({ success: true, message: `?ъ슜??沅뚰븳 ?깃툒??${numericLevel}濡??깃났?곸쑝濡?蹂寃쎈릺?덉뒿?덈떎.` });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});
app.route("/api/admin", adminApi);



// ----------------------------------------------------
// [媛쒕컻?먯슜 OpenAPI ?곸뿭] API Key 諛?Rate Limiting 諛붿씤??// ----------------------------------------------------

const v1 = new Hono<{ Bindings: Env }>();

// CORS & Rate Limit 寃고빀 (API Key???뱀? IP??遺꾨떦 理쒕? 15???덉슜)
v1.use('*', rateLimitMiddleware({ limit: 15, windowSec: 60 }));

// 8.5 ?몃????⑥텞 URL ?앹꽦 API
v1.post('/shorten', async (c) => {
    try {
        // ?몄쬆 ?섎떒 ?뺤씤 (?ㅻ뜑 Authorization ?먮뒗 x-api-key)
        let token = c.req.header('x-api-key') || '';
        const authHeader = c.req.header('Authorization');
        
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        }

        if (!token) {
            return c.json({ success: false, error: 'API Key?몄쬆???꾨씫?섏뿀?듬땲?? x-api-key ?먮뒗 Bearer ?좏겙???ㅻ뜑???숇큺??二쇱꽭??' }, 401);
        }

        // SHA-256 ?댁떆 蹂??
        const encoder = new TextEncoder();        const data = encoder.encode(token);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const keyHash = Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');

        // D1?먯꽌 ?쒖꽦?붾맂 ??諛??뚯쑀 ?ъ슜??李얘린
        const keyRecord = await c.env.DB.prepare(`SELECT k.id, u.level FROM api_keys k JOIN users u ON k.user_id = u.id WHERE k.key_hash = ? AND k.is_active = 1`
        )
        .bind(keyHash)
        .first<{ user_id: number; level: number }>();

        if (!keyRecord) {
            return c.json({ success: false, error: '?좏슚?섏? ?딄굅??鍮꾪솢?깊솕??API Key?낅땲??' }, 401);
        }

        if (keyRecord.level < 3) {
            return c.json({ success: false, error: '?대떦 API Key ?뚯쑀?먯쓽 沅뚰븳 ?덈꺼??遺議깊빀?덈떎.' }, 403);
        }

        const body = await c.req.json();
        const { original_url, title, description, is_public, expires_at, password } = body;
        let { slug } = body;

        if (!original_url) {
            return c.json({ success: false, error: 'original_url???꾩슂?⑸땲??' }, 400);
        }
        try {
            new URL(original_url);
        } catch {
            return c.json({ success: false, error: '?좏슚?섏? ?딆? URL ?뺤떇?낅땲??' }, 400);
        }

        if (password && !/^\d{6}$/.test(password)) {
            return c.json({ success: false, error: '鍮꾨?踰덊샇???レ옄 6?먮━?ъ빞 ?⑸땲??' }, 400);
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
                return c.json({ success: false, error: '?щ윭洹몃뒗 4~20?먯쓽 ?곸닽?? ?쒓? 諛??섏씠?덈쭔 ?ъ슜?????덉뒿?덈떎.' }, 400);
            }
            if (reservedSet.has(slug.toLowerCase())) {
                return c.json({ success: false, error: '?ъ슜?????녿뒗 ?덉빟???щ윭洹몄엯?덈떎.' }, 400);
            }
            
            const exists = await c.env.DB.prepare("SELECT id FROM urls WHERE slug = ?").bind(slug).first();
            if (exists) {
                return c.json({ success: false, error: '?대? ?ъ슜 以묒씤 ?щ윭洹몄엯?덈떎.' }, 400);
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
                return c.json({ success: false, error: '?щ윭洹??앹꽦???ㅽ뙣?덉뒿?덈떎. ?ㅼ떆 ?쒕룄??二쇱꽭??' }, 500);
            }
            slug = generated;
        }

        const publicFlag = is_public ? 1 : 0;
        const expiration = expires_at ? expires_at : null;
        const pass = password ? password : null;

        // D1 DB 湲곕줉 (is_public, expires_at, password 異붽?)
        await c.env.DB.prepare(
            `INSERT INTO urls (slug, original_url, title, description, is_public, expires_at, password, user_id) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(slug, original_url, title || 'API Created Link', description || 'Generated via Developer API', publicFlag, expiration, pass, keyRecord.user_id).run();

        // KV 罹먯떆 ?낅뜲?댄듃
        if (!pass && !expiration) {
            await c.env.URL_CACHE.put(slug, original_url);
        } else {
            await c.env.URL_CACHE.delete(slug);
        }

        // API ??留덉?留??ъ슜 湲곕줉 ?낅뜲?댄듃 (waitUntil ?쒖슜 鍮꾨룞湲?泥섎━)
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

// v1 ?ㅽ뵂 API ?쒕툕?쇱슦???곌껐
app.route('/api/v1', v1);


// ----------------------------------------------------
// [?쇰툝由?由щ뵒?됱뀡 諛?SPA ?쒕튃]
// ----------------------------------------------------

// QR 슬러그 DB 조회 + 응답 생성
async function buildQrResponse(slug: string, requestUrl: string, env: Env): Promise<Response | null> {
    const record = await env.DB.prepare(
        "SELECT is_active FROM urls WHERE base_slug = ? OR custom_slug = ? OR slug = ?"
    ).bind(slug, slug, slug).first<{ is_active: number }>();
    if (!record || record.is_active !== 1) return null;

    const host = new URL(requestUrl).host;
    const proto = requestUrl.startsWith('https') ? 'https' : 'http';
    const shortUrl = `${proto}://${host}/${slug}`;

    const html = `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>QR 코드 · /${slug}</title>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700;900&display=swap" rel="stylesheet">
    <style>
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { width: 100%; height: 100%; font-family: 'Noto Sans KR', sans-serif;
            background: #0f1117; color: #fff; overflow: hidden; }
        .page { width: 100vw; height: 100vh; display: flex; flex-direction: column;
            align-items: center; justify-content: center; position: relative;
            background: radial-gradient(ellipse at center, #1a1f2e 0%, #0a0d14 100%); }
        .bg-glow { position: absolute; width: 520px; height: 520px; border-radius: 50%;
            background: rgba(79,70,229,0.12); filter: blur(80px); pointer-events: none; }
        .qr-wrapper { position: relative; z-index: 1; display: flex; flex-direction: column;
            align-items: center; }
        .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 28px; }
        .brand-dot { width: 10px; height: 10px; border-radius: 50%;
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
            box-shadow: 0 0 12px rgba(99,102,241,0.7); }
        .brand-name { font-size: 15px; font-weight: 700; letter-spacing: 0.08em;
            color: rgba(255,255,255,0.6); text-transform: uppercase; }
        .qr-frame { background: #fff; border-radius: 28px; padding: 22px;
            box-shadow: 0 0 0 1px rgba(255,255,255,0.06), 0 24px 60px rgba(0,0,0,0.5),
                        0 0 80px rgba(99,102,241,0.15);
            display: flex; align-items: center; justify-content: center; }
        canvas { display: block; width: min(72vw, 360px) !important; height: min(72vw, 360px) !important; }
        .url-label { margin-top: 22px; display: flex; align-items: center; gap: 8px; }
        .url-label span { font-size: 13px; font-weight: 700; color: rgba(255,255,255,0.45); }
        .url-label code { font-size: 15px; font-weight: 700; color: rgba(255,255,255,0.9); }
        .actions { margin-top: 28px; display: flex; gap: 12px; }
        .btn { display: flex; align-items: center; gap: 8px; padding: 12px 22px; border: none;
            border-radius: 100px; font-size: 13px; font-weight: 700; cursor: pointer;
            transition: all 0.2s cubic-bezier(0.34,1.56,0.64,1); font-family: inherit; }
        .btn:hover { transform: translateY(-2px) scale(1.03); }
        .btn-copy { background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.9);
            border: 1px solid rgba(255,255,255,0.15); backdrop-filter: blur(12px); }
        .btn-download { background: linear-gradient(135deg,#4f46e5,#7c3aed); color:#fff;
            box-shadow: 0 4px 20px rgba(79,70,229,0.4); }
        .toast { position: fixed; top: 28px; left: 50%;
            transform: translateX(-50%) translateY(-20px);
            background: rgba(30,41,59,0.95); border: 1px solid rgba(255,255,255,0.1);
            color: #fff; padding: 10px 22px; border-radius: 100px;
            font-size: 12px; font-weight: 600; opacity: 0; transition: all 0.3s ease;
            pointer-events: none; backdrop-filter: blur(10px); white-space: nowrap; z-index: 100; }
        .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
        @media (max-width: 480px) { .qr-frame { padding: 14px; border-radius: 20px; } }
    </style>
</head>
<body>
<div class="page">
    <div class="bg-glow"></div>
    <div class="qr-wrapper">
        <div class="brand"><div class="brand-dot"></div><span class="brand-name">edulink</span></div>
        <div class="qr-frame">
            <canvas id="qr"></canvas>
        </div>
        <div class="url-label"><span>단축주소</span><code id="url-text">${shortUrl}</code></div>
        <div class="actions">
            <button class="btn btn-copy" onclick="copyUrl()">🔗 주소 복사</button>
            <button class="btn btn-download" onclick="downloadPng()">⬇ PNG 저장</button>
        </div>
    </div>
</div>
<div class="toast" id="toast"></div>
<script src="https://cdn.jsdelivr.net/npm/qrcode/build/qrcode.min.js"></script>
<script>
    const url = '${shortUrl}';
    const canvas = document.getElementById('qr');
    QRCode.toCanvas(canvas, url, {
        errorCorrectionLevel: 'H',
        margin: 2,
        width: 800,
        color: { dark: '#000000', light: '#ffffff' }
    }, function(err) {
        if (err) {
            canvas.parentElement.innerHTML = '<p style="color:#f87171;font-size:12px">QR 생성 실패: ' + err.message + '</p>';
        }
    });
    function copyUrl() {
        navigator.clipboard.writeText(url).then(() => showToast('주소가 복사됐습니다!'));
    }
    function downloadPng() {
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = '${slug}-qr.png';
        a.click();
    }
    function showToast(m) {
        const t = document.getElementById('toast');
        t.textContent = m;
        t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 2200);
    }
</script>
</body>
</html>`;
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
}

// 8.9 /qr/:slug  및  /:slug.qr  — QR 코드 전체화면
app.get('/qr/:slug', async (c) => {
    let slug = c.req.param('slug');
    try { slug = decodeURIComponent(slug).normalize('NFC'); } catch { slug = slug.normalize('NFC'); }
    try {
        const res = await buildQrResponse(slug, c.req.url, c.env);
        if (res) return res;
    } catch (err) {
        console.error('QR route error:', err);
    }
    return c.html('<p style="text-align:center;margin-top:50px;font-family:sans-serif">존재하지 않는 단축주소입니다.</p>', 404);
});

// /:slug.qr 패턴 (예: /Q9FPip.qr)
app.get('/:slug{[^/]+\\.qr}', async (c) => {
    let raw = c.req.param('slug');
    try { raw = decodeURIComponent(raw).normalize('NFC'); } catch { raw = raw.normalize('NFC'); }
    const slug = raw.replace(/\.qr$/i, '');
    try {
        const res = await buildQrResponse(slug, c.req.url, c.env);
        if (res) return res;
    } catch (err) {
        console.error('QR .qr route error:', err);
    }
    return c.html('<p style="text-align:center;margin-top:50px;font-family:sans-serif">존재하지 않는 단축주소입니다.</p>', 404);
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
        let urlRecord: { id: number; original_url: string; is_active: number; expires_at: string | null; password: string | null } | null = null;

        if (!destination) {
            // 2. D1 DB 조회 (base_slug, custom_slug, slug 모두 검색)
            urlRecord = await c.env.DB.prepare(
                "SELECT id, original_url, is_active, expires_at, password FROM urls WHERE base_slug = ? OR custom_slug = ? OR slug = ?"
            )
            .bind(slug, slug, slug)
            .first<{ id: number; original_url: string; is_active: number; expires_at: string | null; password: string | null }>();

            if (urlRecord) {
                // 비활성 링크 처리
                if (urlRecord.is_active === 0) {
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
                        return c.redirect('/');
                    }
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

// 10. SPA ?대갚 ?쒕튃
app.all('*', (c) => {
    return c.env.ASSETS.fetch(c.req.raw);
});

// HTML ?쒗뵆由??앹꽦 ?ы띁 ?⑥닔
function getPasswordPageHtml(slug: string): string {
    return `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>蹂댄샇??留곹겕 - ?먮?留곹겕</title>
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
            <img src="/edulink_logo.png" alt="濡쒓퀬">
            <span>?먮?留곹겕</span>
        </div>
        <h2>鍮꾨?踰덊샇瑜??낅젰?섏꽭??/h2>
        <p>??留곹겕??鍮꾨?踰덊샇濡?蹂댄샇?섏뼱 ?덉뒿?덈떎.<br>?몄쬆??6?먮━ ?レ옄 肄붾뱶瑜??낅젰??二쇱꽭??</p>
        <div class="input-group" id="inputGroup">
            <input type="password" maxlength="1" class="digit-input" pattern="[0-9]*" inputmode="numeric">
            <input type="password" maxlength="1" class="digit-input" pattern="[0-9]*" inputmode="numeric">
            <input type="password" maxlength="1" class="digit-input" pattern="[0-9]*" inputmode="numeric">
            <input type="password" maxlength="1" class="digit-input" pattern="[0-9]*" inputmode="numeric">
            <input type="password" maxlength="1" class="digit-input" pattern="[0-9]*" inputmode="numeric">
            <input type="password" maxlength="1" class="digit-input" pattern="[0-9]*" inputmode="numeric">
        </div>
        <button class="btn" id="submitBtn">?뺤씤 諛??대룞</button>
        <div class="error-msg" id="errorMsg">鍮꾨?踰덊샇媛 ?쇱튂?섏? ?딆뒿?덈떎.</div>
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
                showError('鍮꾨?踰덊샇 6?먮━瑜?紐⑤몢 ?낅젰??二쇱꽭??');
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
                } else {
                    showError(data.error || '鍮꾨?踰덊샇媛 ?щ컮瑜댁? ?딆뒿?덈떎.');
                }
            } catch (e) {
                showError('?쒕쾭 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎. ?ㅼ떆 ?쒕룄??二쇱꽭??');
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

function getQrPageHtml(slug: string, shortUrl: string): string {
    return `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>QR 肄붾뱶 쨌 /${slug} 쨌 ?먮?留곹겕</title>
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

        /* ?꾩껜 ?덉씠?꾩썐 */
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

        /* 諛곌꼍 釉붾윭 ?④낵??QR 洹몃┝??*/
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

        /* 硫붿씤 QR ?섑띁 */
        .qr-wrapper {
            position: relative;
            z-index: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 0;
        }

        /* ?곷떒 濡쒓퀬 */
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

        /* QR ?대?吏 ?꾨젅??*/
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

        /* URL ?쒖떆 */
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

        /* ?섎떒 踰꾪듉 洹몃９ */
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

        /* ?좎뒪??*/
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

        /* 紐⑤컮??理쒖쟻??*/
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
                    alt="QR 肄붾뱶 쨌 ${shortUrl}"
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
            QR ???        </button>
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
                .then(() => showToast('?? 二쇱냼媛 蹂듭궗?섏뿀?듬땲??))
                .catch(() => showToast('蹂듭궗 ?ㅽ뙣 ??二쇱냼李쎌뿉??吏곸젒 蹂듭궗?댁＜?몄슂'));
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
                showToast('?? QR 肄붾뱶媛 ??λ릺?덉뒿?덈떎');
            } catch {
                window.open(document.getElementById('qrImg').src, '_blank');
            }
        });
    </script>
</body>
</html>`;
}

export default app;
