from .base import LLMClient
from .glm import GLMClient


def get_llm_client(provider: str = "glm") -> LLMClient:
    provider_key = provider.strip().lower()
    if provider_key == "glm":
        return GLMClient()
    raise ValueError(f"Unsupported LLM provider: {provider}")
