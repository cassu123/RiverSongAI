import json
import re
import html
from typing import Any, Dict, List, Optional
from fractions import Fraction

_UNITS = {
    "cup", "cups", "c", "tablespoon", "tablespoons", "tbsp", "tbsps", "tbs",
    "teaspoon", "teaspoons", "tsp", "tsps", "pound", "pounds", "lb", "lbs",
    "ounce", "ounces", "oz", "gram", "grams", "g", "kilogram", "kilograms", "kg",
    "liter", "liters", "l", "ml", "milliliter", "milliliters", "quart", "quarts",
    "qt", "pint", "pints", "pt", "gallon", "gallons", "package", "packages", "pkg",
    "can", "cans", "jar", "jars", "slice", "slices", "piece", "pieces", "bunch",
    "bunches", "clove", "cloves", "stalk", "stalks", "head", "heads", "pinch",
    "pinches", "dash", "dashes", "handful", "inch", "inches", "strip", "strips",
    "sprig", "sprigs", "sheet", "sheets", "link", "links", "fillet", "fillets",
}

_UNICODE_FRACS = {
    "½": "1/2", "⅓": "1/3", "⅔": "2/3", "¼": "1/4",
    "¾": "3/4", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8",
}

_MEAL_TYPE_MAP = {
    "breakfast": "Breakfast", "brunch": "Breakfast",
    "lunch": "Lunch",
    "dinner": "Dinner", "main course": "Dinner", "main dish": "Dinner", "entree": "Dinner",
    "snack": "Snack", "appetizer": "Snack", "starter": "Snack",
    "dessert": "Dessert", "sweet": "Dessert", "baking": "Dessert",
}

_PROTEIN_MAP = {
    "chicken": "Chicken",
    "beef": "Beef",
    "steak": "Beef",
    "pork": "Pork",
    "bacon": "Pork",
    "ham": "Pork",
    "fish": "Fish",
    "salmon": "Fish",
    "cod": "Fish",
    "tuna": "Fish",
    "shrimp": "Seafood",
    "prawn": "Seafood",
    "crab": "Seafood",
    "lobster": "Seafood",
    "turkey": "Turkey",
    "lamb": "Lamb",
    "tofu": "Vegetarian",
    "paneer": "Vegetarian",
    "egg": "Vegetarian",
}

def _detect_protein(title: str, ingredients: List[dict]) -> Optional[str]:
    """Identify the primary protein from recipe title or ingredient names."""
    # 1. Check title first (highest weight)
    title_lower = title.lower()
    for key, val in _PROTEIN_MAP.items():
        if key in title_lower:
            return val

    # 2. Check ingredients
    for ing in ingredients:
        name_lower = ing.get("name", "").lower()
        for key, val in _PROTEIN_MAP.items():
            if key in name_lower:
                return val

    return None

_METRIC_TO_IMPERIAL = {
    "g": ("oz", 0.035274),
    "gram": ("ounce", 0.035274),
    "grams": ("ounces", 0.035274),
    "kg": ("lb", 2.20462),
    "kilogram": ("pound", 2.20462),
    "kilograms": ("pounds", 2.20462),
    "ml": ("fl oz", 0.033814),
    "milliliter": ("fluid ounce", 0.033814),
    "milliliters": ("fluid ounces", 0.033814),
    "l": ("qt", 1.05669),
    "liter": ("quart", 1.05669),
    "liters": ("quarts", 1.05669),
}

_IMPERIAL_TO_METRIC = {
    "oz": ("g", 28.3495),
    "ounce": ("gram", 28.3495),
    "ounces": ("grams", 28.3495),
    "lb": ("kg", 0.453592),
    "pound": ("kilogram", 0.453592),
    "pounds": ("kilograms", 0.453592),
    "fl oz": ("ml", 29.5735),
    "fluid ounce": ("milliliter", 29.5735),
    "fluid ounces": ("milliliters", 29.5735),
    "cup": ("ml", 236.588),
    "cups": ("ml", 236.588),
}

_NUM_PAT = re.compile(r"^([\d\s./]+)")

