-- Seed the baseline marketplace category hierarchy (M26.2).
-- Idempotent: deterministic cat_<slug> ids + ON CONFLICT (slug) DO NOTHING, so a
-- fresh environment gets the full tree while production rows (their own cuids,
-- parent links, and any client-created categories) are left completely untouched.
-- Children resolve parentId via a slug subquery, so the link is correct whether the
-- parent is a freshly-inserted baseline row or a pre-existing production row.

-- Top-level categories
INSERT INTO "categories" ("id","name","slug","featured","isVisible","sortOrder","parentId","createdAt","updatedAt")
VALUES ('cat_electronics', 'Electronics', 'electronics', true, true, 0, NULL, now(), now())
ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "categories" ("id","name","slug","featured","isVisible","sortOrder","parentId","createdAt","updatedAt")
VALUES ('cat_fashion-apparel', 'Fashion & Apparel', 'fashion-apparel', true, true, 1, NULL, now(), now())
ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "categories" ("id","name","slug","featured","isVisible","sortOrder","parentId","createdAt","updatedAt")
VALUES ('cat_home-garden', 'Home & Garden', 'home-garden', true, true, 2, NULL, now(), now())
ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "categories" ("id","name","slug","featured","isVisible","sortOrder","parentId","createdAt","updatedAt")
VALUES ('cat_food-grocery', 'Food & Grocery', 'food-grocery', true, true, 3, NULL, now(), now())
ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "categories" ("id","name","slug","featured","isVisible","sortOrder","parentId","createdAt","updatedAt")
VALUES ('cat_health-beauty', 'Health & Beauty', 'health-beauty', false, true, 4, NULL, now(), now())
ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "categories" ("id","name","slug","featured","isVisible","sortOrder","parentId","createdAt","updatedAt")
VALUES ('cat_sports-outdoors', 'Sports & Outdoors', 'sports-outdoors', false, true, 5, NULL, now(), now())
ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "categories" ("id","name","slug","featured","isVisible","sortOrder","parentId","createdAt","updatedAt")
VALUES ('cat_toys-kids-baby', 'Toys, Kids & Baby', 'toys-kids-baby', false, true, 6, NULL, now(), now())
ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "categories" ("id","name","slug","featured","isVisible","sortOrder","parentId","createdAt","updatedAt")
VALUES ('cat_automotive', 'Automotive', 'automotive', false, true, 7, NULL, now(), now())
ON CONFLICT ("slug") DO NOTHING;

