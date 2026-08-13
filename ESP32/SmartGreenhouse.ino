const int PIN_DHT = 4;
const int PIN_SOIL_ADC = 34;
const int PIN_WATER_ADC = 35;
const int PIN_FAN_RELAY = 26;
const int PIN_PUMP_RELAY = 27;
const int PIN_GREEN_LED = 18;
const int PIN_RED_LED = 19;
const int PIN_BUZZER = 23;

// THRESHOLDS
const float TEMP_FAN_ON = 30.0;
const float TEMP_FAN_OFF = 27.0;

const float SOIL_DRY = 30.0;   // start watering if < this
const float SOIL_WET = 60.0;   // stop watering if >= this

const float MIN_WATER_LEVEL = 30.0; // safety cutoff for pump

// ADC
const int ADC_MAX = 4095;

// TIMING INTERVALS (ms)
const unsigned long SENSOR_INTERVAL_DHT = 2000UL;
const unsigned long SENSOR_INTERVAL_ANALOG = 1000UL;
const unsigned long TELEMETRY_INTERVAL = 5000UL;
const unsigned long COMMAND_INTERVAL = 1000UL;
const unsigned long SERIAL_INTERVAL = 5000UL;
// HTTP TIMEOUTS (applied inline)

// WIFI / API CONFIGURATION - change these before running in your backend
const char* WIFI_SSID = "Wokwi-GUEST";
const char* WIFI_PASSWORD = "";
const char* API_BASE_URL = "https://smart-greenhouse-dyp1.onrender.com"; // no trailing slash

// DEBUG
#define DEBUG_ENABLED true

// RELAY POLARITY - Wokwi modules often are ACTIVE LOW; change to HIGH if your relay is active-high.
const int RELAY_ON_LEVEL = LOW;
const int RELAY_OFF_LEVEL = HIGH;

/* =========================
   LIBRARIES
   ========================= */
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include "DHT.h"
#include <ArduinoJson.h> // used for safe JSON parsing/creation

/* =========================
   GLOBALS
   ========================= */
// Global secure client (single instance)
WiFiClientSecure secureClient;

/* =========================
   TYPES & STATE
   ========================= */
DHT dht(PIN_DHT, DHT22);

enum SystemMode {
  AUTO_MODE = 0,
  MANUAL_MODE = 1
};

enum SystemStatus {
  STATUS_NORMAL,
  STATUS_HIGH_TEMPERATURE,
  STATUS_IRRIGATION_REQUIRED,
  STATUS_LOW_WATER,
  STATUS_LOW_WATER_ALERT,
  STATUS_SENSOR_ERROR,
  STATUS_WIFI_ERROR,
  STATUS_API_ERROR
};

struct SystemState {
  // sensors
  float temperature = NAN;
  float humidity = NAN;
  float soilMoisture = NAN; // percent
  float waterLevel = NAN;   // percent

  // actuators
  bool fanState = false;
  bool pumpState = false;
  // desired actuator states (control logic first writes desired, safety may modify, then relays are updated)
  bool desiredFan = false;
  bool desiredPump = false;
  // manual command requests from cloud
  bool manualFanRequest = false;
  bool manualPumpRequest = false;

  bool greenLed = false;
  bool redLed = false;
  bool buzzer = false;

  // mode & flags
  SystemMode mode = AUTO_MODE;
  bool waterLow = false;
  bool irrigationRequired = false;
  bool highTemperature = false;
  bool sensorError = false;

  // connectivity
  bool wifiConnected = false;
  bool apiConnected = false;
  bool apiError = false;
  bool cloudConnected = false;

  // system status
  SystemStatus status = STATUS_NORMAL;

  // alert dedupe
  String lastAlert = "";
} state;

const char* getSystemStatusString() {

  switch (state.status) {

    case STATUS_NORMAL:
      return "NORMAL";

    case STATUS_HIGH_TEMPERATURE:
      return "HIGH_TEMPERATURE";

    case STATUS_IRRIGATION_REQUIRED:
      return "IRRIGATION_REQUIRED";

    case STATUS_LOW_WATER:
      return "LOW_WATER";

    case STATUS_LOW_WATER_ALERT:
      return "LOW_WATER_ALERT";

    case STATUS_SENSOR_ERROR:
      return "SENSOR_ERROR";

    case STATUS_WIFI_ERROR:
      return "WIFI_ERROR";

    case STATUS_API_ERROR:
      return "API_ERROR";

    default:
      return "UNKNOWN";
  }
}

