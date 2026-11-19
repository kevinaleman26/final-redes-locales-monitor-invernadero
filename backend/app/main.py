"""API REST de consulta para el dashboard."""
from contextlib import asynccontextmanager

import asyncpg
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.pool = await asyncpg.create_pool(settings.database_url, min_size=1, max_size=10)
    yield
    await app.state.pool.close()


app = FastAPI(title="Invernadero IoT API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_methods=["GET"],
    allow_headers=["*"],
)


def pool(request: Request) -> asyncpg.Pool:
    return request.app.state.pool


@app.get("/health")
async def health(request: Request):
    await pool(request).fetchval("SELECT 1")
    return {"status": "ok"}


@app.get("/api/stats")
async def stats(request: Request):
    row = await pool(request).fetchrow(
        """
        SELECT
          (SELECT count(*) FROM devices)                                              AS devices,
          (SELECT count(*) FROM devices WHERE last_seen > now() - interval '30 seconds') AS devices_online,
          (SELECT count(*) FROM readings)                                             AS total_readings,
          (SELECT count(*) FROM readings WHERE stored_at > now() - interval '1 minute') AS readings_last_minute,
          (SELECT avg(temperature)::float8 FROM readings WHERE measured_at > now() - interval '1 hour') AS avg_temperature_1h,
          (SELECT avg(humidity)::float8    FROM readings WHERE measured_at > now() - interval '1 hour') AS avg_humidity_1h
        """
    )
    return dict(row)


@app.get("/api/devices")
async def devices(request: Request):
    rows = await pool(request).fetch(
        """
        SELECT id, first_seen, last_seen,
               last_temperature::float8 AS last_temperature,
               last_humidity::float8    AS last_humidity,
               readings_count,
               last_seen > now() - interval '30 seconds' AS online
        FROM devices
        ORDER BY id
        """
    )
    return [dict(r) for r in rows]


@app.get("/api/devices/{device_id}")
async def device(request: Request, device_id: str):
    row = await pool(request).fetchrow(
        """
        SELECT id, first_seen, last_seen,
               last_temperature::float8 AS last_temperature,
               last_humidity::float8    AS last_humidity,
               readings_count,
               last_seen > now() - interval '30 seconds' AS online
        FROM devices WHERE id = $1
        """,
        device_id,
    )
    if row is None:
        raise HTTPException(404, "Dispositivo no encontrado")
    return dict(row)


@app.get("/api/readings")
async def readings(
    request: Request,
    device_id: str | None = None,
    minutes: int = Query(60, ge=1, le=60 * 24 * 30),
    limit: int = Query(500, ge=1, le=5000),
):
    rows = await pool(request).fetch(
        """
        SELECT id, message_id, device_id,
               temperature::float8 AS temperature,
               humidity::float8    AS humidity,
               measured_at, received_at, stored_at
        FROM readings
        WHERE ($1::text IS NULL OR device_id = $1)
          AND measured_at > now() - make_interval(mins => $2)
        ORDER BY measured_at DESC
        LIMIT $3
        """,
        device_id,
        minutes,
        limit,
    )
    return [dict(r) for r in rows]
