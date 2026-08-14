from typing import Optional, Any
import uuid
from datetime import datetime, timezone
from enum import Enum as PyEnum

from sqlalchemy import (  # type: ignore
    Boolean,
    Column,
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

class ListSource(PyEnum):
    MANUAL = "manual"
    CHAT = "chat"
    STOCKROOM_AUTO = "stockroom_auto"
    PREP = "prep"
    MEAL_PLAN = "meal_plan"
    PARTS = "parts"


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
    #: A method rewritten for a different appliance, for this session only:
    #: {"station", "steps", "ingredients", "note"}. Deliberately here and not
    #: on the Recipe -- trying the Dutch oven once should not rewrite the
    #: thing you will cook in a skillet next month.
    appliance_swap_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

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
    #: What this particular machine can do, as facts rather than a category:
    #: {"watts", "capacity", "max_c", "presets": [...], "notes"}.
    #:
    #: Two jobs. It goes into the prompt, so a rewrite says 230C because that
    #: is what this air fryer reaches rather than because 230 is a common
    #: number. And it tightens the check afterwards -- a household that has
    #: recorded a 200C maximum gets a stricter bound than the generic one for
    #: the class, so a wrong answer has less room to look plausible.
    profile_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    #: How it has actually behaved: [{"at", "recipe", "verdict", "note"}].
    #: Appended after a cook, and fed back into later rewrites. This is the
    #: only part of the system that can converge on being right about *your*
    #: oven, because it is the only part that observes it.
    history_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

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
    recipe = relationship("Recipe")


class ShoppingListItem(Base):  # type: ignore
    __tablename__ = "cul_shopping_list"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    household_id: Mapped[str] = mapped_column(String, ForeignKey("cul_households.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False, index=True)
    qty: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    unit: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    category: Mapped[str] = mapped_column(String, default="grocery", nullable=False)
    source: Mapped[ListSource] = mapped_column(Enum(ListSource), default=ListSource.MANUAL, nullable=False)
    source_ref: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    added_by: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    checked_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

class MealPlanEntry(Base):  # type: ignore
    __tablename__ = "cul_meal_plan"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    household_id: Mapped[str] = mapped_column(String, ForeignKey("cul_households.id"), nullable=False, index=True)
    plan_date: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    slot: Mapped[MealType] = mapped_column(Enum(MealType), default=MealType.DINNER, nullable=False)
    recipe_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("cul_recipes.id"), nullable=True)
    label: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, default="planned", nullable=False)
    created_by: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    
    household = relationship("Household")
    recipe = relationship("Recipe")


class CookingSession(Base):  # type: ignore
    """
    A recipe being cooked right now.

    `cook_now` returns steps and forgets them, so nothing tracked "we are on
    step 3". A session is household-scoped rather than per-device so the
    kitchen Vortex, a phone and the browser all show the same step, and it is
    persisted so a Pi rebooting mid-recipe does not lose your place.

    Steps and ingredients are **materialised** at start rather than derived on
    every read. Scaling is cheap but equipment translation is an LLM call, and
    re-deriving would re-run it on every "next". Materialising also means a
    recipe edited by someone else mid-cook does not change the instructions
    under the person following them.
    """
    __tablename__ = "cul_cooking_sessions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    household_id: Mapped[str] = mapped_column(String, ForeignKey("cul_households.id"), nullable=False, index=True)
    # Nullable so deleting a recipe does not delete the history of cooking it.
    recipe_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("cul_recipes.id"), nullable=True)

    recipe_title: Mapped[str] = mapped_column(String, nullable=False, default="")
    servings_target: Mapped[int] = mapped_column(Integer, default=4, nullable=False)
    scale_factor: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    equipment: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    steps_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    ingredients_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")

    current_step: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)

    started_by: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    household = relationship("Household")
    recipe = relationship("Recipe")
    timers = relationship("CookingTimer", back_populates="session",
                          cascade="all, delete-orphan")


class MealCook(Base):  # type: ignore
    """
    Several recipes being cooked together as one meal.

    CookingSession is one recipe and a pointer into its steps. That is the
    wrong shape for a meal: three dishes share one oven, one pair of hands and
    one moment when everything is meant to be hot, and none of that exists
    inside a single recipe's step list.

    The timeline is **materialised** at start, for the same reason
    CookingSession materialises its steps and one more. Scheduling is cheap,
    but a plan that silently re-derived would move under the cook whenever
    somebody edited a recipe, adjusted the prep session, or plugged in an air
    fryer -- and a cooking plan that changes while you are following it is
    worse than a stale one. `plan_json` is the plan they agreed to start.

    Progress is a set of keys rather than an index. Steps interleave across
    recipes, so "we are on step 4" means nothing; what is true is that these
    particular steps are done, in whatever order the cook actually got to
    them.
    """
    __tablename__ = "cul_meal_cooks"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    household_id: Mapped[str] = mapped_column(String, ForeignKey("cul_households.id"), nullable=False, index=True)
    # Nullable so clearing a prep session does not delete the record of cooking it.
    prep_session_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    label: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    #: Wall-clock target. The plan itself is in offsets from its own start, so
    #: a cook running late slides the whole thing rather than being told they
    #: are behind on every row at once.
    serve_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    plan_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    done_steps_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    started_by: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    household = relationship("Household")


class MealTimer(Base):  # type: ignore
    """A timer for one step of a meal cook.

    Stores a deadline, never a countdown, for the same reason CookingTimer
    does: a countdown has to be decremented by something that is still
    running, so it loses time across a reload and then lies about how long is
    left. A deadline is simply true whenever it is next read, on any device.

    Pausing is the one case that needs the other representation. A paused
    timer has no deadline -- there is no instant it is counting towards -- so
    it holds the seconds remaining instead, and resuming turns that back into
    a deadline. Exactly one of the two is set at a time.
    """
    __tablename__ = "cul_meal_timers"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    cook_id: Mapped[str] = mapped_column(String, ForeignKey("cul_meal_cooks.id"), nullable=False, index=True)
    #: "<recipe_id>:<step_index>" -- the same key the done-set uses.
    step_key: Mapped[str] = mapped_column(String, nullable=False, index=True)
    label: Mapped[str] = mapped_column(String, nullable=False, default="Timer")

    ends_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    paused_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    #: Set once the cook has acknowledged the alarm, which is what stops it
    #: going off again on the next device to open the page.
    stopped_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class CookingTimer(Base):  # type: ignore
    """
    A named timer bound to a step of a cooking session.

    Stores the wall-clock deadline, never a countdown. A countdown has to be
    decremented by something that is still running, so it loses time across a
    reboot and lies about how long is left. A deadline is simply true whenever
    it is next read.
    """
    __tablename__ = "cul_cooking_timers"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id: Mapped[str] = mapped_column(String, ForeignKey("cul_cooking_sessions.id"), nullable=False, index=True)

    label: Mapped[str] = mapped_column(String, nullable=False, default="Timer")
    step_index: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    duration_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    ends_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    # running | fired | cancelled
    status: Mapped[str] = mapped_column(String, default="running", nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    fired_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    session = relationship("CookingSession", back_populates="timers")
