from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class SensorMessage(BaseModel):
    """Lectura publicada por el dispositivo vía MQTT (tópico invernadero/<device_id>/lecturas)."""

    message_id: UUID
    device_id: str = Field(min_length=1, max_length=64)
    temperature: float = Field(ge=-40, le=85)
    humidity: float = Field(ge=0, le=100)
    measured_at: datetime | None = None
    received_at: datetime | None = None
