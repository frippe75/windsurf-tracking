"""
Authentication middleware and dependencies
"""

import os
from typing import Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session
from jose import JWTError, jwt
import uuid

from .database import get_db, DBUser

# JWT configuration
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "dev-secret-change-in-production")
ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")

# Bearer token scheme
security = HTTPBearer(auto_error=False)

async def get_current_user(
    db: Session = Depends(get_db), 
    token: Optional[str] = Depends(security)
) -> Optional[DBUser]:
    """
    Get current authenticated user from JWT token.
    Returns None when auth is disabled or no token provided.
    Raises HTTPException for invalid tokens when auth is enabled.
    """
    
    # Check if auth is enabled
    auth_enabled = os.getenv("AUTH_ENABLED", "false").lower() == "true"
    
    if not auth_enabled:
        # Return a default development user when auth is disabled
        return DBUser(
            id=str(uuid.uuid4()),
            email="dev@localhost",
            name="Development User", 
            role="admin",
            auth_provider="disabled",
            is_active=True
        )
    
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    try:
        payload = jwt.decode(token.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise HTTPException(status_code=401, detail="Invalid token payload")
    except JWTError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")
    
    user = db.query(DBUser).filter(
        DBUser.email == email, 
        DBUser.is_active == True
    ).first()
    
    if user is None:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    
    return user

async def get_current_active_user(current_user: DBUser = Depends(get_current_user)) -> DBUser:
    """
    Get current user and ensure they are active.
    Use this dependency for routes that require active authentication.
    """
    
    auth_enabled = os.getenv("AUTH_ENABLED", "false").lower() == "true"
    
    if not auth_enabled:
        return current_user  # Pass through development user
    
    if not current_user or not current_user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    
    return current_user

async def get_admin_user(current_user: DBUser = Depends(get_current_active_user)) -> DBUser:
    """
    Get current user and ensure they have admin role.
    Use this dependency for admin-only routes.
    """
    
    auth_enabled = os.getenv("AUTH_ENABLED", "false").lower() == "true"
    
    if not auth_enabled:
        return current_user  # Pass through development user
    
    if current_user.role not in ["admin", "superuser"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required"
        )
    
    return current_user

def auth_enabled() -> bool:
    """Check if authentication is enabled"""
    return os.getenv("AUTH_ENABLED", "false").lower() == "true"