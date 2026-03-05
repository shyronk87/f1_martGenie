from .models import User


async def after_user_registered(_: User) -> None:
    """Hook for custom side effects after registration."""
    return None
