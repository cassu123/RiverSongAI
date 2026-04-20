# =============================================================================
# providers/memory/models.py
#
# File Purpose:
#   Data models for River Song's three-tier memory system. These are plain
#   dataclasses used throughout the memory layer -- no ORM, no magic.
#
# Key Functions/Classes:
#   Fact            -- an explicit piece of information the user told River Song
#   Preference      -- an inferred pattern about the user (overwritten, not appended)
#   ConversationSummary -- a compressed record of one conversation with a TTL
#   MemorySettings  -- per-user configuration for how memory behaves
#   LLMSettings     -- per-user LLM provider and model selection
#   TTLOption       -- enum-style constants for TTL tiers
#
# Dependencies:
#   Python standard library only (dataclasses, datetime, typing)
#
# Usage Example:
#   fact = Fact(id="uuid", user_id="alice", key="name", value="Alice")
#   summary = ConversationSummary(id="uuid", user_id="alice", summary="...",
#                                  ttl_setting=TTLOption.STANDARD)
# =============================================================================

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


# =============================================================================
# TTL Option constants
# =============================================================================
#
# Purpose:
#   Named tiers for how long a conversation summary is retained before
#   automatic deletion. Used in both the data model and the TTL engine.
#
# Assumptions/Constraints:
#   - "forever" maps to None expiry date (never deleted automatically)
#   - These string values are stored verbatim in SQLite
# =============================================================================

class TTLOption:
    SHORT    = "short"      # 7 days
    STANDARD = "standard"   # 30 days  (default)
    EXTENDED = "extended"   # 90 days
    LONG     = "long"       # 365 days
    FOREVER  = "forever"    # never deleted

    ALL = [SHORT, STANDARD, EXTENDED, LONG, FOREVER]

    # Maps each option to its day count; None means no expiry
    DAYS: dict[str, Optional[int]] = {
        SHORT:    7,
        STANDARD: 30,
        EXTENDED: 90,
        LONG:     365,
        FOREVER:  None,
    }

    @classmethod
    def is_valid(cls, value: str) -> bool:
        return value in cls.ALL


# =============================================================================
# Fact
# =============================================================================

@dataclass
class Fact:
    """
    Purpose:
        An explicit piece of information the user has told River Song.
        Examples: name, job title, pet's name, city, birthday.

    Inputs/Outputs:
        Created by MemoryManager when River Song detects a memorable statement.
        Read back and injected into the system prompt context at conversation start.

    Assumptions/Constraints:
        - key is a short lowercase slug (e.g., "name", "job", "pet_dog_name")
        - value is plain text, no length limit enforced here (SQLite TEXT)
        - source is "explicit" when user directly stated it, "inferred" when
          River Song concluded it from context
        - UNIQUE(user_id, key) -- updating a fact overwrites, never duplicates
    """
    id: str
    user_id: str
    key: str
    value: str
    source: str = "explicit"         # "explicit" | "inferred"
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)


# =============================================================================
# Preference
# =============================================================================

@dataclass
class Preference:
    """
    Purpose:
        An inferred pattern or stated preference about the user.
        Unlike Facts, these are overwritten as River Song learns more --
        they represent current best understanding, not a historical log.

    Inputs/Outputs:
        Written by MemoryManager after each conversation or on explicit statement.
        Read into context at conversation start.

    Assumptions/Constraints:
        - category is a short slug (e.g., "tone", "verbosity", "wake_time")
        - value is JSON-encoded for complex values (lists, dicts)
        - confidence: "low" (single observation), "medium" (pattern), "high" (stated)
        - UNIQUE(user_id, category) -- one record per preference type per user
    """
    id: str
    user_id: str
    category: str
    value: str                       # JSON string for complex values
    confidence: str = "low"          # "low" | "medium" | "high"
    last_updated: datetime = field(default_factory=datetime.utcnow)


# =============================================================================
# ConversationSummary
# =============================================================================

@dataclass
class ConversationSummary:
    """
    Purpose:
        A 2-3 sentence summary of one conversation, generated by River Song
        at the end of each session. Retained for the duration of the TTL.

    Inputs/Outputs:
        Written by MemoryManager.record_summary() at end of conversation.
        Read and injected into context at next conversation start (most recent N).
        reference_count incremented whenever this summary is pulled into context.

    Assumptions/Constraints:
        - expires_at is None when ttl_setting == "forever"
        - If auto_extend is enabled for the user, expires_at resets on each reference
        - Expired summaries are cleaned up lazily (on next context build) or by a
          periodic cleanup call; they are never shown but kept in DB until swept
    """
    id: str
    user_id: str
    summary: str
    ttl_setting: str = TTLOption.STANDARD
    expires_at: Optional[datetime] = None
    reference_count: int = 0
    last_referenced: Optional[datetime] = None
    created_at: datetime = field(default_factory=datetime.utcnow)


# =============================================================================
# MemorySettings
# =============================================================================

@dataclass
class MemorySettings:
    """
    Purpose:
        Per-user configuration for the memory system behaviour.

    Assumptions/Constraints:
        - If summaries_enabled is False, no summaries are generated or stored
        - default_ttl must be a valid TTLOption constant
        - auto_extend: when True, a summary's expires_at resets from today
          every time it is pulled into context (useful summaries survive longer)
    """
    user_id: str
    summaries_enabled: bool = True
    default_ttl: str = TTLOption.STANDARD
    auto_extend: bool = True


# =============================================================================
# LLMSettings
# =============================================================================

@dataclass
class LLMSettings:
    """
    Purpose:
        Per-user LLM provider and model selection. Stored in SQLite so each
        user can have a different preferred model without .env changes.

    Assumptions/Constraints:
        - provider must be a key in the LLM registry (providers/llm/registry.py)
        - model must be valid for that provider
        - cloud_fallback_enabled: if True, fall back to cloud_fallback_provider
          when the primary provider fails (Ollama down, model not found, etc.)
        - Cloud providers show a delay warning before every request
    """
    user_id: str
    provider: str = "ollama"
    model: str = "llama3.2:3b"
    cloud_fallback_enabled: bool = False
    timezone: str = "UTC" # Per-user timezone setting
    cloud_fallback_provider: Optional[str] = None
    cloud_fallback_model: Optional[str] = None
