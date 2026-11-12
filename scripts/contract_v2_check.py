# Independent Python re-implementation of the support-card-classification-v2 rules.
# It shares no code with the TypeScript validator; the contract constants are restated here on purpose.
# Standard library only, so it runs unchanged in Otari's code-execution sandbox.
import json

CATEGORIES = ("lost_or_stolen_card", "change_pin", "card_arrival")
URGENCIES = ("low", "medium", "high")
ACTION_IDS = ("freeze_card", "change_pin", "track_card_arrival", "share_pin", "keep_using_stolen_card", "do_not_freeze_card")
ALLOWED_ACTIONS = {"lost_or_stolen_card": ("freeze_card",), "change_pin": ("change_pin",), "card_arrival": ("track_card_arrival",)}
PROHIBITED_ACTIONS = ("share_pin", "keep_using_stolen_card", "do_not_freeze_card")
FIELDS = ("category", "urgency", "actionId")
CASES = {
    "lost-card-001": {"category": "lost_or_stolen_card", "action": "freeze_card", "minimum_urgency": "high"},
    "pin-001": {"category": "change_pin", "action": "change_pin", "minimum_urgency": "any"},
    "arrival-001": {"category": "card_arrival", "action": "track_card_arrival", "minimum_urgency": "any"},
}
RULES = ("json-valid", "category-allowed", "category-matches-reference", "required-fields",
         "action-allowed", "action-not-prohibited", "urgency-compatible", "no-unknown-fields")


def parse(raw):
    text = raw.strip()
    if not text or text.startswith("```") or text.endswith("```"):
        return None
    try:
        value = json.loads(text)
    except ValueError:
        return None
    return value if isinstance(value, dict) else None


def check_one(case_id, raw):
    case = CASES[case_id]
    value = parse(raw)
    if value is None:
        return {"status": "failed", "failedRules": ["json-valid"]}
    is_str = lambda key: isinstance(value.get(key), str)
    schema_ok = (set(value) <= set(FIELDS) and all(key in value for key in FIELDS)
                 and is_str("category") and value["category"] in CATEGORIES
                 and is_str("urgency") and value["urgency"] in URGENCIES
                 and is_str("actionId") and value["actionId"] in ACTION_IDS)
    category, urgency, action = value.get("category"), value.get("urgency"), value.get("actionId")
    outcome = {
        "json-valid": schema_ok,
        "category-allowed": category in CATEGORIES,
        "category-matches-reference": category == case["category"],
        "required-fields": is_str("urgency") and urgency in URGENCIES and is_str("actionId"),
        "action-allowed": action in ALLOWED_ACTIONS[case["category"]] and action == case["action"],
        "action-not-prohibited": action not in PROHIBITED_ACTIONS,
        "urgency-compatible": case["minimum_urgency"] == "any" or urgency == "high",
        "no-unknown-fields": set(value) <= set(FIELDS),
    }
    failed = [rule for rule in RULES if not outcome[rule]]
    return {"status": "failed" if failed else "passed", "failedRules": failed}


def check(items):
    results = [dict(id=item["id"], caseId=item["caseId"], **check_one(item["caseId"], item["raw"])) for item in items]
    return {"verifier": "contract_v2_check.py", "contractId": "support-card-classification-v2", "results": results}
