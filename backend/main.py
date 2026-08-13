from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional


app = FastAPI(
    title="Smart Greenhouse API",
    description="IoT Based Automatic Temperature and Water Controlling System",
    version="1.0.0"
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # Development ke liye
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# TELEMETRY MODEL
# ============================================================

class Telemetry(BaseModel):
    temperature: Optional[float] = None
    humidity: Optional[float] = None
    soilMoisture: Optional[float] = None
    waterLevel: Optional[float] = None

    fan: bool = False
    pump: bool = False

    greenLed: bool = False
    redLed: bool = False
    buzzer: bool = False

    mode: str = "AUTO"

    waterLow: bool = False
    irrigationRequired: bool = False
    highTemperature: bool = False

    systemStatus: str = "UNKNOWN"


# ============================================================
# LATEST SYSTEM STATE
# ============================================================

latest_telemetry = {
    "temperature": None,
    "humidity": None,
    "soilMoisture": None,
    "waterLevel": None,

    "fan": False,
    "pump": False,

    "greenLed": False,
    "redLed": False,
    "buzzer": False,

    "mode": "AUTO",

    "waterLow": False,
    "irrigationRequired": False,
    "highTemperature": False,

    "systemStatus": "UNKNOWN"
}


# ============================================================
# ROOT
# ============================================================

@app.get("/")
def root():
    return {
        "message": "Smart Greenhouse API is running",
        "project": "IoT Based Automatic Temperature and Water Controlling System",
        "application": "Smart Greenhouse Automation System"
    }


# ============================================================
# HEALTH CHECK
# ============================================================

@app.get("/api/health")
def health_check():
    return {
        "status": "ok",
        "service": "Smart Greenhouse Backend"
    }


# ============================================================
# RECEIVE TELEMETRY FROM ESP32
# ============================================================

@app.post("/api/telemetry")
def receive_telemetry(data: Telemetry):

    global latest_telemetry

    latest_telemetry = data.model_dump()

    print("\n========== ESP32 TELEMETRY ==========")
    print(f"Temperature      : {data.temperature}")
    print(f"Humidity         : {data.humidity}")
    print(f"Soil Moisture    : {data.soilMoisture}")
    print(f"Water Level      : {data.waterLevel}")
    print(f"Fan              : {data.fan}")
    print(f"Pump             : {data.pump}")
    print(f"Mode             : {data.mode}")
    print(f"Water Low        : {data.waterLow}")
    print(f"Irrigation Req.  : {data.irrigationRequired}")
    print(f"High Temperature : {data.highTemperature}")
    print(f"System Status    : {data.systemStatus}")
    print("======================================\n")

    return {
        "success": True,
        "message": "Telemetry received successfully"
    }


# ============================================================
# GET LATEST TELEMETRY
# ============================================================

@app.get("/api/telemetry")
def get_telemetry():

    return {
        "success": True,
        "data": latest_telemetry
    } 
# ============================================================
# COMMAND MODEL
# ============================================================

class Command(BaseModel):
    mode: Optional[str] = None
    fan: Optional[str] = None
    pump: Optional[str] = None
class ControlState(BaseModel):
    mode: Optional[str] = None
    fan: Optional[bool] = None
    pump: Optional[bool] = None

# ============================================================
# LATEST COMMAND
# ============================================================

latest_command = {
    "mode": "AUTO",
    "fan": "OFF",
    "pump": "OFF"
}
# ============================================================
# CONTROL STATE
# ============================================================

control_state = {
    "mode": "AUTO",
    "fan": False,
    "pump": False
}

# ============================================================
# SET COMMAND
# ============================================================

@app.post("/api/commands")
def set_command(command: Command):

    global latest_command

    # -----------------------------
    # Validate MODE
    # -----------------------------

    if command.mode is not None:

        mode = command.mode.upper()

        if mode not in ["AUTO", "MANUAL"]:
            return {
                "success": False,
                "message": "Invalid mode. Use AUTO or MANUAL."
            }

        latest_command["mode"] = mode

    # -----------------------------
    # Validate FAN
    # -----------------------------

    if command.fan is not None:

        fan = command.fan.upper()

        if fan not in ["ON", "OFF"]:
            return {
                "success": False,
                "message": "Invalid fan command. Use ON or OFF."
            }

        latest_command["fan"] = fan

    # -----------------------------
    # Validate PUMP
    # -----------------------------

    if command.pump is not None:

        pump = command.pump.upper()

        if pump not in ["ON", "OFF"]:
            return {
                "success": False,
                "message": "Invalid pump command. Use ON or OFF."
            }

        latest_command["pump"] = pump

    # -----------------------------
    # Print command
    # -----------------------------

    print("\n========== NEW COMMAND ==========")
    print(f"Mode : {latest_command['mode']}")
    print(f"Fan  : {latest_command['fan']}")
    print(f"Pump : {latest_command['pump']}")
    print("=================================\n")

    return {
        "success": True,
        "message": "Command updated successfully",
        "command": latest_command
    }


# ============================================================
# GET COMMAND FOR ESP32
# ============================================================

@app.get("/api/commands")
def get_commands():

    return latest_command
# ============================================================
# GET CONTROL STATE
# ============================================================

@app.get("/api/control")
def get_control():

    return {
        "success": True,
        "data": control_state
    }
# ============================================================
# UPDATE CONTROL STATE
# ============================================================

@app.post("/api/control")
def update_control(data: ControlState):

    global control_state

    if data.mode is not None:

        mode = data.mode.upper()

        if mode not in ["AUTO", "MANUAL"]:
            return {
                "success": False,
                "message": "Mode must be AUTO or MANUAL"
            }

        control_state["mode"] = mode

    if data.fan is not None:
        control_state["fan"] = data.fan

    if data.pump is not None:
        control_state["pump"] = data.pump

    print("\n========== CONTROL UPDATE ==========")
    print(control_state)
    print("====================================\n")

    return {
        "success": True,
        "message": "Control updated",
        "data": control_state
    }