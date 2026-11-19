# Invernadero IoT · Lectura de temperatura y humedad

Sistema dockerizado que recibe lecturas de dispositivos IoT (identificador, temperatura y humedad) por **MQTT** directamente en **RabbitMQ**, las persiste de forma **transaccional** en **PostgreSQL** mediante un backend **FastAPI (uv)** y las muestra en un **dashboard Next.js**. Incluye **pgAdmin** para administrar la base de datos desde el navegador.

## Arquitectura

```
 ┌──────────────┐  MQTT :1883 (QoS 1)  ┌──────────────────────────────────┐        ┌────────────────┐
 │ Dispositivos │ ───────────────────▶ │             RabbitMQ             │ ─────▶ │ backend-worker │
 │ IoT / test   │  invernadero/<id>/   │ amq.topic ─▶ sensor.readings     │        │ (uv + asyncpg) │
 └──────────────┘       lecturas       │              sensor.readings.dlq │        └───────┬────────┘
                                       └──────────────────────────────────┘                │ transacción
                                                                                           ▼
 ┌──────────────┐   HTTP   ┌──────────────┐   HTTP   ┌─────────────────────┐       ┌─────────────┐
 │  Navegador   │ ───────▶ │   frontend   │ ───────▶ │    backend-api      │ ────▶ │ PostgreSQL  │ ◀── pgAdmin
 └──────────────┘          │  (Next.js)   │  proxy   │ (FastAPI + uv)      │       └─────────────┘
                           └──────────────┘          └─────────────────────┘
```

| Servicio / archivo     | Tecnología                       | Función |
|------------------------|----------------------------------|---------|
| `test-comunication.py` | Python + paho-mqtt (en el host)  | Emula un dispositivo que publica una lectura por MQTT cada 10 s |
| `rabbitmq`             | RabbitMQ 3.13 + plugin MQTT      | Broker MQTT (puerto 1883) y cola `sensor.readings` con cola de errores `sensor.readings.dlq` |
| `backend-worker`       | Proyecto uv (FastAPI) + asyncpg  | Consume la cola y guarda cada lectura en una transacción |
| `backend-api`          | FastAPI + uvicorn (uv)           | API REST de consulta para el dashboard |
| `frontend`             | Next.js 15 + Recharts            | Dashboard con KPIs, gráficas y tablas (se refresca cada 3 s) |
| `postgres`             | PostgreSQL 16                    | Tablas `devices` y `readings` |
| `pgadmin`              | pgAdmin 4                        | Gestor web de la base de datos (servidor ya preconfigurado) |

> **¿Por qué RabbitMQ y no Kafka?** Para este caso (mensajes pequeños, procesamiento uno a uno, necesidad de ack/reintento por mensaje) RabbitMQ es más ligero, no necesita ZooKeeper/KRaft, trae de serie colas de *dead-letter* y una consola web, y además funciona como **broker MQTT** sin servicios adicionales.

### Cómo entra un mensaje MQTT a la cola

Todo se configura dentro de RabbitMQ, en la carpeta [rabbitmq/](rabbitmq/):

| Archivo | Qué hace |
|---------|----------|
| [enabled_plugins](rabbitmq/enabled_plugins) | Activa `rabbitmq_mqtt` (además de la consola web) |
| [20-invernadero.conf](rabbitmq/20-invernadero.conf) | Abre el listener MQTT en el 1883, exige usuario y contraseña y carga las definiciones |
| [definitions.template.json](rabbitmq/definitions.template.json) | Declara el usuario, las colas `sensor.readings` y `sensor.readings.dlq`, y el **binding** `amq.topic` → `sensor.readings` con la clave `invernadero.*.lecturas` |
| [entrypoint.sh](rabbitmq/entrypoint.sh) | Rellena la plantilla con el usuario y la contraseña de `.env` antes de arrancar RabbitMQ (al importar definiciones, RabbitMQ ya no crea el usuario por defecto) |

