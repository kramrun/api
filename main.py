from typing import Optional
from fastapi import FastAPI, status
from pydantic import BaseModel
from fastapi import HTTPException

class GameLib(BaseModel):
    title: str
    genre: str
    year: int
    rating: float
    completed: bool

next_id = 1
games_db = []
app = FastAPI()


the_witcher_3 = {
    "id": next_id,
    "title": "The Witcher 3",
    "genre": "RPG",
    "year": 2015,
    "rating": 9.7,
    "completed": True
}
games_db.append(the_witcher_3)
next_id += 1

spider_man_2 = {
    "id": next_id,
    "title": "Marvel's Spider-Man 2",
    "genre": "Action-adventure",
    "year": 2023,
    "rating": 9.0,
    "completed": False
}
games_db.append(spider_man_2)
next_id += 1

hogwarts_legacy = {
    "id": next_id,
    "title": "Hogwarts Legacy",
    "genre": "RPG",
    "year": 2023,
    "rating": 8.4,
    "completed": True
}
games_db.append(hogwarts_legacy)



@app.get("/games")
def get_games(
    genre: Optional[str] = None,
    completed: Optional[bool] = None
):


    filtred = []
    for game in games_db:
        if game['genre'] == genre and game['completed'] == completed:
            filtred.append(game)
    return filtred

@app.get('/games/{game_id}')
def id_search(
        ident: int
):
    for game in games_db:
        if ident == game['id']:
            return game


    raise HTTPException(status_code=404, detail="404 not found")


@app.post('/games', status_code=status.HTTP_201_CREATED)
def create_game(game: GameLib):
    global next_id

    next_id += 1

    new_game = {
        "id": next_id,
        "title": game.title,
        "genre": game.genre,
        "year": game.year,
        "rating": game.rating,
        "completed": game.completed
    }


    games_db.append(new_game)


    return new_game