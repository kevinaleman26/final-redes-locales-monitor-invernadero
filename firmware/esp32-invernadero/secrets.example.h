// Copia este archivo como secrets.h (está en .gitignore).
//
// El WiFi y el nombre de la planta no se configuran aquí: la primera vez (o
// tras mantener pulsado BOOT 3 s) la placa crea la red "Invernadero-Config"
// con contraseña "invernadero" (la misma en todas las placas). Conéctate desde
// el móvil, elige tu WiFi de 2,4 GHz y, si quieres, cambia el servidor MQTT y
// el nombre de la planta; también puedes usar los QR de la página «Información».
// Lo que pongas en el portal se guarda en la ESP32 y tiene prioridad sobre
// estos valores. Sin nombre, cada placa se llama "planta-<id único>".
#pragma once

// Servidor MQTT por defecto (RabbitMQ del docker-compose). No uses "localhost":
// para el ESP32, localhost sería él mismo. Lo más cómodo es el nombre mDNS del
// servidor terminado en ".local" (en macOS: `scutil --get LocalHostName`; en una
// Raspberry Pi suele ser "raspberrypi.local"), porque sigue funcionando aunque
// el router le cambie la IP. También acepta una IP fija, p. ej. "192.168.0.18".
#define MQTT_HOST     "mi-servidor.local"
#define MQTT_PORT     1883
#define MQTT_USER     "invernadero"   // RABBITMQ_DEFAULT_USER en .env
#define MQTT_PASSWORD "invernadero"   // RABBITMQ_DEFAULT_PASS en .env
