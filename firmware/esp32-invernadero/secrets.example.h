// Copia este archivo como secrets.h y rellena tus datos.
// secrets.h está en .gitignore: tu contraseña del WiFi no se sube al repositorio.
#pragma once

// WiFi (el ESP32 solo funciona en redes de 2,4 GHz)
#define WIFI_SSID     "nombre-de-tu-red"
#define WIFI_PASSWORD "contraseña-de-tu-red"

// Broker MQTT (RabbitMQ del docker-compose). Usa la IP de tu Mac en la red local,
// no "localhost": para el ESP32, localhost sería él mismo.
#define MQTT_HOST     "192.168.0.28"
#define MQTT_PORT     1883
#define MQTT_USER     "invernadero"   // RABBITMQ_DEFAULT_USER en .env
#define MQTT_PASSWORD "invernadero"   // RABBITMQ_DEFAULT_PASS en .env

// Identificador del dispositivo: aparece en el dashboard
#define DEVICE_ID     "esp32-01"
