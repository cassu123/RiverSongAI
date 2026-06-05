from typing import Optional, Any
import uuid
from datetime import datetime, timezone
from enum import Enum as PyEnum

from sqlalchemy import (  # type: ignore
    Boolean,
    Column, mapped_column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)

from sqlalchemy.orm import declarative_base, relationship, Mapped, mapped_column

Base = declarative_base()


def _now():
    return datetime.now(timezone.utc)


class StockState(PyEnum):
    LOW    = "Low"
    MEDIUM = "Medium"
    GOOD   = "Good"


class MealType(PyEnum):
    BREAKFAST = "Breakfast"
    LUNCH     = "Lunch"
    DINNER    = "Dinner"
    SNACK     = "Snack"
    DESSERT   = "Dessert"
    OTHER     = "Other"


class SourceType(PyEnum):
    PDF    = "pdf"
    URL    = "url"
    MANUAL = "manual"


class Household(Base):  # type: ignore
    """
    One household per user (owner). Scopes all culinary data.
    Kitchen equipment flags drive the Equipment Translator.
    """
    __tablename__ = "cul_households"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String, nullable=False, default="My Household")
    owner_id: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)# JWT sub

    # Kitchen equipment toggles
    has_air_fryer: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    has_instant_pot: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    has_dutch_oven: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    has_sous_vide: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    has_slow_cooker: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    has_stand_mixer: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    has_wok: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    has_grill: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    recipes           = relationship("Recipe",           back_populates="household", cascade="all, delete-orphan")
    stockroom_items   = relationship("StockroomItem",    back_populates="household", cascade="all, delete-orphan")
    prep_sessions     = relationship("PrepSession",      back_populates="household", cascade="all, delete-orphan")
    walmart_mappings  = relationship("WalmartMapping",   back_populates="household", cascade="all, delete-orphan")
    equipment_items   = relationship("KitchenEquipment", back_populates="household", cascade="all, delete-orphan")
    dinner_proposals  = relationship("DinnerProposal",   back_populates="household", cascade="all, delete-orphan")
    banned_ingredients = relationship("BannedIngredient", back_populates="household", cascade="all, delete-orphan")


class Recipe(Base):  # type: ignore
    """
    A saved recipe in the Library.
    ingredients and steps are stored as JSON text.
    """
    __tablename__ = "cul_recipes"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    household_id: Mapped[str] = mapped_column(String, ForeignKey("cul_households.id"), nullable=False, index=True)

    title: Mapped[str] = mapped_column(String,           nullable=False)
    meal_type: Mapped[MealType] = mapped_column(Enum(MealType),   default=MealType.OTHER, nullable=False)
    primary_protein: Mapped[Optional[str]] = mapped_column(String,           nullable=True)
    source_url: Mapped[Optional[str]] = mapped_column(Text,             nullable=True)
    source_type: Mapped[SourceType] = mapped_column(Enum(SourceType), default=SourceType.MANUAL, nullable=False)
    servings: Mapped[int] = mapped_column(Integer,          default=4, nullable=False)

    image_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # JSON arrays stored as text (SQLite-compatible)
    ingredients_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    steps_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    equipment_needed_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    # Flagged blacklist ingredients found during ingest
    blacklisted_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    rating: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)# 1–5 stars

    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    household = relationship("Household", back_populates="recipes")
    prep_entries = relationship("PrepSessionRecipe", back_populates="recipe", cascade="all, delete-orphan")


class BannedIngredient(Base):  # type: ignore
    """
    Household-specific banned ingredients with preferred substitutes.
    Used during recipe ingest and scaling to flag/auto-replace items.
    """
    __tablename__ = "cul_banned_ingredients"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    household_id: Mapped[str] = mapped_column(String, ForeignKey("cul_households.id"), nullable=False, index=True)

    name: Mapped[str] = mapped_column(String, nullable=False, index=True)
    substitute: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    household = relationship("Household", back_populates="banned_ingredients")


