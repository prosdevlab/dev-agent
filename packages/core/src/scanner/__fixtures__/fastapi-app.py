"""FastAPI application for user management."""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional

app = FastAPI()

MAX_USERS = 1000


class User(BaseModel):
    """User data model."""
    name: str
    email: str
    age: Optional[int] = None


@app.get("/users/{user_id}")
async def get_user(user_id: int) -> User:
    """Fetch a user by ID."""
    user = await db.get(user_id)
    if not user:
        raise HTTPException(status_code=404)
    return user


def _validate_email(email: str) -> bool:
    """Private helper for email validation."""
    return "@" in email
