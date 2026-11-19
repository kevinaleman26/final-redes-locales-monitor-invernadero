"""Consumidor de RabbitMQ que persiste cada lectura en Postgres dentro de una transacción.

Garantías:
  * El mensaje solo se confirma (ack) DESPUÉS de que la transacción hace commit.
  * Si la BD falla, se hace rollback y el mensaje se reencola (no se pierde).
  * Si el mensaje es inválido, se rechaza sin reencolar -> va a la DLQ.
  * Idempotencia por message_id: una entrega duplicada no genera una fila duplicada.
"""
import asyncio
import json
import logging
from datetime import datetime, timezone

import aio_pika
import asyncpg
from pydantic import ValidationError

from app.config import settings
from app.messaging import declare_queues
from app.schemas import SensorMessage

logging.basicConfig(level=logging.INFO, format="%(asctime)s [worker] %(levelname)s %(message)s")
log = logging.getLogger(__name__)

INSERT_DEVICE = """
INSERT INTO devices (id, first_seen, last_seen)
VALUES ($1, $2, $2)
ON CONFLICT (id) DO NOTHING
"""

INSERT_READING = """
INSERT INTO readings (message_id, device_id, temperature, humidity, measured_at, received_at)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (message_id) DO NOTHING
RETURNING id
"""

UPDATE_DEVICE = """
UPDATE devices
SET last_seen        = GREATEST(last_seen, $2),
    last_temperature = $3,
    last_humidity    = $4,
    readings_count   = readings_count + 1
WHERE id = $1
"""


async def persist(pool: asyncpg.Pool, msg: SensorMessage) -> bool:
    """Guarda la lectura de forma atómica. Devuelve False si era un duplicado."""
    received_at = msg.received_at or datetime.now(timezone.utc)
    measured_at = msg.measured_at or received_at
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(INSERT_DEVICE, msg.device_id, measured_at)
            reading_id = await conn.fetchval(
                INSERT_READING,
                msg.message_id,
                msg.device_id,
                round(msg.temperature, 2),
                round(msg.humidity, 2),
                measured_at,
                received_at,
            )
            if reading_id is None:
                return False
            await conn.execute(
                UPDATE_DEVICE, msg.device_id, measured_at, round(msg.temperature, 2), round(msg.humidity, 2)
            )
            return True


def parse(message: aio_pika.abc.AbstractIncomingMessage) -> SensorMessage:
    """Convierte el payload MQTT en SensorMessage.

    - device_id: del payload o, si falta, del tópico (routing key invernadero.<device_id>.lecturas).
    - received_at: hora de llegada al broker (timestamp AMQP) o la hora actual.
    """
    raw = json.loads(message.body)
    if not isinstance(raw, dict):
        raise ValueError("el payload debe ser un objeto JSON")
    parts = (message.routing_key or "").split(".")
    if "device_id" not in raw and len(parts) == 3:
        raw["device_id"] = parts[1]
    if "measured_at" not in raw and "ts" in raw:
        raw["measured_at"] = raw["ts"]
    raw.setdefault("received_at", message.timestamp or datetime.now(timezone.utc))
    return SensorMessage.model_validate(raw)


async def handle(pool: asyncpg.Pool, message: aio_pika.abc.AbstractIncomingMessage) -> None:
    try:
        data = parse(message)
    except (ValidationError, ValueError) as exc:
        reason = exc.errors()[0]["msg"] if isinstance(exc, ValidationError) else str(exc)
        log.warning("Mensaje inválido enviado a DLQ: %s | %s", message.body[:200], reason)
        await message.reject(requeue=False)
        return

    try:
        inserted = await persist(pool, data)
    except Exception:
        log.exception("Error de BD (rollback). Reencolando mensaje %s", data.message_id)
        await asyncio.sleep(2)
        await message.nack(requeue=True)
        return

    await message.ack()
    if inserted:
        log.info("OK %s T=%.2f H=%.2f", data.device_id, data.temperature, data.humidity)
    else:
        log.info("Duplicado ignorado %s", data.message_id)


async def connect_with_retry(factory, what: str):
    for attempt in range(1, 31):
        try:
            return await factory()
        except Exception as exc:  # noqa: BLE001
            log.warning("No se pudo conectar a %s (intento %d): %s", what, attempt, exc)
            await asyncio.sleep(2)
    raise RuntimeError(f"No fue posible conectar a {what}")


async def main() -> None:
    pool = await connect_with_retry(lambda: asyncpg.create_pool(settings.database_url, min_size=1, max_size=10), "Postgres")
    connection = await connect_with_retry(lambda: aio_pika.connect_robust(settings.rabbitmq_url), "RabbitMQ")

    async with connection:
        channel = await connection.channel()
        await channel.set_qos(prefetch_count=settings.worker_prefetch)
        queue = await declare_queues(channel, settings.queue_name)
        log.info("Escuchando cola '%s'", settings.queue_name)
        await queue.consume(lambda m: handle(pool, m))
        await asyncio.Future()  # corre para siempre


if __name__ == "__main__":
    asyncio.run(main())