def _parse_qty(s: str) -> float:
    """Parse a quantity string into a float, handling fractions and spaces."""
    s = s.strip()
    if not s:
        return 0.0
    try:
        # Handle mixed fractions like "1 1/2"
        if " " in s:
            parts = s.split()
            total = 0.0
            for p in parts:
                if "/" in p:
                    total += float(Fraction(p))
                else:
                    total += float(p)
            return total
        if "/" in s:
            return float(Fraction(s))
        return float(s)
    except (ValueError, ZeroDivisionError):
        return 0.0

def _safe_json(s: Optional[str], default: Any) -> Any:
    try:
        return json.loads(s) if s else default
    except (json.JSONDecodeError, TypeError):
        return default

def _format_qty(v: float) -> str:
    """Format a float quantity back to a string, rounding to fractions if possible."""
    if abs(v - round(v)) < 1e-9:
        return str(round(v))

    whole = int(v)
    frac = v - whole

    frac_str = ""
    if abs(frac - 0.25) < 0.01:
        frac_str = "1/4"
    elif abs(frac - 0.50) < 0.01:
        frac_str = "1/2"
    elif abs(frac - 0.75) < 0.01:
        frac_str = "3/4"
    elif abs(frac - 0.33) < 0.02:
        frac_str = "1/3"
    elif abs(frac - 0.66) < 0.02:
        frac_str = "2/3"

    if frac_str:
        return f"{whole if whole > 0 else ''} {frac_str}".strip()
    return str(round(v, 2))

def _parse_ingredient(s: str) -> dict:
    for uc, asc in _UNICODE_FRACS.items():
        s = s.replace(uc, asc)
    s = s.strip()
    qty = unit = ""
    m = _NUM_PAT.match(s)
    if m:
        qty = m.group(1).strip()
        rest = s[m.end():].strip()
        words = rest.split()
        if words and words[0].lower().rstrip(".") in _UNITS:
            unit = words[0]
            name = " ".join(words[1:])
        else:
            name = rest
    else:
        name = s
    return {"name": name.strip() or s, "qty": qty, "unit": unit}

def _parse_yield(y: Any) -> int:
    if isinstance(y, list):
        y = y[0] if y else "4"
    m = re.search(r"\d+", str(y))
    return int(m.group()) if m else 4

def _strip_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()

def _parse_steps(instructions: Any) -> List[str]:
    if isinstance(instructions, str):
        cleaned = _strip_html(instructions)
        return [s.strip() for s in re.split(r"\.\s+|\n", cleaned) if s.strip()]
    if not isinstance(instructions, list):
        return []
    steps: List[str] = []
    for item in instructions:
        if isinstance(item, str):
            steps.append(_strip_html(item))
        elif isinstance(item, dict):
            text = item.get("text") or item.get("name") or ""
            if text:
                steps.append(_strip_html(text))
            for sub in item.get("itemListElement", []):
                if isinstance(sub, dict):
                    t = sub.get("text") or sub.get("name") or ""
                    if t:
                        steps.append(_strip_html(t))
    return [s for s in steps if s]

def _extract_image_url(image: Any) -> Optional[str]:
    """Normalise schema.org image field — string, list, or ImageObject."""
    if not image:
        return None
    if isinstance(image, str):
        return image or None
    if isinstance(image, list):
        image = image[0] if image else None
        if not image:
            return None
    if isinstance(image, str):  # unwrapped from a list of plain URLs
        return image or None
    if isinstance(image, dict):
        return image.get("url") or image.get("contentUrl") or None
    return None

def _jsonld_to_recipe(node: dict) -> Optional[dict]:
    """Convert a schema.org Recipe node to our internal recipe dict."""
    t = node.get("@type", "")
    if "Recipe" not in (t if isinstance(t, str) else " ".join(t)):
        return None
    raw_category = node.get("recipeCategory", "") or ""
    if isinstance(raw_category, list):
        raw_category = " ".join(raw_category)
    meal_type = "Other"
    for key, val in _MEAL_TYPE_MAP.items():
        if key in raw_category.lower():
            meal_type = val
            break

    title = node.get("name", "Untitled Recipe")
    ingredients = [_parse_ingredient(i)
                   for i in node.get("recipeIngredient", [])]

    return {
        "title": title,
        "meal_type": meal_type,
        "primary_protein": _detect_protein(title, ingredients),
        "servings": _parse_yield(node.get("recipeYield", 4)),
        "image_url": _extract_image_url(node.get("image")),
        "ingredients": ingredients,
        "steps": _parse_steps(node.get("recipeInstructions", [])),
        "equipment_needed": [],
    }

