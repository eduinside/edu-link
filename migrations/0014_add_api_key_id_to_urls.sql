-- migrations/0014_add_api_key_id_to_urls.sql
-- api_key_id: 해당 단축주소를 생성한 API Key (앱) 식별자
--   - created_by = 'web'  → 항상 NULL
--   - created_by = 'api'  → 발급 키의 api_keys.id
--   - 본 마이그레이션 이전에 생성된 API 링크는 NULL (대시보드에서 '키 미지정'으로 표시)
-- ON DELETE SET NULL: 키를 삭제해도 단축주소는 유지되고 소속만 해제된다.

ALTER TABLE urls ADD COLUMN api_key_id INTEGER REFERENCES api_keys(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_urls_api_key_id ON urls(api_key_id);
