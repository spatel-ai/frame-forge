"""API contract tests (T-104): error shape, request ids, health, OpenAPI. Mock provider only."""

import ast
import logging
from dataclasses import replace
from io import BytesIO
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine

from app.core.config import Settings
from app.jobs.schemas import ConfigOut, JobOut
from app.main import create_app


@pytest.fixture
def settings(tmp_path, database_url):
    return replace(
        Settings(),
        provider="mock",
        data_dir=tmp_path,
        poll_interval_seconds=0.05,
        database_url=database_url,
    )


@pytest.fixture
def client(settings, sign_up, grant):
    # start_poller=False: nothing runs in the background, so jobs stay where the test puts them.
    # https and signed in: job routes need a session (T-204), whose cookie is Secure.
    # Credits: creating a job charges the voice (T-304), which is checked before input errors.
    with TestClient(create_app(settings, start_poller=False), base_url="https://testserver") as c:
        grant(c, sign_up(c), 1_000)
        yield c


def png() -> bytes:
    out = BytesIO()
    Image.new("RGB", (512, 512), "teal").save(out, "PNG")
    return out.getvalue()


def assert_error(response, status, code):
    assert response.status_code == status
    body = response.json()
    # `fields` appears only on input errors (D-029); the tests below check it where it applies.
    assert set(body) <= {"detail", "code", "fields"}
    assert isinstance(body["detail"], str) and body["detail"]
    assert body["code"] == code
    return body


def create_job(client) -> dict:
    r = client.post(
        "/api/v1/jobs",
        files={"image": ("me.png", png(), "image/png")},
        data={"script": "Hello.", "language": "English"},
    )
    assert r.status_code == 201
    return r.json()


def test_job_not_found_error_shape(client):
    """R-42: unknown job id gives job_not_found."""
    body = assert_error(client.get("/api/v1/jobs/nope"), 404, "job_not_found")
    assert body["detail"] == "Job not found."
    assert_error(client.post("/api/v1/jobs/nope/approve"), 404, "job_not_found")


def test_media_not_ready_error_shape(client):
    """R-42: a video that does not exist yet gives not_available_yet."""
    job_id = create_job(client)["id"]
    body = assert_error(client.get(f"/api/v1/jobs/{job_id}/video"), 404, "not_available_yet")
    assert body["detail"] == "Not available yet."


def test_wrong_state_error_shape(client):
    """R-42: approving a job that is no longer audio_ready gives wrong_state."""
    job_id = create_job(client)["id"]  # mock voice is synchronous: already audio_ready
    assert client.post(f"/api/v1/jobs/{job_id}/approve").status_code == 200
    assert_error(client.post(f"/api/v1/jobs/{job_id}/approve"), 409, "wrong_state")


def test_invalid_input_error_shape(client):
    """R-42: the service's ValidationError gives invalid_input with the existing message."""
    r = client.post(
        "/api/v1/jobs",
        files={"image": ("x.png", b"junk", "image/png")},
        data={"script": "hi", "language": "English"},
    )
    body = assert_error(r, 422, "invalid_input")
    assert body["detail"].startswith("The file is not a readable image.")
    assert set(body["fields"]) == {"image"}


def test_missing_form_field_gives_validation_error(client):
    """R-42: FastAPI request validation is flattened into one string with code validation_error."""
    r = client.post(
        "/api/v1/jobs",
        files={"image": ("me.png", png(), "image/png")},
        data={"language": "English"},
    )
    body = assert_error(r, 422, "validation_error")
    assert "script" in body["detail"]
    assert body["fields"] == {"script": "This is required."}


def test_unknown_route_and_wrong_method(client):
    """R-42: unknown routes give not_found and wrong methods give method_not_allowed."""
    assert_error(client.get("/api/v1/nothing-here"), 404, "not_found")
    assert_error(client.delete("/api/v1/config"), 405, "method_not_allowed")


def test_old_unversioned_routes_are_gone(client):
    """R-42: /api/config no longer exists and answers in the standard error shape."""
    assert_error(client.get("/api/config"), 404, "not_found")
    assert_error(client.get("/api/jobs/x"), 404, "not_found")


def test_internal_error_hides_exception_text(settings, caplog):
    """R-42: an unexpected exception gives internal_error without its text, with a request id."""
    app = create_app(settings, start_poller=False)

    @app.get("/boom")
    def boom():
        raise RuntimeError("secret-database-password-xyz")

    with TestClient(app, raise_server_exceptions=False) as c:
        with caplog.at_level(logging.INFO):
            r = c.get("/boom", headers={"X-Request-ID": "req-500"})
    body = assert_error(r, 500, "internal_error")
    assert "secret-database-password-xyz" not in r.text
    assert "Traceback" not in r.text
    assert r.headers["X-Request-ID"] == "req-500"
    assert body["detail"] == "Something went wrong on our side. Please try again."


