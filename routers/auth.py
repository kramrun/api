import base64
import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

try:
    from ..database.connection import get_db
    from ..database.models import AuthSession, User
    from ..database.schemas import AuthCredentials, TokenResponse, UserResponse
except ImportError:
    from database.connection import get_db
    from database.models import AuthSession, User
    from database.schemas import AuthCredentials, TokenResponse, UserResponse


router = APIRouter(prefix="/auth", tags=["auth"])
bearer = HTTPBearer(auto_error=False)
SESSION_LIFETIME = timedelta(days=7)
PBKDF2_ITERATIONS = 310_000


@dataclass
class CurrentSession:
    user: User
    session: AuthSession


def _password_hash(password: str, salt: bytes) -> str:
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS
    )
    return base64.urlsafe_b64encode(digest).decode("ascii")


def _issue_token(user: User, db: Session) -> str:
    token = secrets.token_urlsafe(32)
    db.add(AuthSession(
        token_hash=hashlib.sha256(token.encode("utf-8")).hexdigest(),
        user_id=user.id,
        expires_at=datetime.utcnow() + SESSION_LIFETIME,
    ))
    db.commit()
    return token


def get_current_session(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    db: Session = Depends(get_db),
) -> CurrentSession:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Authentication required")
    token_hash = hashlib.sha256(credentials.credentials.encode("utf-8")).hexdigest()
    auth_session = db.query(AuthSession).filter(AuthSession.token_hash == token_hash).first()
    if auth_session is None or auth_session.expires_at <= datetime.utcnow():
        if auth_session is not None:
            db.delete(auth_session)
            db.commit()
        raise HTTPException(status_code=401, detail="Session expired")
    user = db.query(User).filter(User.id == auth_session.user_id).first()
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    return CurrentSession(user=user, session=auth_session)


def get_current_user(current: CurrentSession = Depends(get_current_session)) -> User:
    return current.user


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(credentials: AuthCredentials, db: Session = Depends(get_db)):
    username = credentials.username.strip().lower()
    if len(username) < 3:
        raise HTTPException(status_code=422, detail="Username is too short")
    salt = secrets.token_bytes(16)
    user = User(
        username=username,
        password_salt=base64.urlsafe_b64encode(salt).decode("ascii"),
        password_hash=_password_hash(credentials.password, salt),
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Username already exists")
    db.refresh(user)
    return TokenResponse(access_token=_issue_token(user, db), user=user)


@router.post("/login", response_model=TokenResponse)
def login(credentials: AuthCredentials, db: Session = Depends(get_db)):
    username = credentials.username.strip().lower()
    user = db.query(User).filter(User.username == username).first()
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    salt = base64.urlsafe_b64decode(user.password_salt.encode("ascii"))
    if not hmac.compare_digest(_password_hash(credentials.password, salt), user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    return TokenResponse(access_token=_issue_token(user, db), user=user)


@router.get("/me", response_model=UserResponse)
def me(user: User = Depends(get_current_user)):
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(current: CurrentSession = Depends(get_current_session), db: Session = Depends(get_db)):
    db.delete(current.session)
    db.commit()
    return None