class StockroomItem(Base):  # type: ignore
    """
    Raw ingredient inventory with numeric quantity.
    Items with quantity <= min_quantity are auto-injected into the grocery list.
    """
    __tablename__ = "cul_stockroom"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    household_id: Mapped[str] = mapped_column(String, ForeignKey("cul_households.id"), nullable=False, index=True)

    name: Mapped[str] = mapped_column(String, nullable=False, index=True)
    barcode: Mapped[Optional[str]] = mapped_column(String, nullable=True, index=True)
    brand: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    state: Mapped[StockState] = mapped_column(Enum(StockState), default=StockState.GOOD, nullable=False)
    
    quantity: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    min_quantity: Mapped[float] = mapped_column(Float, default=0.25, nullable=False)


    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


    household = relationship("Household", back_populates="stockroom_items")


class PrepSession(Base):  # type: ignore
    """
    An ephemeral bulk-cook session. Completed sessions are retained for history
    but flagged inactive so the active session is always singular.
    """
    __tablename__ = "cul_prep_sessions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    household_id: Mapped[str] = mapped_column(String, ForeignKey("cul_households.id"), nullable=False, index=True)

    label: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    target_containers: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    container_oz: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    household = relationship("Household", back_populates="prep_sessions")
    recipes   = relationship("PrepSessionRecipe", back_populates="session", cascade="all, delete-orphan")


class PrepSessionRecipe(Base):  # type: ignore
    """Junction between a prep session and a recipe, with optional scaled ingredients."""
    __tablename__ = "cul_prep_session_recipes"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id: Mapped[str] = mapped_column(String, ForeignKey("cul_prep_sessions.id"), nullable=False, index=True)
    recipe_id: Mapped[str] = mapped_column(String, ForeignKey("cul_recipes.id"),       nullable=False)

    servings_target: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    scaled_ingredients_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)# post-scaling JSON

    added_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    session = relationship("PrepSession", back_populates="recipes")
    recipe  = relationship("Recipe",      back_populates="prep_entries")


class KitchenEquipment(Base):  # type: ignore
    """Owned kitchen equipment with make/model for recipe personalization."""
    __tablename__ = "cul_kitchen_equipment"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    household_id: Mapped[str] = mapped_column(String, ForeignKey("cul_households.id"), nullable=False, index=True)

    equipment_type: Mapped[str] = mapped_column(String, nullable=False)# primary type, e.g. "air_fryer"
    label: Mapped[str] = mapped_column(String, nullable=False)# e.g. "Cosori Pro Gen 2"
    make: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    model: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    capabilities_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)# JSON list of all equipment_type keys

    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    household = relationship("Household", back_populates="equipment_items")


class WalmartMapping(Base):  # type: ignore
    """Maps a generic ingredient name to a Walmart Item ID for cart export."""
    __tablename__ = "cul_walmart_mappings"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    household_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("cul_households.id"), nullable=True, index=True)

    ingredient_name: Mapped[str] = mapped_column(String, nullable=False, index=True)# lowercase, normalized
    walmart_item_id: Mapped[str] = mapped_column(String, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    household = relationship("Household", back_populates="walmart_mappings")


class DinnerProposal(Base):  # type: ignore
    """
    A household-scoped dinner suggestion. Multiple proposals can coexist.
    status: pending → approved (any yes vote) → dismissed (acted on or cleared).
    """
    __tablename__ = "cul_active_vote"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    household_id: Mapped[str] = mapped_column(String, ForeignKey("cul_households.id"), nullable=False, index=True)
    recipe_id: Mapped[str] = mapped_column(String, ForeignKey("cul_recipes.id"),    nullable=False)

    proposed_by: Mapped[Optional[str]] = mapped_column(String, nullable=True)# JWT sub of proposer
    votes_yes: Mapped[str] = mapped_column(Text, nullable=False, default="[]")# JSON list of user_ids
    votes_no: Mapped[str] = mapped_column(Text, nullable=False, default="[]")# JSON list of user_ids
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")# pending | approved | dismissed

    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    household = relationship("Household", back_populates="dinner_proposals")
    recipe    = relationship("Recipe")
