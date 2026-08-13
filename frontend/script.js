/* Smart Greenhouse Dashboard (UPDATED with /api/control integration)
   - Preserves existing telemetry, charts and command logic
   - Adds control state sync with GET/POST /api/control
   - Fan/Pump/Mode actions now POST to /api/control with full control payload
   - UI enables/disables fan & pump buttons based on control API mode (AUTO/MANUAL)
   - Updates UI immediately on successful control POST
   - Does NOT override telemetry as source-of-truth for actuator actual states
*/

/* API endpoints */
const API_BASE = 'https://smart-greenhouse-dyp1.onrender.com';
const TELEMETRY_ENDPOINT = `${API_BASE}/api/telemetry`;
const COMMANDS_ENDPOINT = `${API_BASE}/api/commands`; // preserved, not used for manual control
const HEALTH_ENDPOINT = `${API_BASE}/api/health`;
const CONTROL_ENDPOINT = `${API_BASE}/api/control`;

/* DOM refs (preserve original IDs) */
const liveDateTime = document.getElementById('liveDateTime');
const temperatureValue = document.getElementById('temperatureValue');
const humidityValue = document.getElementById('humidityValue');
const soilValue = document.getElementById('soilValue');
const waterValue = document.getElementById('waterValue');

const temperatureSub = document.getElementById('temperatureSub');
const humiditySub = document.getElementById('humiditySub');
const soilSub = document.getElementById('soilSub');
const waterSub = document.getElementById('waterSub');

const modeBadge = document.getElementById('modeBadge');
const fanBadge = document.getElementById('fanBadge');
const pumpBadge = document.getElementById('pumpBadge');
const buzzerBadge = document.getElementById('buzzerBadge');
const waterTankBadge = document.getElementById('waterTankBadge');
const systemBadge = document.getElementById('systemBadge');
const wifiBadge = document.getElementById('wifiBadge');

const alertsList = document.getElementById('alertsList');
const controlNotice = document.getElementById('controlNotice');
const lastApiStatus = document.getElementById('lastApiStatus');
const apiHealth = document.getElementById('apiHealth');
const apiHealthText = document.getElementById('apiHealthText');

const lastUpdateEl = document.getElementById('lastUpdate');
const nextUpdateEl = document.getElementById('nextUpdate');

const controlModeNote = document.getElementById('controlModeNote'); // shows "Automatic/Manual control active"

const yearSpan = document.getElementById('year');
yearSpan.textContent = new Date().getFullYear();

/* Buttons */
const btnAuto = document.getElementById('btnAuto');
const btnManual = document.getElementById('btnManual');
const btnFanOn = document.getElementById('btnFanOn');
const btnFanOff = document.getElementById('btnFanOff');
const btnPumpOn = document.getElementById('btnPumpOn');
const btnPumpOff = document.getElementById('btnPumpOff');

/* State */
let lastTelemetry = null;
let pollingHandle = null;
let nextUpdateCountdown = 5;

/* Control state (from /api/control) */
let controlState = {
  mode: null,   // 'AUTO' | 'MANUAL' or null
  fan: null,    // boolean or null
  pump: null    // boolean or null
};

/* History + charts */
const MAX_POINTS = 20;
const history = {
  labels: [],
  temperature: [],
  humidity: [],
  soil: [],
  water: []
};

/* Chart instances store */
window.SG_CHARTS = window.SG_CHARTS || {};

