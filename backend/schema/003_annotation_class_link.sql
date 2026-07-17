-- Link annotations to a class (denormalized) so YOLO export has a class per box.
-- Idempotent. Apply by hand (repo has no migration tool):
--   kubectl -n windsurf-prod exec -i windsurf-prod-postgres-0 -- \
--     psql -U windsurf -d windsurf_prod < backend/schema/003_annotation_class_link.sql
-- Keep in sync with app/database.py::DBAnnotation.

ALTER TABLE annotations
    ADD COLUMN IF NOT EXISTS class_id UUID REFERENCES annotation_classes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_annotations_project ON annotations (project_id);
CREATE INDEX IF NOT EXISTS ix_annotations_class ON annotations (class_id);
