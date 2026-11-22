-- Cloudflare D1 (SQLite) şeması
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  google_sub TEXT UNIQUE NOT NULL,
  name TEXT,
  email TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER,                 -- NULL = örnek / yönetici ilanı
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  engine TEXT,                      -- "1.6 TDI" gibi
  year INTEGER NOT NULL,
  fuel TEXT NOT NULL,               -- benzin | dizel | lpg | hibrit | elektrik
  gear TEXT NOT NULL,               -- manuel | otomatik | yari-otomatik
  km INTEGER NOT NULL,
  price INTEGER NOT NULL,           -- TL
  body TEXT,                        -- sedan | hatchback | suv | station | coupe | minivan | pickup
  segment TEXT NOT NULL,            -- ekonomi | orta | ust
  color TEXT,
  city TEXT,
  changed_parts INTEGER NOT NULL DEFAULT 0,   -- değişen parça sayısı
  painted_parts INTEGER NOT NULL DEFAULT 0,   -- boyalı parça sayısı
  heavy_damage INTEGER NOT NULL DEFAULT 0,    -- 1 = ağır hasar kayıtlı
  tramer INTEGER NOT NULL DEFAULT 0,          -- TL
  note TEXT,
  image_url TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  -- sayaçlar (her oyda sadece 2 satır güncellenir -> D1 yazma limitini yavaş tüketir)
  shown INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  haggle INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  expensive INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_listings_active_shown ON listings(active, shown);
CREATE INDEX IF NOT EXISTS idx_listings_owner ON listings(owner_id);
