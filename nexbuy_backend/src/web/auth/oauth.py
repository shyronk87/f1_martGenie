from httpx_oauth.clients.google import GoogleOAuth2

from .config import settings


google_oauth_client = GoogleOAuth2(
    settings.google_oauth_client_id,
    settings.google_oauth_client_secret,
)
