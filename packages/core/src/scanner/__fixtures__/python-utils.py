"""Utility functions."""

__all__ = ["parse_date", "format_currency"]

MAX_RETRIES = 3
_INTERNAL_CACHE = {}


def parse_date(date_str: str):
    """Parse a date string."""
    return date_str


def format_currency(amount: float) -> str:
    return f"${amount:.2f}"


def _internal_helper():
    """Private helper — not in __all__."""
    pass
