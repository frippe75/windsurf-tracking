"""Annotation persistence endpoints (bulk replace + list).

DB-free (CI has no Postgres): the session is faked. Covers the route contract,
the bulk-replace happy path, and the ownership guard. Real CRUD is exercised by
the tracking/export e2e journey.
"""
import sys
import uuid
import asyncio
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class _FakeQuery:
    def __init__(self, result):
        self._result = result
        self.deleted = 0

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

    def delete(self):
        self.deleted = len(self._result) if isinstance(self._result, list) else 0
        return self.deleted


class _FakeDB:
    def __init__(self, results):
        self.results = results
        self.added = []
        self.committed = False

    def query(self, model):
        return _FakeQuery(self.results.get(model.__name__))

    def add(self, obj):
        self.added.append(obj)

    def commit(self):
        self.committed = True


def _user():
    from app.database import DBUser
    u = DBUser(); u.id = uuid.uuid4(); return u


def _project(owner):
    from app.database import DBProject
    p = DBProject(); p.id = uuid.uuid4(); p.owner_id = owner.id; return p


def _ann(frame, cls_id):
    return {
        "instance_id": str(uuid.uuid4()),
        "class_id": str(cls_id),
        "frame_number": frame,
        "annotation_type": "bbox",
        "geometry": {"bbox": {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2}},
        "is_keyframe": frame == 0,
    }


def test_annotation_routes_exist():
    from app.routers import projects
    routes = {(m, r.path) for r in projects.router.routes for m in getattr(r, "methods", [])}
    required = {
        ("PUT", "/api/projects/{project_id}/annotations"),
        ("GET", "/api/projects/{project_id}/annotations"),
    }
    assert not (required - routes), f"missing annotation routes: {sorted(required - routes)}"


def test_save_annotations_replaces_and_counts():
    from app.routers import projects
    from app.api_models import AnnotationsSaveRequest

    user = _user()
    proj = _project(user)
    cls_id = uuid.uuid4()
    db = _FakeDB({"DBProject": proj, "DBAnnotation": []})

    req = AnnotationsSaveRequest(annotations=[_ann(0, cls_id), _ann(1, cls_id)])
    out = asyncio.run(projects.save_annotations(str(proj.id), req, db=db, current_user=user))

    assert out == {"saved": 2}
    assert len(db.added) == 2 and db.committed
    # class link + frame carried through to the DB rows
    assert {str(a.class_id) for a in db.added} == {str(cls_id)}
    assert sorted(a.frame_number for a in db.added) == [0, 1]


def test_save_annotations_unknown_project_404():
    from app.routers import projects
    from app.api_models import AnnotationsSaveRequest
    from fastapi import HTTPException

    user = _user()
    db = _FakeDB({"DBProject": None})
    with pytest.raises(HTTPException) as exc:
        asyncio.run(projects.save_annotations(
            str(uuid.uuid4()), AnnotationsSaveRequest(annotations=[]), db=db, current_user=user))
    assert exc.value.status_code == 404


def test_annotations_save_request_accepts_empty_and_full():
    from app.api_models import AnnotationsSaveRequest
    assert AnnotationsSaveRequest(annotations=[]).annotations == []
    r = AnnotationsSaveRequest(annotations=[_ann(3, uuid.uuid4())])
    assert r.annotations[0].frame_number == 3 and r.annotations[0].annotation_type == "bbox"
