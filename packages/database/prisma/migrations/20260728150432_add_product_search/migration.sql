-- Full-text search for products (PostgreSQL only; no external engine).

-- Trigram matching for fuzzy title search.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- tsvector column, maintained by a trigger (to_tsvector-by-config-name is only
-- STABLE, so a GENERATED column is rejected; a trigger has no such requirement).
ALTER TABLE "products" ADD COLUMN "searchVector" tsvector;

CREATE OR REPLACE FUNCTION products_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW."searchVector" :=
    setweight(to_tsvector('english', coalesce(NEW."title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW."brand", '')), 'B') ||
    setweight(to_tsvector('english', array_to_string(NEW."searchKeywords", ' ')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW."description", '')), 'C');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER products_search_vector_trg
  BEFORE INSERT OR UPDATE OF "title", "brand", "description", "searchKeywords"
  ON "products"
  FOR EACH ROW EXECUTE FUNCTION products_search_vector_update();

-- Backfill any existing rows.
UPDATE "products" SET
  "searchVector" =
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("brand", '')), 'B') ||
    setweight(to_tsvector('english', array_to_string("searchKeywords", ' ')), 'B') ||
    setweight(to_tsvector('english', coalesce("description", '')), 'C');

-- GIN index on the tsvector for fast full-text ranking/filtering.
CREATE INDEX "products_search_idx" ON "products" USING GIN ("searchVector");

-- GIN trigram index on title for fuzzy matches.
CREATE INDEX "products_title_trgm_idx" ON "products" USING GIN ("title" gin_trgm_ops);
