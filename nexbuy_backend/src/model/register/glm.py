import asyncio
from typing import Any

from .base import ChatMessage, ChatResult
from ..config import model_settings


class GLMClient:
    """SDK client for Zhipu GLM chat completions API."""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        model: str | None = None,
        base_url: str | None = None,
    ) -> None:
        self.api_key = (api_key or model_settings.glm_model_key).strip()
        if not self.api_key:
            raise ValueError("GLM_MODEL_KEY is not set.")

        self.model = (model or model_settings.glm_model_name).strip()
        self.base_url = (base_url or model_settings.glm_api_base_url).strip()

        try:
            from zai import ZhipuAiClient  # type: ignore
        except ImportError as exc:
            raise ImportError(
                "zai-sdk is required. Install dependencies first (e.g. `uv sync`)."
            ) from exc

        self._sdk_client = ZhipuAiClient(api_key=self.api_key, base_url=self.base_url)

    async def chat(
        self,
        messages: list[ChatMessage],
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> ChatResult:
        def _request() -> Any:
            kwargs: dict[str, Any] = {
                "model": self.model,
                "messages": messages,
                "stream": False,
            }
            if temperature is not None:
                kwargs["temperature"] = temperature
            if max_tokens is not None:
                kwargs["max_tokens"] = max_tokens
            return self._sdk_client.chat.completions.create(**kwargs)

        response = await asyncio.to_thread(_request)

        if hasattr(response, "model_dump"):
            data = response.model_dump()  # pydantic model
        elif isinstance(response, dict):
            data = response
        else:
            data = {"raw": str(response)}

        choices = data.get("choices") or []
        if not choices:
            raise RuntimeError(f"GLM API response missing choices: {data}")

        first_choice = choices[0]
        if isinstance(first_choice, dict):
            message = first_choice.get("message") or {}
            content = message.get("content")
        else:
            message = getattr(first_choice, "message", None)
            content = getattr(message, "content", None) if message is not None else None

        if not isinstance(content, str) or not content.strip():
            raise RuntimeError(f"GLM API response missing content: {data}")

        return ChatResult(content=content, raw_response=data)
