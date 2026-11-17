"""T-552 (R-13): exactly one "your video is ready" email per completed job; none for failed
jobs or a lost race; a mail failure changes neither status nor ledger. Mock provider."""

import asyncio
import threading

from app.jobs import db
from app.providers import VideoPoll
from tests.test_charging import DONE, ScriptedPolls, charging, settings  # noqa: F401


class Recorder:
    def __init__(self, fail: bool = False):
        self.sent: list[tuple] = []
        self.fail = fail
        self.event = threading.Event()

    def send(self, to, subject, text, html=None):
        self.event.set()
        if self.fail:
            raise OSError("smtp down")
        self.sent.append((to, subject, text, html))


def wait(rec: Recorder, expect_none: bool = False):
    rec.event.wait(0.5 if expect_none else 5)
    for t in threading.enumerate():
        if t.name == "video-ready-email":
            t.join(5)


def make(charging, settings, outcome, rec):  # noqa: F811
    c = charging(credits=100, provider=ScriptedPolls(settings, outcome))
    c.service.email_sender = rec
    return c


def test_one_email_for_a_completed_job(charging, settings):  # noqa: F811
    async def run():
        rec = Recorder()
        c = make(charging, settings, DONE, rec)
        job_id = await c.approved_job()
        await c.service.poll_once()
        wait(rec)
        await c.service.poll_once()  # already completed: nothing more
        wait(rec, True)
        assert len(rec.sent) == 1
        to, subject, text, html = rec.sent[0]
        assert to == "owner@example.com" and subject.startswith("Your video is ready: “Hello")
        assert f"/videos/{job_id}" in text and "voice 10, video 43, total 53" in text
        assert "Hi Test, your talking video is ready." in text
        print(text)

    asyncio.run(run())


def test_no_email_for_a_failed_job(charging, settings):  # noqa: F811
    async def run():
        rec = Recorder()
        c = make(charging, settings, VideoPoll("failed", error="nope"), rec)
        await c.approved_job()
        await c.service.poll_once()
        wait(rec, True)
        assert rec.sent == []

    asyncio.run(run())


def test_no_email_when_the_transition_loses(charging, settings):  # noqa: F811
    async def run():
        rec = Recorder()
        c = make(charging, settings, DONE, rec)
        job_id = await c.approved_job()
        job = c.job(job_id)
        # Another poller already moved it: our compare-and-set matches nothing.
        assert c.store.transition(job_id, db.VIDEO_GENERATING, db.FAILED)
        await c.service._poll_job(job)
        wait(rec, True)
        assert rec.sent == [] and c.job(job_id)["status"] == db.FAILED

    asyncio.run(run())


def test_mail_failure_changes_nothing(charging, settings):  # noqa: F811
    async def run():
        rec = Recorder(fail=True)
        c = make(charging, settings, DONE, rec)
        job_id = await c.approved_job()
        await c.service.poll_once()
        wait(rec)
        assert c.job(job_id)["status"] == db.COMPLETED
        assert c.wallet() == (90 - 43, 0) and c.invariant()

    asyncio.run(run())