El plugin MQTT publica cada mensaje en el exchange `amq.topic` y convierte el tópico en *routing key* reemplazando `/` por `.`:

```
tópico MQTT:  invernadero/inv-01/lecturas
routing key:  invernadero.inv-01.lecturas   ──(binding invernadero.*.lecturas)──▶  sensor.readings
```

### Control de la transacción

El `backend-worker` garantiza que ninguna lectura se pierda ni se duplique:

1. Valida el mensaje (rango de temperatura −40…85 °C, humedad 0…100 %, `message_id` UUID, `device_id` obligatorio).
   Si es inválido → `reject` sin reencolar → va a **`sensor.readings.dlq`**.
2. Abre una transacción en Postgres: registra el dispositivo si no existe, inserta la lectura y actualiza los últimos valores del dispositivo.
3. Solo después del `COMMIT` hace `ack` del mensaje en RabbitMQ.
   Si la base falla → `ROLLBACK` + `nack` con reencolado (se reintenta).
4. **Idempotencia:** el dispositivo genera un `message_id` (UUID) por lectura y la tabla lo tiene como `UNIQUE`. Si MQTT (QoS 1) o RabbitMQ reentregan un mensaje ya guardado, se ignora.

## Requisitos

- Docker Desktop (o Docker Engine) con **Docker Compose v2** (`docker compose version`).
- Puertos libres en el host (configurables en `.env`): `3100`, `8000`, `5050`, `5433`, `5672`, `15672` y `1883`.
- Para el script de prueba: [uv](https://docs.astral.sh/uv/) (recomendado) o Python 3 con `pip install paho-mqtt`.

No necesitas Python, uv ni Node para el sistema en sí: todo se construye dentro de los contenedores.

## Levantar el proyecto

```bash
# 1. Crear el archivo de variables (solo la primera vez)
cp .env.example .env

# 2. Construir y levantar todo
docker compose up -d --build

# 3. Ver el estado de los servicios
docker compose ps
```

El primer build tarda unos minutos (descarga de imágenes y dependencias). La base de datos arranca vacía: el dashboard mostrará datos en cuanto un dispositivo (o el script de prueba) empiece a publicar lecturas.

## Probar la comunicación

[test-comunication.py](test-comunication.py) emula un dispositivo IoT y publica temperatura, humedad e identificador por MQTT **cada 10 segundos**, con QoS 1 (el broker confirma cada mensaje).

```bash
uv run test-comunication.py          # uv instala paho-mqtt automáticamente
# o bien
pip install paho-mqtt && python3 test-comunication.py
```

Salida esperada:

```
Publicando lecturas de 'inv-01' en mqtt://localhost:1883 tópico 'invernadero/inv-01/lecturas' cada 10.0s (Ctrl+C para detener)
[21:12:01] #1 (confirmado) -> {"message_id": "3b9e...", "device_id": "inv-01", "temperature": 24.68, "humidity": 63.22, "ts": "..."}
```

Opciones:

| Opción | Default | Descripción |
|--------|---------|-------------|
| `--device-id` | `inv-01` | Identificador del dispositivo emulado |
| `--interval` | `10` | Segundos entre envíos |
| `--count` | `0` (infinito) | Cantidad de envíos antes de terminar |
| `--host` / `--port` | `localhost` / `1883` | Dirección del broker MQTT |
| `--user` / `--password` | `invernadero` / `invernadero` | Credenciales MQTT (las de RabbitMQ en `.env`) |
| `--qos` | `1` | QoS MQTT (0 o 1) |

Para emular varios dispositivos a la vez, abre una terminal por cada uno:

```bash
uv run test-comunication.py --device-id inv-01
uv run test-comunication.py --device-id inv-02
```

## Accesos

| Qué | URL | Credenciales (por defecto) |
|-----|-----|----------------------------|
| Dashboard | http://localhost:3100 | — |
| API (Swagger) | http://localhost:8000/docs | — |
| pgAdmin | http://localhost:5050 | Entra directo. Al abrir el servidor **Invernadero** pide la contraseña de Postgres: `invernadero` |
| RabbitMQ (consola) | http://localhost:15672 | `invernadero` / `invernadero` |
| Broker MQTT (dispositivos) | `mqtt://localhost:1883` | `invernadero` / `invernadero` |
| PostgreSQL (cliente externo) | `localhost:5433`, BD `invernadero` | `invernadero` / `invernadero` |

Todos los valores se cambian en `.env`. Si algún puerto ya está ocupado en tu máquina, cambia la variable `*_PORT` correspondiente y vuelve a ejecutar `docker compose up -d`.

## Formato de los datos del dispositivo

Cada dispositivo publica **un mensaje por lectura** en el tópico:

```
invernadero/<device_id>/lecturas
```

Payload JSON (QoS 1 recomendado):

```json
{
  "message_id": "3b9e5e37-095b-4b60-bb59-20b35c0ae7e4",
  "device_id": "inv-01",
  "temperature": 23.5,
  "humidity": 60.1,
  "ts": "2026-11-18T20:00:00Z"
}
```

| Campo | Obligatorio | Descripción |
|-------|-------------|-------------|
| `message_id` | Sí | UUID generado por el dispositivo para cada lectura (evita duplicados en reintentos) |
| `temperature` | Sí | °C, entre −40 y 85 |
| `humidity` | Sí | %, entre 0 y 100 |
| `device_id` | No | Si falta, se toma del tópico |
| `ts` | No | Hora de medición (ISO 8601). Si falta, se usa la hora de recepción en el backend |

Los mensajes publicados en tópicos que no coinciden con `invernadero/<id>/lecturas` no entran a la cola.

Ejemplo para un ESP32 (Arduino, librería `PubSubClient`):

```cpp
#include <WiFi.h>
#include <PubSubClient.h>

WiFiClient net;
PubSubClient mqtt(net);

void setup() {
  // ... conectar WiFi ...
  mqtt.setServer("IP_DEL_SERVIDOR", 1883);
  mqtt.connect("inv-07", "invernadero", "invernadero");
}

void loop() {
  char payload[200];
  snprintf(payload, sizeof(payload),
           "{\"message_id\":\"%s\",\"temperature\":%.2f,\"humidity\":%.2f}",
           uuid, t, h);                       // uuid: generar uno nuevo por lectura
  mqtt.publish("invernadero/inv-07/lecturas", payload);
  mqtt.loop();
  delay(10000);
}
```

> `PubSubClient` publica con QoS 0. Si necesitas QoS 1 desde el ESP32, usa `AsyncMqttClient` o `esp-mqtt` (ESP-IDF).

## API REST

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/health` | Estado del servicio y conexión a la BD |
| GET | `/api/stats` | Totales, dispositivos en línea, promedios de la última hora |
| GET | `/api/devices` | Lista de dispositivos con su última lectura y estado (`online` = reportó en los últimos 30 s) |
| GET | `/api/devices/{id}` | Detalle de un dispositivo |
| GET | `/api/readings?device_id=&minutes=60&limit=500` | Lecturas filtradas por dispositivo y ventana de tiempo |

El frontend no llama al backend directamente desde el navegador: usa un proxy interno de Next.js (`/api/*` → `http://backend-api:8000/api/*`), así no hay problemas de CORS ni hace falta exponer la URL del backend.

## Base de datos

El esquema se crea automáticamente desde [db/init.sql](db/init.sql) la **primera vez** que arranca Postgres:

- **`devices`**: `id`, `first_seen`, `last_seen`, `last_temperature`, `last_humidity`, `readings_count`.
- **`readings`**: `id`, `message_id` (único), `device_id` (FK), `temperature`, `humidity`, `measured_at` (hora del dispositivo), `received_at` (hora de recepción en el backend), `stored_at` (hora del commit).

> Si modificas `init.sql`, debes borrar el volumen para que se vuelva a ejecutar: `docker compose down -v`.

## Comandos útiles

```bash
# Logs en vivo del procesamiento
docker compose logs -f backend-worker

# Escalar los consumidores (procesamiento en paralelo)
docker compose up -d --scale backend-worker=3

# Ver mensajes pendientes y rechazados
docker compose exec rabbitmq rabbitmqctl list_queues name messages

# Vaciar la base de datos (conserva el esquema)
docker compose exec postgres psql -U invernadero -d invernadero -c "TRUNCATE readings, devices RESTART IDENTITY;"

# Reconstruir un servicio tras cambiar su código
docker compose up -d --build backend-api backend-worker

# Apagar todo (conserva los datos)
docker compose down

# Apagar todo y BORRAR los datos (BD, colas, pgAdmin)
docker compose down -v
```

## Estructura del proyecto

```
.
├── docker-compose.yml
├── .env.example
├── test-comunication.py            # emulador de dispositivo (MQTT cada 10 s)
├── db/init.sql                     # esquema de PostgreSQL
├── pgadmin/servers.json            # servidor preconfigurado en pgAdmin
├── rabbitmq/                       # configuración del broker MQTT y de las colas
│   ├── enabled_plugins
│   ├── 20-invernadero.conf
│   ├── definitions.template.json
│   └── entrypoint.sh
├── backend/                        # proyecto uv (FastAPI)
│   ├── pyproject.toml / uv.lock
│   └── app/
│       ├── main.py                 # API REST
│       ├── worker.py               # consumidor transaccional
│       ├── schemas.py              # validación del mensaje
│       ├── messaging.py            # declaración de colas
│       └── config.py
├── frontend/                       # Next.js (dashboard)
│   └── app/
│       ├── page.tsx
│       └── api/[...path]/route.ts  # proxy hacia el backend
└── docs/                           # documentación en PDF
```

## Desarrollo local (opcional, sin Docker para el código)

Con la infraestructura en Docker (`docker compose up -d postgres rabbitmq`):

```bash
# Backend
cd backend
export DATABASE_URL=postgresql://invernadero:invernadero@localhost:5433/invernadero
export RABBITMQ_URL=amqp://invernadero:invernadero@localhost:5672/
uv sync
uv run uvicorn app.main:app --reload      # API
uv run python -m app.worker               # worker (otra terminal)

# Frontend
cd frontend
npm install
BACKEND_URL=http://localhost:8000 npm run dev
```

## Solución de problemas

| Síntoma | Causa / solución |
|---------|------------------|
| `Bind for 0.0.0.0:XXXX failed: port is already allocated` | Otro programa usa ese puerto. Cambia la variable `*_PORT` en `.env`. |
| `No se pudo conectar a mqtt://localhost:1883` | RabbitMQ no está arriba o el 1883 está ocupado: `docker compose ps rabbitmq`. |
| El script publica pero no aparecen datos | Revisa que el tópico sea `invernadero/<id>/lecturas` y mira `docker compose logs backend-worker`. |
| pgAdmin se reinicia en bucle | `PGADMIN_DEFAULT_EMAIL` debe ser un correo con dominio válido (no `.local`). |
| Cambié la contraseña de RabbitMQ en `.env` | Ejecuta `docker compose up -d rabbitmq`: las definiciones se regeneran al arrancar. Evita los caracteres `\|` y `"` en la contraseña. |
| Cambios en `init.sql` no se aplican | El script solo corre con el volumen vacío: `docker compose down -v`. |
| Mensajes en `sensor.readings.dlq` | Lecturas rechazadas por validación; inspecciónalas en la consola de RabbitMQ (Queues → `sensor.readings.dlq` → Get messages). |
