// src/server/middleware/auth.ts
import { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { jwtVerify, createRemoteJWKSet } from 'jose';

// Cloudflare Access 토큰 검증을 위한 JWKS 셋업 캐시
let jwksCache: any = null;

function getJWKSet(teamDomain: string) {
    if (!jwksCache) {
        jwksCache = createRemoteJWKSet(
            new URL(`https://${teamDomain}.cloudflareaccess.com/cdn-cgi/access/certs`)
        );
    }
    return jwksCache;
}

export const authMiddleware = (): MiddlewareHandler<{ Bindings: Env; Variables: { user: { id: number; email: string; name: string; affiliation: string; level: number } } }> => {
    return async (c, next) => {
        const env = c.env;
        const isLocal = !c.req.url.includes('dgedu.link');
        const mockRoleHeader = c.req.header('x-mock-role');

        // 1. [로컬 개발 환경 전용] x-mock-role 헤더가 있으면 모의 권한 즉시 적용
        if (isLocal && mockRoleHeader) {
            let mockEmail = 'teacher@dge.go.kr';
            let mockName = '홍길동';
            let mockLevel = 2; // 기본 인증사용자

            if (mockRoleHeader === 'admin') {
                mockEmail = 'admin@korea.kr';
                mockName = '최고관리자';
                mockLevel = 4;
            } else if (mockRoleHeader === 'developer') {
                mockEmail = 'dev@dge.go.kr';
                mockName = '개발자';
                mockLevel = 3;
            } else if (mockRoleHeader === 'login') {
                mockEmail = 'guest@gmail.com';
                mockName = '일반회원';
                mockLevel = 1;
            } else if (mockRoleHeader === 'authenticated') {
                mockEmail = 'teacher@dge.go.kr';
                mockName = '홍길동';
                mockLevel = 2;
            }

            let userRecord = await env.DB.prepare("SELECT id, email, name, affiliation, level FROM users WHERE email = ?")
                .bind(mockEmail)
                .first<{ id: number; email: string; name: string; affiliation: string; level: number }>();

            if (!userRecord) {
                const insert = await env.DB.prepare(
                    "INSERT INTO users (email, name, affiliation, level) VALUES (?, ?, ?, ?)"
                ).bind(mockEmail, mockName, '', mockLevel).run();
                userRecord = {
                    id: Number(insert.meta.last_row_id),
                    email: mockEmail,
                    name: mockName,
                    affiliation: '',
                    level: mockLevel
                };
            } else {
                if (userRecord.level !== mockLevel) {
                    await env.DB.prepare("UPDATE users SET level = ? WHERE id = ?")
                        .bind(mockLevel, userRecord.id)
                        .run();
                    userRecord.level = mockLevel;
                }
            }

            c.set('user', userRecord);
            return await next();
        }

        // 2. 커스텀 JWT 쿠키 확인 ('edulink_token')
        const cookieToken = getCookie(c, 'edulink_token');
        let token = cookieToken || '';

        // 3. Authorization 헤더 확인 (Bearer <token>)
        if (!token) {
            const authHeader = c.req.header('Authorization');
            if (authHeader && authHeader.startsWith('Bearer ')) {
                token = authHeader.substring(7);
            }
        }

        // 자체 발급 JWT 토큰이 있는 경우 검증
        if (token) {
            try {
                const secret = new TextEncoder().encode(env.JWT_SECRET || 'edulink_jwt_secret_key_2026_xyz');
                const { payload } = await jwtVerify(token, secret);
                
                const email = payload.email as string;
                if (email) {
                    let userRecord = await env.DB.prepare("SELECT id, email, name, affiliation, level FROM users WHERE email = ?")
                        .bind(email)
                        .first<{ id: number; email: string; name: string; affiliation: string; level: number }>();

                    if (userRecord) {
                        c.set('user', userRecord);
                        return await next();
                    }
                }
            } catch (err: any) {
                console.warn('Custom JWT verification failed or user not found, falling back:', err.message);
            }
        }

        // 4. Cloudflare Access JWT 확인
        const accessHeader = c.req.header('Cf-Access-Jwt-Assertion');

        // [개발 환경 편의성 우회 및 Mock인증 - 헤더 없을 때 기본값]
        if (!accessHeader) {
            if (isLocal) {
                let mockEmail = 'teacher@dge.go.kr';
                let mockName = '홍길동';
                let mockLevel = 2;

                let userRecord = await env.DB.prepare("SELECT id, email, name, affiliation, level FROM users WHERE email = ?")
                    .bind(mockEmail)
                    .first<{ id: number; email: string; name: string; affiliation: string; level: number }>();

                if (!userRecord) {
                    const insert = await env.DB.prepare(
                        "INSERT INTO users (email, name, affiliation, level) VALUES (?, ?, ?, ?)"
                    ).bind(mockEmail, mockName, '', mockLevel).run();
                    userRecord = {
                        id: Number(insert.meta.last_row_id),
                        email: mockEmail,
                        name: mockName,
                        level: mockLevel
                    };
                }

                c.set('user', userRecord);
                return await next();
            }

            return c.json({ success: false, error: '인증 토큰이 누락되었습니다.' }, 401);
        }

        try {
            const teamDomain = (env as any).TEAM_DOMAIN || 'dgedu'; 
            const aud = (env as any).ACCESS_AUDIENCE || '';

            const JWKS = getJWKSet(teamDomain);
            const { payload } = await jwtVerify(accessHeader, JWKS, {
                issuer: `https://${teamDomain}.cloudflareaccess.com`,
                ...(aud ? { audience: aud } : {})
            });

            const email = payload.email as string;
            const name = (payload.name as string) || email.split('@')[0];

            if (!email) {
                return c.json({ success: false, error: '토큰에 이메일 정보가 존재하지 않습니다.' }, 401);
            }

            const domain = email.split('@')[1];
            if (!domain) {
                return c.json({ success: false, error: '올바르지 않은 이메일 형식입니다.' }, 401);
            }

            // D1 users 테이블 조회
            let userRecord = await env.DB.prepare("SELECT id, email, name, affiliation, level FROM users WHERE email = ?")
                .bind(email)
                .first<{ id: number; email: string; name: string; affiliation: string; level: number }>();

            if (!userRecord) {
                // 화이트리스트 도메인 여부 검증 후 자동 등급 승급 처리
                const isAllowed = await env.DB.prepare("SELECT id FROM allowed_domains WHERE domain = ?")
                    .bind(domain)
                    .first();

                // 화이트리스트 도메인이면 2(인증사용자), 아니면 1(일반 로그인)
                const initialLevel = isAllowed ? 2 : 1;

                const insert = await env.DB.prepare(
                    "INSERT INTO users (email, name, affiliation, level) VALUES (?, ?, ?, ?)"
                ).bind(email, name, '', initialLevel).run();

                userRecord = {
                    id: Number(insert.meta.last_row_id),
                    email,
                    name,
                    affiliation: '',
                    level: initialLevel
                };
            }

            c.set('user', userRecord);
            await next();
        } catch (err: any) {
            console.error('JWT verification error:', err);
            return c.json({ success: false, error: '인증 토큰 검증에 실패했습니다: ' + err.message }, 401);
        }
    };
};

export const adminMiddleware = (): MiddlewareHandler<{ Bindings: Env; Variables: { user: { id: number; email: string; name: string; affiliation: string; level: number } } }> => {
    return async (c, next) => {
        const user = c.get('user');
        if (!user || user.level !== 4) {
            return c.json({ success: false, error: '최고관리자 권한이 필요합니다.' }, 403);
        }
        await next();
    };
};
