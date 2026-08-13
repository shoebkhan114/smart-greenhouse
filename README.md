# 🌱 IoT Smart Greenhouse Automation System

An IoT-based Smart Greenhouse Automation System developed using ESP32, sensors, a Python backend API, and a responsive web dashboard. The system continuously monitors environmental conditions and automatically controls greenhouse devices such as fans and water pumps to maintain optimal plant growth conditions.

---

## 🚀 Features

### 📊 Real-Time Monitoring
- Temperature Monitoring
- Humidity Monitoring
- Soil Moisture Monitoring
- Water Tank Level Monitoring
- Live Sensor Data Updates

### 🤖 Smart Automation
- Automatic Fan Control
- Automatic Irrigation Control
- Water Tank Safety Protection
- High Temperature Detection
- Low Water Level Detection

### 🎮 Manual Control
- AUTO Mode
- MANUAL Mode
- Fan ON/OFF Control
- Pump ON/OFF Control

### 📈 Data Visualization
- Temperature History Graph
- Humidity History Graph
- Soil Moisture History Graph
- Water Level History Graph
- Real-Time Dashboard Updates

### 🔔 Alert System
- High Temperature Alert
- Irrigation Required Alert
- Low Water Alert
- Sensor Error Detection
- API Connection Status

---

## 🛠️ Technology Stack

### Hardware
- ESP32 Dev Board
- DHT Sensor (Temperature & Humidity)
- Soil Moisture Sensor
- Water Level Sensor
- Relay Module
- DC Fan
- Water Pump
- LEDs & Buzzer

### Software
- HTML5
- CSS3
- JavaScript
- Chart.js
- Python
- FastAPI
- REST API
- Render Cloud Deployment

---

## 📂 Project Structure

```text
smart-greenhouse/
│
├── ESP32/
│   └── SmartGreenhouse.ino
│
├── backend/
│   ├── main.py
│   └── requirements.txt
│
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── script.js
│
└── README.md
```

---

## ⚙️ System Workflow

1. ESP32 reads sensor data.
2. Sensor data is sent to the backend API.
3. Backend processes and stores the latest state.
4. Frontend dashboard fetches live telemetry data.
5. Automatic control logic manages fan and pump operation.
6. Users can switch between AUTO and MANUAL modes.
7. Real-time graphs display historical sensor readings.

---

## 🎯 Automation Logic

### Fan Control

| Condition | Action |
|------------|----------|
| Temperature ≥ 30°C | Fan ON |
| Temperature ≤ 27°C | Fan OFF |

### Irrigation Control

| Condition | Action |
|------------|----------|
| Soil Moisture < 30% | Pump ON |
| Soil Moisture ≥ 60% | Pump OFF |

### Safety Logic

| Condition | Action |
|------------|----------|
| Water Level < 30% | Pump Disabled |
| Water Level ≥ 30% | Pump Allowed |

---

## 🌐 Dashboard Features

- Live Environmental Data
- Device Status Monitoring
- Historical Data Charts
- Control Panel
- API Health Monitoring
- Responsive User Interface
- Real-Time Alerts

---

## 📸 Project Screenshots

Add screenshots of:

- Dashboard Home Screen
- Real-Time Charts
- Control Panel
- ESP32 Hardware Setup

---

## 🔮 Future Improvements

- Firebase Integration
- Mobile Application
- AI-Based Plant Recommendations
- Weather Forecast Integration
- Multi-Greenhouse Support
- Data Export & Analytics

---

## 👨‍💻 Author

**Shoeb Khan**

B.Tech Artificial Intelligence & Data Science  
Arya College of Engineering & IT, Jaipur

---

## 📜 License

This project is developed for My Indisturial training 