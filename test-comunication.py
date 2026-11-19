#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# dependencies = ["paho-mqtt>=2.0"]
# ///
"""Prueba de comunicación: emula un dispositivo IoT que publica temperatura y humedad por MQTT.

Publica una lectura cada 10 segundos (configurable) en el broker MQTT de RabbitMQ,
en el tópico  invernadero/<device_id>/lecturas  con QoS 1 (entrega confirmada).

Uso (uv instala paho-mqtt automáticamente):
    uv run test-comunication.py
    uv run test-comunication.py --device-id inv-02 --interval 5
    uv run test-comunication.py --host 192.168.1.50 --count 3

Sin uv:
    pip install paho-mqtt && python3 test-comunication.py

Detener con Ctrl+C.
"""
import argparse
import json
import random
import sys
import time
import uuid
from datetime import datetime, timezone

try:
    import paho.mqtt.client as mqtt
except ImportError:
    sys.exit("Falta paho-mqtt. Ejecuta con 'uv run test-comunication.py' o instala: pip install paho-mqtt")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Emula el envío de lecturas de un dispositivo IoT por MQTT.")
    p.add_argument("--host", default="localhost", help="Host del broker MQTT (default: localhost)")
    p.add_argument("--port", type=int, default=1883, help="Puerto MQTT (default: 1883)")
    p.add_argument("--user", default="invernadero", help="Usuario MQTT (default: invernadero)")
    p.add_argument("--password", default="invernadero", help="Contraseña MQTT (default: invernadero)")
    p.add_argument("--device-id", default="inv-01", help="Identificador del dispositivo (default: inv-01)")
    p.add_argument("--interval", type=float, default=10, help="Segundos entre envíos (default: 10)")
    p.add_argument("--count", type=int, default=0, help="Cantidad de envíos; 0 = infinito (default: 0)")
    p.add_argument("--qos", type=int, choices=[0, 1], default=1, help="QoS MQTT (default: 1)")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    topic = f"invernadero/{args.device_id}/lecturas"

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"{args.device_id}-{uuid.uuid4().hex[:6]}")
    client.username_pw_set(args.user, args.password)
    try:
        client.connect(args.host, args.port, keepalive=60)
    except OSError as exc:
        sys.exit(f"No se pudo conectar a mqtt://{args.host}:{args.port} ({exc}). ¿Está levantado RabbitMQ?")
    client.loop_start()

    # Valores iniciales realistas para un invernadero; varían suavemente en cada envío.
    temperature = random.uniform(20, 26)
    humidity = random.uniform(55, 75)

    print(f"Publicando lecturas de '{args.device_id}' en mqtt://{args.host}:{args.port} "
          f"tópico '{topic}' cada {args.interval}s (Ctrl+C para detener)")
    sent = 0
    try:
        while args.count == 0 or sent < args.count:
            temperature = min(40.0, max(10.0, temperature + random.uniform(-0.5, 0.5)))
            humidity = min(95.0, max(30.0, humidity + random.uniform(-1.5, 1.5)))
            payload = json.dumps({
                # El message_id lo genera el dispositivo: si MQTT reenvía el mensaje (QoS 1),
                # el backend lo reconoce y no lo guarda dos veces.
                "message_id": str(uuid.uuid4()),
                "device_id": args.device_id,
                "temperature": round(temperature, 2),
                "humidity": round(humidity, 2),
                "ts": datetime.now(timezone.utc).isoformat(),
            })

            info = client.publish(topic, payload, qos=args.qos)
            info.wait_for_publish(timeout=10)
            sent += 1
            status = "confirmado" if info.is_published() else "SIN CONFIRMAR"
            print(f"[{datetime.now():%H:%M:%S}] #{sent} ({status}) -> {payload}")

            if args.count == 0 or sent < args.count:
                time.sleep(args.interval)
    except KeyboardInterrupt:
        print()
    finally:
        client.loop_stop()
        client.disconnect()
        print(f"Total enviado: {sent} lecturas")


if __name__ == "__main__":
    main()
