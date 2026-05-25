// src/server/utils/slug.ts

// 헷갈리기 쉬운 문자(0, O, o, 1, l, I) 및 특수문자/하이픈을 제외한 가독성 높은 Base54 문자셋
export const READABLE_CHARSET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * 6자리 랜덤 슬러그 생성
 */
export function generateRandomSlug(length: number = 6): string {
    let result = '';
    const charsetLength = READABLE_CHARSET.length;
    
    // Web Crypto API를 사용하여 보안적으로 우수한 난수 생성
    const randomValues = new Uint32Array(length);
    crypto.getRandomValues(randomValues);
    
    for (let i = 0; i < length; i++) {
        result += READABLE_CHARSET[randomValues[i] % charsetLength];
    }
    return result;
}

/**
 * 사용자 입력 슬러그 형식 검증 (4~20자, 영숫자, 한글 및 하이픈)
 */
export function isValidCustomSlug(slug: string): boolean {
    const slugRegex = /^[a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣-]{4,20}$/;
    return slugRegex.test(slug);
}
