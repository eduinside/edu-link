import { describe, it, expect } from 'vitest';
import { isValidCustomSlug } from '../src/server/utils/slug';

describe('isValidCustomSlug', () => {
    it('should allow valid English alphanumeric slugs (4 to 20 chars)', () => {
        expect(isValidCustomSlug('slug')).toBe(true);
        expect(isValidCustomSlug('slug123')).toBe(true);
        expect(isValidCustomSlug('another-valid-slug')).toBe(true);
    });

    it('should reject slugs that are too short (< 4 chars)', () => {
        expect(isValidCustomSlug('abc')).toBe(false);
        expect(isValidCustomSlug('a')).toBe(false);
    });

    it('should reject slugs that are too long (> 20 chars)', () => {
        expect(isValidCustomSlug('a'.repeat(21))).toBe(false);
    });

    it('should allow Korean slugs up to 20 characters', () => {
        expect(isValidCustomSlug('한글슬러그')).toBe(true);
        expect(isValidCustomSlug('가나다라-마바사')).toBe(true);
        expect(isValidCustomSlug('단축주소테스트용한글슬러그길이이십자')).toBe(true); // 18자
        expect(isValidCustomSlug('한글자모ㄱㄴㄷㄹ')).toBe(true);
    });

    it('should reject Korean slugs longer than 20 characters', () => {
        expect(isValidCustomSlug('한글슬러그'.repeat(5))).toBe(false); // 25자
    });

    it('should reject invalid characters', () => {
        expect(isValidCustomSlug('slug!')).toBe(false);
        expect(isValidCustomSlug('slug_with_underscore')).toBe(false);
        expect(isValidCustomSlug('slug with space')).toBe(false);
    });
});
