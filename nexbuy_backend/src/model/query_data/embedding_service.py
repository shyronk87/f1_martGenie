import asyncio
from typing import Any

from src.model.config import model_settings


class EmbeddingService:
    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
    ) -> None:
        key = (api_key or model_settings.glm_model_key).strip()
        if not key:
            raise ValueError("GLM_MODEL_KEY is not set.")
        self._api_key = key
        self._base_url = (base_url or model_settings.glm_api_base_url).strip()
        self._model = (model or model_settings.glm_embedding_model_name).strip()
        self._expected_dim = int(model_settings.glm_embedding_dim or 0)

        try:
            from zai import ZhipuAiClient  # type: ignore
        except ImportError as exc:
            raise ImportError(
                "zai-sdk is required. Install dependencies first (e.g. `uv sync`)."
            ) from exc

        self._sdk_client = ZhipuAiClient(api_key=self._api_key, base_url=self._base_url)

    async def embed_text(self, text: str) -> list[float]:
        vectors = await self.embed_texts([text])
        if not vectors:
            raise RuntimeError("Embedding response is empty.")
        return vectors[0]

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        cleaned = [str(t or "").strip() for t in texts]
        cleaned = [t for t in cleaned if t]
        if not cleaned:
            return []

        def _request() -> Any:
            return self._sdk_client.embeddings.create(
                model=self._model,
                input=cleaned,
            )

        response = await asyncio.to_thread(_request)
        payload = response.model_dump() if hasattr(response, "model_dump") else response
        if not isinstance(payload, dict):
            raise RuntimeError(f"Unexpected embedding response: {payload}")

        data = payload.get("data")
        if not isinstance(data, list):
            raise RuntimeError(f"Embedding response missing data: {payload}")

        vectors: list[list[float]] = []
        for item in data:
            if not isinstance(item, dict):
                continue
            emb = item.get("embedding")
            if not isinstance(emb, list) or not emb:
                continue
            try:
                vectors.append([float(v) for v in emb])
            except (TypeError, ValueError):
                continue

        if len(vectors) != len(cleaned):
            raise RuntimeError(
                f"Embedding vector count mismatch: input={len(cleaned)} output={len(vectors)}"
            )
        if self._expected_dim > 0 and vectors and len(vectors[0]) != self._expected_dim:
            raise RuntimeError(
                f"Embedding dimension mismatch: expected={self._expected_dim}, got={len(vectors[0])}. "
                "Please align glm_embedding_dim and DB vector column size."
            )
        return vectors


def vector_to_literal(vector: list[float]) -> str:
    return "[" + ",".join(f"{float(v):.8f}" for v in vector) + "]"
