"""Annotation-class endpoints (project-scoped labels).

DB-free: CI has no Postgres, so the DB is faked. Covers the route contract plus
the ownership / duplicate / validation guards. Full CRUD-against-real-DB coverage
lives in the tracking e2e journey.
"""
import sys
import uuid
import asyncio
from datetime import datetime
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


# --- fake SQLAlchemy session ------------------------------------------------
class _FakeQuery:
    def __init__(self, result):
        self._result = result

    def filter(self, *a, **k):
        return self

    def order_by(self, *a, **k):
        return self

    def first(self):
        if isinstance(self._result, list):
            return self._result[0] if self._result else None
        return self._result

    def all(self):
        return self._result if isinstance(self._result, list) else []


class _FakeDB:
    """Returns preconfigured results keyed by model class name."""
    def __init__(self, results):
        self.results = results
        self.added = []
        self.committed = False
        self.deleted = []

    def query(self, model):
        return _FakeQuery(self.results.get(model.__name__))

    def add(self, obj):
        self.added.append(obj)

    def commit(self):
        self.committed = True

    def refresh(self, obj):
        if getattr(obj, "id", None) is None:
            obj.id = uuid.uuid4()
        if getattr(obj, "created_at", None) is None:
            obj.created_at = datetime(2026, 7, 17)

    def delete(self, obj):
        self.deleted.append(obj)


def _user():
    from app.database import DBUser
    u = DBUser(); u.id = uuid.uuid4(); return u


def _project(owner):
    from app.database import DBProject
    p = DBProject(); p.id = uuid.uuid4(); p.owner_id = owner.id; p.name = "e2e"; return p


# --- tests ------------------------------------------------------------------
def test_class_routes_exist():
    """The class CRUD routes the frontend/e2e call must exist on the backend."""
    from app.routers import projects
    routes = {(m, r.path) for r in projects.router.routes for m in getattr(r, "methods", [])}
    required = {
        ("POST", "/api/projects/{project_id}/classes"),
        ("GET", "/api/projects/{project_id}/classes"),
        ("DELETE", "/api/projects/{project_id}/classes/{class_id}"),
    }
    assert not (required - routes), f"missing class routes: {sorted(required - routes)}"


def test_class_create_request_rejects_blank_name():
    from app.api_models import ClassCreateRequest
    with pytest.raises(Exception):
        ClassCreateRequest(name="   ")
    # trims whitespace
    assert ClassCreateRequest(name="  sail  ").name == "sail"


def test_create_class_happy_path():
    from app.routers import projects
    from app.api_models import ClassCreateRequest
    from app.database import DBProject, DBAnnotationClass

    user = _user()
    proj = _project(user)
    db = _FakeDB({"DBProject": proj, "DBAnnotationClass": None})  # project owned, no dup

    out = asyncio.run(projects.create_class(
        str(proj.id), ClassCreateRequest(name="sail", color="#e11"), db=db, current_user=user))

    assert out["name"] == "sail" and out["color"] == "#e11"
    assert out["project_id"] == str(proj.id)
    assert db.committed and len(db.added) == 1


def test_create_class_unknown_project_404():
    from app.routers import projects
    from app.api_models import ClassCreateRequest
    from fastapi import HTTPException

    user = _user()
    db = _FakeDB({"DBProject": None})  # not owned / missing

    with pytest.raises(HTTPException) as exc:
        asyncio.run(projects.create_class(
            str(uuid.uuid4()), ClassCreateRequest(name="sail"), db=db, current_user=user))
    assert exc.value.status_code == 404


def test_create_class_duplicate_409():
    from app.routers import projects
    from app.api_models import ClassCreateRequest
    from app.database import DBAnnotationClass
    from fastapi import HTTPException

    user = _user()
    proj = _project(user)
    dup = DBAnnotationClass(); dup.id = uuid.uuid4(); dup.name = "sail"
    db = _FakeDB({"DBProject": proj, "DBAnnotationClass": dup})  # existing class

    with pytest.raises(HTTPException) as exc:
        asyncio.run(projects.create_class(
            str(proj.id), ClassCreateRequest(name="sail"), db=db, current_user=user))
    assert exc.value.status_code == 409
