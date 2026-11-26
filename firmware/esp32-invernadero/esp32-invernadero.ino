// Dispositivo IoT del invernadero para ESP32.
//
// Se conecta al WiFi y publica por MQTT una lectura de temperatura y humedad
// cada INTERVALO_MS en el tópico  invernadero/<DEVICE_ID>/lecturas,
// con el mismo formato JSON que test-comunication.py:
//   {"message_id": "<uuid4>", "device_id": "...", "temperature": 23.4,
//    "humidity": 61.2, "soil_moisture": 45.0, "ts": "2026-11-24T20:15:00Z"}
//
// Sensor: DHT11 (temperatura y humedad) con la línea de datos en DHT_PIN.
// Conexión: VCC -> 3V3, GND -> GND, DATA -> GPIO 4.
// Si la lectura falla (sensor desconectado o mal cableado) se publica
// temperatura 0 y humedad 0. Con SIMULAR 1 se vuelve a los valores simulados.
//
// Sensor de humedad de tierra: capacitivo analógico (v1.2 o similar).
// Conexión: VCC -> 3V3, GND -> GND, AOUT -> GPIO 32.
// Si no está conectado, el mensaje se envía sin "soil_moisture".
// Calibración: mira el valor "crudo" en el monitor serie con el sensor al aire
// (seco) y metido en un vaso de agua (mojado), y ajusta TIERRA_SECO/TIERRA_MOJADO.
//
// Configuración: copia secrets.example.h a secrets.h y rellena tus datos.

#include <WiFi.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <time.h>
#include "secrets.h"

#define SIMULAR 0      // 1 = valores simulados, sin sensor
#define DHT_PIN 4
#define DHT_TIPO DHT11
#define TIERRA_PIN 32         // ADC1: funciona con el WiFi encendido (ADC2 no)
#define TIERRA_SECO 3000      // lectura cruda con el sensor al aire
#define TIERRA_MOJADO 1300    // lectura cruda con el sensor en agua
#define TIERRA_DESCONECTADO 200  // por debajo: no hay sensor (el pull-down lleva el pin a 0)

const unsigned long INTERVALO_MS = 10000;  // 10 s, como el script de prueba
const int LED = 2;

DHT dht(DHT_PIN, DHT_TIPO);

WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);
String topic;

float temperatura;
float humedad;
float humedadTierra;
unsigned long ultimoEnvio = 0;
unsigned long enviados = 0;

// UUID versión 4 generado con el generador aleatorio por hardware del ESP32.
String uuid4() {
  uint8_t b[16];
  for (int i = 0; i < 16; i += 4) {
    uint32_t r = esp_random();
    memcpy(b + i, &r, 4);
  }
  b[6] = (b[6] & 0x0F) | 0x40;  // versión 4
  b[8] = (b[8] & 0x3F) | 0x80;  // variante RFC 4122
  char s[37];
  snprintf(s, sizeof(s),
           "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
           b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7],
           b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]);
  return String(s);
}

// Hora UTC en ISO 8601, o cadena vacía si aún no se sincronizó por NTP.
String horaUTC() {
  time_t ahora = time(nullptr);
  if (ahora < 1700000000) return "";  // reloj sin sincronizar
  struct tm t;
  gmtime_r(&ahora, &t);
  char s[25];
  strftime(s, sizeof(s), "%Y-%m-%dT%H:%M:%SZ", &t);
  return String(s);
}

float aleatorio(float min, float max) {
  return min + (max - min) * (esp_random() / 4294967295.0f);
}

// Lee temperatura y humedad. Devuelve false si el sensor no respondió.
bool leerSensor() {
#if SIMULAR
  // Paseo aleatorio dentro de rangos realistas.
  temperatura = constrain(temperatura + aleatorio(-0.5, 0.5), 10.0, 40.0);
  humedad = constrain(humedad + aleatorio(-1.5, 1.5), 30.0, 95.0);
  return true;
#else
  float h = dht.readHumidity();
  float t = dht.readTemperature();  // grados Celsius
  if (isnan(h) || isnan(t)) return false;
  temperatura = t;
  humedad = h;
  return true;
#endif
}

