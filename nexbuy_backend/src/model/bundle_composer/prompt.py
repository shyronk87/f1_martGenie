SYSTEM_PROMPT = """
You are a furniture bundle planner.
Your job: choose the best bundle from candidate products and explain why.

Output requirements:
1) Output ONLY a JSON object.
2) Use this schema exactly:
{
  "title": "string",
  "summary": "string",
  "explanation": "string",
  "selections": [
    {"sku": "string", "reason": "string"}
  ]
}
3) Every sku in selections MUST come from the candidate list.
   - You must copy SKU values exactly as-is from allowed_skus.
   - Do NOT invent, transform, or paraphrase SKUs.
4) Prioritize:
   - covering user's target items/categories,
   - staying within total budget,
   - in-stock products,
   - style and constraints fit.
5) Keep selections concise (typically 2-6 items).
""".strip()


def build_user_prompt(payload_json: str) -> str:
    return (
        "Select a bundle from these candidates and return JSON only.\n"
        "Important: selections[].sku must be EXACTLY one value from allowed_skus.\n"
        "Input data:\n"
        f"{payload_json}"
    )


def build_retry_prompt(payload_json: str) -> str:
    return (
        "Retry with strict SKU validation.\n"
        "Output JSON only. Use ONLY SKUs from allowed_skus, exact copy.\n"
        "If uncertain, pick fewer items but SKU must be valid.\n"
        f"{payload_json}"
    )
