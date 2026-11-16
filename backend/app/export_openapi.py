"""Print the OpenAPI document to stdout: `uv run python -m app.export_openapi`.

Builds the app without starting its lifespan, so no database or provider is needed."""

import json

from .main import create_app


def main() -> None:
    print(json.dumps(create_app().openapi(), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
