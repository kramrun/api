import sys
from pathlib import Path
from dotenv import load_dotenv

# Добавляем путь к корню проекта
sys.path.append(str(Path(__file__).parent.parent))

# Загружаем .env из корня проекта
dotenv_path = Path(__file__).parent.parent / ".env"
load_dotenv(dotenv_path)

from logging.config import fileConfig
from sqlalchemy import engine_from_config
from sqlalchemy import pool
from alembic import context

# Импортируем модели (чтобы Alembic знал, какие таблицы создавать)
from database.models import Base

# Это метаданные, которые Alembic использует для генерации миграций
target_metadata = Base.metadata

# Интерпретация файла конфигурации для логирования
config = context.config

# Настройка логирования
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Получаем URL базы данных из переменных окружения
# Если в alembic.ini есть sqlalchemy.url, можно взять оттуда,
# но лучше из .env
from database.connection import DATABASE_URL
config.set_main_option("sqlalchemy.url", DATABASE_URL)

def run_migrations_offline() -> None:
    """Запуск миграций в 'офлайн' режиме."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()

def run_migrations_online() -> None:
    """Запуск миграций в 'онлайн' режиме."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata
        )

        with context.begin_transaction():
            context.run_migrations()

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()