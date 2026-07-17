-- Durable job store (tracking today; export/others later). Replaces the
-- in-memory tracking_jobs_db so status/results survive rollouts + multiple
-- replicas. Idempotent. Apply by hand (repo has no migration tool):
--   kubectl -n windsurf-prod exec -i windsurf-prod-postgres-0 -- \
--     psql -U windsurf -d windsurf_prod < backend/schema/004_jobs.sql
-- Keep in sync with app/database.py::DBJob.

CREATE TABLE IF NOT EXISTS jobs (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    kind       VARCHAR(50) NOT NULL,
    video_id   UUID,
    project_id UUID,
    status     VARCHAR(50) NOT NULL DEFAULT 'pending',
    params     JSONB DEFAULT '{}'::jsonb,
    result     JSONB,
    task_id    VARCHAR(255),
    error      TEXT,
    progress   DOUBLE PRECISION DEFAULT 0,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_jobs_kind_status ON jobs (kind, status);
CREATE INDEX IF NOT EXISTS ix_jobs_video ON jobs (video_id);
