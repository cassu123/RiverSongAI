"""
providers/culinary/vault_sync.py

CHRONOS vault sync — every recipe becomes a markdown note.

Best effort by design: a recipe saving to the database must not fail because
the vault is unavailable, so every entry point here swallows and logs rather
than raising into the request.
"""

from __future__ import annotations

import logging
import re
from typing import Optional

from api.services.recipe_parser import _safe_json
from core.family import resolve_module_owner as _resolve_module_owner
from culinary.models import Recipe
from providers.vault.vault_provider import (
    VROOT_HOUSEHOLD,
    VROOT_PERSONAL,
    VaultProvider,
)

logger = logging.getLogger(__name__)


def _safe_filename(title: str) -> str:
    """Strip path separators and clamp length so the title makes a safe filename."""
    cleaned = re.sub(r'[\\/]+', '-', title or "Untitled Recipe").strip()
    cleaned = re.sub(r'[\x00-\x1f]', '', cleaned)
    cleaned = cleaned.strip('. ')
    if not cleaned:
        cleaned = "Untitled Recipe"
    return cleaned[:100]


def _recipe_vault_path_for(r: Recipe, root: str = VROOT_HOUSEHOLD) -> str:
    return f"{root}/Recipes/{_safe_filename(r.title)}.md"


def _recipe_to_markdown(r: Recipe) -> str:
    """Serialize a Recipe to markdown with YAML frontmatter."""
    ingredients = _safe_json(r.ingredients_json, [])
    steps = _safe_json(r.steps_json, [])
    equipment = _safe_json(r.equipment_needed_json, [])

    def _yaml_str(v) -> str:
        if v is None:
            return '""'
        s = str(v).replace('"', '\\"')
        return f'"{s}"'

    frontmatter = [
        "---",
        "kind: recipe",
        f"recipe_id: {_yaml_str(r.id)}",
        f"title: {_yaml_str(r.title)}",
        f"meal_type: {
            _yaml_str(
                r.meal_type.value if r.meal_type else 'Other')}",
        f"primary_protein: {_yaml_str(r.primary_protein or '')}",
        f"servings: {r.servings or 0}",
        f"rating: {r.rating if r.rating is not None else 'null'}",
        f"source_url: {_yaml_str(r.source_url or '')}",
        "---",
        "",
        f"# {r.title}",
        "",
    ]
    body: list[str] = list(frontmatter)
    if r.image_url:
        body.append(f"![cover]({r.image_url})")
        body.append("")
    body.append("## Ingredients")
    body.append("")
    if ingredients:
        for ing in ingredients:
            if isinstance(ing, dict):
                qty = ing.get("quantity") or ing.get("amount") or ""
                unit = ing.get("unit", "")
                name = ing.get("name") or ing.get("item") or ""
                line = " ".join(
                    p for p in [
                        str(qty).strip(),
                        unit.strip(),
                        name.strip()] if p)
                body.append(f"- {line}")
            else:
                body.append(f"- {ing}")
    else:
        body.append("_(none listed)_")
    body.append("")
    body.append("## Steps")
    body.append("")
    if steps:
        for i, step in enumerate(steps, 1):
            text = step if isinstance(
                step, str) else (
                step.get("text") or step.get("instruction") or str(step))
            body.append(f"{i}. {text}")
    else:
        body.append("_(no steps recorded)_")
    body.append("")
    if equipment:
        body.append("## Equipment")
        body.append("")
        for eq in equipment:
            label = eq if isinstance(eq, str) else (eq.get("name") or str(eq))
            body.append(f"- {label}")
        body.append("")
    return "\n".join(body)


async def _sync_recipe_to_vault(
        uid: str, r: Recipe, old_title: Optional[str] = None) -> None:
    """
    Write the recipe to the user's vault as a markdown note. Best-effort:
    a vault failure must never break the recipe save itself.
    """
    try:
        provider = VaultProvider(store=None)
        content = _recipe_to_markdown(r)
        # Prefer household root when the user has one; otherwise fall back to
        # personal.
        owner_id = _resolve_module_owner(uid, "culinary")
        root = VROOT_HOUSEHOLD if owner_id.startswith(
            "family:") else VROOT_PERSONAL
        new_path = _recipe_vault_path_for(r, root=root)
        # If the title changed, retire the old file by renaming
        # (delete-on-fail).
        if old_title and _safe_filename(old_title) != _safe_filename(r.title):
            old_path = f"{root}/Recipes/{_safe_filename(old_title)}.md"
            try:
                await provider.rename_note(uid, old_path, new_path)
            except (FileNotFoundError, ValueError):
                pass
            except Exception as exc:
                logger.debug("Recipe note rename skipped: %s", exc)
        await provider.write_note(uid, new_path, content)
    except Exception as exc:
        logger.debug(
            "Recipe vault sync skipped (recipe=%s): %s",
            getattr(
                r,
                "id",
                "?"),
            exc)


async def _delete_recipe_from_vault(uid: str, r: Recipe) -> None:
    try:
        provider = VaultProvider(store=None)
        owner_id = _resolve_module_owner(uid, "culinary")
        root = VROOT_HOUSEHOLD if owner_id.startswith(
            "family:") else VROOT_PERSONAL
        path = _recipe_vault_path_for(r, root=root)
        await provider.delete_note(uid, path)
    except Exception as exc:
        logger.debug(
            "Recipe vault delete skipped (recipe=%s): %s",
            getattr(
                r,
                "id",
                "?"),
            exc)
