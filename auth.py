from sqlalchemy.orm import Session
from sqlalchemy.sql import exists

from .models import Home, collaborators_table


class PermissionDeniedError(Exception):
    """Custom exception for authorization failures."""
    pass


class HomeNotFoundError(Exception):
    """Custom exception for when a home is not found."""
    pass


def set_active_home(db_session: Session, user_id: str, home_id: str) -> Home:
    """
    Verifies a user has permission to access a home and returns the home object.

    This function acts as the primary authorization gate before any home-specific
    queries are executed. It checks for both ownership and collaboration.

    Args:
        db_session: The SQLAlchemy session object.
        user_id: The ID of the user attempting to access the home.
        home_id: The ID of the home being accessed.

    Returns:
        The Home object if access is permitted.

    Raises:
        HomeNotFoundError: If no home with the given home_id exists.
        PermissionDeniedError: If the user is not the owner and not a collaborator.
    """
    home = db_session.query(Home).filter(Home.id == home_id).first()

    if not home:
        raise HomeNotFoundError(f"Home with ID '{home_id}' not found.")

    # 1. Check if the user is the owner of the home.
    if str(home.owner_id) == user_id:
        # In a real application, you would set this home in a user's session state.
        return home

    # 2. If not the owner, check if they are a collaborator.
    is_collaborator = db_session.query(
        exists().where(
            collaborators_table.c.user_id == user_id,
            collaborators_table.c.home_id == home_id,
        )
    ).scalar()

    if is_collaborator:
        # In a real application, you would set this home in a user's session state.
        return home

    # 3. If neither, deny access.
    raise PermissionDeniedError(
        f"User '{user_id}' does not have permission to access home '{home_id}'."
    )