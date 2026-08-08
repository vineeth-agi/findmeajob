-- Cover the public catalog's active/newest order, auto-country filter, exact
-- role filter, and paginated sitemap without building temporary sort tables.
CREATE INDEX IF NOT EXISTS idx_jobs_active_posted
  ON jobs (lifecycle_status, posted_at DESC, updated_at DESC, job_id);

CREATE INDEX IF NOT EXISTS idx_jobs_active_country_posted
  ON jobs (lifecycle_status, country COLLATE NOCASE, posted_at DESC, updated_at DESC, job_id);

CREATE INDEX IF NOT EXISTS idx_jobs_active_job_id
  ON jobs (lifecycle_status, job_id);
