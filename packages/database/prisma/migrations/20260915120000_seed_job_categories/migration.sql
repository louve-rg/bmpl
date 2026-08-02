-- Seed baseline Belize Connect job categories (M26.1 UX audit).
-- Idempotent: deterministic ids + ON CONFLICT on the unique slug, so repeated
-- deploys never create duplicates. The Jobs frontend/API/admin were already wired
-- for JobCategory; only the reference rows were missing in production.
INSERT INTO "job_categories" ("id", "name", "slug", "isVisible", "sortOrder", "createdAt", "updatedAt")
VALUES
  ('jobcat_accounting-finance',          'Accounting & Finance',           'accounting-finance',          true, 10,  now(), now()),
  ('jobcat_administration-office',       'Administration & Office Support', 'administration-office-support', true, 20,  now(), now()),
  ('jobcat_agriculture-fisheries',       'Agriculture & Fisheries',        'agriculture-fisheries',       true, 30,  now(), now()),
  ('jobcat_construction-trades',         'Construction & Skilled Trades',  'construction-skilled-trades', true, 40,  now(), now()),
  ('jobcat_customer-service',            'Customer Service',               'customer-service',            true, 50,  now(), now()),
  ('jobcat_education-training',          'Education & Training',            'education-training',          true, 60,  now(), now()),
  ('jobcat_engineering',                 'Engineering',                    'engineering',                 true, 70,  now(), now()),
  ('jobcat_government-public',           'Government & Public Service',    'government-public-service',    true, 80,  now(), now()),
  ('jobcat_healthcare',                  'Healthcare',                     'healthcare',                  true, 90,  now(), now()),
  ('jobcat_hospitality-tourism',         'Hospitality & Tourism',          'hospitality-tourism',         true, 100, now(), now()),
  ('jobcat_human-resources',             'Human Resources',                'human-resources',             true, 110, now(), now()),
  ('jobcat_information-technology',      'Information Technology',         'information-technology',      true, 120, now(), now()),
  ('jobcat_legal',                       'Legal',                          'legal',                       true, 130, now(), now()),
  ('jobcat_logistics-transportation',   'Logistics & Transportation',     'logistics-transportation',    true, 140, now(), now()),
  ('jobcat_manufacturing',               'Manufacturing',                  'manufacturing',               true, 150, now(), now()),
  ('jobcat_marketing-communications',   'Marketing & Communications',     'marketing-communications',    true, 160, now(), now()),
  ('jobcat_retail-sales',                'Retail & Sales',                 'retail-sales',                true, 170, now(), now()),
  ('jobcat_security',                    'Security',                       'security',                    true, 180, now(), now()),
  ('jobcat_social-services',             'Social Services',                'social-services',             true, 190, now(), now()),
  ('jobcat_other',                       'Other',                          'other',                       true, 200, now(), now())
ON CONFLICT ("slug") DO NOTHING;
