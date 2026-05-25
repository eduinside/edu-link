-- migrations/0005_update_user_levels.sql

-- 1. 임시 새 사용자 테이블 생성 (numeric level 적용)
CREATE TABLE IF NOT EXISTS users_new (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL DEFAULT '',
    level       INTEGER NOT NULL DEFAULT 1 CHECK(level IN (1, 2, 3, 4)),
    avatar_url  TEXT DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. 기존 사용자 데이터 복사 및 등급 변환
INSERT INTO users_new (id, email, name, level, avatar_url, created_at, updated_at)
SELECT 
    id, 
    email, 
    name, 
    CASE 
        WHEN role = 'admin' THEN 4
        WHEN role = 'developer' THEN 3
        WHEN role = 'user' THEN 2
        ELSE 1
    END as level,
    avatar_url, 
    created_at, 
    updated_at
FROM users;

-- 3. 구 테이블 삭제 및 새 테이블 이름 변경
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
