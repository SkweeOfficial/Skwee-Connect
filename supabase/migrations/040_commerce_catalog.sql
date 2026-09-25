-- ============================================================
-- 040_commerce_catalog.sql
--
-- WhatsApp product cards from a Meta Commerce catalog.
--
--   1. whatsapp_config.catalog_id — the Meta catalog linked to the
--      account's WhatsApp number (Commerce Manager → WhatsApp Manager →
--      Catalog). Product / product-list messages must name it.
--
--   2. catalog_products — a local cache of that catalog, refreshed from
--      the Graph API by /api/commerce/catalog (manual "Sync now") and
--      /api/commerce/cron. The AI auto-reply bot picks recommendations
--      from here, and the inbox renders sent cards from it. Meta stays
--      the source of truth: a retailer_id that isn't in the catalog
--      can't be sent, so we only ever offer ids we've synced.
--
--   3. messages: 'order' content type + order_payload. When a customer
--      sends their WhatsApp cart, Meta delivers an `order` message with
--      the line items; we keep them structured so the inbox can render
--      the order and the public webhook can hand it to the store.
-- ============================================================

-- 1. Catalog id ----------------------------------------------
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS catalog_id TEXT;

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS catalog_synced_at TIMESTAMPTZ;

-- 2. Catalog cache -------------------------------------------
CREATE TABLE IF NOT EXISTS catalog_products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Tenancy. Every member of the account shares the catalog.
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- The id the product message sends (Meta's `product_retailer_id`) —
  -- the store's SKU / feed `id` column.
  retailer_id TEXT NOT NULL,
  -- Meta's `retailer_product_group_id` (feed `item_group_id`): all
  -- sizes / colours of one product share it. Null for single items.
  item_group_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  -- Meta's display string, e.g. "₹1,290.00". Shown as-is.
  price_text TEXT,
  -- Parsed numeric price in major units (1290.00), when available.
  price_amount NUMERIC(12, 2),
  currency TEXT,
  -- 'in stock' | 'out of stock' | 'preorder' | … (Meta's values).
  availability TEXT,
  image_url TEXT,
  url TEXT,
  size TEXT,
  color TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, retailer_id)
);

CREATE INDEX IF NOT EXISTS idx_catalog_products_account
  ON catalog_products(account_id);

ALTER TABLE catalog_products ENABLE ROW LEVEL SECURITY;

-- Any member can read (the inbox renders cards from it). Writes come
-- only from the service-role sync, so there are no write policies.
DROP POLICY IF EXISTS catalog_products_select ON catalog_products;
CREATE POLICY catalog_products_select ON catalog_products FOR SELECT
  USING (is_account_member(account_id));

-- 3. Orders --------------------------------------------------
ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_content_type_check;

ALTER TABLE messages
  ADD CONSTRAINT messages_content_type_check
  CHECK (content_type IN (
    'text', 'image', 'document', 'audio', 'video',
    'location', 'template', 'interactive', 'order'
  ));

-- { catalog_id, text, items: [{ retailer_id, quantity, item_price, currency }] }
-- NULL for every non-order message.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS order_payload JSONB;
