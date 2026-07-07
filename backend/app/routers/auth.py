"""
Authentication endpoints for user registration and JWT token management
"""

import os
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, status, Form
from fastapi.security import HTTPBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from passlib.context import CryptContext
from jose import JWTError, jwt
import uuid

from ..database import get_db, DBUser
from ..api_models import UserCreate, UserLogin, UserResponse, Token

router = APIRouter(prefix="/auth", tags=["authentication"])

# Password hashing - use pbkdf2_sha256 for compatibility
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

# JWT configuration
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "dev-secret-change-in-production")
ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_HOURS = int(os.getenv("TOKEN_EXPIRE_HOURS", "24"))

# Bearer token scheme
security = HTTPBearer(auto_error=False)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash"""
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    """Hash a password"""
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create JWT access token"""
    to_encode = data.copy()
    
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(db: Session = Depends(get_db), token: Optional[str] = Depends(security)) -> Optional[DBUser]:
    """Get current authenticated user from JWT token"""
    
    # Check if auth is enabled
    auth_enabled = os.getenv("AUTH_ENABLED", "false").lower() == "true"
    if not auth_enabled:
        # Return a default user when auth is disabled
        return DBUser(
            id=str(uuid.uuid4()),
            email="dev@localhost",
            name="Development User",
            role="admin",
            auth_provider="disabled"
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
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    user = db.query(DBUser).filter(DBUser.email == email, DBUser.is_active == True).first()
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    
    return user

@router.get("/config")
async def get_auth_config():
    """Expose auth configuration so the frontend knows whether to require login"""
    auth_enabled = os.getenv("AUTH_ENABLED", "false").lower() == "true"
    return {
        "auth_required": auth_enabled,
        "auth_types": ["local"]
    }

@router.post("/register", response_model=UserResponse)
async def register_user(user_data: UserCreate, db: Session = Depends(get_db)):
    """Register a new local user (disabled for security)"""
    
    # Check if registration is enabled
    registration_enabled = os.getenv("REGISTRATION_ENABLED", "false").lower() == "true"
    if not registration_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Registration is disabled. Contact administrator."
        )
    
    # Check if user already exists
    if db.query(DBUser).filter(DBUser.email == user_data.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # Create new user
    hashed_password = get_password_hash(user_data.password)
    db_user = DBUser(
        email=user_data.email,
        name=user_data.name,
        password_hash=hashed_password,
        auth_provider="local"
    )
    
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    
    return UserResponse(
        id=str(db_user.id),
        email=db_user.email,
        name=db_user.name,
        role=db_user.role,
        auth_provider=db_user.auth_provider,
        created_at=db_user.created_at
    )

@router.post("/login", response_model=Token)
async def login_user(login_data: UserLogin, db: Session = Depends(get_db)):
    """Login user and return JWT token"""
    
    # Find user by email
    user = db.query(DBUser).filter(
        DBUser.email == login_data.email,
        DBUser.is_active == True,
        DBUser.auth_provider == "local"
    ).first()
    
    if not user or not verify_password(login_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Update last login
    user.last_login = datetime.utcnow()
    db.commit()
    
    # Create access token
    access_token_expires = timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    access_token = create_access_token(
        data={"sub": user.email, "role": user.role},
        expires_delta=access_token_expires
    )
    
    return Token(
        access_token=access_token,
        token_type="bearer",
        expires_in=ACCESS_TOKEN_EXPIRE_HOURS * 3600
    )

@router.get("/me", response_model=UserResponse)
async def get_current_user_info(current_user: DBUser = Depends(get_current_user)):
    """Get current user information"""
    
    return UserResponse(
        id=str(current_user.id),
        email=current_user.email,
        name=current_user.name,
        role=current_user.role,
        auth_provider=current_user.auth_provider,
        created_at=current_user.created_at,
        last_login=current_user.last_login
    )

@router.post("/logout")
async def logout_user():
    """Logout user (client should remove token)"""
    return {"message": "Logged out successfully"}