-- Sub-categories (parentId resolved by parent slug)
INSERT INTO "categories" ("id","name","slug","featured","isVisible","sortOrder","parentId","createdAt","updatedAt")
SELECT 'cat_phones-tablets', 'Phones & Tablets', 'phones-tablets', false, true, 0, par."id", now(), now() FROM "categories" par WHERE par."slug" = 'electronics'
ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "categories" ("id","name","slug","featured","isVisible","sortOrder","parentId","createdAt","updatedAt")
SELECT 'cat_computers-laptops', 'Computers & Laptops', 'computers-laptops', false, true, 1, par."id", now(), now() FROM "categories" par WHERE par."slug" = 'electronics'
ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "categories" ("id","name","slug","featured","isVisible","sortOrder","parentId","createdAt","updatedAt")
SELECT 'cat_audio-headphones', 'Audio & Headphones', 'audio-headphones', false, true, 2, par."id", now(), now() FROM "categories" par WHERE par."slug" = 'electronics'
ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "categories" ("id","name","slug","featured","isVisible","sortOrder","parentId","createdAt","updatedAt")
SELECT 'cat_cameras', 'Cameras', 'cameras', false, true, 3, par."id", now(), now() FROM "categories" par WHERE par."slug" = 'electronics'
ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "categories" ("id","name","slug","featured","isVisible","sortOrder","parentId","createdAt","updatedAt")
SELECT 'cat_men-s-clothing', 'Men''s Clothing', 'men-s-clothing', false, true, 0, par."id", now(), now() FROM "categories" par WHERE par."slug" = 'fashion-apparel'
ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "categories" ("id","name","slug","featured","isVisible","sortOrder","parentId","createdAt","updatedAt")
SELECT 'cat_women-s-clothing', 'Women''s Clothing', 'women-s-clothing', false, true, 1, par."id", now(), now() FROM "categories" par WHERE par."slug" = 'fashion-apparel'
ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "categories" ("id","name","slug","featured","isVisible","sortOrder","parentId","createdAt","updatedAt")
SELECT 'cat_kids-clothing', 'Kids'' Clothing', 'kids-clothing', false, true, 2, par."id", now(), now() FROM "categories" par WHERE par."slug" = 'fashion-apparel'
ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "categories" ("id","name","slug","featured","isVisible","sortOrder","parentId","createdAt","updatedAt")
SELECT 'cat_shoes', 'Shoes', 'shoes', false, true, 3, par."id", now(), now() FROM "categories" par WHERE par."slug" = 'fashion-apparel'
ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "categories" ("id","name","slug","featured","isVisible","sortOrder","parentId","createdAt","updatedAt")
SELECT 'cat_accessories', 'Accessories', 'accessories', false, true, 4, par."id", now(), now() FROM "categories" par WHERE par."slug" = 'fashion-apparel'
ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "categories" ("id","name","slug","featured","isVisible","sortOrder","parentId","createdAt","updatedAt")
SELECT 'cat_furniture', 'Furniture', 'furniture', false, true, 0, par."id", now(), now() FROM "categories" par WHERE par."slug" = 'home-garden'
ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "categories" ("id","name","slug","featured","isVisible","sortOrder","parentId","createdAt","updatedAt")
SELECT 'cat_kitchen-dining', 'Kitchen & Dining', 'kitchen-dining', false, true, 1, par."id", now(), now() FROM "categories" par WHERE par."slug" = 'home-garden'
ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "categories" ("id","name","slug","featured","isVisible","sortOrder","parentId","createdAt","updatedAt")
SELECT 'cat_home-decor', 'Home Decor', 'home-decor', false, true, 2, par."id", now(), now() FROM "categories" par WHERE par."slug" = 'home-garden'
ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "categories" ("id","name","slug","featured","isVisible","sortOrder","parentId","createdAt","updatedAt")
SELECT 'cat_garden-outdoor', 'Garden & Outdoor', 'garden-outdoor', false, true, 3, par."id", now(), now() FROM "categories" par WHERE par."slug" = 'home-garden'
ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "categories" ("id","name","slug","featured","isVisible","sortOrder","parentId","createdAt","updatedAt")
SELECT 'cat_beverages', 'Beverages', 'beverages', false, true, 0, par."id", now(), now() FROM "categories" par WHERE par."slug" = 'food-grocery'
ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "categories" ("id","name","slug","featured","isVisible","sortOrder","parentId","createdAt","updatedAt")
SELECT 'cat_snacks', 'Snacks', 'snacks', false, true, 1, par."id", now(), now() FROM "categories" par WHERE par."slug" = 'food-grocery'
ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "categories" ("id","name","slug","featured","isVisible","sortOrder","parentId","createdAt","updatedAt")
SELECT 'cat_pantry-staples', 'Pantry Staples', 'pantry-staples', false, true, 2, par."id", now(), now() FROM "categories" par WHERE par."slug" = 'food-grocery'
ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "categories" ("id","name","slug","featured","isVisible","sortOrder","parentId","createdAt","updatedAt")
SELECT 'cat_fresh-produce', 'Fresh Produce', 'fresh-produce', false, true, 3, par."id", now(), now() FROM "categories" par WHERE par."slug" = 'food-grocery'
ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "categories" ("id","name","slug","featured","isVisible","sortOrder","parentId","createdAt","updatedAt")
SELECT 'cat_skincare', 'Skincare', 'skincare', false, true, 0, par."id", now(), now() FROM "categories" par WHERE par."slug" = 'health-beauty'
ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "categories" ("id","name","slug","featured","isVisible","sortOrder","parentId","createdAt","updatedAt")
SELECT 'cat_cosmetics', 'Cosmetics', 'cosmetics', false, true, 1, par."id", now(), now() FROM "categories" par WHERE par."slug" = 'health-beauty'
ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "categories" ("id","name","slug","featured","isVisible","sortOrder","parentId","createdAt","updatedAt")
SELECT 'cat_supplements', 'Supplements', 'supplements', false, true, 2, par."id", now(), now() FROM "categories" par WHERE par."slug" = 'health-beauty'
ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "categories" ("id","name","slug","featured","isVisible","sortOrder","parentId","createdAt","updatedAt")
SELECT 'cat_personal-care', 'Personal Care', 'personal-care', false, true, 3, par."id", now(), now() FROM "categories" par WHERE par."slug" = 'health-beauty'
ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "categories" ("id","name","slug","featured","isVisible","sortOrder","parentId","createdAt","updatedAt")
SELECT 'cat_fitness', 'Fitness', 'fitness', false, true, 0, par."id", now(), now() FROM "categories" par WHERE par."slug" = 'sports-outdoors'
ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "categories" ("id","name","slug","featured","isVisible","sortOrder","parentId","createdAt","updatedAt")
SELECT 'cat_camping-hiking', 'Camping & Hiking', 'camping-hiking', false, true, 1, par."id", now(), now() FROM "categories" par WHERE par."slug" = 'sports-outdoors'
ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "categories" ("id","name","slug","featured","isVisible","sortOrder","parentId","createdAt","updatedAt")
SELECT 'cat_cycling', 'Cycling', 'cycling', false, true, 2, par."id", now(), now() FROM "categories" par WHERE par."slug" = 'sports-outdoors'
ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "categories" ("id","name","slug","featured","isVisible","sortOrder","parentId","createdAt","updatedAt")
SELECT 'cat_toys-games', 'Toys & Games', 'toys-games', false, true, 0, par."id", now(), now() FROM "categories" par WHERE par."slug" = 'toys-kids-baby'
ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "categories" ("id","name","slug","featured","isVisible","sortOrder","parentId","createdAt","updatedAt")
SELECT 'cat_baby-gear', 'Baby Gear', 'baby-gear', false, true, 1, par."id", now(), now() FROM "categories" par WHERE par."slug" = 'toys-kids-baby'
ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "categories" ("id","name","slug","featured","isVisible","sortOrder","parentId","createdAt","updatedAt")
SELECT 'cat_parts-accessories', 'Parts & Accessories', 'parts-accessories', false, true, 0, par."id", now(), now() FROM "categories" par WHERE par."slug" = 'automotive'
ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "categories" ("id","name","slug","featured","isVisible","sortOrder","parentId","createdAt","updatedAt")
SELECT 'cat_car-care', 'Car Care', 'car-care', false, true, 1, par."id", now(), now() FROM "categories" par WHERE par."slug" = 'automotive'
ON CONFLICT ("slug") DO NOTHING;
