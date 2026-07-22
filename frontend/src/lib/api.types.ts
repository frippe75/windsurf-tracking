/**
 * Ergonomic re-exports of the backend's OpenAPI-generated schemas.
 *
 * `api.gen.ts` is generated from the live spec (`npm run gen:api` →
 * windsurf-api.tclab.org/openapi.json) and must not be edited by hand. Import backend
 * DTOs from here rather than re-declaring them, so frontend types can't silently drift
 * from the backend contract (the `description` field bug is exactly what this prevents).
 *
 * Migration is incremental: `lib/api.ts` still has hand-written types today; move them to
 * these as you touch each area.
 */
import type { components } from "./api.gen";

export type Schemas = components["schemas"];

export type ProjectResponse = Schemas["ProjectResponse"];
export type ProjectListResponse = Schemas["ProjectListResponse"];
export type ProjectCreateRequest = Schemas["ProjectCreateRequest"];
export type ProjectUpdateRequest = Schemas["ProjectUpdateRequest"];
