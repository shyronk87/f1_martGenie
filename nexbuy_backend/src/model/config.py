from pydantic_settings import BaseSettings, SettingsConfigDict


class ModelSettings(BaseSettings):
    glm_model_key: str = ""
    glm_model_name: str = "glm-5"
    glm_embedding_model_name: str = "embedding-3"
    glm_embedding_dim: int = 2048
    glm_api_base_url: str = "https://open.bigmodel.cn/api/paas/v4/"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


model_settings = ModelSettings()