/* =========================
   TIMERS
   ========================= */
unsigned long lastDhtRead = 0;
unsigned long lastAnalogRead = 0;
unsigned long lastTelemetry = 0;
unsigned long lastCommandPoll = 0;
unsigned long lastSerial = 0;
unsigned long lastWifiAttempt = 0;
const unsigned long WIFI_RECONNECT_INTERVAL = 5000UL; // ms

/* =========================
   FORWARD DECLARATIONS
   ========================= */
float readTemperature();
float readHumidity();
float readSoilMoisture();
float readWaterLevel();

void initializePins();
void maintainWiFiConnection();
void sendTelemetry();
void pollCommands();

void processAutomaticControl();
void processManualControl();
void processSafety();
void updateIndicators();
void serialStatusPrinter();

bool isWaterSafeForPump();
bool isSensorValid();

void setFan(bool on);
void setPump(bool on);
void setGreenLED(bool on);
void setRedLED(bool on);
void setBuzzer(bool on);

void generateAlerts();
const char* getSystemStatusString();
/* =========================
   SETUP
   ========================= */
void setup() {
  // Serial
  Serial.begin(115200);
  delay(20);
  // Initialize global secure client once
  secureClient.setInsecure();

  if (DEBUG_ENABLED) {
    Serial.println();
    Serial.println("========================================");
    Serial.println("SMART GREENHOUSE BOOT");
    Serial.println("========================================");
  }

  // Pins
  initializePins();

  // Sensors
  dht.begin();

  // ADC configuration (optional)
  analogReadResolution(12); // 0-4095

  // WiFi connect attempt (non-blocking attempt)
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWifiAttempt = millis();

  // Initial state defaults
  state.mode = AUTO_MODE;
  state.fanState = false;
  state.pumpState = false;
  state.desiredFan = false;
  state.desiredPump = false;
  state.manualFanRequest = false;
  state.manualPumpRequest = false;
  state.greenLed = false;
  state.redLed = false;
  state.buzzer = false;

  // Start reading sensors immediately
  lastDhtRead = 0;
  lastAnalogRead = 0;
  // Initial sensor values
  state.temperature = NAN;
  state.humidity = NAN;
  state.soilMoisture = NAN;
  state.waterLevel = NAN;
  state.sensorError = true;
}

/* =========================
   LOOP
   ========================= */
void loop() {
  unsigned long now = millis();

  // 0) Maintain WiFi connection (non-blocking)
  maintainWiFiConnection();

  // 1) Sensor Read
  if (now - lastDhtRead >= SENSOR_INTERVAL_DHT) {
    lastDhtRead = now;
    float t = readTemperature();
    float h = readHumidity();

    if (isnan(t) || isnan(h)) {
      state.sensorError = true;
      state.status = STATUS_SENSOR_ERROR;
      if (DEBUG_ENABLED) Serial.println("[WARN] DHT read failed");
    } else {
      state.sensorError = false;
      state.temperature = t;
      state.humidity = h;
    }
  }

  if (now - lastAnalogRead >= SENSOR_INTERVAL_ANALOG) {
    lastAnalogRead = now;
    state.soilMoisture = readSoilMoisture();
    state.waterLevel = readWaterLevel();
  }

  // Update derived flags (used by control logic)
  state.waterLow = (state.waterLevel < MIN_WATER_LEVEL);
  state.irrigationRequired = (state.soilMoisture < SOIL_DRY);
  state.highTemperature = (!isnan(state.temperature) && state.temperature >= TEMP_FAN_ON);

  // 2) Control Logic (compute desired states; do not yet write relays)
  if (state.mode == AUTO_MODE) {
    processAutomaticControl(); // sets state.desiredFan / state.desiredPump
  } else {
    processManualControl();    // sets state.desiredFan / state.desiredPump from manual requests
  }

  // 3) Safety Layer (adjust desired states if safety requires it)
  processSafety(); // will modify state.desiredFan / state.desiredPump as needed

  // 4) Relay Updates (apply final desired states to hardware)
  // Apply fan
  if (state.desiredFan != state.fanState) {
    setFan(state.desiredFan);
  }
  // Apply pump
  if (state.desiredPump != state.pumpState) {
    setPump(state.desiredPump);
  }

  // 5) LED / Buzzer Updates
  updateIndicators();

  // 6) Command Polling (cloud communication -- placed after hardware)
  if (now - lastCommandPoll >= COMMAND_INTERVAL) {
    lastCommandPoll = now;
    pollCommands();
  }

  // 7) Telemetry Upload (cloud communication)
  if (now - lastTelemetry >= TELEMETRY_INTERVAL) {
    lastTelemetry = now;
    sendTelemetry();
  }

  // Serial status (non-blocking)
  if (now - lastSerial >= SERIAL_INTERVAL) {
    lastSerial = now;
    serialStatusPrinter();
  }

  // Small yield to keep WiFi stack happy (non-blocking)
  delay(1);
}

