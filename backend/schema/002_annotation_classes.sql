-- Annotation classes: project-scoped labels (name + display color).
-- Idempotent. This repo has no migration tool; existing tables (users, projects,
-- annotations) were provisioned manually, so schema changes are applied by hand:
--   kubectl -n windsurf-prod exec -i windsurf-prod-postgres-0 -- \
--     psql -U windsurf -d windsurf < backend/schema/002_annotation_classes.sql
-- Keep this file in sync with app/database.py::DBAnnotationClass.

CREATE TABLE IF NOT EXISTS annotation_classes (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name       VARCHAR(255) NOT NULL,
    color      VARCHAR(32)  NOT NULL DEFAULT '#3b82f6',
    created_at TIMESTAMP DEFAULT now(),
    CONSTRAINT uq_class_project_name UNIQUE (project_id, name)
);

CREATE INDEX IF NOT EXISTS ix_annotation_classes_project ON annotation_classes (project_id);
