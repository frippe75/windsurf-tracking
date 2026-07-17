"""
Pydantic models for API requests and responses
"""

from pydantic import BaseModel, field_validator, EmailStr
from typing import Optional, Dict, List
from datetime import datetime

class VideoInfo(BaseModel):
    id: str
    filename: str
    file_path: str
    duration: float
    fps: float
    width: int
    height: int
    total_frames: int
    upload_date: datetime
    status: str = "ready"

class SceneData(BaseModel):
    scene_id: int
    start_frame: int
    end_frame: int
    start_time: float
    end_time: float
    duration: float
    quality: str = "unknown"

class FrameRequest(BaseModel):
    frame_number: int
    width: Optional[int] = None
    height: Optional[int] = None

class YouTubeDownloadRequest(BaseModel):
    url: str
    format: Optional[str] = "mp4"
    quality: Optional[str] = "720p"

class ProjectCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    video_id: str

class ProjectUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    settings: Optional[Dict] = None

class ClassCreateRequest(BaseModel):
    name: str
    color: Optional[str] = "#3b82f6"

    @field_validator('name')
    @classmethod
    def name_not_blank(cls, v):
        if not v or not v.strip():
            raise ValueError('Class name must not be blank')
        return v.strip()

class AnnotationItem(BaseModel):
    instance_id: str
    class_id: Optional[str] = None
    frame_number: int
    annotation_type: str = "bbox"
    geometry: Dict                       # e.g. {"bbox": {...}} or {"points": [...]}
    is_keyframe: bool = False
    confidence: Optional[float] = None
    created_by_method: str = "manual"    # manual | tracked
    tracking_metadata: Optional[Dict] = None

class AnnotationsSaveRequest(BaseModel):
    """Full annotation set for a project (bulk replace)."""
    annotations: List[AnnotationItem]

# Authentication models
class UserCreate(BaseModel):
    email: EmailStr
    name: str
    password: str
    
    @field_validator('password')
    @classmethod
    def validate_password(cls, v):
        if len(v) < 6:
            raise ValueError('Password must be at least 6 characters')
        return v

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserResponse(BaseModel):
    id: str
    email: str
    name: str
    role: str
    auth_provider: str
    created_at: datetime
    last_login: Optional[datetime] = None

class Token(BaseModel):
    access_token: str
    token_type: str
    expires_in: int