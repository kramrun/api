"""Add authentication tables and game ownership.

Revision ID: a8416c982f10
Revises: e3ba5f8cb0d2
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a8416c982f10"
down_revision: Union[str, Sequence[str], None] = "e3ba5f8cb0d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(length=50), nullable=False),
        sa.Column("password_hash", sa.String(), nullable=False),
        sa.Column("password_salt", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("username"),
    )
    op.create_index("ix_users_id", "users", ["id"], unique=False)
    op.create_index("ix_users_username", "users", ["username"], unique=True)
    op.create_table(
        "auth_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index("ix_auth_sessions_expires_at", "auth_sessions", ["expires_at"], unique=False)
    op.create_index("ix_auth_sessions_token_hash", "auth_sessions", ["token_hash"], unique=True)
    op.add_column("games", sa.Column("owner_id", sa.Integer(), nullable=True))
    op.create_foreign_key("fk_games_owner_id_users", "games", "users", ["owner_id"], ["id"], ondelete="CASCADE")
    op.create_index("ix_games_owner_id", "games", ["owner_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_games_owner_id", table_name="games")
    op.drop_constraint("fk_games_owner_id_users", "games", type_="foreignkey")
    op.drop_column("games", "owner_id")
    op.drop_index("ix_auth_sessions_token_hash", table_name="auth_sessions")
    op.drop_index("ix_auth_sessions_expires_at", table_name="auth_sessions")
    op.drop_table("auth_sessions")
    op.drop_index("ix_users_username", table_name="users")
    op.drop_index("ix_users_id", table_name="users")
    op.drop_table("users")