/* =========================
   SENSOR FUNCTIONS
   ========================= */
float readTemperature() {
  float t = dht.readTemperature();
  // DHT returns NaN on error
  return t;
}

float readHumidity() {
  float h = dht.readHumidity();
  return h;
}

float convertAdcToPercent(int raw) {
  return ( (float)raw / (float)ADC_MAX ) * 100.0;
}

float readSoilMoisture() {
  int raw = analogRead(PIN_SOIL_ADC);
  float percent = convertAdcToPercent(raw);
  return percent;
}

float readWaterLevel() {
  int raw = analogRead(PIN_WATER_ADC);
  float percent = convertAdcToPercent(raw);
  return percent;
}

/* =========================
   CONTROL & SAFETY
   ========================= */
void processAutomaticControl() {
  // FAN: hysteresis (compute desiredFan)
  if (!isnan(state.temperature)) {
    if (state.temperature >= TEMP_FAN_ON) {
      state.desiredFan = true;
    } else if (state.temperature <= TEMP_FAN_OFF) {
      state.desiredFan = false;
    } else {
      // between thresholds: keep previous desired fan state
    }
  } else {
    // Sensor invalid -> prefer fan OFF (safety layer will enforce)
    state.desiredFan = false;
  }

  // PUMP: hysteresis and safety (compute desiredPump)
  if (state.sensorError) {
    // sensor invalid => prefer pump off (safety layer will enforce)
    state.desiredPump = false;
    return;
  }

  if (state.soilMoisture < SOIL_DRY) {
    // requested pump ON (subject to safety checks later)
    state.desiredPump = true;
  } else if (state.soilMoisture >= SOIL_WET) {
    // stop pump
    state.desiredPump = false;
  } else {
    // between SOIL_DRY and SOIL_WET -> keep previous desired pump state
  }
}

void processManualControl() {
  state.desiredFan = state.manualFanRequest;
  state.desiredPump = state.manualPumpRequest;
}

/* processSafety: final enforcing layer */
void processSafety() {

  // -------------------------------------------------
  // 1. SENSOR SAFETY
  // -------------------------------------------------
  if (state.sensorError) {

    state.desiredFan = false;
    state.desiredPump = false;

    setBuzzer(true);

    state.status = STATUS_SENSOR_ERROR;

    generateAlerts();
    return;
  }

  // -------------------------------------------------
  // 2. WATER LEVEL SAFETY
  // -------------------------------------------------
  // Pump must NEVER run when water level is low.
  if (state.waterLow) {
    // Safety prevents pump operation
    state.desiredPump = false;
  }

  // -------------------------------------------------
  // 3. SYSTEM STATUS PRIORITY
  // -------------------------------------------------

  if (state.waterLow && state.irrigationRequired) {

    state.status = STATUS_LOW_WATER_ALERT;

  } else if (state.waterLow) {

    state.status = STATUS_LOW_WATER;

  } else if (state.highTemperature) {

    state.status = STATUS_HIGH_TEMPERATURE;

  } else if (state.irrigationRequired) {

    state.status = STATUS_IRRIGATION_REQUIRED;

  } else if (!state.wifiConnected) {

    state.status = STATUS_WIFI_ERROR;

  } else if (state.apiError) {

    state.status = STATUS_API_ERROR;

  } else {

    state.status = STATUS_NORMAL;
  }

  generateAlerts();
}

/* =========================
   ACTUATOR ABSTRACTION
   ========================= */
void initializePins() {
  pinMode(PIN_FAN_RELAY, OUTPUT);
  pinMode(PIN_PUMP_RELAY, OUTPUT);
  pinMode(PIN_GREEN_LED, OUTPUT);
  pinMode(PIN_RED_LED, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);

  // Initialize to OFF states
  digitalWrite(PIN_FAN_RELAY, RELAY_OFF_LEVEL);
  digitalWrite(PIN_PUMP_RELAY, RELAY_OFF_LEVEL);
  digitalWrite(PIN_GREEN_LED, LOW);
  digitalWrite(PIN_RED_LED, LOW);
  digitalWrite(PIN_BUZZER, LOW);
}

