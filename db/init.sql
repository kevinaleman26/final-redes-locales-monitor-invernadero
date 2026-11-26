-- Esquema inicial. Se ejecuta automáticamente la primera vez que arranca Postgres
-- (cuando el volumen de datos está vacío).

CREATE TABLE IF NOT EXISTS devices (
    id                VARCHAR(64) PRIMARY KEY,
    first_seen        TIMESTAMPTZ NOT NULL,
    last_seen         TIMESTAMPTZ NOT NULL,
    last_temperature  NUMERIC(5, 2),
    last_humidity     NUMERIC(5, 2),
    last_soil_moisture NUMERIC(5, 2),                  -- NULL = el dispositivo no tiene sensor de tierra o no respondió
    readings_count    BIGINT      NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS readings (
    id           BIGSERIAL    PRIMARY KEY,
    message_id   UUID         NOT NULL UNIQUE,          -- idempotencia: un mensaje se guarda una sola vez
    device_id    VARCHAR(64)  NOT NULL REFERENCES devices (id),
    temperature  NUMERIC(5, 2) NOT NULL,
    humidity     NUMERIC(5, 2) NOT NULL CHECK (humidity BETWEEN 0 AND 100),
    soil_moisture NUMERIC(5, 2) CHECK (soil_moisture BETWEEN 0 AND 100), -- humedad de tierra (%), opcional
    measured_at  TIMESTAMPTZ  NOT NULL,                 -- hora reportada por el dispositivo (o de recepción)
    received_at  TIMESTAMPTZ  NOT NULL,                 -- hora en que el backend recibió la lectura
    stored_at    TIMESTAMPTZ  NOT NULL DEFAULT now()    -- hora en que se confirmó la transacción
);

CREATE INDEX IF NOT EXISTS idx_readings_device_time ON readings (device_id, measured_at DESC);
CREATE INDEX IF NOT EXISTS idx_readings_time        ON readings (measured_at DESC);
