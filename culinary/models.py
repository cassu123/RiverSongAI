import uuid
from datetime import datetime, timezone
from enum import Enum as PyEnum

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import declarative_base, relationship

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


class Household(Base):
    """
    One household per user (owner). Scopes all culinary data.
    Kitchen equipment flags drive the Equipment Translator.
    """
    __tablename__ = "cul_households"

    id       = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name     = Column(String, nullable=False, default="My Household")
    owner_id = Column(String, unique=True, nullable=False, index=True)  # JWT sub

    # Kitchen equipment toggles
    has_air_fryer    = Column(Boolean, default=False, nullable=False)
    has_instant_pot  = Column(Boolean, default=False, nullable=False)
    has_dutch_oven   = Column(Boolean, default=False, nullable=False)
    has_sous_vide    = Column(Boolean, default=False, nullable=False)
    has_slow_cooker  = Column(Boolean, default=False, nullable=False)
    has_stand_mixer  = Column(Boolean, default=False, nullable=False)
    has_wok          = Column(Boolean, default=False, nullable=False)
    has_grill        = Column(Boolean, default=False, nullable=False)

    created_at = Column(DateTime, default=_now)
    updated_at = Column(DateTime, default=_now, onupdate=_now)

    recipes          = relationship("Recipe",           back_populates="household", cascade="all, delete-orphan")
    stockroom_items  = relationship("StockroomItem",    back_populates="household", cascade="all, delete-orphan")
    prep_sessions    = relationship("PrepSession",      back_populates="household", cascade="all, delete-orphan")
    walmart_mappings = relationship("WalmartMapping",   back_populates="household", cascade="all, delete-orphan")
    equipment_items  = relationship("KitchenEquipment", back_populates="household", cascade="all, delete-orphan")


class Recipe(Base):
    """
    A saved recipe in the Library.
    ingredients and steps are stored as JSON text.
    """
    __tablename__ = "cul_recipes"

    id           = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    household_id = Column(String, ForeignKey("cul_households.id"), nullable=False, index=True)

    title           = Column(String,           nullable=False)
    meal_type       = Column(Enum(MealType),   default=MealType.OTHER, nullable=False)
    primary_protein = Column(String,           nullable=True)
    source_url      = Column(Text,             nullable=True)
    source_type     = Column(Enum(SourceType), default=SourceType.MANUAL, nullable=False)
    servings        = Column(Integer,          default=4, nullable=False)

    image_url            = Column(Text, nullable=True)

    # JSON arrays stored as text (SQLite-compatible)
    ingredients_json     = Column(Text, nullable=False, default="[]")
    steps_json           = Column(Text, nullable=False, default="[]")
    equipment_needed_json = Column(Text, nullable=False, default="[]")
    # Flagged blacklist ingredients found during ingest
    blacklisted_json     = Column(Text, nullable=False, default="[]")

    created_at = Column(DateTime, default=_now)
    updated_at = Column(DateTime, default=_now, onupdate=_now)

    household = relationship("Household", back_populates="recipes")
    prep_entries = relationship("PrepSessionRecipe", back_populates="recipe", cascade="all, delete-orphan")


class StockroomItem(Base):
    """
    Raw ingredient inventory with strictly ternary state.
    Items marked Low are auto-injected into the grocery list.
    """
    __tablename__ = "cul_stockroom"

    id           = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    household_id = Column(String, ForeignKey("cul_households.id"), nullable=False, index=True)

    name    = Column(String, nullable=False, index=True)
    barcode = Column(String, nullable=True, index=True)
    brand   = Column(String, nullable=True)
    state   = Column(Enum(StockState), default=StockState.GOOD, nullable=False)

    created_at = Column(DateTime, default=_now)
    updated_at = Column(DateTime, default=_now, onupdate=_now)

    household = relationship("Household", back_populates="stockroom_items")


class PrepSession(Base):
    """
    An ephemeral bulk-cook session. Completed sessions are retained for history
    but flagged inactive so the active session is always singular.
    """
    __tablename__ = "cul_prep_sessions"

    id           = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    household_id = Column(String, ForeignKey("cul_households.id"), nullable=False, index=True)

    label             = Column(String, nullable=True)
    is_active         = Column(Boolean, default=True, nullable=False)
    target_containers = Column(Integer, nullable=True)
    container_oz      = Column(Integer, nullable=True)

    created_at   = Column(DateTime, default=_now)
    completed_at = Column(DateTime, nullable=True)

    household = relationship("Household", back_populates="prep_sessions")
    recipes   = relationship("PrepSessionRecipe", back_populates="session", cascade="all, delete-orphan")


class PrepSessionRecipe(Base):
    """Junction between a prep session and a recipe, with optional scaled ingredients."""
    __tablename__ = "cul_prep_session_recipes"

    id         = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String, ForeignKey("cul_prep_sessions.id"), nullable=False, index=True)
    recipe_id  = Column(String, ForeignKey("cul_recipes.id"),       nullable=False)

    servings_target      = Column(Integer, nullable=True)
    scaled_ingredients_json = Column(Text, nullable=True)  # post-scaling JSON

    added_at = Column(DateTime, default=_now)

    session = relationship("PrepSession", back_populates="recipes")
    recipe  = relationship("Recipe",      back_populates="prep_entries")


class KitchenEquipment(Base):
    """Owned kitchen equipment with make/model for recipe personalization."""
    __tablename__ = "cul_kitchen_equipment"

    id           = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    household_id = Column(String, ForeignKey("cul_households.id"), nullable=False, index=True)

    equipment_type    = Column(String, nullable=False)  # primary type, e.g. "air_fryer"
    label             = Column(String, nullable=False)  # e.g. "Cosori Pro Gen 2"
    make              = Column(String, nullable=True)
    model             = Column(String, nullable=True)
    capabilities_json = Column(Text, nullable=True)     # JSON list of all equipment_type keys

    created_at = Column(DateTime, default=_now)
    updated_at = Column(DateTime, default=_now, onupdate=_now)

    household = relationship("Household", back_populates="equipment_items")


class WalmartMapping(Base):
    """Maps a generic ingredient name to a Walmart Item ID for cart export."""
    __tablename__ = "cul_walmart_mappings"

    id           = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    household_id = Column(String, ForeignKey("cul_households.id"), nullable=True, index=True)

    ingredient_name = Column(String, nullable=False, index=True)  # lowercase, normalized
    walmart_item_id = Column(String, nullable=False)

    created_at = Column(DateTime, default=_now)

    household = relationship("Household", back_populates="walmart_mappings")