// Lee la humedad de tierra (%). Devuelve false si el sensor no está conectado.
bool leerTierra() {
#if SIMULAR
  humedadTierra = constrain(humedadTierra + aleatorio(-2, 1.5), 5.0, 90.0);
  return true;
#else
  long suma = 0;
  for (int i = 0; i < 10; i++) {
    suma += analogRead(TIERRA_PIN);
    delay(2);
  }
  int crudo = suma / 10;
  if (crudo < TIERRA_DESCONECTADO) return false;
  float pct = 100.0 * (TIERRA_SECO - crudo) / (TIERRA_SECO - TIERRA_MOJADO);
  humedadTierra = constrain(pct, 0.0, 100.0);
  Serial.printf("Tierra: crudo=%d -> %.0f %%\n", crudo, humedadTierra);
  return true;
#endif
}

void conectarWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.printf("Conectando al WiFi \"%s\"", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long inicio = millis();
  while (WiFi.status() != WL_CONNECTED) {
    digitalWrite(LED, !digitalRead(LED));
    delay(250);
    Serial.print(".");
    if (millis() - inicio > 20000) {
      Serial.printf("\nNo se pudo conectar al WiFi (estado %d). Reintentando...\n", WiFi.status());
      WiFi.disconnect();
      delay(1000);
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
      inicio = millis();
    }
  }
  digitalWrite(LED, LOW);
  Serial.printf("\nWiFi conectado. IP: %s\n", WiFi.localIP().toString().c_str());
}

void conectarMQTT() {
  while (!mqtt.connected()) {
    conectarWiFi();
    String clientId = String(DEVICE_ID) + "-" + String((uint32_t)esp_random(), HEX).substring(0, 6);
    Serial.printf("Conectando a mqtt://%s:%d como %s... ", MQTT_HOST, MQTT_PORT, clientId.c_str());
    if (mqtt.connect(clientId.c_str(), MQTT_USER, MQTT_PASSWORD)) {
      Serial.println("conectado");
    } else {
      // -2 = sin conexión TCP (IP/puerto o red), 4/5 = usuario o contraseña incorrectos
      Serial.printf("falló (estado %d). Reintentando en 5 s\n", mqtt.state());
      delay(5000);
    }
  }
}

void publicarLectura() {
  if (!leerSensor()) {
    // Sin lectura: se publica 0 y 0 para que el dispositivo siga apareciendo en línea.
    Serial.printf("Error leyendo el DHT11 en GPIO %d: revisa el cableado. Se envía 0 y 0.\n", DHT_PIN);
    temperatura = 0;
    humedad = 0;
  }
  bool tierraOk = leerTierra();
  if (!tierraOk) Serial.printf("Sin sensor de tierra en GPIO %d: se envía sin soil_moisture.\n", TIERRA_PIN);
  String ts = horaUTC();
  String payload = "{\"message_id\":\"" + uuid4() + "\"," +
                   "\"device_id\":\"" + DEVICE_ID + "\"," +
                   "\"temperature\":" + String(temperatura, 2) + "," +
                   "\"humidity\":" + String(humedad, 2);
  if (tierraOk) payload += ",\"soil_moisture\":" + String(humedadTierra, 1);
  if (ts.length()) payload += ",\"ts\":\"" + ts + "\"";
  payload += "}";

  bool ok = mqtt.publish(topic.c_str(), payload.c_str());
  enviados++;
  Serial.printf("#%lu (%s) -> %s\n", enviados, ok ? "enviado" : "ERROR", payload.c_str());

  // Parpadeo corto del LED en cada envío correcto.
  if (ok) {
    digitalWrite(LED, HIGH);
    delay(80);
    digitalWrite(LED, LOW);
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LED, OUTPUT);
  delay(500);
  Serial.println("\n=== Invernadero IoT · ESP32 ===");

  topic = String("invernadero/") + DEVICE_ID + "/lecturas";
  temperatura = aleatorio(20, 26);  // solo se usan con SIMULAR 1
  humedad = aleatorio(55, 75);
  humedadTierra = aleatorio(40, 70);
  pinMode(TIERRA_PIN, INPUT_PULLDOWN);  // sin sensor, el pin queda en 0 en vez de flotar
  analogSetPinAttenuation(TIERRA_PIN, ADC_11db);  // rango completo 0–3,3 V
  dht.begin();

  conectarWiFi();
  configTime(0, 0, "pool.ntp.org", "time.google.com");  // hora UTC para "ts"

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setBufferSize(512);
  conectarMQTT();
  Serial.printf("Publicando en '%s' cada %lu s\n", topic.c_str(), INTERVALO_MS / 1000);
}

void loop() {
  if (!mqtt.connected()) conectarMQTT();
  mqtt.loop();

  if (ultimoEnvio == 0 || millis() - ultimoEnvio >= INTERVALO_MS) {
    ultimoEnvio = millis();
    publicarLectura();
  }
}
