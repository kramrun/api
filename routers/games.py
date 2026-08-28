from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import Optional
import random

from database.connection import get_db
from database.models import Game
from database.schemas import GameCreate, GameResponse, GameUpdate

router = APIRouter(prefix="/games", tags=["games"])


@router.get("/", response_model=list[GameResponse])
def get_games(
        genre: Optional[str] = None,
        completed: Optional[bool] = None,
        db: Session = Depends(get_db)
):
    """Получить все игры с фильтрацией по жанру и статусу"""
    query = db.query(Game)
    if genre:
        query = query.filter(Game.genre == genre)
    if completed is not None:
        query = query.filter(Game.completed == completed)
    return query.all()


@router.get("/{game_id}", response_model=GameResponse)
def get_game(
        game_id: int,
        db: Session = Depends(get_db)
):
    """Получить игру по ID"""
    game = db.query(Game).filter(Game.id == game_id).first()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    return game


@router.post("/", response_model=GameResponse, status_code=status.HTTP_201_CREATED)
def create_game(
        game: GameCreate,
        db: Session = Depends(get_db)
):
    """Создать новую игру"""
    new_game = Game(**game.model_dump())
    db.add(new_game)
    db.commit()
    db.refresh(new_game)
    return new_game


@router.put("/{game_id}", response_model=GameResponse)
def update_game(
        game_id: int,
        game: GameUpdate,
        db: Session = Depends(get_db)
):
    """Полностью обновить игру"""
    db_game = db.query(Game).filter(Game.id == game_id).first()
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
        db: Session = Depends(get_db)
):
    """Отметить игру как пройденную"""
    db_game = db.query(Game).filter(Game.id == game_id).first()
    if not db_game:
        raise HTTPException(status_code=404, detail="Game not found")

    db_game.completed = True
    db.commit()
    db.refresh(db_game)
    return db_game


@router.delete("/{game_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_game(
        game_id: int,
        db: Session = Depends(get_db)
):
    """Удалить игру"""
    db_game = db.query(Game).filter(Game.id == game_id).first()
    if not db_game:
        raise HTTPException(status_code=404, detail="Game not found")

    db.delete(db_game)
    db.commit()
    return None


@router.get("/recommend", response_model=GameResponse)
def recommend_game(
        min_rating: float = Query(7, ge=0, le=10),
        db: Session = Depends(get_db)
):
    """Получить случайную непройденную игру с рейтингом не ниже min_rating"""
    games = db.query(Game).filter(
        Game.completed == False,
        Game.rating >= min_rating
    ).all()

    if not games:
        raise HTTPException(status_code=404, detail="No recommendations found")

    return random.choice(games)