-- GOLDEN PALACE POS — Migration 001: Official Menu Integration, Variants, Add-ons, Discounts & Import History
-- Backward-compatible additive SQLite migration (applied automatically via runSafeMigrations in src/db/index.ts)
-- Preserves all existing tables and historical records; no tables are dropped or recreated.

-- 1. Products extensions (SKU, structured subcategory support for Drinks, active state)
ALTER TABLE products ADD COLUMN sku TEXT;
ALTER TABLE products ADD COLUMN subcategory_ar TEXT;
ALTER TABLE products ADD COLUMN subcategory_fr TEXT;
ALTER TABLE products ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;

-- 2. Product Variants extensions (absolute DA integer price alongside price_adjustment, SKU, active flag)
ALTER TABLE product_variants ADD COLUMN price INTEGER;
ALTER TABLE product_variants ADD COLUMN sku TEXT;
ALTER TABLE product_variants ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;

-- 3. Product Add-ons extensions (empty by default; admin-configurable global or product-level add-ons)
ALTER TABLE product_addons ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE product_addons ADD COLUMN created_at TEXT;

-- 4. Orders discount authorization & audit trail extensions
ALTER TABLE orders ADD COLUMN discount_type TEXT;
ALTER TABLE orders ADD COLUMN discount_value NUMERIC DEFAULT 0;
ALTER TABLE orders ADD COLUMN discount_reason TEXT;
ALTER TABLE orders ADD COLUMN discount_authorized_by INTEGER REFERENCES users(id);
ALTER TABLE orders ADD COLUMN discount_authorized_at TEXT;

-- 5. Audit logs structured before/after values
ALTER TABLE audit_logs ADD COLUMN previous_value TEXT;
ALTER TABLE audit_logs ADD COLUMN new_value TEXT;

-- 6. Menu Import History table
CREATE TABLE IF NOT EXISTS menu_import_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  file_format TEXT NOT NULL,
  categories_count INTEGER NOT NULL DEFAULT 0,
  products_count INTEGER NOT NULL DEFAULT 0,
  variants_count INTEGER NOT NULL DEFAULT 0,
  valid_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  invalid_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'COMPLETED',
  backup_filename TEXT,
  backup_path TEXT,
  summary_json TEXT,
  imported_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

-- 7. Performance & integrity indexes
CREATE INDEX IF NOT EXISTS idx_menu_import_history_created ON menu_import_history(created_at);
CREATE INDEX IF NOT EXISTS idx_products_category_name ON products(category_id, name_ar);
CREATE INDEX IF NOT EXISTS idx_products_subcategory ON products(category_id, subcategory_ar);
CREATE INDEX IF NOT EXISTS idx_product_variants_product ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_product_addons_product ON product_addons(product_id);
CREATE INDEX IF NOT EXISTS idx_categories_sort_active ON categories(sort_order, is_active);
