from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "martgennie-auth"
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/nexbuy_auth"
    jwt_secret: str = "change-this-secret"
    access_token_lifetime_seconds: int = 3600
    frontend_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    google_oauth_frontend_redirect_url: str = "http://localhost:3000/auth/callback"
    google_oauth_client_id: str = ""
    google_oauth_client_secret: str = ""
    apple_oauth_frontend_redirect_url: str = "http://localhost:3000/auth/callback"
    apple_oauth_client_id: str = ""
    apple_oauth_team_id: str = ""
    apple_oauth_key_id: str = ""
    apple_oauth_private_key: str = ""
    apple_oauth_redirect_uri: str = "http://localhost:8000/api/auth/apple/callback"
    apple_oauth_scope: str = "name email"
    apple_oauth_response_mode: str = "query"
    oauth_state_secret: str = "change-this-oauth-state-secret"
    oauth_csrf_cookie_secure: bool = False

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.frontend_origins.split(",") if origin.strip()]


settings = Settings()
