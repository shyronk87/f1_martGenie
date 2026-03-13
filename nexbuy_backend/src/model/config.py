from pydantic_settings import BaseSettings, SettingsConfigDict


class ModelSettings(BaseSettings):
    glm_model_key: str = ""
    glm_model_name: str = "glm-4.7"
    glm_embedding_model_name: str = "embedding-3"
    glm_embedding_dim: int = 2048
    glm_api_base_url: str = "https://open.bigmodel.cn/api/paas/v4/"
    llm_analysis_provider: str = "glm"
    llm_analysis_model: str = "glm-4.7"
    llm_analysis_timeout_seconds: int = 90
    llm_bundle_provider: str = "openrouter"
    llm_bundle_model: str = "minimax/minimax-m2.5"
    llm_bundle_timeout_seconds: int = 30
    llm_buyer_decision_provider: str = "openrouter"
    llm_buyer_decision_model: str = "minimax/minimax-m2.5"
    llm_buyer_decision_timeout_seconds: int = 30
    llm_sell_parser_provider: str = "openrouter"
    llm_sell_parser_model: str = "minimax/minimax-m2.5"
    llm_sell_parser_timeout_seconds: int = 30
    llm_sell_price_provider: str = "openrouter"
    llm_sell_price_model: str = "minimax/minimax-m2.5"
    llm_sell_price_timeout_seconds: int = 30
    llm_sell_reply_provider: str = "openrouter"
    llm_sell_reply_model: str = "minimax/minimax-m2.5"
    llm_sell_reply_timeout_seconds: int = 30
    llm_embedding_provider: str = "glm"
    llm_embedding_model: str = "embedding-3"
    llm_embedding_timeout_seconds: int = 15

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


model_settings = ModelSettings()
