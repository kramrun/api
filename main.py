from typing import Optional
from fastapi import FastAPI, status, Depends, Query, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path
from pydantic import BaseModel, Field
import random
if __package__:
    from .routers import games
    from .database.connection import engine
    from .database.models import Base
    from .database.connection import get_db
    from .database.models import Game
    from .database.schemas import GameCreate, GameResponse, GameUpdate
else:
    # Allows PyCharm to run this file directly as well as Uvicorn to import API.main.
    from routers import games
    from database.connection import engine, get_db
    from database.models import Base, Game
    from database.schemas import GameCreate, GameResponse, GameUpdate
from sqlalchemy.orm import Session

Base.metadata.create_all(bind=engine)


app = FastAPI(title="Game Library", version="1.0.0")
app.include_router(games.router)

FRONTEND_DIR = Path(__file__).parent / "frontend"
app.mount("/assets", StaticFiles(directory=FRONTEND_DIR), name="assets")


@app.get("/", include_in_schema=False)
def frontend():
    return FileResponse(FRONTEND_DIR / "index.html")



@app.get("/games")
def get_games(
    genre: Optional[str] = None,
    completed: Optional[bool] = None,
    db: Session = Depends(get_db)
):
    query = db.query(Game) #я большую часть делаю с ии и разбираю каждую команду как я понял ты сохраняешь логику приложения просто меняешь строение блоков обрщаясь не к спискам а к db
    if genre:
        query = query.filter(Game.genre == genre)
    if completed is not None:
        query = query.filter(Game.completed == completed)
    return query.all()


@app.get('/games/{game_id}')
def id_search(
        game_id: int,db: Session = Depends(get_db)
):
    game = db.query(Game).filter(Game.id == game_id).first()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    return game


@app.post("/games", status_code=status.HTTP_201_CREATED)
def create_game(game: GameCreate, db: Session = Depends(get_db)):
    new_game = Game(**game.model_dump())
    db.add(new_game)
    db.commit()
    db.refresh(new_game)
    return new_game


@app.put("/games/{game_id}", response_model=GameResponse) # put я делал с ии т.к не знал как его сдлеать
def update_game(game_id: int, game: GameUpdate, db: Session = Depends(get_db)):
    db_game = db.query(Game).filter(Game.id == game_id).first()
    if not db_game:
        raise HTTPException(status_code=404, detail="Game not found")
    update_data = game.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_game, key, value)
    db.commit()
    db.refresh(db_game)
    return db_game


@app.patch("/games/{game_id}/complete")
def complete_game(game_id: int, db: Session = Depends(get_db)):
    db_game = db.query(Game).filter(Game.id == game_id).first()
    if not db_game:
        raise HTTPException(status_code=404, detail="Game not found")

    db_game.completed = True
    db.commit()
    db.refresh(db_game)
    return db_game


@app.delete("/games/{game_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_game(game_id: int, db: Session = Depends(get_db)):
    db_game = db.query(Game).filter(Game.id == game_id).first()
    if not db_game:
        raise HTTPException(status_code=404, detail="Game not found")
    db.delete(db_game)
    db.commit()
    return None

@app.get("/games/recommend")
def recommend(min_rating: float = Query(7, ge=0, le=10), db: Session = Depends(get_db)): # вот тут я минимальный рейтинг сделал с ии потому что не знал как проверку сделать с бд через цикл
    games = db.query(Game).filter(
Game.completed == False,
        Game.rating >= min_rating
    ).all()
    if not games:
        raise HTTPException(status_code=404, detail="No recommendations found")

    return random.choice(games)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