def _extract_jsonld_recipes(page_html: str) -> List[dict]:
    """Pull all schema.org Recipe objects from JSON-LD blocks in an HTML page."""
    blocks = re.findall(
        r'<script[^>]*ld\+json[^>]*>([\s\S]*?)</script>',
        page_html,
        re.I)
    found: List[dict] = []
    for block in blocks:
        try:
            data = json.loads(block.strip())
        except Exception:
            continue
        nodes = data if isinstance(data, list) else [data]
        for node in nodes:
            if not isinstance(node, dict):
                continue
            # Handle @graph wrapper (common on WordPress sites)
            for item in node.get("@graph", [node]):
                if not isinstance(item, dict):
                    continue
                recipe = _jsonld_to_recipe(item)
                if recipe:
                    found.append(recipe)
    return found

def _extract_json(text: str) -> Any:
    match = re.search(r"(\{[\s\S]*\}|\[[\s\S]*\])", text)
    if match:
        return json.loads(match.group(1))
    return json.loads(text)

def _extract_og_image(page_html: str) -> Optional[str]:
    """Pull the best available social/meta image from an HTML page."""
    patterns = [
        r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']',
        r'<meta[^>]+name=["\']twitter:image["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']twitter:image["\']',
    ]
    for pat in patterns:
        m = re.search(pat, page_html, re.I)
        if m:
            url = m.group(1).strip()
            if url.startswith("http"):
                return url
    return None

def _is_bot_challenge(page_html: str) -> bool:
    """Detect bot challenge / CAPTCHA gate pages (Walmart, Cloudflare, etc.)."""
    lower = page_html.lower()
    indicators = [
        "robot or human",
        "are you a robot",
        "verify you are human",
        "automated access",
        "bot detected",
        "checking your browser",
        "access denied",
        "enable javascript and cookies",
        "challenge-form",
        "cf-challenge",
    ]
    return any(phrase in lower for phrase in indicators) and len(
        page_html) < 60_000

def _extract_microdata_recipes(page_html: str) -> List[dict]:
    """Pull schema.org Recipe data from Microdata (itemprop) tags."""
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        return []

    soup = BeautifulSoup(page_html, "html.parser")
    # Instant Pot and others use itemprop="recipeIngredient" for list items
    ingredients = [
        i.get_text(
            strip=True) for i in soup.find_all(
            attrs={
                "itemprop": "recipeIngredient"})]
    if not ingredients:
        return []

    # Scope title search to the recipe container to avoid picking up
    # site/author names
    recipe_container = (
        soup.find(attrs={"itemtype": re.compile(r"schema\.org/Recipe", re.I)})
    )
    title_node = (
        (recipe_container.find(
            attrs={"itemprop": "name"}) if recipe_container else None)
        or soup.find(attrs={"itemprop": "name"})
        or soup.find("h1")
    )
    title = title_node.get_text(
        strip=True) if title_node else "Untitled Recipe"

    # Instructions — look for itemprop="recipeInstructions" first
    steps: List[str] = []
    instruction_nodes = soup.find_all(attrs={"itemprop": "recipeInstructions"})
    if instruction_nodes:
        for node in instruction_nodes:
            # If the node contains <li> children, extract those
            lis = node.find_all("li")
            if lis:
                steps.extend([li.get_text(strip=True) for li in lis])
            else:
                steps.extend(_parse_steps(node.get_text(separator="\n")))
    else:
        # Fallback for sites with Microdata ingredients but unstructured instructions
        # Look for headers like "Instructions" or "Directions"
        for h in soup.find_all(["h2", "h3", "h4"]):
            h_text = h.get_text().lower()
            if "instruction" in h_text or "direction" in h_text:
                # Check siblings or parent for a list
                container = h.find_next(["ul", "ol", "div"])
                if container:
                    lis = container.find_all("li")
                    if lis:
                        steps = [li.get_text(strip=True) for li in lis]
                    else:
                        steps = [
                            p.get_text(
                                strip=True) for p in container.find_all("p") if len(
                                p.get_text()) > 10]
                if steps:
                    break

    yield_node = soup.find(attrs={"itemprop": "recipeYield"})
    servings = _parse_yield(yield_node.get_text()) if yield_node else 4

    # Try to find a specific recipe image, fallback to OG
    image_node = soup.find(attrs={"itemprop": "image"})
    image_url = _extract_image_url(image_node.get(
        "src") if image_node else None) or _extract_og_image(page_html)

    parsed_ingredients = [_parse_ingredient(i) for i in ingredients]

    return [{
        "title": title,
        "ingredients": parsed_ingredients,
        "steps": [s for s in steps if s],
        "servings": servings,
        "meal_type": "Other",
        "primary_protein": _detect_protein(title, parsed_ingredients),
        "image_url": image_url,
    }]

