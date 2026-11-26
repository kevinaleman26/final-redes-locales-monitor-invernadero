// Dispositivo IoT del invernadero para ESP32.
//
// Se conecta al WiFi y publica por MQTT una lectura de temperatura y humedad
// cada INTERVALO_MS en el tópico  invernadero/<device_id>/lecturas,
// con el mismo formato JSON que test-comunication.py:
//   {"message_id": "<uuid4>", "device_id": "...", "temperature": 23.4,
//    "humidity": 61.2, "soil_moisture": 45.0, "ts": "2026-11-24T20:15:00Z"}
//
// Configuración por portal WiFi (librería WiFiManager):
//   Si la placa no tiene WiFi guardado o no logra conectarse, crea la red
//   AP_NOMBRE (la misma en todas las placas, contraseña AP_PASSWORD), así el QR
//   para unirse es siempre el mismo; configura las placas de una en una.
//   Conéctate desde el móvil y se abre una página para elegir tu WiFi y,
//   opcionalmente, cambiar el servidor MQTT, su puerto y el nombre de la planta.
//   La página muestra el identificador único de la placa (sale de su MAC).
//   Todo se guarda en la memoria de la ESP32. Para volver a configurarla,
//   mantén pulsado el botón BOOT 3 segundos con la placa en marcha.
//
// Nombre de la planta (device_id): mientras no se le ponga uno en el portal,
// cada placa usa "planta-<id único>", así dos placas con el mismo firmware
// nunca se confunden.
//
// Sensor: DHT11 (temperatura y humedad) con la línea de datos en DHT_PIN.
// Conexión: VCC -> 3V3, GND -> GND, DATA -> GPIO 4.
// Si la lectura falla (sensor desconectado o mal cableado) se publica
// temperatura 0 y humedad 0. Con SIMULAR 1 se vuelve a los valores simulados.
//
// Sensor de humedad de tierra: Capacitive Soil Moisture v1.2 (analógico).
// Conexión: VCC -> 3V3, GND -> GND, AOUT -> GPIO 32.
// Si no está conectado, el mensaje se envía sin "soil_moisture".
// Calibración: mira el valor "crudo" en el monitor serie con el sensor al aire
// (seco) y metido en un vaso de agua (mojado), y ajusta TIERRA_SECO/TIERRA_MOJADO.
//
// Broker: el servidor MQTT puede ser una IP, un nombre DNS o un nombre ".local"
// (mDNS/Bonjour, p. ej. "mi-mac.local" o "raspberrypi.local"). Con ".local"
// la IP se busca en la red antes de cada conexión, así que no hace falta
// fijarla aunque el router se la cambie al servidor.
//
// secrets.h (copia de secrets.example.h) solo tiene los valores por defecto
// del broker y sus credenciales; el portal puede cambiar el servidor.

#include <WiFi.h>
#include <WiFiManager.h>
#include <Preferences.h>
#include <esp_mac.h>
#include <ESPmDNS.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <time.h>
#include "secrets.h"

#define SIMULAR 0      // 1 = valores simulados, sin sensor
#define DHT_PIN 4
#define DHT_TIPO DHT11
#define TIERRA_PIN 32            // ADC1: funciona con el WiFi encendido (ADC2 no)
#define TIERRA_SECO 2430         // lectura cruda con el sensor al aire (calibrado con el v1.2 del proyecto)
#define TIERRA_MOJADO 1015       // lectura cruda con el sensor en agua hasta la línea
#define TIERRA_DESCONECTADO 200  // por debajo: no hay sensor (el pull-down lleva el pin a 0)

#define AP_NOMBRE "Invernadero-Config"  // red del portal, igual en todas las placas
#define AP_PASSWORD "invernadero"       // contraseña de la red del portal (mínimo 8 caracteres)
#define BOTON_BOOT 0               // botón BOOT de la placa
#define PORTAL_TIMEOUT_S 300       // si nadie usa el portal en 5 min, reinicia y reintenta

const unsigned long INTERVALO_MS = 5000;  // 5 s (el DHT11 necesita al menos 1 s entre lecturas)
const int LED = 2;

DHT dht(DHT_PIN, DHT_TIPO);

WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);
Preferences prefs;

// Configuración guardada (o los valores por defecto de secrets.h).
String mqttHost;
int mqttPort;
String deviceId;
String idPlaca;  // identificador único de la placa (últimos 3 bytes de la MAC)
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

// ---------- Configuración guardada y botón de reinicio ----------

void cargarConfiguracion() {
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_WIFI_STA);
  char id[7];
  snprintf(id, sizeof(id), "%02X%02X%02X", mac[3], mac[4], mac[5]);
  idPlaca = id;

  prefs.begin("invernadero", false);
  mqttHost = prefs.getString("mqtt_host", MQTT_HOST);
  mqttPort = prefs.getInt("mqtt_port", MQTT_PORT);
  String porDefecto = "planta-" + idPlaca;
  porDefecto.toLowerCase();
  deviceId = prefs.getString("device_id", porDefecto);
}