void setFan(bool on) {
  state.fanState = on;
  digitalWrite(PIN_FAN_RELAY, on ? RELAY_ON_LEVEL : RELAY_OFF_LEVEL);
}

void setPump(bool on) {

  // -------------------------------------------------
  // PUMP OFF REQUEST
  // -------------------------------------------------
  // Turning the pump OFF is always allowed.
  if (!on) {
    state.pumpState = false;
    digitalWrite(PIN_PUMP_RELAY, RELAY_OFF_LEVEL);
    return;
  }

  // -------------------------------------------------
  // PUMP ON REQUEST
  // -------------------------------------------------

  // Sensor validity check
  if (!isSensorValid()) {
    state.pumpState = false;
    digitalWrite(PIN_PUMP_RELAY, RELAY_OFF_LEVEL);
    return;
  }

  // Water safety check
  if (!isWaterSafeForPump()) {
    state.pumpState = false;
    digitalWrite(PIN_PUMP_RELAY, RELAY_OFF_LEVEL);
    return;
  }

  // All safety conditions passed
  state.pumpState = true;
  digitalWrite(PIN_PUMP_RELAY, RELAY_ON_LEVEL);
}

void setGreenLED(bool on) {
  state.greenLed = on;
  digitalWrite(PIN_GREEN_LED, on ? HIGH : LOW);
}

void setRedLED(bool on) {
  state.redLed = on;
  digitalWrite(PIN_RED_LED, on ? HIGH : LOW);
}

void setBuzzer(bool on) {
  state.buzzer = on;
  digitalWrite(PIN_BUZZER, on ? HIGH : LOW);
}

/* =========================
   SAFETY & VALIDATION
   ========================= */
bool isWaterSafeForPump() {

  if (state.sensorError) {
    return false;
  }

  if (isnan(state.waterLevel)) {
    return false;
  }

  return (state.waterLevel >= MIN_WATER_LEVEL);
}

bool isSensorValid() {
  // For control, consider DHT sensor validity only. ADC analogs always return values.
  return !state.sensorError;
}

/* =========================
   INDICATORS & ALERTS
   ========================= */
void updateIndicators() {

  // -----------------------------------------
  // WATER LEVEL LEDS
  // -----------------------------------------

  if (isnan(state.waterLevel)) {

    // Sensor value not available yet
    setGreenLED(false);
    setRedLED(false);

  } else if (state.waterLevel >= MIN_WATER_LEVEL) {

    setGreenLED(true);
    setRedLED(false);

  } else {

    setGreenLED(false);
    setRedLED(true);
  }

  // -----------------------------------------
  // BUZZER
  // -----------------------------------------

  bool buzz = false;

  if (!isnan(state.waterLevel) && !isnan(state.soilMoisture)) {

    buzz =
      (state.waterLevel < MIN_WATER_LEVEL) &&
      (state.soilMoisture < SOIL_DRY);
  }

  setBuzzer(buzz);
}

void generateAlerts() {
  // Build a short human-readable alert string; only print/send when changed
  String alert = "";

  if (state.sensorError) {
    alert = "SENSOR_ERROR";
  } else if (state.waterLow && state.irrigationRequired) {
    alert = "LOW_WATER_AND_IRRIGATION_REQUIRED";
  } else if (state.waterLow) {
    alert = "LOW_WATER";
  } else if (state.irrigationRequired) {
    alert = "IRRIGATION_REQUIRED";
  } else if (state.highTemperature) {
    alert = "HIGH_TEMPERATURE";
  } else if (!state.wifiConnected) {
    alert = "WIFI_ERROR";
  } else if (state.apiError) {
    alert = "API_ERROR";
  } else {
    alert = "NORMAL";
  }

  if (alert != state.lastAlert) {
    state.lastAlert = alert;
    if (DEBUG_ENABLED) {
      Serial.print("[ALERT] ");
      Serial.println(alert);
    }
    // TODO: optionally send alert immediately to API via POST /api/status
  }
}

/* =========================
   Wi-Fi & API
   ========================= */
void maintainWiFiConnection() {
  wl_status_t s = WiFi.status();
  state.wifiConnected = (s == WL_CONNECTED);
  if (state.wifiConnected) {
    // set flag if first time
    return;
  } else {
    state.apiError = false;
    unsigned long now = millis();
    if (now - lastWifiAttempt >= WIFI_RECONNECT_INTERVAL) {
      lastWifiAttempt = now;
      if (DEBUG_ENABLED) Serial.println("[WIFI] Attempting to reconnect...");
      WiFi.disconnect(false, true); // flush
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }
  }
}

