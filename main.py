from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path
if __package__:
    from .routers import auth, games
    from .database.connection import engine
    from .database.models import Base
else:
    from routers import auth, games
    from database.connection import engine
    from database.models import Base

Base.metadata.create_all(bind=engine)


app = FastAPI(title="Game Library", version="1.0.0")
app.include_router(auth.router)
app.include_router(games.router)

FRONTEND_DIR = Path(__file__).parent / "frontend"
app.mount("/assets", StaticFiles(directory=FRONTEND_DIR), name="assets")


@app.get("/", include_in_schema=False)
def frontend():
    return FileResponse(FRONTEND_DIR / "index.html")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