// El device_id va en el tópico MQTT: solo letras, números, '-' y '_'.
String limpiarId(String id) {
  id.trim();
  String limpio;
  for (char c : id) {
    if (isalnum((unsigned char)c) || c == '-' || c == '_') limpio += c;
  }
  return limpio;
}

// Si se mantiene pulsado BOOT 3 s: borra el WiFi guardado y reinicia en modo
// configuración. El nombre de la planta y el servidor se conservan (el portal
// los muestra y permite cambiarlos), así la planta no pierde su historial.
void revisarBotonReset() {
  if (digitalRead(BOTON_BOOT) == HIGH) return;
  unsigned long inicio = millis();
  while (digitalRead(BOTON_BOOT) == LOW) {
    if (millis() - inicio > 3000) {
      Serial.println("\nBOOT pulsado 3 s: se borra el WiFi guardado. Reiniciando en modo configuración...");
      for (int i = 0; i < 10; i++) {
        digitalWrite(LED, !digitalRead(LED));
        delay(100);
      }
      WiFiManager wm;
      wm.resetSettings();
      ESP.restart();
    }
    delay(20);
  }
}

// delay() que sigue atento al botón BOOT.
void esperar(unsigned long ms) {
  unsigned long inicio = millis();
  while (millis() - inicio < ms) {
    revisarBotonReset();
    delay(20);
  }
}

// Conecta con el WiFi guardado o abre el portal de configuración.
void iniciarWiFi() {
  WiFiManager wm;
  wm.setDebugOutput(true);  // mensajes del portal en el monitor serie (útil para diagnosticar)
  wm.setTitle("Invernadero IoT · Placa " + idPlaca);
  wm.setConfigPortalTimeout(PORTAL_TIMEOUT_S);

  char puerto[6];
  snprintf(puerto, sizeof(puerto), "%d", mqttPort);
  String info = "<p>Placa <b>" + idPlaca + "</b> · planta actual <b>" + deviceId +
                "</b>. Deja el nombre vacío para mantenerlo.</p>";
  WiFiManagerParameter pInfo(info.c_str());
  WiFiManagerParameter pHost("mqtt_host", "Servidor MQTT (IP o nombre .local)", mqttHost.c_str(), 64);
  WiFiManagerParameter pPort("mqtt_port", "Puerto MQTT", puerto, 6);
  WiFiManagerParameter pId("device_id", "Nombre de la planta (device_id)", "", 32);
  wm.addParameter(&pInfo);
  wm.addParameter(&pHost);
  wm.addParameter(&pPort);
  wm.addParameter(&pId);

  String placa = idPlaca;
  wm.setAPCallback([placa](WiFiManager*) {
    Serial.printf("\nModo configuración (placa %s): conéctate a la red WiFi \"%s\" (contraseña \"%s\")\n",
                  placa.c_str(), AP_NOMBRE, AP_PASSWORD);
    Serial.println("y abre http://192.168.4.1 si la página no aparece sola.");
  });

  Serial.println("Conectando al WiFi guardado...");
  if (!wm.autoConnect(AP_NOMBRE, AP_PASSWORD)) {
    Serial.println("Nadie configuró el WiFi a tiempo. Reiniciando...");
    ESP.restart();
  }

  // Guarda lo que se haya cambiado en el portal.
  String nuevoHost = String(pHost.getValue());
  nuevoHost.trim();
  int nuevoPuerto = atoi(pPort.getValue());
  String nuevoId = limpiarId(pId.getValue());
  if (nuevoHost.length() && nuevoHost != mqttHost) {
    mqttHost = nuevoHost;
    prefs.putString("mqtt_host", mqttHost);
  }
  if (nuevoPuerto > 0 && nuevoPuerto <= 65535 && nuevoPuerto != mqttPort) {
    mqttPort = nuevoPuerto;
    prefs.putInt("mqtt_port", mqttPort);
  }
  if (nuevoId.length() && nuevoId != deviceId) {
    deviceId = nuevoId;
    prefs.putString("device_id", deviceId);
  }

  digitalWrite(LED, LOW);
  Serial.printf("WiFi conectado a \"%s\". IP: %s\n", WiFi.SSID().c_str(), WiFi.localIP().toString().c_str());
}