void sendTelemetry() {

  if (WiFi.status() != WL_CONNECTED) {
    state.wifiConnected = false;
    state.apiConnected = false;
    state.cloudConnected = false;
    return;
  }

  state.wifiConnected = true;

  StaticJsonDocument<512> doc;

  if (isnan(state.temperature))
    doc["temperature"] = nullptr;
  else
    doc["temperature"] = state.temperature;

  if (isnan(state.humidity))
    doc["humidity"] = nullptr;
  else
    doc["humidity"] = state.humidity;

  if (isnan(state.soilMoisture))
    doc["soilMoisture"] = nullptr;
  else
    doc["soilMoisture"] = state.soilMoisture;

  if (isnan(state.waterLevel))
    doc["waterLevel"] = nullptr;
  else
    doc["waterLevel"] = state.waterLevel;
  doc["fan"] = state.fanState;
  doc["pump"] = state.pumpState;
  doc["manualFanRequest"] = state.manualFanRequest;
  doc["manualPumpRequest"] = state.manualPumpRequest;
  doc["greenLed"] = state.greenLed;
  doc["redLed"] = state.redLed;
  doc["buzzer"] = state.buzzer;

  doc["mode"] = (state.mode == AUTO_MODE) ? "AUTO" : "MANUAL";

  doc["waterLow"] = state.waterLow;
  doc["irrigationRequired"] = state.irrigationRequired;
  doc["highTemperature"] = state.highTemperature;
  doc["systemStatus"] = getSystemStatusString();

  String payload;
  serializeJson(doc, payload);

  String url = String(API_BASE_URL) + "/api/telemetry";

  // Use single global secure client
  HTTPClient http;
  http.setReuse(false);
  http.setConnectTimeout(2000);
  http.setTimeout(3000);

  if (!http.begin(secureClient, url)) {
    Serial.println("[TELEMETRY] HTTP Begin Failed");
    state.apiConnected = false;
    state.apiError = true;
    state.cloudConnected = false;
    http.end();
    return;
  }

  http.addHeader("Content-Type", "application/json");

  int httpCode = http.POST(payload);

  if (httpCode == HTTP_CODE_OK || httpCode == HTTP_CODE_CREATED) {
    state.apiConnected = true;
    state.apiError = false;
    state.cloudConnected = true;
    Serial.print("[TELEMETRY] Sent OK, code=");
    Serial.println(httpCode);
  } else {
    state.apiConnected = false;
    state.apiError = true;
    state.cloudConnected = false;
    Serial.print("[TELEMETRY] Failed, code=");
    Serial.println(httpCode);
    if (httpCode < 0) {
      Serial.print("[TELEMETRY] Error: ");
      Serial.println(http.errorToString(httpCode));
    }
  }

  http.end();
}

