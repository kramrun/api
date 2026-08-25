from typing import Optional
from fastapi import FastAPI, status
from pydantic import BaseModel, Field
from fastapi import HTTPException

class GameLib(BaseModel):
    title: str = Field(min_length=1)
    genre: str
    year: int = Field(ge = 1970, le=2026)
    rating: float = Field(ge=0, le=10)
    completed: bool

class GameResponse(BaseModel):
    id: int
    title: str = Field(min_length=1)
    genre: str
    year: int = Field(ge=1970, le=2026)
    rating: float = Field(ge=0, le=10)
    completed: bool

class GameUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1)
    genre: Optional[str] = Field(None, min_length=1)
    year: Optional[int] = Field(None, ge=1970, le=2026)
    rating: Optional[float] = Field(None, ge=0, le=10)
    completed: Optional[bool] = None

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


@app.put("/games/{game_id}", response_model=GameResponse) # put я делал с ии т.к не знал как его сдлеать
def update_game(game_id: int, game: GameUpdate):
    for this_game in games_db:
        if this_game["id"] == game_id:
            update_data = game.model_dump(exclude_unset=True)
            for key, value in update_data.items():
                this_game[key] = value

            return this_game

    raise HTTPException(status_code=404, detail="Game not found")


@app.patch("/games/{game_id}/complete")
def complete_game(game_id: int):
    for game in games_db:
        if game["id"] == game_id:
            game["completed"] = True

            return game

    raise HTTPException(status_code=404, detail="Game not found")


@app.delete("/games/{game_id}", status_code=status.HTTP_204_NO_CONTENT) # тут я pop сделал с ии потому что забыл как удалять
def delete_game(game_id: int):
    for index, game in enumerate(games_db):
        if game["id"] == game_id:
            games_db.pop(index)

            return None

    raise HTTPException(status_code=404, detail="Game not found")