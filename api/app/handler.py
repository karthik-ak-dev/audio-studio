"""Lambda entry point via Mangum."""

from typing import Any

from mangum import Mangum

from app.main import app

handler: Any = Mangum(app, lifespan="off")