void pollCommands() {

  if (WiFi.status() != WL_CONNECTED) {

    state.wifiConnected = false;

    if (DEBUG_ENABLED) {
      Serial.println("[COMMAND] WiFi not connected");
    }

    return;
  }

  state.wifiConnected = true;

  String url = String(API_BASE_URL) + "/api/control";
  HTTPClient http;
  http.setReuse(false);
  http.setConnectTimeout(2000);
  http.setTimeout(3000);

  Serial.print("[COMMAND URL] ");
  Serial.println(url);

  if (!http.begin(secureClient, url)) {

    Serial.println("[COMMAND] HTTP Begin Failed");

    state.apiConnected = false;
    state.apiError = true;
    state.cloudConnected = false;
    http.end();
    return;
  }

  int httpCode = http.GET();

  Serial.print("[HTTP CODE] ");
  Serial.println(httpCode);

  if (httpCode == HTTP_CODE_OK) {

    String payload = http.getString();

    Serial.print("[COMMAND RESPONSE] ");
    Serial.println(payload);

    StaticJsonDocument<256> doc;

    DeserializationError err =
      deserializeJson(doc, payload);

    if (!err) {

      JsonObject data = doc["data"];

      if (data.containsKey("mode")) {

        String m = data["mode"].as<String>();

        if (m.equalsIgnoreCase("AUTO")) {
          state.mode = AUTO_MODE;

          state.manualFanRequest = false;
          state.manualPumpRequest = false;
        }
        else if (m.equalsIgnoreCase("MANUAL")) {
          state.mode = MANUAL_MODE;
        }
      }

        if (data.containsKey("fan")) {

          bool fanReq = data["fan"];

          if (state.mode == MANUAL_MODE) {
            // Store manual request; it will be applied during relay update after safety
            state.manualFanRequest = fanReq;
          }
        }

        if (data.containsKey("pump")) {

          bool pumpReq = data["pump"];

          if (state.mode == MANUAL_MODE) {
            // Store manual request; it will be applied during relay update after safety
            state.manualPumpRequest = pumpReq;
          }
        }

        // Success: cloud reachable
        state.apiConnected = true;
        state.apiError = false;
        state.cloudConnected = true;

      } else {

        Serial.print("[COMMAND] JSON Error: ");
        Serial.println(err.c_str());

        state.apiConnected = false;
        state.apiError = true;
        state.cloudConnected = false;
      }

    } else {

      state.apiConnected = false;
      state.apiError = true;
      state.cloudConnected = false;

      Serial.print("[COMMAND] HTTP Failed: ");
      Serial.println(httpCode);

      if (httpCode < 0) {
        Serial.print("[COMMAND] Error: ");
        Serial.println(http.errorToString(httpCode));
      }
    }

    http.end();
  }

  /* =========================
     SERIAL STATUS PRINTING
     ========================= */
  void serialStatusPrinter() {
    if (!DEBUG_ENABLED) return;
    Serial.println();
    Serial.println("========================================");
    Serial.println("SMART GREENHOUSE");
    Serial.println("========================================");
    Serial.print("Temperature : ");
    if (isnan(state.temperature)) Serial.println("N/A");
    else {
      Serial.print(state.temperature);
      Serial.println(" °C");
    }

    Serial.print("Humidity    : ");
    if (isnan(state.humidity)) Serial.println("N/A");
    else {
      Serial.print(state.humidity);
      Serial.println(" %");
    }

    Serial.print("Soil        : ");
    Serial.print(state.soilMoisture);
    Serial.println(" %");

    Serial.print("Water Level : ");
    Serial.print(state.waterLevel);
    Serial.println(" %");

    Serial.println();
    Serial.print("Mode        : ");
    Serial.println((state.mode == AUTO_MODE) ? "AUTO" : "MANUAL");

    Serial.println();
    Serial.print("Fan         : ");
    Serial.println(state.fanState ? "ON" : "OFF");

    Serial.print("Pump        : ");
    Serial.println(state.pumpState ? "ON" : "OFF");

    Serial.print("Green LED   : ");
    Serial.println(state.greenLed ? "ON" : "OFF");

    Serial.print("Red LED     : ");
    Serial.println(state.redLed ? "ON" : "OFF");

    Serial.print("Buzzer      : ");
    Serial.println(state.buzzer ? "ON" : "OFF");

    Serial.println();
    Serial.print("Water Safe  : ");
    Serial.println(isWaterSafeForPump() ? "YES" : "NO");

    Serial.print("Irrigation  : ");
    Serial.println(state.irrigationRequired ? "REQUIRED" : "NOT REQUIRED");

    Serial.print("System      : ");
    switch (state.status) {
      case STATUS_NORMAL: Serial.println("NORMAL"); break;
      case STATUS_HIGH_TEMPERATURE: Serial.println("HIGH_TEMPERATURE"); break;
      case STATUS_IRRIGATION_REQUIRED: Serial.println("IRRIGATION_REQUIRED"); break;
      case STATUS_LOW_WATER: Serial.println("LOW_WATER"); break;
      case STATUS_LOW_WATER_ALERT: Serial.println("LOW_WATER_ALERT"); break;
      case STATUS_SENSOR_ERROR: Serial.println("SENSOR_ERROR"); break;
      case STATUS_WIFI_ERROR: Serial.println("WIFI_ERROR"); break;
      case STATUS_API_ERROR: Serial.println("API_ERROR"); break;
    }

    Serial.print("WiFi        : ");
    Serial.println(state.wifiConnected ? "CONNECTED" : "DISCONNECTED");

    Serial.print("API         : ");
    Serial.println(state.apiConnected ? "CONNECTED" : "DISCONNECTED");

    Serial.print("API Error   : ");
    Serial.println(state.apiError ? "YES" : "NO");
    Serial.print("Cloud       : ");
    Serial.println(state.cloudConnected ? "CONNECTED" : "DISCONNECTED");

    Serial.println("========================================");
  }

  /* End of sketch */