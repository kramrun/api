from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session
from typing import Optional
import random

try:
    from ..database.connection import get_db
    from ..database.models import Game, User
    from ..database.schemas import GameCreate, GameResponse, GameUpdate, RatingResponse
    from .auth import get_current_user
except ImportError:  # Direct execution of main.py from the API directory.
    from database.connection import get_db
    from database.models import Game, User
    from database.schemas import GameCreate, GameResponse, GameUpdate, RatingResponse
    from routers.auth import get_current_user

router = APIRouter(
    prefix="/games",
    tags=["games"],
    dependencies=[Depends(get_current_user)],
)


@router.get("/", response_model=list[GameResponse])
def get_games(
        genre: Optional[str] = None,
        completed: Optional[bool] = None,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db)
):
    """Получить все игры с фильтрацией по жанру и статусу"""
    query = db.query(Game).filter(Game.owner_id == current_user.id)
    if genre:
        query = query.filter(Game.genre == genre)
    if completed is not None:
        query = query.filter(Game.completed == completed)
    return query.all()


@router.post("/", response_model=GameResponse, status_code=status.HTTP_201_CREATED)
def create_game(
        game: GameCreate,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db)
):
    """Создать новую игру"""
    new_game = Game(**game.model_dump(), owner_id=current_user.id)
    db.add(new_game)
    db.commit()
    db.refresh(new_game)
    return new_game


@router.put("/{game_id}", response_model=GameResponse)
def update_game(
        game_id: int,
        game: GameUpdate,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db)
):
    """Полностью обновить игру"""
    db_game = db.query(Game).filter(
        Game.id == game_id,
        Game.owner_id == current_user.id,
    ).first()
    if not db_game:
        raise HTTPException(status_code=404, detail="Game not found")

    update_data = game.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_game, key, value)

    db.commit()
    db.refresh(db_game)
    return db_game


@router.patch("/{game_id}/complete", response_model=GameResponse)
def complete_game(
        game_id: int,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db)
):
    """Отметить игру как пройденную"""
    db_game = db.query(Game).filter(
        Game.id == game_id,
        Game.owner_id == current_user.id,
    ).first()
    if not db_game:
        raise HTTPException(status_code=404, detail="Game not found")

    db_game.completed = True
    db.commit()
    db.refresh(db_game)
    return db_game


@router.delete("/{game_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_game(
        game_id: int,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db)
):
    """Удалить игру"""
    db_game = db.query(Game).filter(
        Game.id == game_id,
        Game.owner_id == current_user.id,
    ).first()
    if not db_game:
        raise HTTPException(status_code=404, detail="Game not found")

    db.delete(db_game)
    db.commit()
    return None


@router.get("/ratings", response_model=list[RatingResponse])
def get_ratings(
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db)
):
    """Общий обезличенный рейтинг игр всех пользователей."""
    normalized_title = func.lower(func.trim(Game.title)).label("title_key")
    user_ratings = db.query(
        Game.owner_id.label("owner_id"),
        normalized_title,
        func.max(Game.title).label("title"),
        func.avg(Game.rating).label("user_rating"),
    ).filter(
        Game.owner_id.isnot(None)
    ).group_by(
        Game.owner_id,
        normalized_title,
    ).subquery()

    average_rating = func.round(func.avg(user_ratings.c.user_rating), 2).label("average_rating")
    votes = func.count().label("votes")
    return db.query(
        user_ratings.c.title_key,
        func.max(user_ratings.c.title).label("title"),
        average_rating,
        votes,
    ).group_by(
        user_ratings.c.title_key,
    ).order_by(
        average_rating.desc(),
        votes.desc(),
        func.max(user_ratings.c.title).asc(),
    ).limit(100).all()


@router.get("/recommend", response_model=GameResponse)
def recommend_game(
        min_rating: float = Query(7, ge=0, le=10),
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db)
):
    """Получить случайную непройденную игру с рейтингом не ниже min_rating"""
    games = db.query(Game).filter(
        Game.owner_id == current_user.id,
        Game.completed == False,
        Game.rating >= min_rating
    ).all()

    if not games:
        raise HTTPException(status_code=404, detail="No recommendations found")

    return random.choice(games)


@router.get("/{game_id}", response_model=GameResponse)
def get_game(
        game_id: int,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db)
):
    """Получить игру по ID"""
    game = db.query(Game).filter(
        Game.id == game_id,
        Game.owner_id == current_user.id,
    ).first()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    return game
