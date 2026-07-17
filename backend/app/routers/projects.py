"""
Project management endpoints
"""

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from sqlalchemy.sql import func

from ..database import get_db, DBProject, DBUser, DBAnnotation, DBAnnotationClass
from ..api_models import (
    ProjectCreateRequest, ProjectUpdateRequest, ClassCreateRequest, AnnotationsSaveRequest,
)
from ..auth import get_current_active_user

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _owned_project_or_404(project_id: str, db: Session, current_user: DBUser) -> DBProject:
    """Fetch a project the current user owns, or raise 404 (same guard the
    project routes use)."""
    project = db.query(DBProject).filter(
        DBProject.id == project_id,
        DBProject.owner_id == current_user.id,
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found or access denied")
    return project


def _class_dict(cls: DBAnnotationClass) -> dict:
    return {
        "id": str(cls.id),
        "project_id": str(cls.project_id),
        "name": cls.name,
        "color": cls.color,
        "created_at": cls.created_at.isoformat() if cls.created_at else None,
    }


def _annotation_dict(a: DBAnnotation) -> dict:
    return {
        "id": str(a.id),
        "instance_id": str(a.instance_id),
        "class_id": str(a.class_id) if a.class_id else None,
        "frame_number": a.frame_number,
        "annotation_type": a.annotation_type,
        "geometry": a.geometry,
        "is_keyframe": a.is_keyframe,
        "confidence": a.confidence,
        "created_by_method": a.created_by_method,
        "tracking_metadata": a.tracking_metadata or {},
    }

# Import videos_db from main (temporary until refactored)
videos_db = {}  # Will be injected

@router.post("")
async def create_project(
    request: ProjectCreateRequest, 
    db: Session = Depends(get_db),
    current_user: DBUser = Depends(get_current_active_user)
):
    """Create new annotation project"""
    
    # Verify video exists
    if request.video_id not in videos_db:
        raise HTTPException(status_code=404, detail="Video not found")
    
    # Create project with current user as owner
    project = DBProject(
        name=request.name,
        description=request.description,
        video_id=request.video_id,
        owner_id=current_user.id
    )
    
    db.add(project)
    db.commit()
    db.refresh(project)
    
    return {
        "id": str(project.id),
        "name": project.name,
        "description": project.description,
        "video_id": str(project.video_id),
        "created_at": project.created_at.isoformat(),
        "last_modified": project.last_modified.isoformat()
    }

@router.get("")
async def list_projects(
    db: Session = Depends(get_db),
    current_user: DBUser = Depends(get_current_active_user)
):
    """List all projects for current user"""
    
    # Filter projects by current user (owner)
    projects = db.query(DBProject).filter(
        DBProject.is_active == True,
        DBProject.owner_id == current_user.id
    ).all()
    
    project_list = []
    for project in projects:
        # Get video info for each project
        video_info = videos_db.get(str(project.video_id))
        
        project_list.append({
            "id": str(project.id),
            "name": project.name,
            "description": project.description,
            "video_id": str(project.video_id),
            "video_filename": video_info.filename if video_info else "Unknown",
            "created_at": project.created_at.isoformat(),
            "last_modified": project.last_modified.isoformat(),
            "settings": project.settings or {}
        })
    
    return {"projects": project_list, "total": len(project_list)}

@router.get("/{project_id}")
async def get_project(
    project_id: str, 
    db: Session = Depends(get_db),
    current_user: DBUser = Depends(get_current_active_user)
):
    """Get project details with all annotations"""
    
    project = db.query(DBProject).filter(
        DBProject.id == project_id,
        DBProject.owner_id == current_user.id
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found or access denied")
    
    # Get video info
    video_info = videos_db.get(str(project.video_id))
    
    # Get all annotations for this project
    annotations = db.query(DBAnnotation).filter(DBAnnotation.project_id == project_id).all()
    
    return {
        "id": str(project.id),
        "name": project.name,
        "description": project.description,
        "video_id": str(project.video_id),
        "video_filename": video_info.filename if video_info else "Unknown",
        "video_metadata": {
            "duration": video_info.duration if video_info else 0,
            "fps": video_info.fps if video_info else 0,
            "width": video_info.width if video_info else 0,
            "height": video_info.height if video_info else 0,
            "total_frames": video_info.total_frames if video_info else 0
        } if video_info else {},
        "created_at": project.created_at.isoformat(),
        "last_modified": project.last_modified.isoformat(),
        "settings": project.settings or {},
        "annotation_count": len(annotations),
        "annotated_frames": len(set(a.frame_number for a in annotations))
    }

@router.put("/{project_id}")
async def update_project(
    project_id: str, 
    request: ProjectUpdateRequest, 
    db: Session = Depends(get_db),
    current_user: DBUser = Depends(get_current_active_user)
):
    """Update project details"""
    
    project = db.query(DBProject).filter(
        DBProject.id == project_id,
        DBProject.owner_id == current_user.id
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found or access denied")
    
    # Update fields
    if request.name is not None:
        project.name = request.name
    if request.description is not None:
        project.description = request.description
    if request.settings is not None:
        project.settings = request.settings
    
    project.last_modified = func.now()
    
    db.commit()
    db.refresh(project)
    
    return {
        "id": str(project.id),
        "name": project.name,
        "description": project.description,
        "last_modified": project.last_modified.isoformat()
    }

@router.delete("/{project_id}")
async def delete_project(
    project_id: str, 
    db: Session = Depends(get_db),
    current_user: DBUser = Depends(get_current_active_user)
):
    """Delete project and all related data"""
    
    project = db.query(DBProject).filter(
        DBProject.id == project_id,
        DBProject.owner_id == current_user.id
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found or access denied")
    
    # Soft delete
    project.is_active = False
    db.commit()

    return {"message": f"Project {project.name} deleted successfully"}


# --- Annotation classes (labels) -------------------------------------------
# A class is a real, project-scoped entity: name + display color. Annotations
# reference it; the tracking flow labels its objects with a class.

@router.post("/{project_id}/classes")
async def create_class(
    project_id: str,
    request: ClassCreateRequest,
    db: Session = Depends(get_db),
    current_user: DBUser = Depends(get_current_active_user),
):
    """Create an annotation class in a project (unique name per project)."""
    _owned_project_or_404(project_id, db, current_user)

    existing = db.query(DBAnnotationClass).filter(
        DBAnnotationClass.project_id == project_id,
        DBAnnotationClass.name == request.name,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Class '{request.name}' already exists")

    cls = DBAnnotationClass(project_id=project_id, name=request.name, color=request.color)
    db.add(cls)
    db.commit()
    db.refresh(cls)
    return _class_dict(cls)


@router.get("/{project_id}/classes")
async def list_classes(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: DBUser = Depends(get_current_active_user),
):
    """List the annotation classes in a project."""
    _owned_project_or_404(project_id, db, current_user)
    classes = db.query(DBAnnotationClass).filter(
        DBAnnotationClass.project_id == project_id
    ).order_by(DBAnnotationClass.created_at).all()
    return {"classes": [_class_dict(c) for c in classes], "total": len(classes)}


@router.delete("/{project_id}/classes/{class_id}")
async def delete_class(
    project_id: str,
    class_id: str,
    db: Session = Depends(get_db),
    current_user: DBUser = Depends(get_current_active_user),
):
    """Delete an annotation class from a project."""
    _owned_project_or_404(project_id, db, current_user)
    cls = db.query(DBAnnotationClass).filter(
        DBAnnotationClass.id == class_id,
        DBAnnotationClass.project_id == project_id,
    ).first()
    if not cls:
        raise HTTPException(status_code=404, detail="Class not found")
    db.delete(cls)
    db.commit()
    return {"message": "Class deleted"}


# --- Annotations (persisted, source of truth for export) --------------------

@router.put("/{project_id}/annotations")
async def save_annotations(
    project_id: str,
    request: AnnotationsSaveRequest,
    db: Session = Depends(get_db),
    current_user: DBUser = Depends(get_current_active_user),
):
    """Replace the project's full annotation set (bulk, idempotent save)."""
    _owned_project_or_404(project_id, db, current_user)

    db.query(DBAnnotation).filter(DBAnnotation.project_id == project_id).delete()
    for a in request.annotations:
        db.add(DBAnnotation(
            project_id=project_id,
            instance_id=a.instance_id,
            class_id=a.class_id,
            frame_number=a.frame_number,
            annotation_type=a.annotation_type,
            geometry=a.geometry,
            is_keyframe=a.is_keyframe,
            confidence=a.confidence,
            created_by_method=a.created_by_method,
            tracking_metadata=a.tracking_metadata or {},
        ))
    db.commit()
    return {"saved": len(request.annotations)}


@router.get("/{project_id}/annotations")
async def list_annotations(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: DBUser = Depends(get_current_active_user),
):
    """List the project's persisted annotations (ordered by frame)."""
    _owned_project_or_404(project_id, db, current_user)
    rows = (db.query(DBAnnotation)
            .filter(DBAnnotation.project_id == project_id)
            .order_by(DBAnnotation.frame_number).all())
    return {"annotations": [_annotation_dict(r) for r in rows], "total": len(rows)}