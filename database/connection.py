from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///game_library.db")


def make_engine(url: str):
    options = {"pool_pre_ping": True}
    if url.startswith("sqlite"):
        options["connect_args"] = {"check_same_thread": False}
    return create_engine(url, **options)


engine = make_engine(DATABASE_URL)

# The project can be opened immediately in development even when PostgreSQL is
# not installed. Production still uses the DATABASE_URL supplied in .env.
if DATABASE_URL.startswith(("postgresql", "postgres")):
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except OperationalError:
        sqlite_path = Path(__file__).resolve().parent.parent / "game_library.db"
        print(f"PostgreSQL is unavailable; using local SQLite database: {sqlite_path}")
        engine = make_engine(f"sqlite:///{sqlite_path.as_posix()}")

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
