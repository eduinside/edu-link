// Worker secrets (wrangler secret put 으로 설정, wrangler types에 포함 안 됨)
interface Env {
    JWT_SECRET?: string;
    RESEND_API_KEY?: string;
    KAKAO_CLIENT_ID?: string;
}