def _extract_nextdata_recipes(page_html: str) -> List[dict]:
    """Extract recipes from Next.js __NEXT_DATA__ JSON (Walmart and similar SPA sites)."""
    m = re.search(
        r'<script[^>]+id=["\']__NEXT_DATA__["\'][^>]*>([\s\S]*?)</script>',
        page_html,
        re.I)
    if not m:
        return []
    try:
        data = json.loads(m.group(1))
    except Exception:
        return []

    def _find_recipe_nodes(obj: Any, depth: int = 0) -> List[dict]:
        if depth > 10 or not isinstance(obj, (dict, list)):
            return []
        found: List[dict] = []
        if isinstance(obj, dict):
            has_name = bool(obj.get("title") or obj.get("name"))
            has_ingredients = bool(
                obj.get("ingredients") or obj.get("recipeIngredients"))
            has_steps = bool(
                obj.get("instructions") or obj.get(
                    "steps") or obj.get("recipeInstructions")
            )
            if has_name and (has_ingredients or has_steps):
                found.append(obj)
            for v in obj.values():
                found.extend(_find_recipe_nodes(v, depth + 1))
        else:
            for item in obj:
                found.extend(_find_recipe_nodes(item, depth + 1))
        return found

    parsed: List[dict] = []
    for raw in _find_recipe_nodes(data):
        name = raw.get("title") or raw.get("name") or "Untitled Recipe"

        raw_ings = raw.get("ingredients") or raw.get("recipeIngredients") or []
        ingredients: List[dict] = []
        for ing in raw_ings if isinstance(raw_ings, list) else []:
            if isinstance(ing, str):
                ingredients.append(_parse_ingredient(ing))
            elif isinstance(ing, dict):
                text = ing.get("text") or ing.get(
                    "name") or ing.get("description") or ""
                if text:
                    ingredients.append(_parse_ingredient(str(text)))

        raw_steps = (
            raw.get("instructions") or raw.get(
                "steps") or raw.get("recipeInstructions") or []
        )
        steps = _parse_steps(raw_steps)

        raw_yield = raw.get("recipeYield") or raw.get(
            "servings") or raw.get("yield") or 4
        servings = _parse_yield(raw_yield)

        raw_image = (
            raw.get("image") or raw.get("images")
            or raw.get("imageUrl") or raw.get("imageURL")
        )
        image_url = _extract_image_url(raw_image)
        if not image_url and isinstance(raw_image, list) and raw_image:
            first = raw_image[0]
            if isinstance(first, dict):
                image_url = (
                    first.get("url") or first.get("src")
                    or first.get("uri") or first.get("contentUrl")
                )
            elif isinstance(first, str) and first.startswith("http"):
                image_url = first

        raw_category = raw.get("category") or raw.get("recipeCategory") or ""
        if isinstance(raw_category, list):
            raw_category = " ".join(raw_category)
        meal_type = "Other"
        for key, val in _MEAL_TYPE_MAP.items():
            if key in str(raw_category).lower():
                meal_type = val
                break
        parsed.append({
            "title": name,
            "meal_type": meal_type,
            "primary_protein": _detect_protein(name, ingredients),
            "servings": servings,
            "image_url": image_url,
            "ingredients": ingredients,
            "steps": steps,
            "equipment_needed": [],
        })

    return parsed
