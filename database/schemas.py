from pydantic import BaseModel, Field
from typing import Optional


class GameCreate(BaseModel):
    title: str = Field(min_length=1)
    genre: str
    year: int = Field(ge=1970, le=2026)
    rating: float = Field(ge=0, le=10)
    completed: bool = False


class GameUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1)
    genre: Optional[str] = None
    year: Optional[int] = Field(None, ge=1970, le=2026)
    rating: Optional[float] = Field(None, ge=0, le=10)
    completed: Optional[bool] = None


class GameResponse(BaseModel):
    id: int
    title: str
    genre: str
    year: int
    rating: float
    completed: bool

    class Config:
        from_attributes = True


class AuthCredentials(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=8, max_length=128)


class UserResponse(BaseModel):
    id: int
    username: str

    class Config:
        from_attributes = True


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse
