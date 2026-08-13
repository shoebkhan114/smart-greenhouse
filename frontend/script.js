/* Smart Greenhouse Dashboard (UPDATED for ESP32 + FastAPI)
   - Preserves original UI & IDs
   - Uses ESP32 telemetry as source-of-truth for actuators & alerts
   - Uses GET /api/health to determine backend health
   - Keeps Chart.js charts, no fabricated data
   - Implements pump/fan safety and command handling per requirements
*/

const API_BASE = 'https://smart-greenhouse-dyp1.onrender.com';
const TELEMETRY_ENDPOINT = `${API_BASE}/api/telemetry`;
const COMMANDS_ENDPOINT = `${API_BASE}/api/commands`;
const HEALTH_ENDPOINT = `${API_BASE}/api/health`;

/* -------------------------
   DOM references (preserve original IDs)
   -------------------------*/
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
const wifiBadge = document.getElementById('wifiBadge'); // ESP32 WiFi status (do NOT fake)

const alertsList = document.getElementById('alertsList');
const controlNotice = document.getElementById('controlNotice');
const lastApiStatus = document.getElementById('lastApiStatus'); // legacy badge in system grid
const apiHealth = document.getElementById('apiHealth'); // footer API health pill
const apiHealthText = document.getElementById('apiHealthText');

const lastUpdateEl = document.getElementById('lastUpdate');
const nextUpdateEl = document.getElementById('nextUpdate');

const yearSpan = document.getElementById('year');
yearSpan.textContent = new Date().getFullYear();

/* Buttons */
const btnAuto = document.getElementById('btnAuto');
const btnManual = document.getElementById('btnManual');
const btnFanOn = document.getElementById('btnFanOn');
const btnFanOff = document.getElementById('btnFanOff');
const btnPumpOn = document.getElementById('btnPumpOn');
const btnPumpOff = document.getElementById('btnPumpOff');

/* UI state */
let lastTelemetry = null;
let pollingHandle = null;
let nextUpdateCountdown = 5;

/* Chart datasets (keep last 20) */
const MAX_POINTS = 20;
const history = {
  labels: [],
  temperature: [],
  humidity: [],
  soil: [],
  water: []
};

/* Initialize charts */
const chartTemp = createChart('chartTemp', 'Temperature (°C)', history.labels, history.temperature, '#ff6b6b');
const chartHumidity = createChart('chartHumidity', 'Humidity (%)', history.labels, history.humidity, '#60a5fa');
const chartSoil = createChart('chartSoil', 'Soil Moisture (%)', history.labels, history.soil, '#f59e0b');
const chartWater = createChart('chartWater', 'Water Level (%)', history.labels, history.water, '#34d399');

/* Live date/time */
function updateDateTime(){
  const now = new Date();
  liveDateTime.textContent = now.toLocaleString();
}
setInterval(updateDateTime, 1000);
updateDateTime();

/* Next update countdown */
setInterval(()=>{
  nextUpdateCountdown = Math.max(0, nextUpdateCountdown - 1);
  nextUpdateEl.textContent = nextUpdateCountdown;
}, 1000);

/* Helper for creating Chart.js line charts */
function createChart(canvasId, label, labels, data, color){
  const ctx = document.getElementById(canvasId).getContext('2d');
  const cfg = {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label,
        data: data,
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
      animation: { duration: 300 },
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
  return new Chart(ctx, cfg);
}

/* Util: hex to rgba */
function hexToRgba(hex, alpha){
  const c = hex.replace('#','');
  const bigint = parseInt(c,16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/* Push data into history arrays keeping MAX_POINTS
   Use `null` for missing sensor values (do not insert 0)
*/
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

/* Apply history to charts */
function refreshCharts(){
  chartTemp.data.labels = history.labels;
  chartTemp.data.datasets[0].data = history.temperature;
  chartTemp.update();

  chartHumidity.data.labels = history.labels;
  chartHumidity.data.datasets[0].data = history.humidity;
  chartHumidity.update();

  chartSoil.data.labels = history.labels;
  chartSoil.data.datasets[0].data = history.soil;
  chartSoil.update();

  chartWater.data.labels = history.labels;
  chartWater.data.datasets[0].data = history.water;
  chartWater.update();
}

/* Round util */
function round(num, dec=1){
  if (num === null || num === undefined || isNaN(num)) return '--';
  const m = Math.pow(10,dec);
  return Math.round(num*m)/m;
}

/* Validate numeric sensor value */
function isValidNumber(v){
  return v !== null && v !== undefined && typeof v === 'number' && !isNaN(v);
}

/* Set badge utility (preserve classes) */
function setBadge(el, text, type){
  el.textContent = text;
  el.classList.remove('green','yellow','red','neutral');
  if(type === 'green') el.classList.add('green');
  else if(type === 'yellow') el.classList.add('yellow');
  else if(type === 'red') el.classList.add('red');
  else el.classList.add('neutral');
}

/* Format systemStatus mapping & colors */
function formatSystemStatus(raw){
  if(!raw) return {text:'UNKNOWN', level:'neutral'};
  const key = String(raw).toUpperCase();

  // Map to human and severity
  switch(key){
    case 'NORMAL':
      return {text:'NORMAL', level:'green'};
    case 'HIGH_TEMPERATURE':
    case 'HIGH TEMPERATURE':
      return {text:'HIGH TEMPERATURE', level:'red'};
    case 'IRRIGATION_REQUIRED':
      return {text:'IRRIGATION REQUIRED', level:'yellow'};
    case 'LOW_WATER':
      return {text:'LOW WATER', level:'yellow'};
    case 'LOW_WATER_ALERT':
      // Special combined meaning: Low water + irrigation required -> show more severe label
      return {text:'LOW WATER + IRRIGATION REQUIRED', level:'red'};
    case 'SENSOR_ERROR':
      return {text:'SENSOR ERROR', level:'red'};
    case 'WIFI_ERROR':
      return {text:'WIFI ERROR', level:'red'};
    case 'API_ERROR':
      return {text:'API ERROR', level:'red'};
    default:
      return {text: String(raw).replace(/_/g,' '), level:'neutral'};
  }
}

/* Alerts generator with required priority */
function buildAlertsFromTelemetry(data, apiOk = true){
  // priority order (highest first):
  // 1. LOW WATER + IRRIGATION REQUIRED
  // 2. SENSOR ERROR
  // 3. WIFI ERROR
  // 4. API ERROR
  // 5. HIGH TEMPERATURE
  // 6. IRRIGATION REQUIRED
  // 7. LOW WATER
  // 8. NORMAL

  const alerts = [];

  if(!apiOk){
    alerts.push({text:'API ERROR', level:'red'});
    return alerts;
  }
  if(!data) {
    alerts.push({text:'SENSOR ERROR', level:'red'});
    return alerts;
  }

  // sensor error detection
  const sensorKeys = ['temperature','humidity','soilMoisture','waterLevel'];
  const sensorError = sensorKeys.some(k => !(k in data) || data[k] === null || data[k] === undefined || (typeof data[k] === 'number' && isNaN(data[k])));
  if(sensorError){
    alerts.push({text:'SENSOR ERROR', level:'red'});
    return alerts;
  }

  // WIFI_ERROR systemStatus takes precedence if present
  if(data.systemStatus && String(data.systemStatus).toUpperCase() === 'WIFI_ERROR'){
    alerts.push({text:'WIFI ERROR', level:'red'});
    return alerts;
  }

  // Combined critical: waterLow && irrigationRequired
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

  // API_ERROR systemStatus
  if(data.systemStatus && String(data.systemStatus).toUpperCase() === 'API_ERROR'){
    alerts.push({text:'API ERROR', level:'red'});
    return alerts;
  }

  // HIGH TEMPERATURE
  if(data.highTemperature === true || (data.systemStatus && String(data.systemStatus).toUpperCase().includes('HIGH'))){
    alerts.push({text:'HIGH TEMPERATURE', level:'red'});
    return alerts;
  }

  // IRRIGATION_REQUIRED
  if(data.irrigationRequired === true || (data.systemStatus && String(data.systemStatus).toUpperCase() === 'IRRIGATION_REQUIRED')){
    alerts.push({text:'IRRIGATION REQUIRED', level:'yellow'});
    return alerts;
  }

  // LOW WATER
  if(data.waterLow === true || (data.systemStatus && String(data.systemStatus).toUpperCase() === 'LOW_WATER')){
    alerts.push({text:'LOW WATER', level:'yellow'});
    return alerts;
  }

  // Default NORMAL
  alerts.push({text:'NORMAL', level:'green'});
  return alerts;
}

/* Render alerts into alertsList */
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

    // If combined critical show extra info prominently
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

/* Enable / Disable manual controls based on mode */
function setManualControlsEnabled(enabled){
  [btnFanOn, btnFanOff, btnPumpOn, btnPumpOff].forEach(b => b.disabled = !enabled);
  controlNotice.textContent = enabled ? 'Manual control active' : 'Automatic control active';
}

/* Update system UI from telemetry (source-of-truth) */
function applyTelemetryToUI(d){
  // sensors: show '--' if invalid
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

  // Mode
  const modeText = d.mode ? String(d.mode).toUpperCase() : 'UNKNOWN';
  setBadge(modeBadge, modeText, 'neutral');

  // Fan & Pump use telemetry (do NOT assume state after sending command)
  setBadge(fanBadge, d.fan ? 'ON' : 'OFF', d.fan ? 'green' : 'neutral');
  setBadge(pumpBadge, d.pump ? 'ON' : 'OFF', d.pump ? 'green' : 'neutral');

  // buzzer
  setBadge(buzzerBadge, d.buzzer ? 'ON' : 'OFF', d.buzzer ? 'yellow' : 'neutral');

  // water tank badge and text
  if(isValidNumber(d.waterLevel)){
    if(d.waterLevel >= 30){
      setBadge(waterTankBadge, `SAFE (${round(d.waterLevel,0)}%)`, 'green');
    } else {
      setBadge(waterTankBadge, `LOW (${round(d.waterLevel,0)}%)`, 'yellow');
    }
  } else {
    setBadge(waterTankBadge, 'DATA NOT AVAILABLE', 'neutral');
  }

  // systemStatus mapping
  const sys = formatSystemStatus(d.systemStatus);
  setBadge(systemBadge, sys.text, sys.level);

  // ESP32 WiFi: DO NOT fabricate. Use wifiConnected field if present, otherwise display DATA NOT AVAILABLE
  if('wifiConnected' in d){
    const wif = d.wifiConnected ? 'CONNECTED' : 'DISCONNECTED';
    setBadge(wifiBadge, `ESP32: ${wif}`, d.wifiConnected ? 'green' : 'red');
  } else {
    setBadge(wifiBadge, 'ESP32 WiFi: DATA NOT AVAILABLE', 'neutral');
  }

  // Controls: enable only in MANUAL
  const manualEnabled = (d.mode && String(d.mode).toUpperCase() === 'MANUAL');
  setManualControlsEnabled(manualEnabled);
}

/* fetchTelemetry - polls telemetry endpoint, updates UI and charts */
async function fetchTelemetry(silent = false){
  try{
    const res = await fetch(TELEMETRY_ENDPOINT, {cache:'no-store'});
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    if(!json || (!json.temperature && json.temperature !== 0 && json.temperature !== null && json.temperature !== undefined && !json.data && !json.success && !json.hasOwnProperty('temperature'))) {
      // support responses either as { data: {...} } or direct payload
      if(json && json.data) {
        // ok
      } else {
        // allow fallback to direct object
      }
    }

    // Accept two possible shapes:
    // 1) { success:true, data: { ... } }
    // 2) { temperature: ..., ... } (ESP32 proxy)
    const d = json && json.data ? json.data : json;

    // save last telemetry
    lastTelemetry = d;

    // Update UI using telemetry source-of-truth (actuators reflect d.fan / d.pump)
    applyTelemetryToUI(d);

    // Build charts only with valid numbers or nulls (no fake zeros)
    const tsLabel = new Date().toLocaleTimeString();
    pushHistory(tsLabel,
      isValidNumber(d.temperature) ? d.temperature : null,
      isValidNumber(d.humidity) ? d.humidity : null,
      isValidNumber(d.soilMoisture) ? d.soilMoisture : null,
      isValidNumber(d.waterLevel) ? d.waterLevel : null
    );
    refreshCharts();

    // Alerts
    showAlertsFromTelemetry(d, true);

    // Update API health display based on separate health check (will be updated by checkApiHealth)
  } catch(err){
    console.error('Telemetry fetch error:', err);
    // Keep lastTelemetry intact; do not assume ESP32 WiFi has changed
    // Show API disconnected where appropriate (health check will also reflect)
    showAlertsFromTelemetry(null, false);
    // don't modify pump/fan badges based on this error
  }
}

/* checkApiHealth - uses GET /api/health to determine backend health status */
async function checkApiHealth(){
  try{
    const res = await fetch(HEALTH_ENDPOINT, {cache:'no-store'});
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    // The health endpoint may return {status:'ok'} or similar; treat 2xx as online
    apiHealth.textContent = 'ONLINE';
    apiHealth.classList.remove('offline');
    apiHealth.classList.add('online');
    // Also update legacy lastApiStatus badge in system grid
    setBadge(lastApiStatus, 'API: CONNECTED', 'green');
  } catch(err){
    console.warn('Health check failed', err);
    apiHealth.textContent = 'OFFLINE';
    apiHealth.classList.remove('online');
    apiHealth.classList.add('offline');
    setBadge(lastApiStatus, 'API: DISCONNECTED', 'red');
  }
}

/* sendCommand - sends a command object to the API.
   Example: sendCommand({mode:'AUTO'}) or sendCommand({fan:'ON'})
   Behaviors:
   - Do not assume actuator state locally after sending
   - If POST fails, show error and do not change badges
   - If POST succeeds, show success then wait for telemetry (the next telemetry poll will update badges)
*/
async function sendCommand(commandObj){
  // Simple UI loading: disable control buttons while sending
  const allButtons = [btnAuto, btnManual, btnFanOn, btnFanOff, btnPumpOn, btnPumpOff];
  allButtons.forEach(b => b.disabled = true);

  // show spinner in control notice
  const spinner = document.createElement('span');
  spinner.className = 'loading-spinner';
  controlNotice.textContent = 'Sending command...';
  controlNotice.appendChild(spinner);

  try{
    const res = await fetch(COMMANDS_ENDPOINT, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(commandObj)
    });

    if(!res.ok){
      throw new Error(`HTTP ${res.status}`);
    }

    // success from backend
    controlNotice.textContent = 'Command sent successfully';

    // After sending, do NOT immediately change actuator badges.
    // Wait for the next telemetry response to reflect actual ESP32 state.
    // We'll poll telemetry for a short window to get confirmation.
    await waitForTelemetryConfirmation(commandObj, 8000); // wait up to 8s
  } catch(err){
    console.error('Command error:', err);
    controlNotice.textContent = 'Command failed — backend unavailable';
    // Do not change badges (source-of-truth remains lastTelemetry)
  } finally {
    // restore manual controls state as per current mode (based on lastTelemetry)
    const manualEnabled = (lastTelemetry && lastTelemetry.mode && String(lastTelemetry.mode).toUpperCase() === 'MANUAL');
    setManualControlsEnabled(manualEnabled);
    btnAuto.disabled = false;
    btnManual.disabled = false;
  }
}

/* waitForTelemetryConfirmation
   Polls telemetry quickly up to timeout to observe actuator state change or safety block.
   expectedCmd example: {pump:'ON'} or {fan:'OFF'} or {mode:'MANUAL'}
*/
async function waitForTelemetryConfirmation(expectedCmd, timeoutMs = 8000){
  const start = Date.now();
  const expectedKey = Object.keys(expectedCmd)[0];
  const expectedVal = expectedCmd[expectedKey];

  // For mode change, we consider telemetry.mode to match expectedVal (AUTO/MANUAL)
  // For fan/pump, the expectedVal is 'ON'/'OFF' and telemetry fields are boolean.
  const desired = (() => {
    if(expectedKey === 'mode') return String(expectedVal).toUpperCase();
    if(expectedKey === 'fan' || expectedKey === 'pump'){
      return String(expectedVal).toUpperCase() === 'ON' ? true : false;
    }
    return expectedVal;
  })();

  let confirmed = false;
  let lastCheckedTelemetry = lastTelemetry;

  while(Date.now() - start < timeoutMs){
    // perform a fresh telemetry fetch (independent)
    try{
      const res = await fetch(TELEMETRY_ENDPOINT, {cache:'no-store'});
      if(res.ok){
        const json = await res.json();
        const d = json && json.data ? json.data : json;
        lastTelemetry = d;
        lastCheckedTelemetry = d;

        // Update UI from telemetry (keeps charts / badges accurate)
        applyTelemetryToUI(d);

        // If expected is mode
        if(expectedKey === 'mode'){
          if(d.mode && String(d.mode).toUpperCase() === desired){
            confirmed = true;
            break;
          }
        } else if(expectedKey === 'fan' || expectedKey === 'pump'){
          const actual = !!d[expectedKey]; // telemetry boolean
          if(actual === desired){
            confirmed = true;
            break;
          } else {
            // safety: if pump remains OFF while waterLow true after request to turn ON => pump blocked
            if(expectedKey === 'pump' && desired === true && d.waterLow === true && actual === false){
              // show pump blocked message
              controlNotice.textContent = 'Pump blocked: LOW WATER';
              return;
            }
            // fan safety is only temperature-driven; if fan not turned ON, we simply wait until telemetry matches or timeout
          }
        } else {
          // for other commands just confirm any telemetry change
          confirmed = true;
          break;
        }
      }
    } catch(e){
      // ignore and continue trying until timeout
    }

    // small delay before next check
    await new Promise(r => setTimeout(r, 900));
  }

  // If not confirmed within timeout, leave UI to reflect last telemetry and show note
  if(!confirmed){
    controlNotice.textContent = 'Awaiting device confirmation...';
    // If we requested pump ON and telemetry shows waterLow true and pump false, show explicit blocked message
    if(expectedKey === 'pump' && lastCheckedTelemetry){
      if(lastCheckedTelemetry.waterLow === true && lastCheckedTelemetry.pump === false){
        controlNotice.textContent = 'Pump blocked: LOW WATER';
      }
    }
  } else {
    controlNotice.textContent = 'Device confirmed command via telemetry';
  }
}

/* Attach button handlers (do not set badges locally for actuators) */
btnAuto.addEventListener('click', async ()=>{
  await sendCommand({mode:'AUTO'});
  // UX: do not mutate badges until telemetry confirms; show sending state already handled
});
btnManual.addEventListener('click', async ()=>{
  await sendCommand({mode:'MANUAL'});
});

btnFanOn.addEventListener('click', async ()=>{
  if(!(lastTelemetry && lastTelemetry.mode && String(lastTelemetry.mode).toUpperCase() === 'MANUAL')) return;
  await sendCommand({fan:'ON'});
});
btnFanOff.addEventListener('click', async ()=>{
  if(!(lastTelemetry && lastTelemetry.mode && String(lastTelemetry.mode).toUpperCase() === 'MANUAL')) return;
  await sendCommand({fan:'OFF'});
});

btnPumpOn.addEventListener('click', async ()=>{
  if(!(lastTelemetry && lastTelemetry.mode && String(lastTelemetry.mode).toUpperCase() === 'MANUAL')) return;

  // Safety: do not send pump ON if telemetry indicates waterLevel < 30 (frontend should respect but ESP32 also enforces)
  if(lastTelemetry && isValidNumber(lastTelemetry.waterLevel) && lastTelemetry.waterLevel < 30){
    controlNotice.textContent = 'Cannot enable pump: water level below minimum safe level (30%)';
    return;
  }

  await sendCommand({pump:'ON'});
});
btnPumpOff.addEventListener('click', async ()=>{
  if(!(lastTelemetry && lastTelemetry.mode && String(lastTelemetry.mode).toUpperCase() === 'MANUAL')) return;
  await sendCommand({pump:'OFF'});
});

/* Start polling every 5 seconds and health checks */
async function startPolling(){
  // initial loads
  await Promise.all([fetchTelemetry(true), checkApiHealth()]);

  // clear any existing
  if(pollingHandle) clearInterval(pollingHandle);

  pollingHandle = setInterval(async ()=>{
    await fetchTelemetry(true);
    await checkApiHealth();
    nextUpdateCountdown = 5;
    nextUpdateEl.textContent = nextUpdateCountdown;
  }, 5000);
}

/* Kick off */
startPolling();