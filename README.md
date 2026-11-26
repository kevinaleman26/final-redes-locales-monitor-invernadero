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
| `frontend`             | Next.js 15 + Recharts            | Dashboard con KPIs, gráficas y tablas, y página de plantas animadas (se refresca cada 3 s) |
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

Para ver cada estado de la [página de plantas](#página-de-plantas), fija los valores iniciales:

```bash
uv run test-comunication.py --device-id planta-sed --soil 12          # tierra seca: sed
uv run test-comunication.py --device-id planta-calor --temperature 34 # calor
uv run test-comunication.py --device-id planta-sofocada --humidity 88 # humedad alta
uv run test-comunication.py --device-id planta-sin-tierra --no-soil   # sin sensor de tierra
```

## Accesos

| Qué | URL | Credenciales (por defecto) |
|-----|-----|----------------------------|
| Dashboard | http://localhost:3100 | — |
| Plantas animadas | http://localhost:3100/plantas | — |
| Información (configurar ESP32 con QR) | http://localhost:3100/informacion | — |
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
| `soil_moisture` | No | Humedad de tierra (%), entre 0 y 100. Omítelo si el dispositivo no tiene sensor de tierra o no respondió |
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
| GET | `/api/config/dispositivo` | Datos para configurar los ESP32: servidor MQTT (`MQTT_PUBLIC_HOST`), puerto y portal |
| GET | `/api/stats` | Totales, dispositivos en línea, promedios de la última hora |
| GET | `/api/devices` | Lista de dispositivos con su última lectura y estado (`online` = reportó en los últimos 30 s) |
| GET | `/api/devices/{id}` | Detalle de un dispositivo |
| GET | `/api/readings?device_id=&minutes=60&limit=500` | Lecturas filtradas por dispositivo y ventana de tiempo |

El frontend no llama al backend directamente desde el navegador: usa un proxy interno de Next.js (`/api/*` → `http://backend-api:8000/api/*`), así no hay problemas de CORS ni hace falta exponer la URL del backend.

## Página de plantas

En http://localhost:3100/plantas cada dispositivo aparece como **una planta en su maceta**, con una carita animada que reacciona a sus sensores (código en [frontend/app/plantas/](frontend/app/plantas/)):

| Situación | Cómo se ve |
|-----------|------------|
| Todo en rango | Planta feliz, se balancea y parpadea |
| Humedad de tierra < 30 % | **Sed**: se marchita, saca la lengua y sueña con una gota de agua |
| Temperatura ≥ 30 °C | **Calor**: suda, jadea, se abanica con las hojas y aparece un sol |
| Humedad del aire ≥ 80 % | **Sofocada**: ojos apretados, mejillas infladas y vapor alrededor |
| Ningún sensor responde, o el dispositivo lleva más de 30 s sin reportar | Maceta vacía con un cartel «?» |
| Solo responde uno de los dos sensores | La planta aparece, con un aviso del sensor que falla |

El sensor de aire se considera caído cuando llega temperatura 0 y humedad 0 (es lo que envía el firmware si el DHT no responde), y el de tierra cuando falta `soil_moisture`. Los umbrales están al principio de [frontend/app/plantas/page.tsx](frontend/app/plantas/page.tsx). La casilla **Ver ejemplos** muestra todos los estados sin necesidad de sensores.

## Firmware ESP32

[firmware/esp32-invernadero/](firmware/esp32-invernadero/) es el firmware de un dispositivo real (Arduino, `PubSubClient` + `DHT sensor library` de Adafruit). Publica cada 5 s en `invernadero/<device_id>/lecturas`:

| Sensor | Conexión |
|--------|----------|
| DHT11 (temperatura y humedad del aire) | VCC → 3V3, GND → GND, DATA → GPIO 4 |

Copia `secrets.example.h` como `secrets.h` (está en `.gitignore`). Ahí solo van el servidor MQTT por defecto y sus credenciales; el WiFi y el nombre de la planta se configuran desde el móvil:

1. La primera vez (o si no logra conectarse al WiFi guardado) la placa crea la red **`Invernadero-Config`**, con contraseña **`invernadero`**. Es la misma en todas las placas, así que configúralas de una en una; la página del portal muestra el **id único** de la placa (sale de su MAC) para saber cuál es.
2. Conéctate desde el móvil: se abre sola una página (si no, entra a http://192.168.4.1). Pulsa **Configure WiFi**, elige tu red de 2,4 GHz y escribe la contraseña.
3. En la misma página puedes cambiar el **servidor MQTT** (IP o nombre `.local`), su puerto y el **nombre de la planta**. Todo queda guardado en la ESP32. Mientras no le pongas nombre, cada placa se llama `planta-<id único>`, así dos placas con el mismo firmware nunca mezclan sus datos.
4. Para volver a configurarla (otro router, otro servidor), **mantén pulsado BOOT 3 segundos** con la placa encendida: el LED parpadea rápido, se borra la configuración y vuelve a abrir el portal.

**Con códigos QR:** la página http://localhost:3100/informacion muestra estos datos y genera dos QR. El primero (siempre el mismo) une el móvil a `Invernadero-Config`; el segundo abre `http://192.168.4.1/wifisave?...` con tu WiFi, el servidor y el nombre de la planta, y la placa los guarda sin escribir nada a mano. La contraseña del WiFi solo se usa en el navegador para crear el QR (no se envía al servidor). El servidor que muestra sale de `MQTT_PUBLIC_HOST` en `.env`.

Si nadie usa el portal en 5 minutos, la placa se reinicia y vuelve a intentar el WiFi guardado. Para el servidor, lo más cómodo es su nombre mDNS terminado en `.local` (en macOS: `scutil --get LocalHostName`; en una Raspberry Pi, normalmente `raspberrypi.local`): el ESP32 busca la IP antes de cada conexión, así que sigue funcionando aunque el router se la cambie.

Librerías: `PubSubClient`, `DHT sensor library` (Adafruit) y `WiFiManager` (tzapu).

```bash
arduino-cli compile --fqbn esp32:esp32:esp32 -u -p /dev/cu.usbserial-0001 firmware/esp32-invernadero
arduino-cli monitor -p /dev/cu.usbserial-0001 --config baudrate=115200
```

## Base de datos

El esquema se crea automáticamente desde [db/init.sql](db/init.sql) la **primera vez** que arranca Postgres:

- **`devices`**: `id`, `first_seen`, `last_seen`, `last_temperature`, `last_humidity`, `last_soil_moisture`, `readings_count`.
- **`readings`**: `id`, `message_id` (único), `device_id` (FK), `temperature`, `humidity`, `soil_moisture` (opcional), `measured_at` (hora del dispositivo), `received_at` (hora de recepción en el backend), `stored_at` (hora del commit).

> Si modificas `init.sql`, debes borrar el volumen para que se vuelva a ejecutar: `docker compose down -v`.
>
> Las columnas de humedad de tierra las añade también el worker al arrancar (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`), así que una base creada antes no necesita borrarse.

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
├── firmware/esp32-invernadero/     # firmware del ESP32 (DHT11)
├── frontend/                       # Next.js (dashboard)
│   └── app/
│       ├── page.tsx                # dashboard
│       ├── plantas/                # página de plantas animadas
│       ├── informacion/            # datos y QR para configurar los ESP32
│       ├── Nav.tsx                 # navegación entre páginas
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
