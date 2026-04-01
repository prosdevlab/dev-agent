"""User service with realistic Python patterns."""

from typing import Optional


class UserService:
    """Service for managing users.

    Provides CRUD operations for the user database.
    Handles authentication and authorization checks.

    Attributes:
        db: Database connection instance.
        cache_ttl: Cache time-to-live in seconds.
    """

    DEFAULT_CACHE_TTL = 300

    def __init__(self, db, cache_ttl: int = 300):
        """Initialize the user service.

        Args:
            db: Database connection.
            cache_ttl: Cache TTL in seconds.
        """
        self.db = db
        self.cache_ttl = cache_ttl

    @property
    def is_connected(self) -> bool:
        """Check if the database connection is active."""
        return self.db.is_alive()

    @classmethod
    def from_config(cls, config: dict) -> "UserService":
        """Create a UserService from a configuration dictionary.

        Args:
            config: Dictionary with 'db_url' and optional 'cache_ttl'.

        Returns:
            Configured UserService instance.
        """
        db = connect(config["db_url"])
        return cls(db, cache_ttl=config.get("cache_ttl", 300))

    @staticmethod
    def validate_email(email: str) -> bool:
        """Validate an email address format."""
        return "@" in email and "." in email

    async def get_user(self, user_id: int) -> Optional[dict]:
        """Fetch a user by ID.

        Args:
            user_id: The user's unique identifier.

        Returns:
            User dictionary if found, None otherwise.

        Raises:
            ConnectionError: If database is unavailable.
        """
        cached = self._check_cache(user_id)
        if cached:
            return cached
        return await self.db.query("SELECT * FROM users WHERE id = ?", user_id)

    def _check_cache(self, user_id: int) -> Optional[dict]:
        """Private: check the in-memory cache."""
        return None
