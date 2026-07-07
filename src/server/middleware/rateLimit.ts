// src/server/middleware/rateLimit.ts
import { MiddlewareHandler } from 'hono';

interface RateLimitOption {
    limit: number;    // 허용 요청 수
    windowSec: number; // 기준 시간 (초)
}

// Worker 메모리를 활용한 캐시 (KV 쓰기 방지)
// Edge 노드별로 독립적으로 동작하지만, 비용이 무료이고 속도가 매우 빠름.
const rateLimitCache = new Map<string, { count: number; resetTime: number }>();

/**
 * In-memory 기반 심플한 Rate Limiter 미들웨어
 */
export const rateLimitMiddleware = (options: RateLimitOption = { limit: 60, windowSec: 60 }): MiddlewareHandler<{ Bindings: Env }> => {
    return async (c, next) => {
        // 메모리 누수 방지용: 캐시가 너무 커지면 초기화 (Edge 환경에선 보통 도달하기 전에 리셋됨)
        if (rateLimitCache.size > 10000) {
            rateLimitCache.clear();
        }
        
        const ip = c.req.header('cf-connecting-ip') || 'unknown-ip';
        const apiKey = c.req.header('x-api-key') || '';
        
        // 식별자: API Key가 있으면 API Key 기준, 없으면 IP 기준
        const identifier = apiKey ? `rl:key:${apiKey.slice(0, 8)}` : `rl:ip:${ip}`;
        
        const now = Date.now();
        let record = rateLimitCache.get(identifier);
        
        // 기록이 없거나 윈도우 시간이 지났으면 새 기록으로 초기화
        if (!record || now > record.resetTime) {
            record = { count: 0, resetTime: now + (options.windowSec * 1000) };
        }

        if (record.count >= options.limit) {
            // 초과 시 429 응답
            c.header('Retry-After', String(Math.ceil((record.resetTime - now) / 1000)));
            return c.json({ 
                success: false, 
                error: '요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요. (Rate Limit Exceeded)' 
            }, 429);
        }

        // 카운트 증가 및 저장
        record.count++;
        rateLimitCache.set(identifier, record);

        // 헤더에 남은 한도 정보 주입
        c.header('X-RateLimit-Limit', String(options.limit));
        c.header('X-RateLimit-Remaining', String(options.limit - record.count));

        await next();
    };
};
