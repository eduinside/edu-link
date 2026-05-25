// src/server/middleware/rateLimit.ts
import { MiddlewareHandler } from 'hono';

interface RateLimitOption {
    limit: number;    // 허용 요청 수
    windowSec: number; // 기준 시간 (초)
}

/**
 * KV 기반 심플한 Rate Limiter 미들웨어
 */
export const rateLimitMiddleware = (options: RateLimitOption = { limit: 60, windowSec: 60 }): MiddlewareHandler<{ Bindings: Env }> => {
    return async (c, next) => {
        const env = c.env;
        const ip = c.req.header('cf-connecting-ip') || 'unknown-ip';
        const apiKey = c.req.header('x-api-key') || '';
        
        // 식별자: API Key가 있으면 API Key 기준, 없으면 IP 기준
        const identifier = apiKey ? `rl:key:${apiKey.slice(0, 8)}` : `rl:ip:${ip}`;
        
        // 현재 시간에 대한 고정 윈도우 키 생성 (예: rl:ip:1.1.1.1:2026-05-25T15:20)
        const now = new Date();
        const windowIndex = Math.floor(now.getTime() / (options.windowSec * 1000));
        const rateLimitKey = `${identifier}:${windowIndex}`;

        try {
            // KV에서 현재 카운트 조회
            const currentCountStr = await env.URL_CACHE.get(rateLimitKey);
            const currentCount = currentCountStr ? parseInt(currentCountStr, 10) : 0;

            if (currentCount >= options.limit) {
                // 초과 시 429 응답
                c.header('Retry-After', String(options.windowSec));
                return c.json({ 
                    success: false, 
                    error: '요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요. (Rate Limit Exceeded)' 
                }, 429);
            }

            // 카운트 증가 및 저장 (만료시간은 기준 시간의 2배 정도로 주어 청소 자동화)
            await env.URL_CACHE.put(rateLimitKey, String(currentCount + 1), {
                expirationTtl: options.windowSec * 2
            });

            // 헤더에 남은 한도 정보 주입
            c.header('X-RateLimit-Limit', String(options.limit));
            c.header('X-RateLimit-Remaining', String(options.limit - (currentCount + 1)));

            await next();
        } catch (err) {
            // KV 에러 등이 발생하더라도 비즈니스 정지를 막기 위해 경고 로그만 남기고 바이패스 처리
            console.error('Rate limit middleware error:', err);
            await next();
        }
    };
};
