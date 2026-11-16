"""The M2 auth contract (T-200) stays as agreed: every route, method and documented error status.

R-01. Needs no database: reads the OpenAPI document only."""

from app.main import create_app

EXPECTED = {
    ("/api/v1/auth/signup", "post"): {"201", "409", "422", "429"},
    ("/api/v1/auth/login", "post"): {"200", "401", "422", "429"},
    ("/api/v1/auth/logout", "post"): {"204"},
    ("/api/v1/auth/logout-all", "post"): {"204", "401"},
    ("/api/v1/auth/me", "get"): {"200", "401"},
    ("/api/v1/auth/verify-email", "post"): {"204", "400", "422"},
    ("/api/v1/auth/verify-email/resend", "post"): {"204", "401", "429"},
    ("/api/v1/auth/password/forgot", "post"): {"202", "422", "429"},
    ("/api/v1/auth/password/reset/check", "post"): {"200", "400", "422"},
    ("/api/v1/auth/password/reset", "post"): {"204", "400", "422"},
    ("/api/v1/auth/password/change", "post"): {"204", "401", "422"},
}


def test_auth_routes_match_the_contract():
    """R-01: each agreed auth route exists with its method and documented statuses."""
    paths = create_app().openapi()["paths"]
    found = {
        (path, method): set(op["responses"])
        for path, ops in paths.items()
        if path.startswith("/api/v1/auth")
        for method, op in ops.items()
    }
    assert set(found) == set(EXPECTED)
    for key, statuses in EXPECTED.items():
        assert statuses <= found[key], key


def test_user_shape_has_the_fields_the_screens_need():
    """R-01: the account page needs name, email, verification, role and the session count."""
    schema = create_app().openapi()["components"]["schemas"]["UserOut"]
    assert set(schema["required"]) == {
        "id",
        "name",
        "email",
        "email_verified",
        "role",
        "active_sessions",
    }
