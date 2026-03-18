from .users import current_active_user, current_superuser, fastapi_users


CurrentActiveUser = current_active_user
CurrentSuperuser = current_superuser
OptionalCurrentActiveUser = fastapi_users.current_user(optional=True, active=True)
