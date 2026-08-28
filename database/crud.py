from sqlalchemy.orm import Session
from database.models import Game
from database.schemas import GameCreate, GameUpdate

def get_games(db: Session, genre: str = None, completed: bool = None):
    query = db.query(Game)
    if genre:
        query = query.filter(Game.genre == genre)
    if completed is not None:
        query = query.filter(Game.completed == completed)
    return query.all()

def get_game_by_id(db: Session, game_id: int):
    return db.query(Game).filter(Game.id == game_id).first()

def create_game(db: Session, game: GameCreate):
    db_game = Game(**game.model_dump())
    db.add(db_game)
    db.commit()
    db.refresh(db_game)
    return db_game

def update_game(db: Session, game_id: int, game: GameUpdate):
    db_game = get_game_by_id(db, game_id)
    if db_game:
        for key, value in game.model_dump(exclude_unset=True).items():
            setattr(db_game, key, value)
        db.commit()
        db.refresh(db_game)
    return db_game

def delete_game(db: Session, game_id: int):
    db_game = get_game_by_id(db, game_id)
    if db_game:
        db.delete(db_game)
        db.commit()
        return True
    return False

def get_recommendations(db: Session, min_rating: int):
    return db.query(Game).filter(
        Game.completed == False,
        Game.rating >= min_rating
    ).all()