  const ORS_API_KEY = "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImFhOTA1MmJkZGYyNjRiYjRhZDA2OTcxM2NiMmJlZjQwIiwiaCI6Im11cm11cjY0In0=";
  const OBSTACLE_STORE_KEY = "rutas_peatonales_obstacles_v1";
  const OBSTACLE_SYNC_MS = 30000;
  const HIGH_RISK_OBSTACLE_COUNT = 5;
  const HIGH_RISK_PENALTY = 10;
  const FORCE_SWITCH_MIN_IMPROVEMENT = 0.12;

  // Configura estos valores para compartir reportes entre diferentes usuarios con Supabase.
  const SUPABASE_URL = "";
  const SUPABASE_ANON_KEY = "";
  const supabaseEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

  const map = L.map("map", { zoomControl: true }).setView([-12.0464, -77.0428], 16);
  let activeBaseLayer = null;
  const baseMapConfigs = {
    streets: {
      label: "Calles",
      url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
      options: {
        attribution: "© OpenStreetMap contributors © CARTO",
        maxZoom: 20,
        subdomains: "abcd"
      }
    },
    contrast: {
      label: "Alto contraste",
      url: "https://{s}.basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png",
      options: {
        attribution: "© OpenStreetMap contributors © CARTO",
        maxZoom: 20,
        subdomains: "abcd"
      }
    },
    satellite: {
      label: "Satélite",
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      options: {
        attribution: "Tiles © Esri",
        maxZoom: 19
      }
    }
  };

  let userLocation = null;
  let userMarker = null;
  let destinationMarker = null;

  let suggestionsData = [];
  let activeSuggestionIndex = -1;
  let searchDebounce = null;

  let currentRoutes = [];
  let routeLayers = [];
  let selectedRouteIndex = null;
  let currentDestination = null;
  let lastDistanceToDestination = null;
  let rerouteInProgress = false;
  let recommendedRouteIndex = null;
  let routeAssessments = [];

  let obstacles = [];
  let obstacleMarkers = [];
  let reportModeActive = false;
  let obstacleSyncTimer = null;

  const searchInput = document.getElementById("searchInput");
  const voiceCommandBtn = document.getElementById("voiceCommandBtn");
  const voiceStatus = document.getElementById("voiceStatus");
  const gpsBtn = document.getElementById("gpsBtn");
  const reportObstacleBtn = document.getElementById("reportObstacleBtn");
  const mapStyleSelect = document.getElementById("mapStyleSelect");
  const suggestionsBox = document.getElementById("suggestions");
  const routesContent = document.getElementById("routesContent");
  const routesPanel = document.querySelector(".routes-panel");
  const toggleRoutesPanelBtn = document.getElementById("toggleRoutesPanelBtn");
  const compassNeedle = document.getElementById("compassNeedle");
  const navStatus = document.getElementById("navStatus");
  const navStatusText = document.getElementById("navStatusText");

  const btnSpeak = document.getElementById("btnSpeak");
  const btnPause = document.getElementById("btnPause");
  const btnResume = document.getElementById("btnResume");
  const btnRepeat = document.getElementById("btnRepeat");
  const btnStop = document.getElementById("btnStop");
  const btnQuickPause = document.getElementById("btnQuickPause");
  const btnQuickStop = document.getElementById("btnQuickStop");

  const currentStepBox = document.getElementById("currentStepBox");
  const currentStepText = document.getElementById("currentStepText");

  const synth = window.speechSynthesis;
  let selectedVoice = null;
  let watchId = null;
  let navigationActive = false;
  let navigationPaused = false;
  let navigationStepIndex = 0;
  let selectedRouteSteps = [];
  let autoCenterMap = true;
  let lastSpokenStepIndex = -1;
  let distanceToCurrentStep = null;
  let announcedStepAlerts = new Set();
  let routesPanelExpanded = false;
  let voiceRecognition = null;
  let voiceRecognitionSupported = false;
  let voiceListening = false;
  let pendingVoiceMode = null;
  let voiceCommandMode = "command";
  let obstacleVoiceDraft = null;

  function createUserIcon(heading = 0) {
    const rotation = Number.isFinite(heading) ? heading : 0;
    return L.divIcon({
      className: "user-location-marker",
      html: `
        <div class="user-location-core" style="transform: rotate(${rotation}deg)">
          <div class="user-location-arrow"></div>
        </div>
        <div class="user-location-pulse"></div>
      `,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });
  }

  function createObstacleIcon(severity = 3) {
    const safeSeverity = Math.max(1, Math.min(5, Number(severity) || 3));
    const colors = ['#10b981', '#3b82f6', '#f59e0b', '#fb923c', '#dc2626'];
    const emojis = ['🚧', '⚠️', '⛔', '🚨', '🆘'];
    const color = colors[safeSeverity - 1] || '#64748b';
    const emoji = emojis[safeSeverity - 1] || '⚠️';
    
    return L.divIcon({
      className: "obstacle-marker",
      html: `
        <div class="obstacle-pin severity-${safeSeverity}" style="
          background:${color};
          box-shadow:0 4px 12px rgba(0,0,0,.25), 0 0 0 3px rgba(255,255,255,.9);
          animation:obstaclePop .4s cubic-bezier(0.34, 1.56, 0.64, 1);
        ">
          <span style="font-size:18px;">${emoji}</span>
        </div>
      `,
      iconSize: [44, 44],
      iconAnchor: [22, 22],
      popupAnchor: [0, -22]
    });
  }

  function setVoiceStatus(message, isListening = false) {
    if (voiceStatus) {
      voiceStatus.textContent = message;
      voiceStatus.classList.toggle("listening", Boolean(isListening));
    }
    if (voiceCommandBtn) {
      voiceCommandBtn.classList.toggle("listening", Boolean(isListening));
      voiceCommandBtn.setAttribute("aria-label", isListening ? "Escuchando comandos por voz" : "Activar comandos por voz");
    }
  }

  function normalizeVoiceText(text) {
    return normalizeSearchText(String(text || "").replace(/[.,;:!?]/g, " "));
  }

  function parseVoiceSeverity(text) {
    const normalized = normalizeVoiceText(text);
    if (!normalized) return null;

    const direct = normalized.match(/\b([1-5])\b/);
    if (direct) return Number(direct[1]);

    const byWord = [
      { keys: ["uno", "un", "bajo", "leve"], value: 1 },
      { keys: ["dos"], value: 2 },
      { keys: ["tres", "medio", "moderado"], value: 3 },
      { keys: ["cuatro", "alto"], value: 4 },
      { keys: ["cinco", "critico", "grave", "muy alto"], value: 5 }
    ];

    for (const rule of byWord) {
      if (rule.keys.some(key => normalized.includes(key))) {
        return rule.value;
      }
    }

    return null;
  }

  function parseVoiceObstacleType(text) {
    const normalized = normalizeVoiceText(text);
    const map = [
      { type: "obra", aliases: ["obra", "construccion", "trabajo"] },
      { type: "escalera", aliases: ["escalera", "escaleras"] },
      { type: "bache", aliases: ["bache", "hueco", "hoyo"] },
      { type: "vereda_rota", aliases: ["vereda rota", "acera rota", "pista rota", "banqueta rota"] },
      { type: "poste", aliases: ["poste", "objeto", "bloqueo"] },
      { type: "inundacion", aliases: ["inundacion", "agua", "charco", "anegado"] },
      { type: "inseguridad", aliases: ["inseguridad", "peligro", "asalto", "robo"] }
    ];

    const found = map.find(item => item.aliases.some(alias => normalized.includes(normalizeSearchText(alias))));
    return found ? found.type : null;
  }

  function extractDestinationFromCommand(rawText) {
    const text = String(rawText || "").trim();
    if (!text) return "";
    const normalized = normalizeVoiceText(text);

    const patterns = [
      "quiero ir a",
      "quiero ir al",
      "quiero llegar a",
      "llevame a",
      "llévame a",
      "ir a",
      "destino",
      "buscar"
    ];

    const prefix = patterns.find(p => normalized.startsWith(normalizeSearchText(p)));
    if (!prefix) return text;

    const cleaned = text.slice(prefix.length).trim();
    return cleaned || "";
  }

  async function searchDestinationByVoice(query) {
    const cleanQuery = String(query || "").trim();
    if (cleanQuery.length < 2) {
      speakText("No escuché bien el destino. Inténtalo nuevamente.", true);
      setVoiceStatus("No se entendió el destino. Toca el micrófono e intenta de nuevo.", false);
      return;
    }

    try {
      setVoiceStatus(`Buscando destino: ${cleanQuery}`, false);
      searchInput.value = cleanQuery;
      const results = await searchPlaces(cleanQuery);
      renderSuggestions(results);
      chooseSuggestion(0);

      const first = suggestionsData[0]?.fullLabel || suggestionsData[0]?.title || cleanQuery;
      speakText(`Entendido. Te llevo a ${first}.`, true);
      setVoiceStatus(`Destino seleccionado por voz: ${first}.`, false);
    } catch (error) {
      console.error(error);
      speakText("No pude encontrar ese destino por voz. Puedes intentarlo otra vez o escribirlo.", true);
      setVoiceStatus("No se encontró destino por voz. Puedes repetir o escribirlo.", false);
    }
  }

  function askVoiceObstacleType() {
    voiceCommandMode = "obstacle_type";
    pendingVoiceMode = "obstacle_type";
    speakText("¿Qué quieres reportar? Puedes decir obra, escalera, bache, vereda rota, poste, inundación, inseguridad u otro.", true);
    setVoiceStatus("Escuchando tipo de obstáculo...", true);
  }

  function askVoiceObstacleSeverity() {
    voiceCommandMode = "obstacle_severity";
    pendingVoiceMode = "obstacle_severity";
    speakText("Indica la severidad del uno al cinco, donde cinco es muy crítico.", true);
    setVoiceStatus("Escuchando severidad del obstáculo...", true);
  }

  function askVoiceObstacleNotes() {
    voiceCommandMode = "obstacle_notes";
    pendingVoiceMode = "obstacle_notes";
    speakText("Puedes dictar un comentario. Si no deseas comentar, di sin comentario.", true);
    setVoiceStatus("Escuchando comentario del obstáculo...", true);
  }

  function beginVoiceObstacleReport() {
    const point = userLocation
      ? { lat: userLocation.lat, lng: userLocation.lng }
      : map.getCenter();

    obstacleVoiceDraft = {
      lat: Number(point.lat),
      lng: Number(point.lng),
      type: null,
      severity: null,
      notes: ""
    };

    speakText("Iniciando reporte por voz en tu ubicación actual.", true);
    askVoiceObstacleType();
  }

  async function handleVoiceObstacleStep(rawText) {
    const text = String(rawText || "").trim();
    const normalized = normalizeVoiceText(text);

    if (normalized.includes("cancelar")) {
      obstacleVoiceDraft = null;
      voiceCommandMode = "command";
      pendingVoiceMode = null;
      speakText("Reporte por voz cancelado.", true);
      setVoiceStatus("Reporte por voz cancelado.", false);
      return;
    }

    if (!obstacleVoiceDraft) {
      voiceCommandMode = "command";
      pendingVoiceMode = null;
      setVoiceStatus("No hay un reporte activo. Di: quiero reportar obstáculo.", false);
      return;
    }

    if (voiceCommandMode === "obstacle_type") {
      const type = parseVoiceObstacleType(text);
      if (!type) {
        pendingVoiceMode = "obstacle_type";
        speakText("No reconocí el tipo. Di obra, escalera, bache, vereda rota, poste, inundación, inseguridad u otro.", true);
        return;
      }
      obstacleVoiceDraft.type = type;
      askVoiceObstacleSeverity();
      return;
    }

    if (voiceCommandMode === "obstacle_severity") {
      const severity = parseVoiceSeverity(text);
      if (!severity) {
        pendingVoiceMode = "obstacle_severity";
        speakText("No entendí la severidad. Di un número del uno al cinco.", true);
        return;
      }
      obstacleVoiceDraft.severity = severity;
      askVoiceObstacleNotes();
      return;
    }

    if (voiceCommandMode === "obstacle_notes") {
      obstacleVoiceDraft.notes = normalized.includes("sin comentario") ? "" : text;

      await registerObstacle({
        lat: obstacleVoiceDraft.lat,
        lng: obstacleVoiceDraft.lng,
        type: obstacleVoiceDraft.type,
        severity: obstacleVoiceDraft.severity,
        notes: obstacleVoiceDraft.notes,
        announceShared: true,
        announceLocalOnly: true
      });

      obstacleVoiceDraft = null;
      voiceCommandMode = "command";
      pendingVoiceMode = null;
      setVoiceStatus("Reporte por voz completado.", false);
      return;
    }
  }

  function handleVoiceCommand(rawText) {
    const normalized = normalizeVoiceText(rawText);

    if (!normalized) {
      speakText("No escuché ningún comando. Intenta de nuevo.", true);
      setVoiceStatus("No se detectó voz. Toca el micrófono para reintentar.", false);
      return;
    }

    if (voiceCommandMode !== "command") {
      handleVoiceObstacleStep(rawText);
      return;
    }

    if (normalized.includes("quiero reportar") || normalized.includes("reportar obstaculo") || normalized.includes("reportar obstáculo")) {
      beginVoiceObstacleReport();
      return;
    }

    if (normalized.includes("iniciar trayecto") || normalized.includes("iniciar navegacion") || normalized.includes("iniciar navegación")) {
      startNavigation();
      return;
    }

    if (normalized.includes("pausar")) {
      pauseNavigation();
      return;
    }

    if (normalized.includes("reanudar") || normalized.includes("continuar")) {
      resumeNavigation();
      return;
    }

    if (normalized.includes("detener")) {
      stopNavigation();
      return;
    }

    if (normalized.includes("repetir")) {
      repeatCurrentInstruction();
      return;
    }

    if (normalized.includes("centrar") || normalized.includes("mi ubicacion") || normalized.includes("mi ubicación")) {
      centerOnUser();
      return;
    }

    if (normalized.includes("mapa satelite") || normalized.includes("mapa satélite") || normalized.includes("satelite") || normalized.includes("satélite")) {
      setMapStyle("satellite");
      return;
    }

    if (normalized.includes("alto contraste") || normalized.includes("contraste")) {
      setMapStyle("contrast");
      return;
    }

    if (normalized.includes("mapa calles") || normalized.includes("calles")) {
      setMapStyle("streets");
      return;
    }

    const routeMatch = normalized.match(/ruta\s+([1-3])/);
    if (routeMatch) {
      const index = Number(routeMatch[1]) - 1;
      if (currentRoutes[index]) {
        selectRoute(index);
      } else {
        speakText("Esa ruta no está disponible aún.", true);
      }
      return;
    }

    const destinationQuery = extractDestinationFromCommand(rawText);
    searchDestinationByVoice(destinationQuery);
  }

  function initVoiceRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      voiceRecognitionSupported = false;
      setVoiceStatus("Tu navegador no soporta reconocimiento de voz. Puedes seguir usando texto.", false);
      if (voiceCommandBtn) voiceCommandBtn.disabled = true;
      return;
    }

    voiceRecognitionSupported = true;
    voiceRecognition = new SpeechRecognition();
    voiceRecognition.lang = "es-PE";
    voiceRecognition.interimResults = false;
    voiceRecognition.maxAlternatives = 1;
    voiceRecognition.continuous = false;

    voiceRecognition.onstart = () => {
      voiceListening = true;
      setVoiceStatus("Escuchando...", true);
    };

    voiceRecognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript || "";
      setVoiceStatus(`Escuchado: ${transcript}`, false);
      handleVoiceCommand(transcript);
    };

    voiceRecognition.onerror = (event) => {
      console.warn("Reconocimiento de voz:", event.error);
      voiceListening = false;
      setVoiceStatus("No se pudo reconocer la voz. Intenta nuevamente.", false);
    };

    voiceRecognition.onend = () => {
      voiceListening = false;
      const nextMode = pendingVoiceMode;
      pendingVoiceMode = null;

      if (nextMode) {
        setTimeout(() => {
          startVoiceRecognition(nextMode, true);
        }, 900);
        return;
      }

      setVoiceStatus("Voz lista. Di: quiero ir a..., iniciar trayecto o quiero reportar obstáculo.", false);
    };
  }

  function startVoiceRecognition(mode = "command", internalFollowUp = false) {
    if (!voiceRecognitionSupported || !voiceRecognition) {
      speakText("Este navegador no soporta reconocimiento de voz.", true);
      return;
    }

    if (voiceListening) return;

    voiceCommandMode = mode;
    if (!internalFollowUp) {
      pendingVoiceMode = null;
      if (mode === "command") {
        speakText("Te escucho. Puedes decir por ejemplo: quiero ir a Plaza San Miguel.", true);
      }
    }

    try {
      voiceRecognition.start();
    } catch (error) {
      console.warn(error);
      setVoiceStatus("No se pudo iniciar el micrófono. Reintenta.", false);
    }
  }

  function setMapStyle(styleKey, silent = false) {
    const selectedStyle = baseMapConfigs[styleKey] ? styleKey : "streets";
    const config = baseMapConfigs[selectedStyle];

    if (activeBaseLayer) {
      map.removeLayer(activeBaseLayer);
    }

    activeBaseLayer = L.tileLayer(config.url, config.options).addTo(map);

    if (mapStyleSelect && mapStyleSelect.value !== selectedStyle) {
      mapStyleSelect.value = selectedStyle;
    }

    if (!silent) {
      speakText(`Mapa cambiado a ${config.label}.`, true);
    }
  }

  function updateNavigationUiState() {
    document.body.classList.remove("nav-idle", "nav-active", "nav-paused", "instruction-only");

    const totalSteps = selectedRouteSteps.length;
    const currentStep = Math.min(navigationStepIndex + 1, Math.max(totalSteps, 1));

    if (!navigationActive) {
      document.body.classList.add("nav-idle");
      if (navStatus) {
        navStatus.className = "nav-status idle";
      }
      if (navStatusText) {
        navStatusText.textContent = "Listo para iniciar trayecto";
      }
    } else if (navigationPaused) {
      document.body.classList.add("nav-paused");
      setRoutesPanelExpanded(false);
      if (navStatus) {
        navStatus.className = "nav-status paused";
      }
      if (navStatusText) {
        navStatusText.textContent = `Trayecto en pausa • Paso ${currentStep} de ${Math.max(totalSteps, 1)}`;
      }
    } else {
      document.body.classList.add("nav-active");
      document.body.classList.add("instruction-only");
      setRoutesPanelExpanded(false);
      if (navStatus) {
        navStatus.className = "nav-status active";
      }
      if (navStatusText) {
        const distLabel = typeof distanceToCurrentStep === "number"
          ? ` • Próximo en ${formatDistance(distanceToCurrentStep)}`
          : "";
        navStatusText.textContent = `Navegación activa • Paso ${currentStep} de ${Math.max(totalSteps, 1)}${distLabel}`;
      }
    }

    btnPause.disabled = !navigationActive || navigationPaused;
    btnResume.disabled = !navigationActive || !navigationPaused;
    btnRepeat.disabled = !navigationActive;
    btnStop.disabled = !navigationActive;

    if (btnQuickPause) {
      if (!navigationActive) {
        btnQuickPause.disabled = true;
        btnQuickPause.textContent = "⏸ Pausar";
      } else if (navigationPaused) {
        btnQuickPause.disabled = false;
        btnQuickPause.textContent = "▶ Reanudar";
      } else {
        btnQuickPause.disabled = false;
        btnQuickPause.textContent = "⏸ Pausar";
      }
    }

    if (btnQuickStop) {
      btnQuickStop.disabled = !navigationActive;
    }
  }

  function handleQuickPauseToggle() {
    if (!navigationActive) return;
    if (navigationPaused) {
      resumeNavigation();
      return;
    }
    pauseNavigation();
  }

  function setRoutesPanelExpanded(expanded) {
    routesPanelExpanded = Boolean(expanded);
    if (!routesPanel || !toggleRoutesPanelBtn) return;

    routesPanel.classList.toggle("expanded", routesPanelExpanded);
    toggleRoutesPanelBtn.textContent = routesPanelExpanded ? "▼" : "▲";
    toggleRoutesPanelBtn.title = routesPanelExpanded ? "Contraer panel" : "Expandir panel";
    toggleRoutesPanelBtn.setAttribute("aria-label", routesPanelExpanded ? "Contraer panel de rutas" : "Expandir panel de rutas");
  }

  function toggleRoutesPanel() {
    setRoutesPanelExpanded(!routesPanelExpanded);
  }

  function setRoutesMessage(html) {
    routesContent.innerHTML = html;
  }

  function getObstacleTypeLabel(type) {
    const key = String(type || "").toLowerCase();
    const labels = {
      obra: "Obra",
      escalera: "Escalera",
      bache: "Bache",
      vereda_rota: "Vereda rota",
      poste: "Poste u objeto",
      inundacion: "Inundación",
      inseguridad: "Zona insegura",
      otro: "Otro"
    };
    return labels[key] || "Otro";
  }

  function normalizeObstacle(record) {
    const lat = Number(record?.lat);
    const lng = Number(record?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    return {
      id: String(record?.id || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
      lat,
      lng,
      type: String(record?.type || "otro").toLowerCase(),
      severity: Math.max(1, Math.min(5, Number(record?.severity) || 3)),
      notes: String(record?.notes || "").trim(),
      createdAt: record?.createdAt || record?.created_at || new Date().toISOString(),
      active: record?.active !== false
    };
  }

  function getStoredObstaclesLocal() {
    try {
      const raw = localStorage.getItem(OBSTACLE_STORE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalizeObstacle).filter(Boolean).filter(item => item.active !== false);
    } catch (error) {
      console.warn("No se pudo leer obstáculos locales:", error);
      return [];
    }
  }

  function persistObstaclesLocal(items) {
    try {
      localStorage.setItem(OBSTACLE_STORE_KEY, JSON.stringify(items));
    } catch (error) {
      console.warn("No se pudo guardar obstáculos locales:", error);
    }
  }

  async function fetchObstaclesRemote() {
    if (!supabaseEnabled) return [];

    const response = await fetch(`${SUPABASE_URL}/rest/v1/obstacles?select=*&active=eq.true&order=created_at.desc&limit=600`, {
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error("No se pudo sincronizar obstáculos del servidor.");
    }

    const data = await response.json();
    return (data || []).map(normalizeObstacle).filter(Boolean);
  }

  async function saveObstacleRemote(obstacle) {
    if (!supabaseEnabled) return;

    const payload = {
      id: obstacle.id,
      lat: obstacle.lat,
      lng: obstacle.lng,
      type: obstacle.type,
      severity: obstacle.severity,
      notes: obstacle.notes,
      created_at: obstacle.createdAt,
      active: true
    };

    const response = await fetch(`${SUPABASE_URL}/rest/v1/obstacles`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error("No se pudo guardar el obstáculo en el servidor.");
    }
  }

  function renderObstaclesOnMap() {
    obstacleMarkers.forEach(marker => map.removeLayer(marker));
    obstacleMarkers = [];

    obstacles.forEach(obstacle => {
      const marker = L.marker([obstacle.lat, obstacle.lng], {
        icon: createObstacleIcon(obstacle.severity)
      }).addTo(map);

      const timestamp = new Date(obstacle.createdAt).toLocaleString("es-PE");
      const severityColor = ['#4ade80', '#60a5fa', '#fbbf24', '#fb923c', '#ef4444'][obstacle.severity - 1] || '#64748b';
      const severityLabel = ['Bajo', 'Moderado', 'Significativo', 'Alto', 'Crítico'][obstacle.severity - 1] || 'Normal';
      const typeLabel = escapeHtml(getObstacleTypeLabel(obstacle.type));
      const notes = obstacle.notes ? `<div class="popup-notes">"${escapeHtml(obstacle.notes)}"</div>` : '';
      
      const popupHTML = `
        <div class="popup-container">
          <div class="popup-header">
            <span class="popup-type">${typeLabel}</span>
            <span class="popup-badge" style="background-color:${severityColor}; color:white;">${severityLabel}</span>
          </div>
          ${notes}
          <div class="popup-footer">
            <div class="popup-severity">Nivel: ${obstacle.severity}/5</div>
            <div class="popup-time">📅 ${timestamp}</div>
          </div>
        </div>
      `;
      
      marker.bindPopup(popupHTML);

      obstacleMarkers.push(marker);
    });
  }

  function rebuildRouteAssessments() {
    routeAssessments = [];
    recommendedRouteIndex = null;

    if (!currentRoutes.length) return;

    let bestIndex = 0;
    let bestScore = Number.POSITIVE_INFINITY;

    currentRoutes.forEach((route, index) => {
      const assessment = assessRoute(route);
      routeAssessments[index] = assessment;

      if (assessment.totalScore < bestScore) {
        bestScore = assessment.totalScore;
        bestIndex = index;
      }
    });

    recommendedRouteIndex = bestIndex;

    if (selectedRouteIndex === null || !currentRoutes[selectedRouteIndex]) {
      selectedRouteIndex = recommendedRouteIndex;
    }
  }

  function isAssessmentHighRisk(assessment) {
    if (!assessment) return false;
    return assessment.nearbyObstacleCount >= HIGH_RISK_OBSTACLE_COUNT || assessment.obstaclePenalty >= HIGH_RISK_PENALTY;
  }

  function enforceSaferRouteIfNeeded(options = {}) {
    const { announce = false, reasonText = "" } = options;

    if (!currentRoutes.length || recommendedRouteIndex === null) return false;
    if (selectedRouteIndex === null || !currentRoutes[selectedRouteIndex]) {
      selectedRouteIndex = recommendedRouteIndex;
      return true;
    }

    if (selectedRouteIndex === recommendedRouteIndex) return false;

    const selectedAssessment = routeAssessments[selectedRouteIndex];
    const recommendedAssessment = routeAssessments[recommendedRouteIndex];
    if (!selectedAssessment || !recommendedAssessment) return false;

    const selectedIsHighRisk = isAssessmentHighRisk(selectedAssessment);
    const improvement = (selectedAssessment.totalScore - recommendedAssessment.totalScore) / Math.max(1, selectedAssessment.totalScore);
    const shouldForce = selectedIsHighRisk || improvement >= FORCE_SWITCH_MIN_IMPROVEMENT;

    if (!shouldForce) return false;

    selectedRouteIndex = recommendedRouteIndex;

    if (announce) {
      const detail = reasonText || "La ruta elegida tiene varios obstáculos.";
      speakText(`${detail} Te cambié automáticamente a la ruta ${selectedRouteIndex + 1}, que es más segura.`, true);
    }

    return true;
  }

  function refreshObstacleAwareRouting() {
    renderObstaclesOnMap();

    if (!currentRoutes.length) return;

    const previousRecommendation = recommendedRouteIndex;
    rebuildRouteAssessments();

    const switchedToSafeRoute = enforceSaferRouteIfNeeded({
      announce: !navigationActive,
      reasonText: "Se detectaron nuevos obstáculos en tu ruta actual."
    });

    if (navigationActive && switchedToSafeRoute) {
      selectedRouteSteps = buildNavigationSteps(currentRoutes[selectedRouteIndex]);
      navigationStepIndex = 0;
      lastSpokenStepIndex = -1;
      distanceToCurrentStep = null;
      announcedStepAlerts.clear();
      showNavigationInstruction(0);
    }

    rerenderRoutes();
    renderRoutesList();

    if (!navigationActive && previousRecommendation !== null && recommendedRouteIndex !== previousRecommendation) {
      speakText(`Se actualizó la ruta recomendada. Ahora la mejor opción es la ruta ${recommendedRouteIndex + 1}.`, true);
    }
  }

  async function loadObstacles() {
    const localItems = getStoredObstaclesLocal();
    obstacles = localItems;
    renderObstaclesOnMap();

    if (!supabaseEnabled) return;

    try {
      const remoteItems = await fetchObstaclesRemote();
      if (remoteItems.length) {
        obstacles = remoteItems;
        persistObstaclesLocal(obstacles);
        refreshObstacleAwareRouting();
      }
    } catch (error) {
      console.warn(error.message);
    }
  }

  function startObstacleSync() {
    if (!supabaseEnabled) return;
    if (obstacleSyncTimer) clearInterval(obstacleSyncTimer);

    obstacleSyncTimer = setInterval(async () => {
      try {
        const remoteItems = await fetchObstaclesRemote();
        if (!remoteItems.length) return;

        const newDigest = JSON.stringify(remoteItems.map(item => `${item.id}:${item.createdAt}`));
        const currentDigest = JSON.stringify(obstacles.map(item => `${item.id}:${item.createdAt}`));
        if (newDigest !== currentDigest) {
          obstacles = remoteItems;
          persistObstaclesLocal(obstacles);
          refreshObstacleAwareRouting();
        }
      } catch (error) {
        console.warn("Error sincronizando obstáculos:", error.message);
      }
    }, OBSTACLE_SYNC_MS);
  }

  function toggleReportMode(forceValue) {
    reportModeActive = typeof forceValue === "boolean" ? forceValue : !reportModeActive;

    if (reportObstacleBtn) {
      reportObstacleBtn.classList.toggle("active", reportModeActive);
      reportObstacleBtn.title = reportModeActive
        ? "Toca el mapa para reportar obstáculo"
        : "Reportar obstáculo";
    }

    if (reportModeActive) {
      speakText("Modo reporte activo. Toca un punto en el mapa para registrar el obstáculo.", true);
    } else {
      speakText("Modo reporte desactivado.", true);
    }
  }

  function askObstacleType() {
    const answer = window.prompt(
      "Tipo de obstáculo:\nobra, escalera, bache, vereda_rota, poste, inundacion, inseguridad, otro",
      "obra"
    );

    if (answer === null) return null;
    const normalized = normalizeSearchText(answer).replace(/\s+/g, "_");
    const allowed = new Set(["obra", "escalera", "bache", "vereda_rota", "poste", "inundacion", "inseguridad", "otro"]);
    return allowed.has(normalized) ? normalized : "otro";
  }

  function askObstacleSeverity() {
    const raw = window.prompt("Severidad del 1 al 5 (5 = muy crítico)", "3");
    if (raw === null) return null;
    const value = Number(raw);
    if (!Number.isFinite(value)) return 3;
    return Math.max(1, Math.min(5, Math.round(value)));
  }

  function askObstacleNotes() {
    const raw = window.prompt("Comentario opcional del obstáculo", "");
    if (raw === null) return "";
    return String(raw).trim();
  }

  async function registerObstacle({ lat, lng, type, severity, notes, announceShared = true, announceLocalOnly = true }) {
    const obstacle = normalizeObstacle({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      lat,
      lng,
      type,
      severity,
      notes,
      createdAt: new Date().toISOString(),
      active: true
    });

    if (!obstacle) return false;

    obstacles = [obstacle, ...obstacles].slice(0, 600);
    persistObstaclesLocal(obstacles);
    refreshObstacleAwareRouting();

    try {
      await saveObstacleRemote(obstacle);
      if (announceShared) {
        speakText("Obstáculo reportado y compartido.", true);
      }
    } catch (error) {
      console.warn(error.message);
      if (announceLocalOnly) {
        speakText("Obstáculo reportado en este dispositivo. Configura Supabase para compartirlo con otros usuarios.", true);
      }
    }

    return true;
  }

  async function handleMapObstacleReport(event) {
    if (!reportModeActive) return;

    const type = askObstacleType();
    if (type === null) {
      toggleReportMode(false);
      return;
    }

    const severity = askObstacleSeverity();
    if (severity === null) {
      toggleReportMode(false);
      return;
    }

    const notes = askObstacleNotes();

    await registerObstacle({
      lat: event.latlng.lat,
      lng: event.latlng.lng,
      type,
      severity,
      notes,
      announceShared: true,
      announceLocalOnly: true
    });

    toggleReportMode(false);
  }

  function formatDistance(meters) {
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(2)} km`;
  }

  function formatDuration(seconds) {
    const min = Math.round(seconds / 60);
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const r = min % 60;
    return `${h} h ${r} min`;
  }

  function formatMetersText(distance) {
    const meters = Math.max(1, Math.round(Number(distance) || 0));
    return `${meters} metros`;
  }

  function normalizeSearchText(text) {
    return String(text || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function extractHouseNumber(text) {
    const match = String(text || "").match(/\b\d{1,6}[a-zA-Z]?\b/);
    return match ? match[0] : "";
  }

  function createSuggestionModel(data) {
    return {
      id: data.id,
      lat: data.lat,
      lng: data.lng,
      title: data.title || "Destino",
      subtitle: data.subtitle || "",
      fullLabel: data.fullLabel || data.title || "Destino",
      country: data.country || "",
      city: data.city || "",
      street: data.street || "",
      houseNumber: data.houseNumber || "",
      source: data.source || "ors"
    };
  }

  function normalizeOrsSuggestion(item) {
    const coords = item?.geometry?.coordinates || [];
    const props = item?.properties || {};
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    const title = props.name || (props.label || "").split(",")[0] || "Destino";
    const fullLabel = props.label || title;
    const street = props.street || "";
    const houseNumber = props.housenumber || extractHouseNumber(fullLabel);
    const city = props.locality || props.county || props.region || "";

    return createSuggestionModel({
      id: props.id || `${lat},${lng},ors`,
      lat,
      lng,
      title,
      subtitle: fullLabel,
      fullLabel,
      country: props.country || "",
      city,
      street,
      houseNumber,
      source: "ors"
    });
  }

  function normalizeNominatimSuggestion(item) {
    const lat = Number(item?.lat);
    const lng = Number(item?.lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    const address = item?.address || {};
    const title = address.road || address.pedestrian || address.amenity || address.building || item?.name || String(item?.display_name || "").split(",")[0] || "Destino";
    const fullLabel = item?.display_name || title;
    const city = address.city || address.town || address.village || address.state || "";

    return createSuggestionModel({
      id: `nominatim:${item?.osm_type || "x"}:${item?.osm_id || `${lat},${lng}`}`,
      lat,
      lng,
      title,
      subtitle: fullLabel,
      fullLabel,
      country: address.country || "",
      city,
      street: address.road || address.pedestrian || "",
      houseNumber: address.house_number || extractHouseNumber(fullLabel),
      source: "osm"
    });
  }

  function buildSuggestionSearchText(item) {
    return [
      item?.title,
      item?.subtitle,
      item?.fullLabel,
      item?.street,
      item?.houseNumber,
      item?.city,
      item?.country
    ].filter(Boolean).join(" ");
  }

  function scoreSuggestion(item, query) {
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) return 0;

    const haystack = normalizeSearchText(buildSuggestionSearchText(item));
    if (!haystack) return 0;

    const tokens = normalizedQuery.split(" ").filter(Boolean);
    const houseNumberInQuery = extractHouseNumber(normalizedQuery);
    const title = normalizeSearchText(item?.title || "");
    const subtitle = normalizeSearchText(item?.subtitle || item?.fullLabel || "");
    const street = normalizeSearchText(item?.street || "");
    const city = normalizeSearchText(item?.city || "");
    const houseNumber = normalizeSearchText(item?.houseNumber || "");

    let score = 0;

    if (haystack === normalizedQuery) score += 1000;
    if (title === normalizedQuery) score += 900;
    if (haystack.startsWith(normalizedQuery)) score += 780;
    if (title.startsWith(normalizedQuery)) score += 740;
    if (haystack.includes(normalizedQuery)) score += 500;
    if (subtitle.includes(normalizedQuery)) score += 220;

    tokens.forEach(token => {
      if (title.startsWith(token)) score += 160;
      if (street.startsWith(token)) score += 120;
      if (city.startsWith(token)) score += 90;
      if (haystack.includes(token)) score += 70;
    });

    if (houseNumberInQuery) {
      if (houseNumber === houseNumberInQuery) score += 260;
      else if (houseNumber && houseNumber !== houseNumberInQuery) score -= 140;
    }

    if (item?.source === "ors") {
      score += 35;
    }

    if (userLocation && Number.isFinite(item?.lat) && Number.isFinite(item?.lng)) {
      const distance = getDistanceMeters(userLocation.lat, userLocation.lng, item.lat, item.lng);
      score += Math.max(0, 240 - Math.min(240, distance / 20));
    }

    return score;
  }

  function sortSuggestionsByQuery(results, query) {
    const seen = new Set();
    const normalizedQuery = normalizeSearchText(query);
    const queryTokenCount = normalizedQuery ? normalizedQuery.split(" ").filter(Boolean).length : 0;
    const hasHouseNumber = Boolean(extractHouseNumber(normalizedQuery));

    let smartRadiusMeters = 2000;
    if (hasHouseNumber) {
      smartRadiusMeters = 4500;
    } else if (normalizedQuery.length <= 4 || queryTokenCount <= 1) {
      smartRadiusMeters = 1200;
    } else if (normalizedQuery.length >= 12 || queryTokenCount >= 3) {
      smartRadiusMeters = 3000;
    }

    return (results || [])
      .filter(item => {
        const key = `${normalizeSearchText(item?.fullLabel || item?.title || "")}|${(Number(item?.lat) || 0).toFixed(5)}|${(Number(item?.lng) || 0).toFixed(5)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(item => {
        const score = scoreSuggestion(item, query);
        let distance = Number.POSITIVE_INFINITY;

        if (userLocation && Number.isFinite(item?.lat) && Number.isFinite(item?.lng)) {
          distance = getDistanceMeters(userLocation.lat, userLocation.lng, item.lat, item.lng);
        }

        const distanceBucket = distance <= smartRadiusMeters ? 0 : 1;
        return { item, score, distance, distanceBucket };
      })
      .sort((left, right) => {
        if (left.distanceBucket !== right.distanceBucket) {
          return left.distanceBucket - right.distanceBucket;
        }
        if (left.distance !== right.distance) {
          return left.distance - right.distance;
        }
        return right.score - left.score;
      })
      .map(entry => entry.item);
  }

  function getSuggestionDistanceText(item) {
    if (!userLocation || !Number.isFinite(item?.lat) || !Number.isFinite(item?.lng)) return "";

    const distance = getDistanceMeters(userLocation.lat, userLocation.lng, item.lat, item.lng);
    if (!Number.isFinite(distance)) return "";

    return distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(1)} km`;
  }

  function simplifyInstructionText(rawInstruction) {
    let text = String(rawInstruction || "Continúa recto").trim();

    const replacements = [
      [/\bGire\b/gi, "Gira"],
      [/\bGirar\b/gi, "Gira"],
      [/\bContinúe\b/gi, "Continúa"],
      [/\bManténgase\b/gi, "Mantente"],
      [/\bDiríjase\b/gi, "Ve"],
      [/\bIncorpórese\b/gi, "Incorpórate"],
      [/\bTome\b/gi, "Toma"],
      [/\bSiga\b/gi, "Sigue"],
      [/\bnorte\b/gi, "Norte"],
      [/\bsur\b/gi, "Sur"],
      [/\beste\b/gi, "Este"],
      [/\boeste\b/gi, "Oeste"],
      [/\blevemente a la derecha\b/gi, "ligeramente a la derecha"],
      [/\blevemente a la izquierda\b/gi, "ligeramente a la izquierda"],
      [/\s+/g, " "]
    ];

    replacements.forEach(([pattern, replacement]) => {
      text = text.replace(pattern, replacement);
    });

    text = text.trim();

    if (!text.endsWith(".") && !text.endsWith("!")) {
      text += ".";
    }

    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function buildStepGuidanceText(step) {
    const instruction = simplifyInstructionText(step?.instruction || "Continúa recto");
    const stepDistance = Number(step?.distance || 0);

    if (/has llegado|destino final|llegada/i.test(instruction)) {
      return "Has llegado a tu destino.";
    }

    if (stepDistance > 0) {
      if (stepDistance <= 15) {
        return `En ${formatMetersText(stepDistance)}, ${instruction}`;
      }
      return `Camina ${formatMetersText(stepDistance)}. Luego, ${instruction}`;
    }

    return instruction;
  }

  function clearSuggestions() {
    suggestionsBox.innerHTML = "";
    suggestionsData = [];
    activeSuggestionIndex = -1;
  }

  function clearRoutes() {
    routeLayers.forEach(layer => map.removeLayer(layer));
    routeLayers = [];
    currentRoutes = [];
    selectedRouteIndex = null;
    stopNavigation(true);
    hideCurrentStep();

    if (destinationMarker) {
      map.removeLayer(destinationMarker);
      destinationMarker = null;
    }

    updateNavigationUiState();
  }

  function getRouteColor(index) {
    if (index === selectedRouteIndex) {
      return "#10b981"; // Verde brillante para ruta seleccionada
    }
    if (index === recommendedRouteIndex) {
      return "#3b82f6"; // Azul para ruta recomendada
    }
    return "#cbd5e1"; // Gris claro para rutas alternativas
  }

  function getRouteWeight(index) {
    return index === selectedRouteIndex ? 8 : index === recommendedRouteIndex ? 6 : 4;
  }

  function getRouteOpacity(index) {
    return index === selectedRouteIndex ? 1 : index === recommendedRouteIndex ? 0.7 : 0.4;
  }

  function escapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function speakText(text, interrupt = false) {
    if (!text || !synth) return;

    if (interrupt) {
      synth.cancel();
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "es-PE";
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.volume = 1;

    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }

    synth.speak(utterance);
  }

  function loadSpanishVoice() {
    const voices = synth.getVoices();
    selectedVoice =
      voices.find(v => v.lang && v.lang.toLowerCase().startsWith("es")) ||
      voices.find(v => v.lang && v.lang.toLowerCase().includes("es")) ||
      voices[0] ||
      null;
  }

  function showCurrentStep(text) {
    currentStepBox.style.display = "block";
    currentStepText.textContent = text;
  }

  function hideCurrentStep() {
    currentStepBox.style.display = "none";
    currentStepText.textContent = "";
  }

  function getDistanceMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = deg => deg * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function toMetersProjection(lat, lng, originLat) {
    const kx = 111320 * Math.cos(originLat * Math.PI / 180);
    const ky = 110540;
    return {
      x: lng * kx,
      y: lat * ky
    };
  }

  function pointSegmentDistanceMeters(pointLat, pointLng, startLat, startLng, endLat, endLng) {
    const originLat = (pointLat + startLat + endLat) / 3;
    const p = toMetersProjection(pointLat, pointLng, originLat);
    const a = toMetersProjection(startLat, startLng, originLat);
    const b = toMetersProjection(endLat, endLng, originLat);

    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const apx = p.x - a.x;
    const apy = p.y - a.y;
    const abSquared = abx * abx + aby * aby;

    if (abSquared === 0) {
      const dx = p.x - a.x;
      const dy = p.y - a.y;
      return Math.sqrt(dx * dx + dy * dy);
    }

    const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abSquared));
    const projX = a.x + t * abx;
    const projY = a.y + t * aby;
    const dx = p.x - projX;
    const dy = p.y - projY;

    return Math.sqrt(dx * dx + dy * dy);
  }

  function getMinDistanceToRouteMeters(obstacle, route) {
    const coords = route?.geometry?.coordinates || [];
    if (coords.length < 2) return Number.POSITIVE_INFINITY;

    let minDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < coords.length - 1; index++) {
      const start = coords[index];
      const end = coords[index + 1];
      const distance = pointSegmentDistanceMeters(
        obstacle.lat,
        obstacle.lng,
        start[1],
        start[0],
        end[1],
        end[0]
      );

      if (distance < minDistance) {
        minDistance = distance;
      }
    }

    return minDistance;
  }

  function getObstacleTypeWeight(type) {
    const key = String(type || "").toLowerCase();
    const weights = {
      obra: 1.35,
      escalera: 1.8,
      bache: 1.15,
      vereda_rota: 1.45,
      poste: 1.2,
      inundacion: 1.65,
      inseguridad: 2.1,
      otro: 1.0
    };
    return weights[key] || 1.0;
  }

  function assessRoute(route) {
    const summary = route?.properties?.summary || {};
    const duration = Number(summary.duration || 0);
    const distance = Number(summary.distance || 0);

    let obstaclePenalty = 0;
    let nearbyObstacleCount = 0;

    obstacles.forEach(obstacle => {
      const nearDistance = getMinDistanceToRouteMeters(obstacle, route);
      if (!Number.isFinite(nearDistance) || nearDistance > 45) return;

      nearbyObstacleCount++;

      const severityWeight = 0.85 + obstacle.severity * 0.45;
      const typeWeight = getObstacleTypeWeight(obstacle.type);
      const closenessWeight = nearDistance <= 12 ? 1.6 : nearDistance <= 24 ? 1.2 : 0.75;

      obstaclePenalty += severityWeight * typeWeight * closenessWeight;
    });

    const totalScore = duration + distance * 0.07 + obstaclePenalty * 220;
    return {
      duration,
      distance,
      nearbyObstacleCount,
      obstaclePenalty,
      totalScore
    };
  }

  function getSafetyLabel(assessment) {
    if (!assessment || assessment.nearbyObstacleCount === 0) return "Muy segura";
    if (assessment.obstaclePenalty <= 4) return "Segura";
    if (assessment.obstaclePenalty <= 9) return "Precaución";
    return "Riesgo alto";
  }

  function buildNavigationSteps(route) {
    const steps = [];
    const segments = route.properties?.segments || [];
    const geometryCoords = route.geometry?.coordinates || [];

    segments.forEach(segment => {
      (segment.steps || []).forEach(step => {
        let targetLat = null;
        let targetLng = null;

        if (Array.isArray(step.way_points) && step.way_points.length > 0) {
          const endIndex = step.way_points[1];
          const coord = geometryCoords[endIndex];
          if (coord) {
            targetLng = coord[0];
            targetLat = coord[1];
          }
        }

        steps.push({
          instruction: step.instruction || "Continúa",
          distance: step.distance || 0,
          way_points: step.way_points || [],
          lat: targetLat,
          lng: targetLng
        });
      });
    });
    return steps;
  }

  function updateUserMarkerLive(lat, lng, heading = null) {
    userLocation = { lat, lng };

    if (!userMarker) {
      userMarker = L.marker([lat, lng], { icon: createUserIcon(heading) }).addTo(map).bindPopup("Tu ubicación");
    } else {
      userMarker.setLatLng([lat, lng]);
      userMarker.setIcon(createUserIcon(heading));
    }

    if (autoCenterMap) {
      map.setView([lat, lng], Math.max(map.getZoom(), 18), {
        animate: true,
        duration: 0.25
      });
    }

    if (typeof heading === "number" && !Number.isNaN(heading)) {
      compassNeedle.style.transform = `rotate(${heading}deg)`;
    }
  }

  function showNavigationInstruction(stepIndex) {
    if (!selectedRouteSteps[stepIndex]) return;

    const step = selectedRouteSteps[stepIndex];
    const stepText = buildStepGuidanceText(step);
    showCurrentStep(stepText);

    if (lastSpokenStepIndex !== stepIndex) {
      speakText(stepText, true);
      lastSpokenStepIndex = stepIndex;
    }

    rerenderRoutes();
    renderRoutesList();
  }

  function maybeSpeakStepProximityAlerts(stepIndex, step, distanceToStep) {
    if (!step || !Number.isFinite(distanceToStep)) return;

    const baseInstruction = simplifyInstructionText(step.instruction || "continúa recto");
    const alerts = [30, 15, 5];

    alerts.forEach(limit => {
      const alertKey = `${stepIndex}-${limit}`;
      if (distanceToStep <= limit && !announcedStepAlerts.has(alertKey)) {
        announcedStepAlerts.add(alertKey);
        speakText(`Atención, en ${limit} metros, ${baseInstruction}`, true);
      }
    });
  }

  function getRouteSegmentStartIndex() {
    const currentStep = selectedRouteSteps[navigationStepIndex];
    if (currentStep && Array.isArray(currentStep.way_points) && currentStep.way_points.length > 0) {
      const startIndex = Number(currentStep.way_points[0]);
      if (Number.isFinite(startIndex)) {
        return Math.max(0, startIndex);
      }
    }

    return 0;
  }

  function getRouteCoords(route) {
    return (route?.geometry?.coordinates || []).map(coord => [coord[1], coord[0]]);
  }

  function renderActiveNavigationRoute() {
    routeLayers.forEach(layer => map.removeLayer(layer));
    routeLayers = [];

    if (selectedRouteIndex === null || !currentRoutes[selectedRouteIndex]) {
      return;
    }

    const route = currentRoutes[selectedRouteIndex];
    const coords = getRouteCoords(route);
    const startIndex = Math.min(getRouteSegmentStartIndex(), Math.max(coords.length - 2, 0));
    const remainingCoords = coords.slice(startIndex);

    if (remainingCoords.length >= 2) {
      const line = L.polyline(remainingCoords, {
        color: "#10b981",
        weight: 10,
        opacity: 0.95,
        lineCap: "round",
        lineJoin: "round",
        className: "active-nav-route"
      }).addTo(map);

      const glowLine = L.polyline(remainingCoords, {
        color: "#10b981",
        weight: 20,
        opacity: 0.2,
        lineCap: "round",
        lineJoin: "round",
        className: "active-nav-glow"
      }).addTo(map);

      routeLayers.push(glowLine);
      routeLayers.push(line);
    }
  }

  function rerenderRoutes() {
    if (navigationActive) {
      renderActiveNavigationRoute();
      return;
    }

    drawRoutes();
  }

  async function rerouteToDestination(reasonText = "Te desviaste. Recalculando la ruta.") {
    if (rerouteInProgress || !currentDestination || !userLocation) return;

    rerouteInProgress = true;
    speakText(reasonText, true);

    try {
      const body = {
        coordinates: [
          [userLocation.lng, userLocation.lat],
          [currentDestination.lng, currentDestination.lat]
        ],
        instructions: true,
        language: "es",
        alternative_routes: {
          target_count: 1,
          weight_factor: 1.4,
          share_factor: 0.5
        }
      };

      const response = await fetch("https://api.openrouteservice.org/v2/directions/foot-walking/geojson", {
        method: "POST",
        headers: {
          "Authorization": ORS_API_KEY,
          "Content-Type": "application/json",
          "Accept": "application/json, application/geo+json"
        },
        body: JSON.stringify(body)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || data.message || "No se pudo recalcular la ruta.");
      }

      if (!data.features || !data.features.length) {
        throw new Error("El servicio no devolvió una ruta nueva.");
      }

      currentRoutes = data.features;
      selectedRouteIndex = null;
      rebuildRouteAssessments();
      const safeIndex = selectedRouteIndex ?? 0;
      selectedRouteSteps = buildNavigationSteps(currentRoutes[safeIndex]);
      navigationStepIndex = 0;
      lastSpokenStepIndex = -1;
      distanceToCurrentStep = null;
      announcedStepAlerts.clear();
      lastDistanceToDestination = null;

      rerenderRoutes();
      renderRoutesList();
      showNavigationInstruction(0);

      speakText("Ruta actualizada. Sigue las nuevas indicaciones.", true);
    } catch (error) {
      console.error(error);
      speakText(`No se pudo recalcular la ruta. ${error.message}`, true);
    } finally {
      rerouteInProgress = false;
    }
  }

  function checkNavigationProgress(lat, lng) {
    if (!navigationActive || navigationPaused || !selectedRouteSteps.length) return;

    const currentStep = selectedRouteSteps[navigationStepIndex];
    const distanceToDestination = currentDestination
      ? getDistanceMeters(lat, lng, currentDestination.lat, currentDestination.lng)
      : null;

    if (distanceToDestination !== null) {
      lastDistanceToDestination = distanceToDestination;
    }

    if (!currentStep) {
      if (distanceToDestination !== null && distanceToDestination > 28) {
        rerouteToDestination("Te pasaste del destino. Recalculando la ruta.");
        return;
      }

      speakText("Has llegado a tu destino.", true);
      stopNavigation(true);
      return;
    }

    if (currentStep.lat == null || currentStep.lng == null) {
      return;
    }

    const distanceToStep = getDistanceMeters(lat, lng, currentStep.lat, currentStep.lng);
    distanceToCurrentStep = distanceToStep;
    updateNavigationUiState();

    maybeSpeakStepProximityAlerts(navigationStepIndex, currentStep, distanceToStep);

    if (distanceToDestination !== null && navigationStepIndex >= selectedRouteSteps.length - 1) {
      const shouldReroute = distanceToDestination > 35 && (
        lastDistanceToDestination === null ||
        distanceToDestination > lastDistanceToDestination + 8
      );

      if (shouldReroute) {
        rerouteToDestination("Te pasaste del destino. Recalculando la ruta.");
        return;
      }
    }

    if (distanceToStep <= 18 && lastSpokenStepIndex !== navigationStepIndex) {
      showNavigationInstruction(navigationStepIndex);
    }

    if (distanceToStep <= 8) {
      navigationStepIndex++;

      if (navigationStepIndex < selectedRouteSteps.length) {
        distanceToCurrentStep = null;
        showNavigationInstruction(navigationStepIndex);
      } else {
        speakText("Has llegado a tu destino.", true);
        stopNavigation(true);
      }
    }
  }

  function startNavigation() {
    if (navigationPaused && watchId !== null && selectedRouteSteps.length) {
      resumeNavigation();
      return;
    }

    if (navigationActive && watchId !== null) {
      speakText("El trayecto ya está activo.", true);
      return;
    }

    if (selectedRouteIndex === null || !currentRoutes[selectedRouteIndex]) {
      speakText("Primero debes elegir una ruta.", true);
      return;
    }

    if (!navigator.geolocation) {
      speakText("Tu navegador no soporta seguimiento de ubicación.", true);
      return;
    }

    rebuildRouteAssessments();
    enforceSaferRouteIfNeeded({
      announce: true,
      reasonText: "La ruta seleccionada tiene demasiados obstáculos"
    });

    selectedRouteSteps = buildNavigationSteps(currentRoutes[selectedRouteIndex]);
    navigationStepIndex = 0;
    lastSpokenStepIndex = -1;
    distanceToCurrentStep = null;
    announcedStepAlerts.clear();
    navigationActive = true;
    navigationPaused = false;
    autoCenterMap = false;

    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
    }

    speakText("Trayecto iniciado. Sigue la ruta seleccionada.", true);

    if (selectedRouteSteps.length > 0) {
      showNavigationInstruction(0);
    }

    updateNavigationUiState();

    watchId = navigator.geolocation.watchPosition(
      position => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const heading = position.coords.heading;
        const accuracy = position.coords.accuracy;

        updateUserMarkerLive(lat, lng, heading);

        if (accuracy && accuracy > 40) return;
        checkNavigationProgress(lat, lng);
      },
      error => {
        console.error("Error de navegación:", error);
        speakText("No se pudo actualizar tu ubicación en tiempo real.", true);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 10000
      }
    );
  }

  function pauseNavigation() {
    if (!navigationActive || watchId === null) {
      speakText("No hay una navegación activa.", true);
      return;
    }

    navigationPaused = true;
    autoCenterMap = false;
    synth.cancel();
    speakText("Trayecto en pausa.", true);
    updateNavigationUiState();
    renderRoutesList();
  }

  function resumeNavigation() {
    if (!navigationActive || watchId === null) {
      speakText("No hay una navegación activa.", true);
      return;
    }

    if (!navigationPaused) {
      speakText("El trayecto ya está en curso.", true);
      return;
    }

    navigationPaused = false;
    autoCenterMap = false;
    if (userLocation) {
      map.setView([userLocation.lat, userLocation.lng], Math.max(map.getZoom(), 18), { animate: true });
    }

    speakText("Trayecto reanudado.", true);
    showNavigationInstruction(navigationStepIndex);
    updateNavigationUiState();
    renderRoutesList();
  }

  function repeatCurrentInstruction() {
    if (!navigationActive || !selectedRouteSteps.length) {
      speakText("No hay una navegación activa.", true);
      return;
    }

    const step = selectedRouteSteps[navigationStepIndex];
    if (!step) return;

    const stepText = buildStepGuidanceText(step);
    showCurrentStep(stepText);
    speakText(stepText, true);
  }

  function stopNavigation(silent = false) {
    navigationActive = false;
    navigationPaused = false;

    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }

    navigationStepIndex = 0;
    selectedRouteSteps = [];
    lastSpokenStepIndex = -1;
    distanceToCurrentStep = null;
    announcedStepAlerts.clear();
    lastDistanceToDestination = null;
    autoCenterMap = true;

    synth.cancel();

    if (!silent) {
      speakText("Trayecto detenido.", true);
    }

    updateNavigationUiState();
    renderRoutesList();
  }

  function renderSuggestions(results) {
    const query = normalizeSearchText(searchInput.value.trim());
    suggestionsData = sortSuggestionsByQuery(results || [], query);
    activeSuggestionIndex = -1;

    if (!suggestionsData.length) {
      suggestionsBox.innerHTML = `<div class="suggestion-item"><div class="suggestion-title">No se encontraron destinos</div><div class="suggestion-sub">Prueba con otra calle, negocio o lugar cercano.</div></div>`;
      return;
    }

    suggestionsBox.innerHTML = suggestionsData.map((item, index) => {
      const title = item.title || "Destino";
      const sub = item.subtitle || item.fullLabel || "";
      const distanceText = getSuggestionDistanceText(item);
      const sourceLabel = item.source === "osm" ? "OSM" : "ORS";
      return `
        <div class="suggestion-item" data-index="${index}">
          <div class="suggestion-title">${escapeHtml(title)}</div>
          <div class="suggestion-sub">${escapeHtml(sub)}</div>
          <div class="suggestion-meta">
            ${index === 0 && query ? `<span class="suggestion-badge">Mejor coincidencia</span>` : `<span class="suggestion-badge">${sourceLabel}</span>`}
            ${distanceText ? `<span class="suggestion-distance">A ${escapeHtml(distanceText)}</span>` : ""}
          </div>
        </div>
      `;
    }).join("");

    [...suggestionsBox.querySelectorAll(".suggestion-item")].forEach(el => {
      el.addEventListener("click", () => {
        const index = Number(el.dataset.index);
        chooseSuggestion(index);
      });
    });
  }

  function updateSuggestionHighlight() {
    const items = suggestionsBox.querySelectorAll(".suggestion-item");
    items.forEach((item, index) => {
      item.classList.toggle("active", index === activeSuggestionIndex);
    });
  }

  async function fetchOrsSuggestions(query) {
    const base = "https://api.openrouteservice.org/geocode/autocomplete";
    const params = new URLSearchParams({
      api_key: ORS_API_KEY,
      text: query,
      size: "10",
      "boundary.country": "PER"
    });

    if (userLocation) {
      params.set("focus.point.lon", userLocation.lng);
      params.set("focus.point.lat", userLocation.lat);
    }

    const response = await fetch(`${base}?${params.toString()}`, {
      headers: { "Accept": "application/json" }
    });

    if (!response.ok) {
      throw new Error("No se pudieron cargar sugerencias de ORS.");
    }

    const data = await response.json();
    return (data.features || []).map(normalizeOrsSuggestion).filter(Boolean);
  }

  async function fetchNominatimSuggestions(query) {
    const base = "https://nominatim.openstreetmap.org/search";
    const params = new URLSearchParams({
      q: query,
      format: "jsonv2",
      addressdetails: "1",
      limit: "8",
      "accept-language": "es"
    });

    if (userLocation) {
      const delta = 0.18;
      params.set("viewbox", `${userLocation.lng - delta},${userLocation.lat + delta},${userLocation.lng + delta},${userLocation.lat - delta}`);
      params.set("bounded", "0");
    }

    const response = await fetch(`${base}?${params.toString()}`, {
      headers: {
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error("No se pudieron cargar sugerencias de OSM.");
    }

    const data = await response.json();
    return (data || []).map(normalizeNominatimSuggestion).filter(Boolean);
  }

  async function searchPlaces(query) {
    const [orsResult, nominatimResult] = await Promise.allSettled([
      fetchOrsSuggestions(query),
      fetchNominatimSuggestions(query)
    ]);

    const orsSuggestions = orsResult.status === "fulfilled" ? orsResult.value : [];
    const nominatimSuggestions = nominatimResult.status === "fulfilled" ? nominatimResult.value : [];

    const combined = [...orsSuggestions, ...nominatimSuggestions];
    if (!combined.length) {
      throw new Error("No se pudieron cargar sugerencias en este momento.");
    }

    return combined;
  }

  async function loadAlternativeRoutes(destination) {
    if (!userLocation) {
      setRoutesMessage(`<div class="status error">Todavía no se obtuvo tu ubicación.</div>`);
      speakText("Todavía no se obtuvo tu ubicación.", true);
      return;
    }

    clearRoutes();
    currentDestination = destination;
    lastDistanceToDestination = null;

    destinationMarker = L.marker([destination.lat, destination.lng])
      .addTo(map)
      .bindPopup(destination.name || "Destino")
      .openPopup();

    setRoutesMessage(`<div class="status">Calculando rutas peatonales…</div>`);
    speakText(`Destino seleccionado. Calculando rutas hacia ${destination.name}.`, true);

    try {
      const body = {
        coordinates: [
          [userLocation.lng, userLocation.lat],
          [destination.lng, destination.lat]
        ],
        instructions: true,
        language: "es",
        alternative_routes: {
          target_count: 3,
          weight_factor: 1.6,
          share_factor: 0.6
        }
      };

      const response = await fetch("https://api.openrouteservice.org/v2/directions/foot-walking/geojson", {
        method: "POST",
        headers: {
          "Authorization": ORS_API_KEY,
          "Content-Type": "application/json",
          "Accept": "application/json, application/geo+json"
        },
        body: JSON.stringify(body)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || data.message || "No se pudieron calcular las rutas.");
      }

      if (!data.features || !data.features.length) {
        throw new Error("El servicio no devolvió rutas.");
      }

      currentRoutes = data.features;
      selectedRouteIndex = null;
      rebuildRouteAssessments();

      drawRoutes();
      renderRoutesList();
      const recommended = recommendedRouteIndex !== null ? ` Ruta recomendada: ${recommendedRouteIndex + 1}.` : "";
      speakText(`Se encontraron ${currentRoutes.length} rutas disponibles.${recommended} Elige una ruta para escuchar sus indicaciones.`, true);

    } catch (error) {
      console.error(error);
      setRoutesMessage(`<div class="status error">${escapeHtml(error.message)}</div>`);
      speakText(`Error al calcular las rutas. ${error.message}`, true);
    }
  }

  function drawRoutes() {
    routeLayers.forEach(layer => map.removeLayer(layer));
    routeLayers = [];

    currentRoutes.forEach((route, index) => {
      const coords = route.geometry.coordinates.map(c => [c[1], c[0]]);

      const line = L.polyline(coords, {
        color: getRouteColor(index),
        weight: getRouteWeight(index),
        opacity: getRouteOpacity(index)
      }).addTo(map);

      line.on("click", () => {
        selectRoute(index);
      });

      routeLayers.push(line);
    });

    const layersToFit = routeLayers.length ? L.featureGroup(routeLayers) : null;
    if (layersToFit) {
      map.fitBounds(layersToFit.getBounds(), { padding: [40, 40] });
    }
  }

  function buildInstructionsHtml(route) {
    const steps = buildNavigationSteps(route);

    if (!steps.length) {
      return `
        <div class="instructions">
          <div class="status">Sin indicaciones disponibles para esta ruta.</div>
        </div>
      `;
    }

    const total = steps.length;
    const rawIndex = navigationActive ? navigationStepIndex : 0;
    const index = Math.min(Math.max(rawIndex, 0), total - 1);
    const step = steps[index];
    const distanceInfo = typeof distanceToCurrentStep === "number"
      ? `<div class="distance">Te faltan ${formatMetersText(distanceToCurrentStep)} para el siguiente punto</div>`
      : `<div class="distance">Debes caminar ${formatMetersText(step.distance || 0)} en este tramo</div>`;
    const stepText = buildStepGuidanceText(step);

    let html = `<div class="instructions">`;

    html += `
      <div class="instruction-focus-head">
        <div class="instruction-focus-title">Indicación actual</div>
        <div class="instruction-focus-counter">Paso ${index + 1} de ${total}</div>
      </div>
      <div class="step active-step">
        <div><strong>${index + 1}.</strong> ${escapeHtml(stepText)}</div>
        ${distanceInfo}
      </div>
    `;

    html += `</div>`;
    return html;
  }

  function renderRoutesList() {
    if (!currentRoutes.length) {
      setRoutesMessage(`<div class="status">No hay rutas para mostrar.</div>`);
      return;
    }

    let html = "";

    currentRoutes.forEach((route, index) => {
      const summary = route.properties.summary;
      const isSelected = index === selectedRouteIndex;
      const isRecommended = index === recommendedRouteIndex;
      const assessment = routeAssessments[index];
      const safetyLabel = getSafetyLabel(assessment);
      const safetyMeta = assessment
        ? `${assessment.nearbyObstacleCount} obstáculos cercanos • ${safetyLabel}`
        : "Sin evaluación de seguridad";

      html += `
        <div class="route-card ${isSelected ? "active" : ""}" data-route-index="${index}">
          <div class="route-card-top">
            <div class="route-title">Ruta ${index + 1}</div>
            <div class="badge">${isRecommended ? "Recomendada" : "Alternativa"}</div>
          </div>
          <div class="route-meta">
            <span><strong>${formatDuration(summary.duration)}</strong></span>
            <span>${formatDistance(summary.distance)}</span>
            <span>${escapeHtml(safetyMeta)}</span>
          </div>
          <div class="route-summary">
            ${isSelected ? "Ruta seleccionada." : isRecommended ? "Más equilibrada entre seguridad y rapidez." : "Toca para elegir esta ruta."}
          </div>
          ${isSelected ? buildInstructionsHtml(route) : ""}
        </div>
      `;
    });

    routesContent.innerHTML = html;

    [...routesContent.querySelectorAll(".route-card")].forEach(card => {
      card.addEventListener("click", () => {
        const index = Number(card.dataset.routeIndex);
        selectRoute(index);
      });
    });
  }

  function selectRoute(index) {
    selectedRouteIndex = index;
    stopNavigation(true);
    hideCurrentStep();

    rebuildRouteAssessments();
    enforceSaferRouteIfNeeded({
      announce: true,
      reasonText: "Esa ruta presenta mayor riesgo"
    });

    drawRoutes();
    renderRoutesList();

    if (routeLayers[index]) {
      map.fitBounds(routeLayers[index].getBounds(), { padding: [40, 40] });
    }

    const summary = currentRoutes[index]?.properties?.summary || {};
    speakText(
      `Ruta ${index + 1} seleccionada. Distancia ${formatDistance(summary.distance || 0)}. Tiempo estimado ${formatDuration(summary.duration || 0)}. Pulsa iniciar trayecto para comenzar la navegación.`,
      true
    );
  }

  function chooseSuggestion(index) {
    const item = suggestionsData[index];
    if (!item) return;

    const destination = {
      lng: Number(item.lng),
      lat: Number(item.lat),
      name: item.fullLabel || item.title || "Destino"
    };

    if (!Number.isFinite(destination.lat) || !Number.isFinite(destination.lng)) {
      speakText("No se pudo interpretar ese destino. Elige otra sugerencia.", true);
      return;
    }

    searchInput.value = destination.name;
    clearSuggestions();
    loadAlternativeRoutes(destination);
  }

  function centerOnUser() {
    if (!userLocation) {
      setRoutesMessage(`<div class="status error">Todavía no se obtuvo tu ubicación.</div>`);
      speakText("Todavía no se obtuvo tu ubicación.", true);
      return;
    }
    map.setView([userLocation.lat, userLocation.lng], 17);
    if (userMarker) userMarker.openPopup();
    speakText("Mapa centrado en tu ubicación.", true);
  }

  function initLocation() {
    if (!navigator.geolocation) {
      setRoutesMessage(`<div class="status error">Tu navegador no soporta geolocalización.</div>`);
      speakText("Tu navegador no soporta geolocalización.", true);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      position => {
        userLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };

        if (userMarker) map.removeLayer(userMarker);

        userMarker = L.marker([userLocation.lat, userLocation.lng])
          .addTo(map)
          .bindPopup("Tu ubicación")
          .openPopup();

        map.setView([userLocation.lat, userLocation.lng], 17);

        setRoutesMessage(`
          <div class="status ok">
            Ubicación lista. Escribe un destino y elige una sugerencia.
          </div>
        `);

        speakText("Ubicación obtenida correctamente. Ahora escribe un destino y elige una sugerencia.", true);
      },
      error => {
        console.error(error);
        setRoutesMessage(`
          <div class="status error">
            No se pudo obtener tu ubicación. Abre la página en localhost o HTTPS y acepta el permiso.
          </div>
        `);
        speakText("No se pudo obtener tu ubicación. Debes abrir la página en localhost o HTTPS y aceptar el permiso.", true);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  }

  function initCompass() {
    let currentHeading = 0;

    function setHeading(deg) {
      if (Number.isFinite(deg)) {
        currentHeading = deg;
        compassNeedle.style.transform = `rotate(${deg}deg)`;
      }
    }

    if (window.DeviceOrientationEvent) {
      window.addEventListener("deviceorientation", (event) => {
        let heading = null;

        if (typeof event.webkitCompassHeading === "number") {
          heading = event.webkitCompassHeading;
        } else if (typeof event.alpha === "number") {
          heading = 360 - event.alpha;
        }

        if (heading !== null) {
          setHeading(heading);
        }
      }, true);
    }

    setHeading(currentHeading);
  }

  searchInput.addEventListener("input", () => {
    const query = searchInput.value.trim();

    if (searchDebounce) clearTimeout(searchDebounce);

    if (query.length < 2) {
      clearSuggestions();
      return;
    }

    searchDebounce = setTimeout(async () => {
      try {
        const results = await searchPlaces(query);
        renderSuggestions(results);
        if (results.length) {
          const first = suggestionsData[0]?.fullLabel || suggestionsData[0]?.title || "la primera sugerencia";
          speakText(`${results.length} sugerencias encontradas. La mejor coincidencia es ${first}. Usa flechas o toca una opción.`, true);
        }
      } catch (error) {
        console.error(error);
        suggestionsBox.innerHTML = `<div class="suggestion-item">Error cargando sugerencias.</div>`;
        speakText("Error al cargar sugerencias.", true);
      }
    }, 250);
  });

  searchInput.addEventListener("keydown", (e) => {
    const items = suggestionsBox.querySelectorAll(".suggestion-item[data-index]");

    if (!items.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeSuggestionIndex = Math.min(activeSuggestionIndex + 1, items.length - 1);
      updateSuggestionHighlight();
      items[activeSuggestionIndex]?.scrollIntoView({ block: "nearest" });

      const item = suggestionsData[activeSuggestionIndex];
      if (item) {
        speakText(item.fullLabel || item.title || "Sugerencia", true);
      }
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      activeSuggestionIndex = Math.max(activeSuggestionIndex - 1, 0);
      updateSuggestionHighlight();
      items[activeSuggestionIndex]?.scrollIntoView({ block: "nearest" });

      const item = suggestionsData[activeSuggestionIndex];
      if (item) {
        speakText(item.fullLabel || item.title || "Sugerencia", true);
      }
    }

    if (e.key === "Enter") {
      if (activeSuggestionIndex >= 0) {
        e.preventDefault();
        chooseSuggestion(activeSuggestionIndex);
      } else if (suggestionsData.length) {
        e.preventDefault();
        chooseSuggestion(0);
      }
    }

    if (e.key === "Escape") {
      clearSuggestions();
      speakText("Sugerencias cerradas.", true);
    }
  });

  document.addEventListener("click", (e) => {
    const panel = document.querySelector(".search-panel");
    if (!panel.contains(e.target)) {
      clearSuggestions();
    }
  });

  if (voiceCommandBtn) {
    voiceCommandBtn.addEventListener("click", () => {
      startVoiceRecognition("command");
    });
  }

  gpsBtn.addEventListener("click", centerOnUser);
  if (toggleRoutesPanelBtn) {
    toggleRoutesPanelBtn.addEventListener("click", toggleRoutesPanel);
  }
  if (reportObstacleBtn) {
    reportObstacleBtn.addEventListener("click", () => toggleReportMode());
  }
  mapStyleSelect.addEventListener("change", (event) => {
    setMapStyle(event.target.value);
  });
  btnSpeak.addEventListener("click", startNavigation);
  btnPause.addEventListener("click", pauseNavigation);
  btnResume.addEventListener("click", resumeNavigation);
  btnRepeat.addEventListener("click", repeatCurrentInstruction);
  btnStop.addEventListener("click", () => stopNavigation());
  if (btnQuickPause) {
    btnQuickPause.addEventListener("click", handleQuickPauseToggle);
  }
  if (btnQuickStop) {
    btnQuickStop.addEventListener("click", () => stopNavigation());
  }

  map.on("click", handleMapObstacleReport);

  loadSpanishVoice();
  if (speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = loadSpanishVoice;
  }

  setMapStyle("streets", true);
  setRoutesPanelExpanded(false);
  loadObstacles();
  startObstacleSync();
  initLocation();
  initCompass();
  initVoiceRecognition();
  updateNavigationUiState();