// ---------- Sensores ----------

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
  // Las primeras conversiones del ADC tras arrancar salen desviadas (marcaba
  // ~88 % con el sensor al aire): se descarta 1 s de lecturas antes de la
  // primera medición (0,1 s no bastaba: aún marcaba ~9 %).
  static bool primeraVez = true;
  if (primeraVez) {
    for (int i = 0; i < 100; i++) {
      analogRead(TIERRA_PIN);
      delay(10);
    }
    primeraVez = false;
  }
  long suma = 0;
  for (int i = 0; i < 10; i++) {
    suma += analogRead(TIERRA_PIN);
    delay(2);
  }
  int crudo = suma / 10;
  if (crudo < TIERRA_DESCONECTADO) {
    Serial.printf("Tierra: crudo=%d -> sin sensor en GPIO %d, se envía sin soil_moisture\n", crudo, TIERRA_PIN);
    return false;
  }
  float pct = 100.0 * (TIERRA_SECO - crudo) / (TIERRA_SECO - TIERRA_MOJADO);
  humedadTierra = constrain(pct, 0.0, 100.0);
  Serial.printf("Tierra: crudo=%d -> %.0f %%\n", crudo, humedadTierra);
  return true;
#endif
}

// ---------- Red ----------

// Reconecta con el WiFi guardado si se cayó la conexión.
void conectarWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.print("WiFi desconectado. Reconectando");
  WiFi.reconnect();
  unsigned long inicio = millis();
  while (WiFi.status() != WL_CONNECTED) {
    revisarBotonReset();
    digitalWrite(LED, !digitalRead(LED));
    delay(250);
    Serial.print(".");
    if (millis() - inicio > 20000) {
      Serial.printf("\nNo se pudo reconectar (estado %d). Reintentando... (mantén BOOT 3 s para reconfigurar)\n", WiFi.status());
      WiFi.disconnect();
      delay(1000);
      WiFi.begin();  // usa el WiFi guardado
      inicio = millis();
    }
  }
  digitalWrite(LED, LOW);
  Serial.printf("\nWiFi conectado. IP: %s\n", WiFi.localIP().toString().c_str());
}

// Configura el broker. Si el servidor termina en ".local", busca su IP por mDNS.
bool configurarBroker() {
  if (!mqttHost.endsWith(".local")) {
    mqtt.setServer(mqttHost.c_str(), mqttPort);
    return true;
  }
  String nombre = mqttHost.substring(0, mqttHost.length() - 6);
  IPAddress ip = MDNS.queryHost(nombre, 3000);
  if (ip == IPAddress()) {
    Serial.printf("No se encontró %s en la red (mDNS). Reintentando en 5 s\n", mqttHost.c_str());
    return false;
  }
  Serial.printf("%s -> %s\n", mqttHost.c_str(), ip.toString().c_str());
  mqtt.setServer(ip, mqttPort);
  return true;
}

void conectarMQTT() {
  while (!mqtt.connected()) {
    conectarWiFi();
    if (!configurarBroker()) {
      esperar(5000);
      continue;
    }
    String clientId = deviceId + "-" + String((uint32_t)esp_random(), HEX).substring(0, 6);
    Serial.printf("Conectando a mqtt://%s:%d como %s... ", mqttHost.c_str(), mqttPort, clientId.c_str());
    if (mqtt.connect(clientId.c_str(), MQTT_USER, MQTT_PASSWORD)) {
      Serial.println("conectado");
    } else {
      // -2 = sin conexión TCP (IP/puerto o red), 4/5 = usuario o contraseña incorrectos
      Serial.printf("falló (estado %d). Reintentando en 5 s\n", mqtt.state());
      esperar(5000);
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
  String ts = horaUTC();
  String payload = "{\"message_id\":\"" + uuid4() + "\"," +
                   "\"device_id\":\"" + deviceId + "\"," +
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
  pinMode(BOTON_BOOT, INPUT_PULLUP);
  delay(500);
  Serial.println("\n=== Invernadero IoT · ESP32 ===");

  cargarConfiguracion();
  temperatura = aleatorio(20, 26);  // solo se usan con SIMULAR 1
  humedad = aleatorio(55, 75);
  humedadTierra = aleatorio(40, 70);
  dht.begin();
  pinMode(TIERRA_PIN, INPUT_PULLDOWN);            // sin sensor, el pin queda en 0 en vez de flotar
  analogSetPinAttenuation(TIERRA_PIN, ADC_11db);  // rango completo 0–3,3 V

  iniciarWiFi();
  topic = "invernadero/" + deviceId + "/lecturas";
  Serial.printf("Placa %s · planta \"%s\" · servidor %s:%d\n", idPlaca.c_str(), deviceId.c_str(), mqttHost.c_str(), mqttPort);

  configTime(0, 0, "pool.ntp.org", "time.google.com");  // hora UTC para "ts"
  MDNS.begin(deviceId.c_str());  // necesario para buscar nombres ".local"
  mqtt.setBufferSize(512);
  conectarMQTT();
  Serial.printf("Publicando en '%s' cada %lu s (mantén BOOT 3 s para reconfigurar)\n", topic.c_str(), INTERVALO_MS / 1000);
}

void loop() {
  revisarBotonReset();
  if (!mqtt.connected()) conectarMQTT();
  mqtt.loop();

  if (ultimoEnvio == 0 || millis() - ultimoEnvio >= INTERVALO_MS) {
    ultimoEnvio = millis();
    publicarLectura();
  }
}
