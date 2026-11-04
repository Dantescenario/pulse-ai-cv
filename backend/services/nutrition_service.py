"""Nutrition catalogue, portion arithmetic and honest photo estimates."""
import base64
import json
import os
from functools import lru_cache
from pathlib import Path
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[2]
MACROS = ("calories", "protein_g", "carbs_g", "fat_g", "fiber_g")

class Portion(BaseModel):
    food_id: str = Field(min_length=1, max_length=120)
    grams: float = Field(gt=0, le=10000, allow_inf_nan=False)

class Calculation(BaseModel):
    items: list[Portion] = Field(min_length=1, max_length=50)
    meal_name: str = Field(default="My meal", min_length=1, max_length=200)

class VisionItem(BaseModel):
    item: str = Field(min_length=1, max_length=200)
    grams: float = Field(gt=0, le=10000, allow_inf_nan=False)
    calories: float = Field(ge=0, le=100000, allow_inf_nan=False)
    protein_g: float = Field(ge=0, le=10000, allow_inf_nan=False)
    carbs_g: float = Field(ge=0, le=10000, allow_inf_nan=False)
    fat_g: float = Field(ge=0, le=10000, allow_inf_nan=False)
    fiber_g: float = Field(default=0, ge=0, le=10000, allow_inf_nan=False)

class VisionMeal(BaseModel):
    meal_name: str = Field(min_length=1, max_length=200)
    ingredients: list[VisionItem] = Field(min_length=1, max_length=30)


def normalize_food(food):
    nutrients = {n["nutrient"]["id"]: n.get("amount") for n in food.get("foodNutrients", []) if n and n.get("nutrient")}
    # Specific Atwater energy takes precedence, then general, then legacy kcal.
    energy = next((nutrients[k] for k in (2048, 2047, 1008) if nutrients.get(k) is not None), None)
    if energy is None:
        return None
    return {"id": "usda-" + str(food["fdcId"]), "name": food["description"],
            "aliases": [], "serving_g": 100, "serving_label": "100 g",
            "calories": energy, "protein_g": nutrients.get(1003) or 0,
            "carbs_g": nutrients.get(1005) or 0, "fat_g": nutrients.get(1004) or 0,
            "fiber_g": nutrients.get(1079) or 0, "estimated": False,
            "source": "USDA FoodData Central", "source_url": f"https://fdc.nal.usda.gov/food-details/{food['fdcId']}/nutrients"}

class CatalogueUnavailable(RuntimeError):
    code = 'NUTRITION_CATALOGUE_UNAVAILABLE'
    message = 'Nutrition catalogue is unavailable. This portfolio release does not bundle nutrition datasets.'

    def __init__(self):
        super().__init__(self.message)


@lru_cache(maxsize=1)
def catalogue():
    try:
        foods = _load_catalogue()
        if not foods:
            raise CatalogueUnavailable()
        return foods
    except (OSError, ValueError, KeyError, TypeError):
        raise CatalogueUnavailable() from None


def _load_catalogue():
    foods = {}
    for path in sorted(ROOT.glob("FoodData_Central*json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        for rows in data.values():
            if not isinstance(rows, list):
                continue
            for row in rows:
                if row and row.get("description"):
                    food = normalize_food(row)
                    if food:
                        foods[food["id"]] = food
    online = ROOT / "backend/data/usda_online.json"
    if online.exists():
        for row in json.loads(online.read_text(encoding="utf-8")):
            food = normalize_food(row)
            if food:
                foods.setdefault(food["id"], food)
    for row in json.loads((ROOT / "backend/data/indian_foods.json").read_text(encoding="utf-8")):
        foods[row["id"]] = row
    return foods


def search_foods(query="", limit=30):
    tokens = query.casefold().split()
    rows = [f for f in catalogue().values() if all(t in (f["name"] + " " + " ".join(f.get("aliases", []))).casefold() for t in tokens)]
    rows.sort(key=lambda f: (not f["id"].startswith("indian-"), f["name"]))
    return {"foods": rows[:limit], "matches": len(rows), "catalogue_size": len(catalogue())}


def calculate_meal(request):
    ingredients = []
    for portion in request.items:
        food = catalogue().get(portion.food_id)
        if food is None:
            raise ValueError(f"Unknown food: {portion.food_id}")
        ingredients.append({"food_id": food["id"], "item": food["name"], "grams": portion.grams,
                            "portion": f"{portion.grams:g} g", "source": food["source"],
                            "source_url": food["source_url"], "estimated": food["estimated"],
                            **{k: round(food[k] * portion.grams / 100, 2) for k in MACROS}})
    return summarize(request.meal_name, ingredients, "Food catalogue")


def summarize(name, ingredients, engine):
    return {"meal_name": name, "ingredients": ingredients,
            **{k: round(sum(i[k] for i in ingredients), 2) for k in MACROS},
            "ai_engine": engine, "fitness_verdict": "Review food identities and portions before logging. Recipes, oil and serving sizes change nutrition."}


def analyze_food_image(image_base64):
    if not image_base64 or len(image_base64) > 11500000:
        raise ValueError("Provide a JPEG, PNG or WebP image up to 8 MB.")
    mime = "image/jpeg"
    encoded = image_base64
    if image_base64.startswith("data:"):
        header, encoded = image_base64.split(",", 1)
        mime = header[5:].split(";")[0]
    try:
        raw = base64.b64decode(encoded, validate=True)
    except Exception:
        raise ValueError("Invalid base64 image.") from None
    actual = "image/jpeg" if raw.startswith(b"\xff\xd8\xff") else "image/png" if raw.startswith(b"\x89PNG\r\n\x1a\n") else "image/webp" if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP" else None
    if not actual or actual != mime or len(raw) > 8 * 1024 * 1024:
        raise ValueError("Use a valid JPEG, PNG or WebP image up to 8 MB.")
    from services.food_model import classify
    predictions = classify(raw)
    result = summarize("Photo food suggestions", [], "Local Food-101 classifier")
    result["predictions"] = predictions
    result["estimate_notice"] = "Possible foods: " + ", ".join(p["label"] for p in predictions) + ". Choose the matching catalogue food and enter its weight. This classifier cannot measure portions, separate a mixed plate, or reliably reject non-food images."
    return result