def test_request_id_generated_when_absent(client):
    """R-42: a request without X-Request-ID gets a generated one."""
    rid = client.get("/api/v1/config").headers["X-Request-ID"]
    assert 1 <= len(rid) <= 64
    assert rid != client.get("/api/v1/config").headers["X-Request-ID"]


def test_request_id_echoed_when_valid(client):
    """R-42: a valid incoming X-Request-ID is returned unchanged, on errors too."""
    r = client.get("/api/v1/config", headers={"X-Request-ID": "abc-123_XYZ"})
    assert r.headers["X-Request-ID"] == "abc-123_XYZ"
    r = client.get("/api/v1/jobs/nope", headers={"X-Request-ID": "abc-123_XYZ"})
    assert r.headers["X-Request-ID"] == "abc-123_XYZ"


@pytest.mark.parametrize("bad", ["has space", "x" * 65, "semi;colon", "naïve"])
def test_request_id_replaced_when_invalid(client, bad):
    """R-42: an invalid incoming X-Request-ID is replaced by a generated one."""
    r = client.get("/api/v1/config", headers={"X-Request-ID": bad.encode("latin-1")})
    assert r.headers["X-Request-ID"] != bad
    assert 1 <= len(r.headers["X-Request-ID"]) <= 64


def test_request_id_is_on_log_lines(client, caplog):
    """R-42: log lines written while handling a request carry its id."""
    with caplog.at_level(logging.INFO):
        client.get("/api/v1/config", headers={"X-Request-ID": "trace-me-1"})
    lines = [r for r in caplog.records if r.name == "app.request"]
    assert lines and all(r.request_id == "trace-me-1" for r in lines)
    assert "/api/v1/config" in lines[0].getMessage()


def test_healthz_ok(client):
    """R-42: /healthz answers ok at the root when the database answers."""
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_healthz_503_when_database_is_down(settings):
    """R-42: /healthz gives database_unavailable when the database does not answer."""
    app = create_app(settings, start_poller=False)
    with TestClient(app) as c:
        real = app.state.service.store.engine
        app.state.service.store.engine = create_engine(
            "postgresql+psycopg://x:y@127.0.0.1:1/none", connect_args={"connect_timeout": 1}
        )
        try:
            body = assert_error(c.get("/healthz"), 503, "database_unavailable")
        finally:
            app.state.service.store.engine.dispose()
            app.state.service.store.engine = real
    assert "127.0.0.1" not in body["detail"]


def test_openapi_lists_every_field_and_the_error_model(settings):
    """R-42: the OpenAPI document declares JobOut, ConfigOut and ErrorOut with all fields."""
    spec = create_app(settings).openapi()
    schemas = spec["components"]["schemas"]
    assert set(schemas["JobOut"]["properties"]) == set(JobOut.model_fields)
    assert set(schemas["ConfigOut"]["properties"]) == set(ConfigOut.model_fields)
    assert set(schemas["ErrorOut"]["properties"]) == {"detail", "code", "fields"}
    # Deliberate contract change (T-157, D-029): `fields` is optional, so it is not required.
    assert set(schemas["ErrorOut"]["required"]) == {"detail", "code"}
    assert set(schemas["JobOut"]["properties"]["status"]["enum"]) == {
        "audio_generating",
        "audio_ready",
        "video_submitting",
        "video_generating",
        "completed",
        "failed",
    }
    paths = spec["paths"]
    assert "/api/v1/config" in paths and "/healthz" in paths
    assert not any(p.startswith("/api/") and not p.startswith("/api/v1/") for p in paths)
    get_job = paths["/api/v1/jobs/{job_id}"]["get"]["responses"]
    assert get_job["404"]["content"]["application/json"]["schema"]["$ref"].endswith("/ErrorOut")
    assert get_job["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/JobOut")


def test_openapi_declares_project_error_shape_for_every_error():
    """D-012: every declared 4xx/5xx is ErrorOut; no FastAPI default validation schema remains."""
    doc = create_app().openapi()
    schemas = doc["components"]["schemas"]
    assert "HTTPValidationError" not in schemas and "ValidationError" not in schemas
    error_ref = "#/components/schemas/ErrorOut"
    for path, methods in doc["paths"].items():
        for method, op in methods.items():
            where = f"{method.upper()} {path}"
            errors = {c: r for c, r in op["responses"].items() if c[:1] in ("4", "5")}
            for code, response in errors.items():
                ref = response.get("content", {}).get("application/json", {}).get("schema", {})
                assert ref.get("$ref") == error_ref, f"{where} {code}"
            # A route with path, query or body input can fail validation (422).
            if op.get("parameters") or op.get("requestBody"):
                assert "422" in errors, f"{where} does not declare 422"


