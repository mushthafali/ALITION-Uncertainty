/**
 * ============================================================
 * ALITION PRO v3.0 - SENSOR FUSED (HIVEMQ READY)
 * ============================================================
 * Hardware : FireBeetle ESP32-C6 + BME280
 * Logic    : FSM Non-Blocking + MQTT JSON Telemetry
 * Default  : broker.hivemq.com (Port 1883)
 * ============================================================
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WebServer.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <PubSubClient.h>
#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BME280.h>

// ── 1. DEFINISI PIN PERANGKAT KERAS ──────────────────────────────────
#define LED_PIN       15  
#define SETUP_BTN_PIN 5   
#define NEXTION_RX_PIN 8
#define NEXTION_TX_PIN 14

// ── 2. KONFIGURASI ACCESS POINT (AP MODE) ────────────────────────────
const char* AP_SSID = "alition1.0";
const char* AP_PASS = "alition123"; 

// ── 3. VARIABEL & OBJEK GLOBAL ───────────────────────────────────────
Preferences prefs;
WebServer   server(80);
WiFiClientSecure espClient;
PubSubClient mqttClient(espClient);
Adafruit_BME280 bme; // Objek BME280

String savedSsid, savedPass, savedMqttHost, savedDeviceId;
String savedMqttUser, savedMqttPass;
int    savedMqttPort = 8883;

// Mesin Status (FSM)
enum SystemMode { MODE_STA, MODE_AP };
SystemMode currentMode = MODE_STA;

// Timer Asinkron (Non-Blocking)
unsigned long lastMqttPublish  = 0;
unsigned long lastBeat         = 0;
unsigned long apStartTime      = 0;
unsigned long buttonPressTime  = 0;
unsigned long lastDebounceTime = 0;
unsigned long lastLedBlink     = 0;

// Status Tombol & LED
bool isPressing      = false;
bool apLedState      = false;
int  lastButtonState = HIGH;
int  buttonState     = HIGH;

// Status Halaman Nextion Aktif (1=Main, 2=Temp, 3=Hum, 4=Pres)
int activeNextionPage = 1;

// ══════════════════════════════════════════════════════════════════════
//  FUNGSI NEXTION HMI
// ══════════════════════════════════════════════════════════════════════
void sendNextionCommand(String cmd) {
  Serial1.print(cmd);
  Serial1.write(0xFF);
  Serial1.write(0xFF);
  Serial1.write(0xFF);
}

void setNextionText(String obj, String text) {
  sendNextionCommand(obj + ".txt=\"" + text + "\"");
}
void readNextion() {
  while (Serial1.available()) {
    char c = Serial1.read();
    if (c == 'A') activeNextionPage = 2; // Halaman Suhu
    else if (c == 'B') activeNextionPage = 3; // Halaman Kelembaban
    else if (c == 'C') activeNextionPage = 4; // Halaman Tekanan
    else if (c == 'D') activeNextionPage = 1; // Halaman Utama
  }
}

// ══════════════════════════════════════════════════════════════════════
//  FUNGSI MEMORI (NVS)
// ══════════════════════════════════════════════════════════════════════
void loadConfig() {
  prefs.begin("alition", true);
  savedSsid     = prefs.getString("ssid", "");
  savedPass     = prefs.getString("pass", "");
  savedMqttHost = prefs.getString("mqtt_host", "broker.hivemq.com"); 
  savedMqttPort = prefs.getInt("mqtt_port", 8883);
  savedDeviceId = prefs.getString("device_id", "ALITION_01");
  savedMqttUser = prefs.getString("mqtt_user", "");
  savedMqttPass = prefs.getString("mqtt_pass", "");
  prefs.end();
}

void saveConfig(String s, String p, String h, int prt, String id, String usr, String pwd) {
  prefs.begin("alition", false);
  prefs.putString("ssid", s); 
  prefs.putString("pass", p);
  prefs.putString("mqtt_host", h); 
  prefs.putInt("mqtt_port", prt);
  prefs.putString("device_id", id);
  prefs.putString("mqtt_user", usr);
  prefs.putString("mqtt_pass", pwd);
  prefs.end();
}

// ══════════════════════════════════════════════════════════════════════
//  FUNGSI SENSOR & MQTT (STATION MODE)
// ══════════════════════════════════════════════════════════════════════
void reconnectMQTT() {
  if (savedMqttHost.isEmpty()) return;
  
  espClient.setInsecure(); // Wajib untuk SSL tanpa verifikasi sertifikat root CA
  mqttClient.setServer(savedMqttHost.c_str(), savedMqttPort);
  
  if (!mqttClient.connected()) {
    Serial.print("[MQTT] Menghubungkan ke " + savedMqttHost + ":" + String(savedMqttPort) + "...");
    
    bool connected = false;
    if (savedMqttUser.length() > 0 && savedMqttPass.length() > 0) {
        connected = mqttClient.connect(savedDeviceId.c_str(), savedMqttUser.c_str(), savedMqttPass.c_str());
    } else {
        connected = mqttClient.connect(savedDeviceId.c_str());
    }

    if (connected) {
      Serial.println(" Terhubung!");
    } else {
      Serial.print(" Gagal, rc=");
      Serial.println(mqttClient.state());
    }
  }
}

void publishTelemetry() {
  // Membaca data metrologi absolut dari perangkat keras
  float suhu = bme.readTemperature();
  float hum  = bme.readHumidity();
  float pres = bme.readPressure() / 100.0F;

  // 1. Update Layar Nextion (Selalu jalan, meskipun internet mati)
  if (!isnan(suhu) && !isnan(hum) && !isnan(pres)) {
    setNextionText("tTemp", String(suhu, 1) + " C");
    setNextionText("tHum", String(hum, 1) + " %");
    setNextionText("tPres", String(pres, 1) + " hPa");
    
    // Mapping nilai untuk grafik (skala 0 - 255)
    int mapTemp = constrain(map((long)suhu, 0, 50, 0, 255), 0, 255);
    int mapHum  = constrain(map((long)hum, 0, 100, 0, 255), 0, 255);
    int mapPres = constrain(map((long)pres, 900, 1100, 0, 255), 0, 255);

    // Kirim data grafik hanya ke halaman yang sedang aktif dibuka
    if (activeNextionPage == 2) sendNextionCommand("add 6,0," + String(mapTemp));
    if (activeNextionPage == 3) sendNextionCommand("add 6,0," + String(mapHum));
    if (activeNextionPage == 4) sendNextionCommand("add 6,0," + String(mapPres));
  }

  // 2. Filter MQTT (Berhenti jika tidak ada koneksi)
  if (!mqttClient.connected()) {
    setNextionText("tMode", "STA");
    setNextionText("tStatus", "WiFi/MQTT Disconnected");
    return;
  }

  // Filter jika sensor dicabut atau rusak saat operasional
  if (isnan(suhu) || isnan(hum) || isnan(pres)) {
    Serial.println("[ERR] Gagal membaca BME280. Transmisi dibatalkan.");
    return;
  }

  // Membuat Objek JSON dengan data riil
  JsonDocument doc;
  doc["id"]   = savedDeviceId;
  doc["temp"] = suhu; 
  doc["hum"]  = hum;  
  doc["pres"] = pres; 
  doc["rssi"] = WiFi.RSSI();

  // Serialisasi dan Pengiriman
  String payload;
  serializeJson(doc, payload);
  
  String topic = "alition/telemetri/" + savedDeviceId;
  mqttClient.publish(topic.c_str(), payload.c_str());
  Serial.println("[MQTT] Terkirim (" + topic + "): " + payload);

  setNextionText("tMode", "STA");
  setNextionText("tStatus", "MQTT OK");
}

// ══════════════════════════════════════════════════════════════════════
//  FUNGSI JARINGAN & PROVISIONING (HTTP & WIFI)
// ══════════════════════════════════════════════════════════════════════
String lastWifiStatus = "first_boot";

void handlePing() {
  server.send(200, "application/json", "{\"status\":\"ok\",\"device\":\"ALITION_01\",\"mode\":\"provisioning\"}");
}

void handleStatus() {
  String body = "{\"status\":\"" + lastWifiStatus + "\",\"ssid\":\"" + savedSsid + "\"}";
  server.send(200, "application/json", body);
  lastWifiStatus = "first_boot"; // Reset
}

void handleSetConfig() {
  JsonDocument doc;
  
  if (deserializeJson(doc, server.arg("plain"))) {
    server.send(400, "application/json", "{\"error\":\"Invalid JSON\"}");
    return;
  }

  String ssid     = doc["ssid"] | "";
  String pass     = doc["pass"] | "";
  String host     = doc["mqtt_host"] | "broker.hivemq.com";
  int    port     = doc["mqtt_port"] | 8883;
  String deviceId = doc["device_id"] | "ALITION_01";
  String mUser    = doc["mqtt_user"] | "";
  String mPass    = doc["mqtt_pass"] | "";

  saveConfig(ssid, pass, host, port, deviceId, mUser, mPass);
  
  server.send(200, "application/json", "{\"status\":\"ok\",\"message\":\"Config saved! Rebooting...\"}");
  Serial.println("[HTTP] Konfigurasi baru diterima. Memulai ulang sistem...");
  
  lastWifiStatus = "pending";
  
  delay(1000); 
  ESP.restart(); 
}

void startAPMode() {
  Serial.println("\n[SYSTEM] Transisi ke Access Point Mode (60 Detik)...");
  WiFi.disconnect(true); 
  delay(100);
  
  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASS); 
  
  server.on("/ping", HTTP_GET, handlePing);
  server.on("/status", HTTP_GET, handleStatus);
  server.on("/set_config", HTTP_POST, handleSetConfig);
  server.begin();
  
  currentMode = MODE_AP;
  apStartTime = millis();
  
  Serial.println("=================================================");
  Serial.println("[AP MODE] Jaringan WiFi Konfigurasi Terbuka!");
  Serial.println("[AP MODE] SSID     : " + String(AP_SSID));
  Serial.println("[AP MODE] Password : " + String(AP_PASS));
  Serial.println("[AP MODE] IP       : " + WiFi.softAPIP().toString());
  Serial.println("=================================================");
}

void connectToWiFi() {
  WiFi.softAPdisconnect(true); 
  delay(100);
  
  WiFi.mode(WIFI_STA);
  if (savedSsid.isEmpty()) {
    Serial.println("[WiFi] NVS Kosong. Menunggu perintah operator (Tahan tombol 5 detik).");
    return;
  }
  
  Serial.println("[WiFi] Menghubungkan ke: " + savedSsid);
  WiFi.begin(savedSsid.c_str(), savedPass.c_str());
}

// ══════════════════════════════════════════════════════════════════════
//  SISTEM INTERUPSI TOMBOL 
// ══════════════════════════════════════════════════════════════════════
void handleButton() {
  if (currentMode != MODE_STA) return; 
  
  int reading = digitalRead(SETUP_BTN_PIN);
  if (reading != lastButtonState) {
    lastDebounceTime = millis();
  }
  
  if ((millis() - lastDebounceTime) > 50) {
    if (reading != buttonState) {
      buttonState = reading;
      
      if (buttonState == LOW) { 
        isPressing = true; 
        buttonPressTime = millis(); 
        Serial.println("\n>>> [TOMBOL DITEKAN] Memulai hitungan mundur 5 detik...");
      } else { 
        isPressing = false; 
        Serial.println(">>> [TOMBOL DILEPAS] Dibatalkan.");
        setNextionText("tMode", "STA");
        setNextionText("tStatus", "MQTT OK");
      }
    }
  }
  
  lastButtonState = reading;

  if (isPressing && buttonState == LOW) {
    unsigned long holdTime = millis() - buttonPressTime;
    if (holdTime >= 5000) {
      Serial.println(">>> [EKSEKUSI] Masuk ke AP Mode!");
      isPressing = false;
      buttonState = HIGH; 
      startAPMode();
    } else {
      int secondsLeft = 5 - (holdTime / 1000);
      static int lastSec = -1;
      if (secondsLeft != lastSec) {
        setNextionText("tMode", "");
        setNextionText("tStatus", "Hold button... " + String(secondsLeft));
        lastSec = secondsLeft;
      }
    }
  }
}

// ══════════════════════════════════════════════════════════════════════
//  FUNGSI INTI (SETUP & LOOP)
// ══════════════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  while (!Serial) { delay(10); } 
  delay(1000);

  Serial.println("\n======================================");
  Serial.println("  Alition Pro v3.0 - BME280 + HiveMQ");
  Serial.println("======================================\n");

  pinMode(LED_PIN, OUTPUT);
  pinMode(SETUP_BTN_PIN, INPUT_PULLUP);
  digitalWrite(LED_PIN, LOW);
  
  // Inisialisasi Nextion HMI
  Serial1.begin(9600, SERIAL_8N1, NEXTION_RX_PIN, NEXTION_TX_PIN);
  delay(100);
  setNextionText("tStatus", "System Booting...");
  
  // Inisialisasi Sensor BME280
  Wire.begin(); 
  if (!bme.begin(0x77, &Wire)) {
    if (!bme.begin(0x76, &Wire)) {
      Serial.println("[CRITICAL ERROR] Sensor BME280 tidak ditemukan!");
      // FSM tetap dilanjutkan agar alat bisa masuk AP Mode untuk debugging
    }
  } else {
    Serial.println("[SYSTEM] BME280 Terhubung dan Siap.");
  }

  loadConfig();
  
  currentMode = MODE_STA;
  connectToWiFi(); 
}

void loop() {
  if (currentMode == MODE_AP) {
    server.handleClient(); 
    
    if (millis() - lastLedBlink >= 200) {
      lastLedBlink = millis(); 
      apLedState = !apLedState;
      digitalWrite(LED_PIN, apLedState);
    }
    
    int timeLeft = 60 - ((millis() - apStartTime) / 1000);
    static int lastApSec = -1;
    if (timeLeft != lastApSec && timeLeft >= 0) {
      setNextionText("tMode", "");
      setNextionText("tStatus", "AP Mode: " + String(timeLeft) + "s");
      lastApSec = timeLeft;
    }

    if (millis() - apStartTime >= 60000) {
      if (WiFi.softAPgetStationNum() > 0) {
        // Ada perangkat (PC/HP) yang terhubung ke WiFi alat, perpanjang waktu AP!
        apStartTime = millis(); 
      } else {
        Serial.println("\n[SYSTEM] Waktu AP habis (60s) dan tidak ada koneksi. Membunuh pemancar...");
        digitalWrite(LED_PIN, LOW);
        currentMode = MODE_STA; 
        connectToWiFi(); 
      }
    }
  } 
  else if (currentMode == MODE_STA) {
    handleButton(); 
    readNextion(); // BACA STATUS HALAMAN DARI LAYAR NEXTION
    
    if (millis() - lastBeat >= 5000) {
      lastBeat = millis();
      
      if (WiFi.status() != WL_CONNECTED) {
        if (!savedSsid.isEmpty()) {
          Serial.println("[Heartbeat] WiFi terputus. Mencoba reconnect latar belakang...");
          setNextionText("tMode", "STA");
          setNextionText("tStatus", "WiFi Disconnected");
          WiFi.reconnect(); 
        }
      } else {
        digitalWrite(LED_PIN, LOW); delay(50); digitalWrite(LED_PIN, HIGH);
        reconnectMQTT();
      }
    }
    
    if (WiFi.status() == WL_CONNECTED) {
      mqttClient.loop(); // Wajib untuk memproses antrean MQTT dan keep-alive
      
      // Interval publish JSON = 5 Detik
      if (millis() - lastMqttPublish >= 5000) {
        lastMqttPublish = millis();
        publishTelemetry();
      }
    }
  }
}