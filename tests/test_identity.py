"""Unit tests for core.identity.

Covers the resolution rules that decide who River thinks she is talking to.
The voice encoder itself is not exercised -- Resemblyzer is a heavy optional
dependency, and the part that has to be right is the arbitration.
"""

from __future__ import annotations

import pytest

from core import identity
from core.identity import (
    DEFAULT_MIN_MARGIN,
    ENROLLMENT_PHRASES,
    MIN_ENROLLMENT_SAMPLES,
    IdentitySignal,
    identify_by_voice,
    identify_speaker,
    resolve,
)


def sig(source, user_id, confidence, runner=None, runner_conf=None):
    return IdentitySignal(
        source=source,
        user_id=user_id,
        confidence=confidence,
        runner_up_user_id=runner,
        runner_up_confidence=runner_conf,
    )


# ---------------------------------------------------------------------------
# Enrollment script
# ---------------------------------------------------------------------------

def test_enrollment_script_has_enough_phrases():
    assert len(ENROLLMENT_PHRASES) >= MIN_ENROLLMENT_SAMPLES


def test_enrollment_phrases_are_distinct():
    """Repeating one phrase trains the phrase, not the person."""
    assert len(set(ENROLLMENT_PHRASES)) == len(ENROLLMENT_PHRASES)


def test_enrollment_phrases_are_long_enough_to_encode():
    for phrase in ENROLLMENT_PHRASES:
        assert len(phrase.split()) >= 5, f"too short to sample: {phrase!r}"


# ---------------------------------------------------------------------------
# Signal basics
# ---------------------------------------------------------------------------

def test_unrecognised_signal():
    s = sig("voice", None, 0.0)
    assert s.recognised is False
    assert s.margin is None


def test_margin_is_the_gap_to_the_runner_up():
    s = sig("voice", "alice", 0.90, "bob", 0.70)
    assert s.margin == pytest.approx(0.20)


# ---------------------------------------------------------------------------
# resolve()
# ---------------------------------------------------------------------------

def test_no_signals_resolves_to_nobody():
    assert resolve([]) is None


def test_all_unrecognised_resolves_to_nobody():
    assert resolve([sig("voice", None, 0.0), sig("face", None, 0.0)]) is None


def test_single_confident_signal_wins():
    winner = resolve([sig("voice", "alice", 0.9)])
    assert winner is not None
    assert winner.user_id == "alice"


def test_face_outranks_voice_when_they_disagree():
    """A camera seeing someone beats a voice heard through a doorway."""
    winner = resolve([
        sig("voice", "bob", 0.99),
        sig("face", "alice", 0.80),
    ])
    assert winner.user_id == "alice"
    assert winner.source == "face"


def test_voice_outranks_session():
    winner = resolve([
        sig("session", "tablet_owner", 0.5),
        sig("voice", "alice", 0.80),
    ])
    assert winner.user_id == "alice"
    assert winner.source == "voice"


def test_session_is_used_when_nothing_else_recognises():
    winner = resolve([sig("voice", None, 0.0), sig("session", "chris", 0.5)])
    assert winner.user_id == "chris"


def test_confidence_breaks_ties_within_a_source():
    winner = resolve([
        sig("voice", "alice", 0.80),
        sig("voice", "bob", 0.95),
    ])
    assert winner.user_id == "bob"


def test_unknown_source_ranks_below_known_ones():
    winner = resolve([
        sig("experimental_sensor", "bob", 0.99),
        sig("voice", "alice", 0.76),
    ])
    assert winner.user_id == "alice"


# ---------------------------------------------------------------------------
# Margin rejection — the household-members-sound-alike case
# ---------------------------------------------------------------------------

def test_narrow_margin_is_rejected():
    """Two similar voices both clearing threshold must not be guessed at."""
    assert resolve([sig("voice", "alice", 0.86, "bob", 0.85)]) is None


def test_wide_margin_is_accepted():
    winner = resolve([sig("voice", "alice", 0.90, "bob", 0.60)])
    assert winner.user_id == "alice"


def test_margin_rejection_falls_through_to_the_next_source():
    winner = resolve([
        sig("voice", "alice", 0.86, "bob", 0.85),
        sig("session", "chris", 0.5),
    ])
    assert winner.user_id == "chris"


def test_zero_margin_setting_accepts_on_confidence_alone():
    winner = resolve([sig("voice", "alice", 0.86, "bob", 0.85)], min_margin=0.0)
    assert winner.user_id == "alice"


def test_missing_runner_up_is_not_treated_as_a_narrow_margin():
    """Only one enrolled user means no runner-up, which is not ambiguity."""
    winner = resolve([sig("voice", "alice", 0.80)])
    assert winner.user_id == "alice"


def test_default_margin_is_conservative_but_usable():
    assert 0.0 < DEFAULT_MIN_MARGIN < 0.5


# ---------------------------------------------------------------------------
# identify_by_voice — degradation
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_empty_audio_is_unrecognised_not_an_error():
    result = await identify_by_voice(b"")
    assert result.recognised is False
    assert result.source == "voice"


@pytest.mark.asyncio
async def test_provider_failure_degrades_quietly(monkeypatch):
    """Resemblyzer missing or broken must not break the turn."""
    monkeypatch.setattr(
        identity, "_get_voice_provider",
        lambda factory: (_ for _ in ()).throw(RuntimeError("no encoder")),
    )
    result = await identify_by_voice(b"RIFFfake")
    assert result.recognised is False


@pytest.mark.asyncio
async def test_provider_result_is_mapped_onto_a_signal(monkeypatch):
    class _Provider:
        async def identify(self, wav, threshold=0.75):
            return {
                "user_id": "alice",
                "score": 0.91,
                "runner_up_user_id": "bob",
                "runner_up_score": 0.42,
            }

    monkeypatch.setattr(identity, "_get_voice_provider", lambda f: _Provider())

    result = await identify_by_voice(b"RIFFfake", threshold=0.75)
    assert result.user_id == "alice"
    assert result.confidence == pytest.approx(0.91)
    assert result.runner_up_user_id == "bob"
    assert result.margin == pytest.approx(0.49)


@pytest.mark.asyncio
async def test_below_threshold_result_maps_to_unrecognised(monkeypatch):
    class _Provider:
        async def identify(self, wav, threshold=0.75):
            return {
                "user_id": None,
                "score": 0.60,
                "runner_up_user_id": None,
                "runner_up_score": None,
            }

    monkeypatch.setattr(identity, "_get_voice_provider", lambda f: _Provider())
    assert (await identify_by_voice(b"RIFFfake")).recognised is False


# ---------------------------------------------------------------------------
# identify_speaker
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_recognised_voice_overrides_the_session_user(monkeypatch):
    async def _voice(wav, threshold=None):
        return sig("voice", "alice", 0.92, "bob", 0.30)

    monkeypatch.setattr(identity, "identify_by_voice", _voice)
    assert await identify_speaker(b"x", session_user_id="chris") == "alice"


@pytest.mark.asyncio
async def test_unrecognised_voice_keeps_the_session_user(monkeypatch):
    async def _voice(wav, threshold=None):
        return sig("voice", None, 0.0)

    monkeypatch.setattr(identity, "identify_by_voice", _voice)
    assert await identify_speaker(b"x", session_user_id="chris") == "chris"


@pytest.mark.asyncio
async def test_nothing_recognised_and_no_session_returns_none(monkeypatch):
    async def _voice(wav, threshold=None):
        return sig("voice", None, 0.0)

    monkeypatch.setattr(identity, "identify_by_voice", _voice)
    assert await identify_speaker(b"x") is None
