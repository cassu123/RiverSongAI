"""Stopping a turn stops all of it, whatever stage it is at."""
import asyncio

from core.turn_runner import TurnRunner


def make(streaming=True):
    sent, cancels = [], []

    async def send(evt):
        sent.append(evt)

    runner = TurnRunner(send, lambda: streaming, on_cancel=lambda: cancels.append(1))
    return runner, sent, cancels


def test_a_stop_during_transcription_stops_the_whole_turn():
    async def scenario():
        runner, sent, cancels = make()
        stages = []

        async def turn():
            stages.append("transcribing")
            await asyncio.sleep(0.2)          # still transcribing when stopped
            stages.append("answering")        # must never be reached

        await runner.start(turn())
        await asyncio.sleep(0.02)
        await runner.cancel()
        await asyncio.sleep(0.3)
        return stages, runner.running, cancels

    stages, running, cancels = asyncio.run(scenario())
    assert stages == ["transcribing"]
    assert running is False
    assert len(cancels) >= 1                  # generation is cancelled too


def test_a_new_turn_stops_the_one_still_running():
    async def scenario():
        runner, sent, _ = make()
        finished = []

        async def turn(name, secs):
            await asyncio.sleep(secs)
            finished.append(name)

        await runner.start(turn("first", 0.3))
        await asyncio.sleep(0.02)
        await runner.start(turn("second", 0.01))
        await asyncio.sleep(0.4)
        return finished

    assert asyncio.run(scenario()) == ["second"]


def test_stream_done_is_still_sent_after_a_stop():
    async def scenario():
        runner, sent, _ = make(streaming=True)

        async def turn():
            await asyncio.sleep(1)

        await runner.start(turn())
        await asyncio.sleep(0.02)
        await runner.cancel()
        return sent

    assert asyncio.run(scenario()) == [{"type": "stream_done"}]


def test_cancelling_a_turn_that_has_not_started_yet_is_safe():
    async def scenario():
        runner, _, _ = make()

        async def turn():
            await asyncio.sleep(1)

        await runner.start(turn())
        await runner.cancel()                 # same tick: the task has not run yet
        return runner.running

    assert asyncio.run(scenario()) is False


def test_cancel_with_nothing_running_is_harmless():
    async def scenario():
        runner, sent, _ = make()
        await runner.cancel()
        return sent

    assert asyncio.run(scenario()) == []


def test_a_failing_turn_is_logged_not_raised():
    async def scenario():
        runner, sent, _ = make()

        async def turn():
            raise RuntimeError("whisper crashed")

        task = await runner.start(turn())
        await task
        return sent

    assert asyncio.run(scenario()) == [{"type": "stream_done"}]