def test_core_does_not_import_from_feature_packages():
    """D-012/D-022: `app.core` imports no feature package, so features can be built in parallel
    without editing shared core files. Every package beside `core` under `app/` counts."""
    core = Path(__file__).resolve().parents[1] / "app" / "core"
    app_dir = core.parent
    forbidden = tuple(
        sorted(
            {p.name for p in app_dir.iterdir() if p.is_dir() and (p / "__init__.py").exists()}
            - {"core"}
        )
        + ["providers"]
    )
    assert {"auth", "jobs", "payments", "wallet"} <= set(forbidden)
    for source in sorted(core.glob("*.py")):
        for node in ast.walk(ast.parse(source.read_text(), str(source))):
            names: list[str] = []
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom):
                # Relative: `..jobs.x` is level 2, module "jobs.x"; `from .. import jobs` too.
                base = node.module or ""
                names = [base] + [f"{base}.{a.name}".strip(".") for a in node.names]
                if node.level == 1:  # `from . import x` / `from .x import y` stay inside core
                    continue
                if node.level == 0 and not base.startswith("app"):
                    continue
                if node.level == 0:
                    base = base.removeprefix("app").lstrip(".")
                    names = [base] + [f"{base}.{a.name}".strip(".") for a in node.names]
            for name in names:
                top = name.removeprefix("app.").split(".")[0]
                assert top not in forbidden, f"{source.name} imports {name!r}"


def test_job_and_config_json_keys_are_unchanged(client):
    """R-42: the response bodies keep exactly the keys clients already use."""
    assert set(client.get("/api/v1/config").json()) == set(ConfigOut.model_fields)
    job = create_job(client)
    assert set(job) == set(JobOut.model_fields)
    assert job["status"] in JobOut.model_fields["status"].annotation.__args__


def _post_job(client, *, image=("me.png", None), script="Hello.", language="English", omit=()):
    name, data = image
    files = {"image": (name, png() if data is None else data, "image/png")}
    form = {"script": script, "language": language}
    if "image" in omit:
        files = None
    for key in omit:
        form.pop(key, None)
    return client.post("/api/v1/jobs", files=files, data=form)


def _small_png() -> bytes:
    out = BytesIO()
    Image.new("RGB", (100, 100)).save(out, "PNG")
    return out.getvalue()


def _gif() -> bytes:
    out = BytesIO()
    Image.new("RGB", (512, 512)).save(out, "GIF")
    return out.getvalue()


@pytest.mark.parametrize(
    "kwargs, code, field",
    [
        ({"image": ("x.png", b"")}, "invalid_input", "image"),
        ({"image": ("x.png", b"junk")}, "invalid_input", "image"),
        ({"image": ("x.png", b"0" * (10 * 1024 * 1024 + 1))}, "invalid_input", "image"),
        ({"image": ("x.png", _small_png())}, "invalid_input", "image"),
        ({"image": ("x.gif", _gif())}, "invalid_input", "image"),
        ({"script": "   "}, "invalid_input", "script"),
        ({"script": "a" * 801}, "invalid_input", "script"),
        ({"script": "नमस्ते दोस्तों"}, "invalid_input", "script"),
        ({"language": "French"}, "invalid_input", "language"),
        ({"omit": ("image",)}, "validation_error", "image"),
        ({"omit": ("script",)}, "validation_error", "script"),
        ({"omit": ("language",)}, "validation_error", "language"),
    ],
)
def test_every_create_job_input_error_names_its_field(client, kwargs, code, field):
    """D-029: each 422 from POST /jobs carries `fields` keyed by the input at fault, with text."""
    body = assert_error(_post_job(client, **kwargs), 422, code)
    assert set(body["fields"]) == {field}
    assert isinstance(body["fields"][field], str) and body["fields"][field]


def test_all_missing_inputs_are_all_named(client):
    """D-029: several missing inputs are reported together, each under its own name."""
    r = client.post("/api/v1/jobs", data={})
    body = assert_error(r, 422, "validation_error")
    assert set(body["fields"]) == {"image", "script", "language"}
    assert set(body["fields"].values()) == {"This is required."}


def test_non_input_errors_have_no_fields(client):
    """D-029: 404, 405 and 409 never carry `fields`, not even as null."""
    job_id = create_job(client)["id"]
    client.post(f"/api/v1/jobs/{job_id}/approve")
    for r in (
        client.get("/api/v1/jobs/nope"),
        client.get(f"/api/v1/jobs/{job_id}/audio/x"),
        client.delete("/api/v1/config"),
        client.post(f"/api/v1/jobs/{job_id}/approve"),
    ):
        assert r.status_code in (404, 405, 409)
        assert "fields" not in r.json()
