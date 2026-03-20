from src.model.user_content_analysis.analyzer import _normalize


def test_single_item_budget_promotes_to_total_budget() -> None:
    result = _normalize(
        {
            "total_budget": None,
            "currency": "USD",
            "style_preference": "Modern Minimalist",
            "room_type": "Bedroom",
            "hard_constraints": [],
            "target_items": [
                {
                    "category": "bedside lamp",
                    "quantity": 1,
                    "item_budget_allocation": 180,
                    "specific_features": ["soft ambient light"],
                }
            ],
            "is_ready": False,
            "missing_fields": ["total_budget"],
            "agent_reply": "",
        }
    )

    assert result.total_budget == 180
    assert result.is_ready is True
    assert result.missing_fields == []


def test_item_budgets_sum_into_total_budget_when_all_items_have_budget() -> None:
    result = _normalize(
        {
            "total_budget": None,
            "currency": "USD",
            "style_preference": "Modern Minimalist",
            "room_type": "Living room",
            "hard_constraints": [],
            "target_items": [
                {
                    "category": "sofa",
                    "quantity": 1,
                    "item_budget_allocation": 900,
                    "specific_features": [],
                },
                {
                    "category": "coffee table",
                    "quantity": 1,
                    "item_budget_allocation": 250,
                    "specific_features": [],
                },
            ],
            "is_ready": False,
            "missing_fields": ["total_budget"],
            "agent_reply": "",
        }
    )

    assert result.total_budget == 1150
    assert result.is_ready is True
    assert result.missing_fields == []
