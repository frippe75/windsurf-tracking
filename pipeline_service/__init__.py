"""pipeline_service — a thin FastAPI wrapper over pipeline_engine.

Lives OUTSIDE pipeline_engine (the engine core forbids FastAPI). It exposes the model
fleet + routing so the app can drive the SAM on/off + v2/v3 + local/external toggle
without rebuilding the pinned annotation-api image. Deploy as its own service/ingress.
"""
from .app import create_app

__all__ = ["create_app"]