/* Create charts (re-use existing if present) */
function createChart(canvasId, label, labelsArr, dataArr, color){
  if(window.SG_CHARTS[canvasId]){
    return window.SG_CHARTS[canvasId];
  }
  const canvas = document.getElementById(canvasId);
  if(!canvas) throw new Error('Canvas not found: '+canvasId);
  const ctx = canvas.getContext('2d');

  const cfg = {
    type: 'line',
    data: {
      labels: labelsArr,
      datasets: [{
        label,
        data: dataArr,
        borderColor: color,
        backgroundColor: hexToRgba(color, 0.12),
        pointRadius: 2,
        borderWidth: 2,
        cubicInterpolationMode: 'monotone',
        tension: 0.4,
        spanGaps: false,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      scales: {
        x: { display: false },
        y: {
          ticks: { color: '#9aa7b2' },
          grid: { color: 'rgba(255,255,255,0.03)' }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0f1724',
          titleColor: '#fff',
          bodyColor: '#dbeafe'
        }
      }
    }
  };

  const chart = new Chart(ctx, cfg);
  window.SG_CHARTS[canvasId] = chart;
  return chart;
}

/* Initialize charts once */
const chartTemp = createChart('chartTemp', 'Temperature (°C)', history.labels, history.temperature, '#ff6b6b');
const chartHumidity = createChart('chartHumidity', 'Humidity (%)', history.labels, history.humidity, '#60a5fa');
const chartSoil = createChart('chartSoil', 'Soil Moisture (%)', history.labels, history.soil, '#f59e0b');
const chartWater = createChart('chartWater', 'Water Level (%)', history.labels, history.water, '#34d399');

/* Helpers */
function hexToRgba(hex, alpha){
  const c = hex.replace('#','');
  const bigint = parseInt(c,16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
function isValidNumber(v){
  return v !== null && v !== undefined && typeof v === 'number' && !isNaN(v);
}
function round(num, dec=1){
  if (num === null || num === undefined || isNaN(num)) return '--';
  const m = Math.pow(10,dec);
  return Math.round(num*m)/m;
}

/* History handling */
function pushHistory(tsLabel, t, h, s, w){
  history.labels.push(tsLabel);
  history.temperature.push(isValidNumber(t) ? round(t,1) : null);
  history.humidity.push(isValidNumber(h) ? round(h,1) : null);
  history.soil.push(isValidNumber(s) ? round(s,1) : null);
  history.water.push(isValidNumber(w) ? round(w,1) : null);

  while(history.labels.length > MAX_POINTS) history.labels.shift();
  while(history.temperature.length > MAX_POINTS) history.temperature.shift();
  while(history.humidity.length > MAX_POINTS) history.humidity.shift();
  while(history.soil.length > MAX_POINTS) history.soil.shift();
  while(history.water.length > MAX_POINTS) history.water.shift();
}

/* Update charts in-place (no destroy/recreate) */
function refreshCharts(){
  if(chartTemp){
    chartTemp.data.labels = history.labels.slice();
    if(chartTemp.data.datasets && chartTemp.data.datasets[0]) chartTemp.data.datasets[0].data = history.temperature.slice();
    chartTemp.update();
  }
  if(chartHumidity){
    chartHumidity.data.labels = history.labels.slice();
    if(chartHumidity.data.datasets && chartHumidity.data.datasets[0]) chartHumidity.data.datasets[0].data = history.humidity.slice();
    chartHumidity.update();
  }
  if(chartSoil){
    chartSoil.data.labels = history.labels.slice();
    if(chartSoil.data.datasets && chartSoil.data.datasets[0]) chartSoil.data.datasets[0].data = history.soil.slice();
    chartSoil.update();
  }
  if(chartWater){
    chartWater.data.labels = history.labels.slice();
    if(chartWater.data.datasets && chartWater.data.datasets[0]) chartWater.data.datasets[0].data = history.water.slice();
    chartWater.update();
  }
}

/* Badge helper */
function setBadge(el, text, type){
  if(!el){
    console.error("Badge element not found");
    return;
  }

  el.textContent = text;

  el.classList.remove(
    'green',
    'yellow',
    'red',
    'neutral',
    'online',
    'offline'
  );

  if(type === 'green')
    el.classList.add('green','status-pill','online');

  else if(type === 'yellow')
    el.classList.add('yellow','status-pill');

  else if(type === 'red')
    el.classList.add('red','status-pill','offline');

  else
    el.classList.add('neutral','status-pill');
}

/* Alerts (same priority rules as before) */
function buildAlertsFromTelemetry(data, apiOk = true){
  const alerts = [];
  if(!apiOk){
    alerts.push({text:'API ERROR', level:'red'});
    return alerts;
  }
  if(!data){
    alerts.push({text:'SENSOR ERROR', level:'red'});
    return alerts;
  }

  const sensorKeys = ['temperature','humidity','soilMoisture','waterLevel'];
  const sensorError = sensorKeys.some(k => !(k in data) || data[k] === null || data[k] === undefined || (typeof data[k] === 'number' && isNaN(data[k])));
  if(sensorError){
    alerts.push({text:'SENSOR ERROR', level:'red'});
    return alerts;
  }

  if(data.systemStatus && String(data.systemStatus).toUpperCase() === 'WIFI_ERROR'){
    alerts.push({text:'WIFI ERROR', level:'red'});
    return alerts;
  }

  if(data.waterLow === true && data.irrigationRequired === true){
    alerts.push({
      text: 'LOW WATER + IRRIGATION REQUIRED',
      level: 'red',
      critical: true,
      extra: [
        'Pump blocked for safety',
        'Refill the water tank'
      ]
    });
    return alerts;
  }

  if(data.systemStatus && String(data.systemStatus).toUpperCase() === 'API_ERROR'){
    alerts.push({text:'API ERROR', level:'red'});
    return alerts;
  }

  if(data.highTemperature === true || (data.systemStatus && String(data.systemStatus).toUpperCase().includes('HIGH'))){
    alerts.push({text:'HIGH TEMPERATURE', level:'red'});
    return alerts;
  }

  if(data.irrigationRequired === true || (data.systemStatus && String(data.systemStatus).toUpperCase() === 'IRRIGATION_REQUIRED')){
    alerts.push({text:'IRRIGATION REQUIRED', level:'yellow'});
    return alerts;
  }

  if(data.waterLow === true || (data.systemStatus && String(data.systemStatus).toUpperCase() === 'LOW_WATER')){
    alerts.push({text:'LOW WATER', level:'yellow'});
    return alerts;
  }

  alerts.push({text:'NORMAL', level:'green'});
  return alerts;
}

function showAlertsFromTelemetry(data, apiOk=true){
  alertsList.innerHTML = '';
  const alerts = buildAlertsFromTelemetry(data, apiOk);
  alerts.forEach(alert => {
    const node = document.createElement('div');
    node.classList.add('alert');
    if(alert.level === 'green') node.classList.add('green');
    else if(alert.level === 'yellow') node.classList.add('yellow');
    else if(alert.level === 'red') node.classList.add('red','critical');
    else node.classList.add('neutral');

    if(alert.critical){
      node.innerHTML = `<div style="font-size:1.05rem">${alert.text}</div>
                        <div style="margin-top:8px;font-weight:700">Pump blocked for safety</div>
                        <div style="margin-top:6px">Refill the water tank</div>`;
    } else {
      node.textContent = alert.text;
    }
    alertsList.appendChild(node);
  });
}

/* Apply telemetry UI (source-of-truth for actuator states and system status) */
function applyTelemetryToUI(d){
  const tText = isValidNumber(d.temperature) ? `${round(d.temperature,1)} °C` : '--';
  const hText = isValidNumber(d.humidity) ? `${round(d.humidity,0)} %` : '--';
  const sText = isValidNumber(d.soilMoisture) ? `${round(d.soilMoisture,0)} %` : '--';
  const wText = isValidNumber(d.waterLevel) ? `${round(d.waterLevel,0)} %` : '--';

  temperatureValue.textContent = tText;
  humidityValue.textContent = hText;
  soilValue.textContent = sText;
  waterValue.textContent = wText;

  const now = new Date();
  const nowLabel = now.toLocaleTimeString();
  temperatureSub.textContent = `Last update: ${nowLabel}`;
  humiditySub.textContent = `Last update: ${nowLabel}`;
  soilSub.textContent = `Last update: ${nowLabel}`;
  waterSub.textContent = `Last update: ${nowLabel}`;

  lastUpdateEl.textContent = now.toLocaleTimeString();
  nextUpdateCountdown = 5;
  nextUpdateEl.textContent = nextUpdateCountdown;

  // modeBadge left to telemetry (do not override by control API)
  const modeText = d.mode ? String(d.mode).toUpperCase() : 'UNKNOWN';
  setBadge(modeBadge, modeText, 'neutral');

  // Fan & Pump badges reflect telemetry booleans (actual device state)
  setBadge(fanBadge, d.fan ? 'ON' : 'OFF', d.fan ? 'green' : 'neutral');
  setBadge(pumpBadge, d.pump ? 'ON' : 'OFF', d.pump ? 'green' : 'neutral');

  setBadge(buzzerBadge, d.buzzer ? 'ON' : 'OFF', d.buzzer ? 'yellow' : 'neutral');

  if(isValidNumber(d.waterLevel)){
    if(d.waterLevel >= 30) setBadge(waterTankBadge, `SAFE (${round(d.waterLevel,0)}%)`, 'green');
    else setBadge(waterTankBadge, `LOW (${round(d.waterLevel,0)}%)`, 'yellow');
  } else {
    setBadge(waterTankBadge, 'DATA NOT AVAILABLE', 'neutral');
  }

  // system status mapping
  const sysText = d.systemStatus ? String(d.systemStatus).toUpperCase() : 'UNKNOWN';
  if(sysText === 'NORMAL') setBadge(systemBadge, 'NORMAL', 'green');
  else if(sysText === 'HIGH_TEMPERATURE' || sysText === 'HIGH TEMPERATURE') setBadge(systemBadge, 'HIGH TEMPERATURE', 'red');
  else if(sysText === 'IRRIGATION_REQUIRED') setBadge(systemBadge, 'IRRIGATION REQUIRED', 'yellow');
  else if(sysText === 'LOW_WATER') setBadge(systemBadge, 'LOW WATER', 'yellow');
  else if(sysText === 'LOW_WATER_ALERT') setBadge(systemBadge, 'LOW WATER + IRRIGATION REQUIRED', 'red');
  else if(sysText === 'SENSOR_ERROR') setBadge(systemBadge, 'SENSOR ERROR', 'red');
  else if(sysText === 'WIFI_ERROR') setBadge(systemBadge, 'WIFI ERROR', 'red');
  else if(sysText === 'API_ERROR') setBadge(systemBadge, 'API ERROR', 'red');
  else setBadge(systemBadge, sysText.replace(/_/g,' '), 'neutral');

  // ESP32 WiFi shown only if present in telemetry
  if('wifiConnected' in d){
    const wif = d.wifiConnected ? 'CONNECTED' : 'DISCONNECTED';
    setBadge(wifiBadge, `ESP32: ${wif}`, d.wifiConnected ? 'green' : 'red');
  } else {
    setBadge(wifiBadge, 'ESP32 WiFi: DATA NOT AVAILABLE', 'neutral');
  }

  // Do not change control buttons enable here — control API manages manual/auto enable.
}

/* TELEMETRY fetching (unchanged logic), but also keep charts and alerts updated */
async function fetchTelemetry(silent = false){
  try{
    const res = await fetch(TELEMETRY_ENDPOINT, {cache:'no-store'});
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const d = json && json.data ? json.data : json;
    lastTelemetry = d;

    applyTelemetryToUI(d);

    const tsLabel = new Date().toLocaleTimeString();
    pushHistory(tsLabel,
      isValidNumber(d.temperature) ? d.temperature : null,
      isValidNumber(d.humidity) ? d.humidity : null,
      isValidNumber(d.soilMoisture) ? d.soilMoisture : null,
      isValidNumber(d.waterLevel) ? d.waterLevel : null
    );
    refreshCharts();

    showAlertsFromTelemetry(d, true);
  } catch(err){
    console.error('Telemetry fetch error:', err);
    showAlertsFromTelemetry(null, false);
  }
}

/* API health */
async function checkApiHealth(){
  try{
    const res = await fetch(HEALTH_ENDPOINT, {cache:'no-store'});
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    await res.json();
    apiHealth.textContent = 'ONLINE';
    apiHealth.classList.remove('offline');
    apiHealth.classList.add('online');
    setBadge(lastApiStatus, 'API: CONNECTED', 'green');
  } catch(err){
    console.warn('Health check failed', err);
    apiHealth.textContent = 'OFFLINE';
    apiHealth.classList.remove('online');
    apiHealth.classList.add('offline');
    setBadge(lastApiStatus, 'API: DISCONNECTED', 'red');
  }
}

/* CONTROL API integration
   - GET /api/control -> controlState
   - POST /api/control with {mode, fan, pump} to update control
   - Button handlers use postControlUpdate
*/

/* Apply controlState to UI: enable/disable buttons and show mode note
   Important: we do NOT override telemetry-based actuator badges (fan/pump ON/OFF)
   We only use controlState.mode to enable/disable controls and show control mode note.
*/
function applyControlStateToUI(){
  const mode = controlState.mode ? String(controlState.mode).toUpperCase() : null;

  if(mode === 'MANUAL'){
    // enable manual buttons
    [btnFanOn, btnFanOff, btnPumpOn, btnPumpOff].forEach(b => b.disabled = false);
    controlModeNote.textContent = 'Manual control active';
    // reflect controlState fan/pump quickly in controlNotice (but not in badges)
    controlNotice.textContent = `Control state: Fan ${controlState.fan ? 'ON' : 'OFF'}, Pump ${controlState.pump ? 'ON' : 'OFF'}`;
  } else {
    // AUTO or unknown -> disable manual controls
    [btnFanOn, btnFanOff, btnPumpOn, btnPumpOff].forEach(b => b.disabled = true);
    controlModeNote.textContent = 'Automatic control active';
    controlNotice.textContent = 'Automatic control active';
  }

  // Update small UI indicator for mode in control panel (modeBadge continues to show telemetry)
  // Optionally show control mode in controlModeNote already done
}

/* Fetch control state from backend */
async function fetchControlState(){
  try{
    const res = await fetch(CONTROL_ENDPOINT, {cache:'no-store'});
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    // Accept both { mode, fan, pump } or { data: { ... } }
    const c = json && json.data ? json.data : json;

    // Normalize: ensure booleans where possible
    controlState.mode = c.mode ? String(c.mode).toUpperCase() : controlState.mode;
    controlState.fan = (typeof c.fan !== 'undefined') ? !!c.fan : controlState.fan;
    controlState.pump = (typeof c.pump !== 'undefined') ? !!c.pump : controlState.pump;

    applyControlStateToUI();
  } catch(err){
    console.warn('Control fetch failed', err);
    // keep previous controlState; do not change UI aggressively
  }
}

/* POST updated control payload to backend
   newPartial: object with any of { mode, fan, pump }
   On success: update controlState to payload and applyControlStateToUI
   On failure: show controlNotice error; do not mutate buttons beyond temporary disable
*/
async function postControlUpdate(newPartial){
  // Build full payload using existing controlState, telemetry fallback
  const payload = {
    mode: (typeof newPartial.mode !== 'undefined') ? String(newPartial.mode).toUpperCase() :
          (controlState.mode ? controlState.mode : (lastTelemetry && lastTelemetry.mode ? String(lastTelemetry.mode).toUpperCase() : 'AUTO')),
    fan: (typeof newPartial.fan !== 'undefined') ? !!newPartial.fan :
         (typeof controlState.fan !== 'undefined' && controlState.fan !== null) ? !!controlState.fan :
         (lastTelemetry ? !!lastTelemetry.fan : false),
    pump: (typeof newPartial.pump !== 'undefined') ? !!newPartial.pump :
          (typeof controlState.pump !== 'undefined' && controlState.pump !== null) ? !!controlState.pump :
          (lastTelemetry ? !!lastTelemetry.pump : false)
  };

  // temporary disable controls while sending
  const allButtons = [btnAuto, btnManual, btnFanOn, btnFanOff, btnPumpOn, btnPumpOff];
  allButtons.forEach(b => b.disabled = true);

  const spinner = document.createElement('span');
  spinner.className = 'loading-spinner';
  controlNotice.textContent = 'Updating controls...';
  controlNotice.appendChild(spinner);

  try{
    const res = await fetch(CONTROL_ENDPOINT, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });

    if(!res.ok) throw new Error(`HTTP ${res.status}`);

    // On success, update local controlState to reflect requested payload
    controlState.mode = payload.mode;
    controlState.fan = payload.fan;
    controlState.pump = payload.pump;

    applyControlStateToUI();

    controlNotice.textContent = 'Control updated successfully';

    // After updating control, fetch telemetry and control state again to sync device status
    // telemetry will remain the source-of-truth for actual actuator states
    await fetchTelemetry(true);
    await fetchControlState();

  } catch(err){
    console.error('Control update failed', err);
    controlNotice.textContent = 'Control update failed — backend unavailable';
  } finally {
    // restore mode buttons enabled state
    btnAuto.disabled = false;
    btnManual.disabled = false;
    // set manual action buttons based on new controlState
    const manualEnabled = controlState.mode && String(controlState.mode).toUpperCase() === 'MANUAL';
    [btnFanOn, btnFanOff, btnPumpOn, btnPumpOff].forEach(b => b.disabled = !manualEnabled);
  }
}

/* Button handlers now call postControlUpdate for manual control API */
btnAuto.addEventListener('click', async () => {
  await postControlUpdate({mode:'AUTO'});
});

btnManual.addEventListener('click', async () => {
  await postControlUpdate({mode:'MANUAL'});
});

btnFanOn.addEventListener('click', async () => {
  // ensure manual allowed by controlState (not telemetry) — requirement 5/6
  if(!(controlState.mode && String(controlState.mode).toUpperCase() === 'MANUAL')) {
    controlNotice.textContent = 'Switch to MANUAL mode to operate fan';
    return;
  }
  await postControlUpdate({fan:true});
});

btnFanOff.addEventListener('click', async () => {
  if(!(controlState.mode && String(controlState.mode).toUpperCase() === 'MANUAL')) {
    controlNotice.textContent = 'Switch to MANUAL mode to operate fan';
    return;
  }
  await postControlUpdate({fan:false});
});

btnPumpOn.addEventListener('click', async () => {
  if(!(controlState.mode && String(controlState.mode).toUpperCase() === 'MANUAL')) {
    controlNotice.textContent = 'Switch to MANUAL mode to operate pump';
    return;
  }
  // Frontend safety: do not send pump ON if lastTelemetry shows waterLevel < 30
  if(lastTelemetry && isValidNumber(lastTelemetry.waterLevel) && lastTelemetry.waterLevel < 30){
    controlNotice.textContent = 'Cannot enable pump: water level below minimum safe level (30%)';
    return;
  }
  await postControlUpdate({pump:true});
});

btnPumpOff.addEventListener('click', async () => {
  if(!(controlState.mode && String(controlState.mode).toUpperCase() === 'MANUAL')) {
    controlNotice.textContent = 'Switch to MANUAL mode to operate pump';
    return;
  }
  await postControlUpdate({pump:false});
});

/* Initialization & polling
   - On startup: fetch telemetry, health, control state
   - Poll telemetry, health, and control state every 5s
*/
async function startPolling(){
  await Promise.all([fetchTelemetry(true), checkApiHealth(), fetchControlState()]);

  if(pollingHandle) clearInterval(pollingHandle);

  pollingHandle = setInterval(async () => {
    await fetchTelemetry(true);
    await checkApiHealth();
    await fetchControlState();
    nextUpdateCountdown = 5;
    nextUpdateEl.textContent = nextUpdateCountdown;
  }, 5000);
}

/* Kick off date/time and start polling */
function updateDateTime(){
  const now = new Date();
  liveDateTime.textContent = now.toLocaleString();
}
setInterval(updateDateTime, 1000);
updateDateTime();

setInterval(()=>{
  nextUpdateCountdown = Math.max(0, nextUpdateCountdown - 1);
  nextUpdateEl.textContent = nextUpdateCountdown;
}, 1000);

/* Start everything */
startPolling();