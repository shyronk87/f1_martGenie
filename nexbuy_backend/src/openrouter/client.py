from typing import Any

import httpx

from src.model.register.base import ChatMessage, ChatResult

from .config import openrouter_settings

OPENROUTER_REQUEST_TIMEOUT_SECONDS = 30


class OpenRouterClient:
    """OpenAI-compatible client for OpenRouter chat completions."""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        model: str | None = None,
        base_url: str | None = None,
        http_referer: str | None = None,
        app_title: str | None = None,
    ) -> None:
        self.api_key = (api_key or openrouter_settings.api_key).strip()
        if not self.api_key:
            raise ValueError("OPENROUTER_API_KEY is not set.")

        self.model = (model or openrouter_settings.model_name).strip()
        self.base_url = (
            base_url or openrouter_settings.base_url
        ).strip().rstrip("/")
        self.http_referer = (
            http_referer or openrouter_settings.http_referer
        ).strip()
        self.app_title = (app_title or openrouter_settings.app_title).strip()

    async def chat(
        self,
        messages: list[ChatMessage],
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
        timeout_seconds: int | None = None,
    ) -> ChatResult:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        if self.http_referer:
            headers["HTTP-Referer"] = self.http_referer
        if self.app_title:
            headers["X-Title"] = self.app_title

        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
        }
        if temperature is not None:
            payload["temperature"] = temperature
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens

        async with httpx.AsyncClient(
            timeout=timeout_seconds or OPENROUTER_REQUEST_TIMEOUT_SECONDS
        ) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                headers=headers,
                json=payload,
            )
            if response.is_error:
                raise RuntimeError(
                    f"OpenRouter error {response.status_code}: {response.text}"
                )
            data = response.json()

        choices = data.get("choices") or []
        if not choices:
            raise RuntimeError(f"OpenRouter response missing choices: {data}")

        first_choice = choices[0]
        if not isinstance(first_choice, dict):
            raise RuntimeError(f"OpenRouter response choice is invalid: {data}")

        message = first_choice.get("message") or {}
        content = message.get("content")
        if not isinstance(content, str) or not content.strip():
            finish_reason = first_choice.get("finish_reason")
            provider = data.get("provider")
            model = data.get("model")
            usage = data.get("usage")
            raise RuntimeError(
                "OpenRouter returned an empty completion "
                f"(provider={provider}, model={model}, finish_reason={finish_reason}, usage={usage})."
            )

        return ChatResult(content=content, raw_response=data)
