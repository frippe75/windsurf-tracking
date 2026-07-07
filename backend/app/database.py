"""
Database configuration and SQLAlchemy models
"""

import os
from sqlalchemy import create_engine, Column, String, Integer, Float, Boolean, Text, ForeignKey, TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.sql import func

# Database configuration
DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql://windsurf:dev_password@localhost:5432/windsurf')
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# Database models
class DBUser(Base):
    __tablename__ = "users"
    id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    email = Column(String(255), unique=True, nullable=False)
    name = Column(String(255))
    password_hash = Column(String(255))  # For local users (null for OIDC users)
    is_active = Column(Boolean, default=True)
    role = Column(String(50), default='user')  # user, admin, viewer
    auth_provider = Column(String(50), default='local')  # local, oidc
    created_at = Column(TIMESTAMP, server_default=func.now())
    last_login = Column(TIMESTAMP)

class DBProject(Base):
    __tablename__ = "projects"
    id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    name = Column(String(255), nullable=False)
    description = Column(Text)
    video_id = Column(UUID(as_uuid=True), nullable=False)
    owner_id = Column(UUID(as_uuid=True), ForeignKey('users.id'), nullable=False)
    created_at = Column(TIMESTAMP, server_default=func.now())
    last_modified = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())
    is_active = Column(Boolean, default=True)
    settings = Column(JSONB, default={})

class DBAnnotation(Base):
    __tablename__ = "annotations"
    id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4())
    project_id = Column(UUID(as_uuid=True), ForeignKey('projects.id'), nullable=False)
    instance_id = Column(UUID(as_uuid=True), nullable=False)
    frame_number = Column(Integer, nullable=False)
    annotation_type = Column(String(50), nullable=False)
    geometry = Column(JSONB, nullable=False)
    is_keyframe = Column(Boolean, default=False)
    confidence = Column(Float)
    created_by_method = Column(String(50), default='manual')
    tracking_metadata = Column(JSONB, default={})
    created_at = Column(TIMESTAMP, server_default=func.now())

# Database dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()