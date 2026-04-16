  const ORS_API_KEY = "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImFhOTA1MmJkZGYyNjRiYjRhZDA2OTcxM2NiMmJlZjQwIiwiaCI6Im11cm11cjY0In0=";

  const map = L.map("map", { zoomControl: true }).setView([-12.0464, -77.0428], 16);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap"
  }).addTo(map);

  let userLocation = null;
  let userMarker = null;
  let destinationMarker = null;

  let suggestionsData = [];
  let activeSuggestionIndex = -1;
  let searchDebounce = null;

  let currentRoutes = [];
  let routeLayers = [];
  let selectedRouteIndex = null;

  const searchInput = document.getElementById("searchInput");
  const gpsBtn = document.getElementById("gpsBtn");
  const suggestionsBox = document.getElementById("suggestions");
  const routesContent = document.getElementById("routesContent");
  const compassNeedle = document.getElementById("compassNeedle");

  const btnSpeak = document.getElementById("btnSpeak");
  const btnPause = document.getElementById("btnPause");
  const btnResume = document.getElementById("btnResume");
  const btnRepeat = document.getElementById("btnRepeat");
  const btnStop = document.getElementById("btnStop");

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

  function setRoutesMessage(html) {
    routesContent.innerHTML = html;
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
  }

  function getRouteColor(index) {
    return index === selectedRouteIndex ? "#20b15a" : "#9ca3af";
  }

  function getRouteWeight(index) {
    return index === selectedRouteIndex ? 7 : 5;
  }

  function getRouteOpacity(index) {
    return index === selectedRouteIndex ? 0.92 : 0.6;
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
    utterance.rate = 1;
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
      userMarker = L.marker([lat, lng]).addTo(map).bindPopup("Tu ubicación");
    } else {
      userMarker.setLatLng([lat, lng]);
    }

    if (autoCenterMap) {
      map.setView([lat, lng], Math.max(map.getZoom(), 18), { animate: true });
    }

    if (typeof heading === "number" && !Number.isNaN(heading)) {
      compassNeedle.style.transform = `rotate(${heading}deg)`;
    }
  }

  function showNavigationInstruction(stepIndex) {
    if (!selectedRouteSteps[stepIndex]) return;

    const step = selectedRouteSteps[stepIndex];
    showCurrentStep(step.instruction);

    if (lastSpokenStepIndex !== stepIndex) {
      speakText(step.instruction, true);
      lastSpokenStepIndex = stepIndex;
    }

    renderRoutesList();
  }

  function checkNavigationProgress(lat, lng) {
    if (!navigationActive || navigationPaused || !selectedRouteSteps.length) return;

    const currentStep = selectedRouteSteps[navigationStepIndex];
    if (!currentStep) {
      speakText("Has llegado a tu destino.", true);
      stopNavigation(true);
      return;
    }

    if (currentStep.lat == null || currentStep.lng == null) {
      return;
    }

    const distanceToStep = getDistanceMeters(lat, lng, currentStep.lat, currentStep.lng);

    if (distanceToStep <= 18 && lastSpokenStepIndex !== navigationStepIndex) {
      showNavigationInstruction(navigationStepIndex);
    }

    if (distanceToStep <= 8) {
      navigationStepIndex++;

      if (navigationStepIndex < selectedRouteSteps.length) {
        showNavigationInstruction(navigationStepIndex);
      } else {
        speakText("Has llegado a tu destino.", true);
        stopNavigation(true);
      }
    }
  }

  function startNavigation() {
    if (navigationPaused && watchId !== null && selectedRouteSteps.length) {
      navigationPaused = false;
      navigationActive = true;
      autoCenterMap = true;
      speakText("Trayecto reanudado.", true);
      showNavigationInstruction(navigationStepIndex);
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

    selectedRouteSteps = buildNavigationSteps(currentRoutes[selectedRouteIndex]);
    navigationStepIndex = 0;
    lastSpokenStepIndex = -1;
    navigationActive = true;
    navigationPaused = false;
    autoCenterMap = true;

    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
    }

    speakText("Trayecto iniciado. Sigue la ruta seleccionada.", true);

    if (selectedRouteSteps.length > 0) {
      showNavigationInstruction(0);
    }

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
    renderRoutesList();
  }

  function recenterMap() {
    if (!userLocation) {
      speakText("No se encontró tu ubicación actual.", true);
      return;
    }

    autoCenterMap = true;
    map.setView([userLocation.lat, userLocation.lng], Math.max(map.getZoom(), 18), { animate: true });
    speakText("Mapa recentrado en tu ubicación.", true);
  }

  function repeatCurrentInstruction() {
    if (!navigationActive || !selectedRouteSteps.length) {
      speakText("No hay una navegación activa.", true);
      return;
    }

    const step = selectedRouteSteps[navigationStepIndex];
    if (!step) return;

    showCurrentStep(step.instruction);
    speakText(step.instruction, true);
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
    autoCenterMap = true;

    synth.cancel();

    if (!silent) {
      speakText("Trayecto detenido.", true);
    }

    renderRoutesList();
  }

  function renderSuggestions(results) {
    suggestionsData = results || [];
    activeSuggestionIndex = -1;

    if (!suggestionsData.length) {
      suggestionsBox.innerHTML = `<div class="suggestion-item">No se encontraron destinos.</div>`;
      return;
    }

    suggestionsBox.innerHTML = suggestionsData.map((item, index) => {
      const title = item.properties?.label?.split(",")[0] || item.properties?.name || "Destino";
      const sub = item.properties?.label || "";
      return `
        <div class="suggestion-item" data-index="${index}">
          <div class="suggestion-title">${escapeHtml(title)}</div>
          <div class="suggestion-sub">${escapeHtml(sub)}</div>
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

  async function searchPlaces(query) {
    const base = "https://api.openrouteservice.org/geocode/autocomplete";
    const params = new URLSearchParams({
      api_key: ORS_API_KEY,
      text: query,
      size: "6"
    });

    if (userLocation) {
      params.set("focus.point.lon", userLocation.lng);
      params.set("focus.point.lat", userLocation.lat);
    }

    const response = await fetch(`${base}?${params.toString()}`, {
      headers: { "Accept": "application/json" }
    });

    if (!response.ok) {
      throw new Error("No se pudieron cargar las sugerencias.");
    }

    const data = await response.json();
    return data.features || [];
  }

  async function loadAlternativeRoutes(destination) {
    if (!userLocation) {
      setRoutesMessage(`<div class="status error">Todavía no se obtuvo tu ubicación.</div>`);
      speakText("Todavía no se obtuvo tu ubicación.", true);
      return;
    }

    clearRoutes();

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

      drawRoutes();
      renderRoutesList();
      speakText(`Se encontraron ${currentRoutes.length} rutas disponibles. Elige una ruta para escuchar sus indicaciones.`, true);

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
    let html = `<div class="instructions">`;

    steps.forEach((step, idx) => {
      const activeClass = navigationActive && idx === navigationStepIndex ? "active-step" : "";
      html += `
        <div class="step ${activeClass}">
          <div><strong>${idx + 1}.</strong> ${escapeHtml(step.instruction || "Continúa")}</div>
          <div class="distance">${formatDistance(step.distance || 0)}</div>
        </div>
      `;
    });

    html += `</div>`;
    return html;
  }

  function renderRoutesList() {
    if (!currentRoutes.length) {
      setRoutesMessage(`<div class="status">No hay rutas para mostrar.</div>`);
      return;
    }

    let html = `
      <h3 class="panel-title">Rutas peatonales</h3>
      <div class="sub-note">
        Elige una ruta y pulsa "Iniciar trayecto" para navegar en vivo.
      </div>
    `;

    currentRoutes.forEach((route, index) => {
      const summary = route.properties.summary;
      const isSelected = index === selectedRouteIndex;

      html += `
        <div class="route-card ${isSelected ? "active" : ""}" data-route-index="${index}">
          <div class="route-card-top">
            <div class="route-title">Ruta ${index + 1}</div>
            <div class="badge">${index === 0 ? "Recomendada" : "Alternativa"}</div>
          </div>
          <div class="route-meta">
            <span><strong>${formatDuration(summary.duration)}</strong></span>
            <span>${formatDistance(summary.distance)}</span>
          </div>
          <div class="route-summary">
            ${isSelected ? "Ruta seleccionada." : "Toca para elegir esta ruta."}
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

    const coords = item.geometry?.coordinates || [];
    const destination = {
      lng: coords[0],
      lat: coords[1],
      name: item.properties?.label || item.properties?.name || "Destino"
    };

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

    if (query.length < 3) {
      clearSuggestions();
      return;
    }

    searchDebounce = setTimeout(async () => {
      try {
        const results = await searchPlaces(query);
        renderSuggestions(results);
        if (results.length) {
          speakText(`${results.length} sugerencias encontradas. Usa flechas o toca una opción.`, true);
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
        speakText(item.properties?.label || "Sugerencia", true);
      }
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      activeSuggestionIndex = Math.max(activeSuggestionIndex - 1, 0);
      updateSuggestionHighlight();
      items[activeSuggestionIndex]?.scrollIntoView({ block: "nearest" });

      const item = suggestionsData[activeSuggestionIndex];
      if (item) {
        speakText(item.properties?.label || "Sugerencia", true);
      }
    }

    if (e.key === "Enter") {
      if (activeSuggestionIndex >= 0) {
        e.preventDefault();
        chooseSuggestion(activeSuggestionIndex);
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

  gpsBtn.addEventListener("click", centerOnUser);
  btnSpeak.addEventListener("click", startNavigation);
  btnPause.addEventListener("click", pauseNavigation);
  btnResume.addEventListener("click", recenterMap);
  btnRepeat.addEventListener("click", repeatCurrentInstruction);
  btnStop.addEventListener("click", () => stopNavigation());

  loadSpanishVoice();
  if (speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = loadSpanishVoice;
  }

  initLocation();
  initCompass();