/* EmLetter · Lector PDF. Lectura local con PDF.js; ningún documento se envía a EmLetter. */
(() => {
  "use strict";

  const PDFJS_VERSION = "6.3.289";
  const PDFJS_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.mjs`;
  const PDFJS_WORKER = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.mjs`;
  const $ = (id) => document.getElementById(id);
  const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
  const elements = {
    input: $("pdf-file-input"), name: $("pdf-document-name"), detail: $("pdf-document-detail"),
    close: $("pdf-close"), prev: $("pdf-prev"), next: $("pdf-next"),
    current: $("pdf-current"), total: $("pdf-total"), range: $("pdf-page-range"),
    zoomOut: $("pdf-zoom-out"), zoomIn: $("pdf-zoom-in"), zoomReset: $("pdf-zoom-reset"),
    rotate: $("pdf-rotate"), rotateMobile: $("pdf-rotate-mobile"), theme: $("pdf-theme"), fit: $("pdf-fit"), settings: $("pdf-preferences"),
    brightness: $("pdf-brightness"), brightnessValue: $("pdf-brightness-value"),
    blueLight: $("pdf-blue-light"), blueLightValue: $("pdf-blue-light-value"),
    card: document.querySelector(".pdf-reader-card"),
    fullscreen: $("pdf-fullscreen-toggle"), fullscreenLabel: $("pdf-fullscreen-label"),
    fullscreenIcon: $("pdf-fullscreen-icon"),
    stage: $("pdf-reader-stage"), empty: $("pdf-empty"), scroll: $("pdf-scroll"),
    sheet: $("pdf-sheet"), canvas: $("pdf-canvas"), text: $("pdf-text-layer"),
    annotations: $("pdf-annotation-layer"), loading: $("pdf-loading"),
    loadingText: $("pdf-loading-text"), error: $("pdf-error"), status: $("pdf-status"), drop: $("pdf-drop"),
  };
  if (!elements.stage) return;

  const SETTINGS_KEY = "emletter-pdf-reader-prefs-v1";
  let settings = { theme: "auto", fit: "width", brightness: 100, blueLight: 0 };
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    if (["auto", "original", "dark"].includes(stored.theme)) settings.theme = stored.theme;
    if (["width", "page"].includes(stored.fit)) settings.fit = stored.fit;
    if (typeof stored.brightness === "number" && Number.isFinite(stored.brightness)) {
      settings.brightness = clamp(Math.round(stored.brightness / 5) * 5, 50, 150);
    }
    if (typeof stored.blueLight === "number" && Number.isFinite(stored.blueLight)) {
      settings.blueLight = clamp(Math.round(stored.blueLight / 5) * 5, 0, 100);
    }
  } catch (_) { /* El lector también funciona sin almacenamiento. */ }
  elements.theme.value = settings.theme;
  elements.fit.value = settings.fit;
  elements.brightness.value = String(settings.brightness);
  elements.blueLight.value = String(settings.blueLight);

  function applyReadingFilters() {
    elements.sheet.style.setProperty("--pdf-reader-brightness", String(settings.brightness / 100));
    // Una capa ámbar reduce visualmente los azules, sin alterar el PDF original.
    elements.sheet.style.setProperty("--pdf-reader-warmth", String(settings.blueLight / 100 * .65));
    elements.brightnessValue.textContent = `${settings.brightness}%`;
    elements.blueLightValue.textContent = `${settings.blueLight}%`;
    elements.brightness.setAttribute("aria-valuetext", `${settings.brightness}%`);
    elements.blueLight.setAttribute("aria-valuetext", `${settings.blueLight}%`);
  }
  applyReadingFilters();

  const state = {
    lib: null, libPromise: null, pdf: null, page: 1, total: 0,
    zoom: 1, rotation: 0, fileName: "", renderTask: null, textTask: null,
    revision: 0, loadingRevision: 0, errorTimer: null, resizeTimer: null, dragDepth: 0,
    fallbackFullscreen: false, previousBodyOverflow: "",
  };

  function setStatus(value) { elements.status.textContent = value; }
  function setLoading(message) {
    elements.loadingText.textContent = message;
    elements.loading.hidden = false;
  }
  function hideLoading() { elements.loading.hidden = true; }
  function showError(message) {
    elements.error.textContent = message;
    elements.error.hidden = false;
    clearTimeout(state.errorTimer);
    state.errorTimer = setTimeout(() => { elements.error.hidden = true; }, 6500);
    setStatus(message);
  }
  function clearError() {
    clearTimeout(state.errorTimer);
    elements.error.hidden = true;
  }

  async function getLib() {
    if (state.lib) return state.lib;
    if (!state.libPromise) {
      state.libPromise = import(PDFJS_URL).then((lib) => {
        lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
        state.lib = lib;
        return lib;
      }).catch((error) => {
        state.libPromise = null;
        throw error;
      });
    }
    return state.libPromise;
  }

  function updateUI() {
    const opened = !!state.pdf;
    elements.current.textContent = String(opened ? state.page : 0);
    elements.total.textContent = String(state.total);
    elements.range.max = String(Math.max(state.total, 1));
    elements.range.value = String(state.page);
    elements.prev.disabled = !opened || state.page <= 1;
    elements.next.disabled = !opened || state.page >= state.total;
    elements.range.disabled = !opened || state.total < 2;
    elements.close.disabled = !opened;
    elements.rotate.disabled = !opened;
    elements.rotateMobile.disabled = !opened;
    elements.zoomOut.disabled = !opened || state.zoom <= .5;
    elements.zoomIn.disabled = !opened || state.zoom >= 5;
    elements.zoomReset.disabled = !opened;
    elements.zoomReset.textContent = `${Math.round(state.zoom * 100)}%`;
  }

  function stopRender() {
    ++state.revision;
    try { state.renderTask?.cancel(); } catch (_) { /* Se puede cancelar al terminar. */ }
    try { state.textTask?.cancel(); } catch (_) {}
    state.renderTask = null;
    state.textTask = null;
    elements.text.replaceChildren();
    elements.annotations.replaceChildren();
  }

  // Pantalla completa nativa cuando está disponible. Safari en iPhone y algunos
  // navegadores pueden requerir un modo inmersivo dentro de la ventana.
  function fullscreenActive() {
    return document.fullscreenElement === elements.card || state.fallbackFullscreen;
  }

  function syncFullscreenControl() {
    const active = fullscreenActive();
    elements.fullscreen.setAttribute("aria-pressed", String(active));
    elements.fullscreen.setAttribute("aria-label", active ? "Salir de pantalla completa" : "Pantalla completa");
    elements.fullscreen.title = active ? "Salir de pantalla completa" : "Pantalla completa";
    elements.fullscreenLabel.textContent = active ? "Salir de pantalla completa" : "Pantalla completa";
    elements.fullscreenIcon.textContent = active ? "↙" : "⛶";
  }

  function refreshViewport() {
    clearTimeout(state.resizeTimer);
    state.resizeTimer = setTimeout(() => {
      if (state.pdf) render({ preserveCenter: true });
    }, 120);
  }

  function enableFallbackFullscreen() {
    if (state.fallbackFullscreen) return;
    state.previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    state.fallbackFullscreen = true;
    elements.card.classList.add("pdf-reader-fullscreen-fallback");
    syncFullscreenControl();
    refreshViewport();
  }

  function disableFallbackFullscreen() {
    if (!state.fallbackFullscreen) return;
    state.fallbackFullscreen = false;
    elements.card.classList.remove("pdf-reader-fullscreen-fallback");
    document.body.style.overflow = state.previousBodyOverflow;
    syncFullscreenControl();
    refreshViewport();
  }

  async function exitReaderFullscreen() {
    if (state.fallbackFullscreen) {
      disableFallbackFullscreen();
    } else if (document.fullscreenElement === elements.card && document.exitFullscreen) {
      try { await document.exitFullscreen(); }
      catch (error) { console.warn("EmLetter: no se pudo salir de pantalla completa.", error); }
    }
    syncFullscreenControl();
  }

  async function toggleReaderFullscreen() {
    if (fullscreenActive()) {
      await exitReaderFullscreen();
      return;
    }
    elements.settings.open = false;
    if (typeof elements.card.requestFullscreen === "function") {
      try {
        // Llamar directamente desde el evento de clic mantiene la activación del usuario.
        await elements.card.requestFullscreen();
        syncFullscreenControl();
        refreshViewport();
        return;
      } catch (error) {
        console.info("EmLetter: pantalla completa nativa no disponible; usando vista inmersiva.", error);
      }
    }
    enableFallbackFullscreen();
  }

  document.addEventListener("fullscreenchange", () => {
    syncFullscreenControl();
    refreshViewport();
  });
  elements.fullscreen.addEventListener("click", toggleReaderFullscreen);
  syncFullscreenControl();

  async function discardDocument() {
    stopRender();
    const previous = state.pdf;
    state.pdf = null;
    state.page = 1;
    state.total = 0;
    state.zoom = 1;
    state.rotation = 0;
    state.fileName = "";
    elements.scroll.hidden = true;
    elements.empty.hidden = false;
    elements.canvas.width = elements.canvas.height = 0;
    elements.name.textContent = "Ningún documento abierto";
    elements.name.removeAttribute("title");
    elements.detail.textContent = "Tus archivos se procesan en tu navegador";
    elements.settings.open = false;
    updateUI();
    if (previous) {
      try { await previous.destroy(); } catch (_) {}
    }
  }

  function canvasLooksLight(canvas) {
    try {
      const probe = document.createElement("canvas");
      probe.width = probe.height = 24;
      const ctx = probe.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, 24, 24);
      const data = ctx.getImageData(0, 0, 24, 24).data;
      let lightCount = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (.2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2] > 158) lightCount++;
      }
      return lightCount / (24 * 24) > .5;
    } catch (_) { return true; }
  }

  function applyTheme() {
    const isDark = settings.theme === "dark" ||
      (settings.theme === "auto" && canvasLooksLight(elements.canvas));
    elements.canvas.classList.toggle("pdf-reader-dark", isDark);
  }

  async function renderText(page, viewport, token) {
    elements.text.replaceChildren();
    elements.text.style.setProperty("--scale-factor", String(viewport.scale));
    elements.text.style.width = `${viewport.width}px`;
    elements.text.style.height = `${viewport.height}px`;
    try {
      const layer = new state.lib.TextLayer({
        textContentSource: page.streamTextContent({ includeMarkedContent: true }),
        container: elements.text,
        viewport,
      });
      state.textTask = layer;
      await layer.render();
      if (token !== state.revision) layer.cancel?.();
    } catch (error) {
      if (error?.name !== "AbortException") console.warn("EmLetter: no se pudo seleccionar texto de esta página.", error);
    }
  }

  async function destinationPage(destination) {
    try {
      const value = typeof destination === "string"
        ? await state.pdf.getDestination(destination) : destination;
      if (!Array.isArray(value) || !value.length) return null;
      if (Number.isInteger(value[0])) return value[0] + 1;
      return (await state.pdf.getPageIndex(value[0])) + 1;
    } catch (_) { return null; }
  }

  function runNamedAction(action) {
    if (action === "NextPage") changePage(state.page + 1);
    else if (action === "PrevPage") changePage(state.page - 1);
    else if (action === "FirstPage") changePage(1);
    else if (action === "LastPage") changePage(state.total);
  }

  async function renderLinks(page, viewport, token) {
    elements.annotations.replaceChildren();
    elements.annotations.style.width = `${viewport.width}px`;
    elements.annotations.style.height = `${viewport.height}px`;
    try {
      const annotations = await page.getAnnotations({ intent: "display" });
      if (token !== state.revision) return;
      for (const annotation of annotations) {
        if (!annotation.rect || !(annotation.url || annotation.dest || annotation.action)) continue;
        const bounds = viewport.convertToViewportRectangle(annotation.rect);
        const width = Math.abs(bounds[2] - bounds[0]);
        const height = Math.abs(bounds[3] - bounds[1]);
        if (width < 1 || height < 1) continue;
        const anchor = document.createElement("a");
        anchor.style.left = `${Math.min(bounds[0], bounds[2])}px`;
        anchor.style.top = `${Math.min(bounds[1], bounds[3])}px`;
        anchor.style.width = `${width}px`;
        anchor.style.height = `${height}px`;
        anchor.setAttribute("aria-label", "Enlace del PDF");
        if (annotation.url) {
          let destination;
          try { destination = new URL(annotation.url, location.href); } catch (_) { continue; }
          if (!["http:", "https:", "mailto:"].includes(destination.protocol)) continue;
          anchor.href = destination.href;
          anchor.target = "_blank";
          anchor.rel = "noopener noreferrer";
        } else {
          anchor.href = "#";
          anchor.addEventListener("click", async (event) => {
            event.preventDefault();
            if (annotation.dest) {
              const target = await destinationPage(annotation.dest);
              if (target) changePage(target);
            } else if (annotation.action) runNamedAction(annotation.action);
          });
        }
        elements.annotations.appendChild(anchor);
      }
    } catch (error) { console.warn("EmLetter: no se pudieron mostrar algunos enlaces del PDF.", error); }
  }

  async function render({ preserveCenter = false } = {}) {
    if (!state.pdf) return;
    const currentPdf = state.pdf;
    const oldW = elements.scroll.scrollWidth || 1;
    const oldH = elements.scroll.scrollHeight || 1;
    const fractionX = (elements.scroll.scrollLeft + elements.scroll.clientWidth / 2) / oldW;
    const fractionY = (elements.scroll.scrollTop + elements.scroll.clientHeight / 2) / oldH;
    stopRender();
    const renderToken = state.revision;
    setLoading(`Cargando página ${state.page}…`);
    updateUI();
    try {
      const page = await currentPdf.getPage(state.page);
      if (renderToken !== state.revision || state.pdf !== currentPdf) return;
      const rotation = ((page.rotate || 0) + state.rotation) % 360;
      const base = page.getViewport({ scale: 1, rotation });
      const availableW = Math.max(160, elements.scroll.clientWidth - 28);
      const availableH = Math.max(160, elements.scroll.clientHeight - 28);
      const fit = settings.fit === "page"
        ? Math.min(availableW / base.width, availableH / base.height)
        : availableW / base.width;
      const cssScale = fit * state.zoom;
      const viewport = page.getViewport({ scale: cssScale, rotation });
      const dpr = Math.min(window.devicePixelRatio || 1, 2.25);
      const area = viewport.width * viewport.height * dpr * dpr;
      const quality = area > 14000000 ? Math.sqrt(14000000 / area) : 1;
      const renderViewport = page.getViewport({ scale: cssScale * dpr * quality, rotation });
      const width = Math.round(viewport.width);
      const height = Math.round(viewport.height);
      elements.sheet.style.width = `${width}px`;
      elements.sheet.style.height = `${height}px`;
      elements.canvas.width = Math.max(1, Math.round(renderViewport.width));
      elements.canvas.height = Math.max(1, Math.round(renderViewport.height));
      elements.canvas.style.width = `${width}px`;
      elements.canvas.style.height = `${height}px`;
      const ctx = elements.canvas.getContext("2d", { alpha: false });
      state.renderTask = page.render({ canvasContext: ctx, viewport: renderViewport });
      await state.renderTask.promise;
      if (renderToken !== state.revision || state.pdf !== currentPdf) return;
      applyTheme();
      await Promise.allSettled([renderText(page, viewport, renderToken), renderLinks(page, viewport, renderToken)]);
      if (renderToken !== state.revision || state.pdf !== currentPdf) return;
      setStatus(`Página ${state.page} de ${state.total}`);
      requestAnimationFrame(() => {
        if (renderToken !== state.revision) return;
        if (preserveCenter) {
          elements.scroll.scrollLeft = Math.max(0, fractionX * elements.scroll.scrollWidth - elements.scroll.clientWidth / 2);
          elements.scroll.scrollTop = Math.max(0, fractionY * elements.scroll.scrollHeight - elements.scroll.clientHeight / 2);
        } else {
          elements.scroll.scrollLeft = Math.max(0, (elements.scroll.scrollWidth - elements.scroll.clientWidth) / 2);
          elements.scroll.scrollTop = 0;
        }
      });
    } catch (error) {
      if (!/RenderingCancelled|AbortException/.test(error?.name || "") && renderToken === state.revision) {
        console.error("EmLetter PDF render:", error);
        showError("No se pudo mostrar esta página.");
      }
    } finally {
      if (renderToken === state.revision) hideLoading();
    }
  }

  async function openFile(file) {
    if (!file) return;
    if (!(/\.pdf$/i.test(file.name) || file.type === "application/pdf")) {
      showError("Selecciona un documento PDF.");
      return;
    }
    const attempt = ++state.loadingRevision;
    clearError();
    setLoading("Abriendo documento…");
    setStatus("Abriendo documento…");
    try {
      const signature = new TextDecoder("ascii").decode(await file.slice(0, 5).arrayBuffer());
      if (signature !== "%PDF-") throw new Error("El archivo no tiene una cabecera PDF válida.");
      const lib = await getLib();
      if (attempt !== state.loadingRevision) return;
      await discardDocument();
      const data = new Uint8Array(await file.arrayBuffer());
      if (attempt !== state.loadingRevision) return;
      const documentTask = lib.getDocument({ data });
      let pdf;
      try { pdf = await documentTask.promise; }
      catch (error) { await documentTask.destroy(); throw error; }
      if (attempt !== state.loadingRevision) { await pdf.destroy(); return; }
      state.pdf = pdf;
      state.page = 1;
      state.total = pdf.numPages;
      state.fileName = file.name;
      elements.name.textContent = file.name;
      elements.name.title = file.name;
      elements.detail.textContent = `${state.total} ${state.total === 1 ? "página" : "páginas"} · lectura local`;
      elements.empty.hidden = true;
      elements.scroll.hidden = false;
      elements.settings.open = false;
      updateUI();
      await render();
    } catch (error) {
      if (attempt !== state.loadingRevision) return;
      console.error("EmLetter PDF:", error);
      await discardDocument();
      const password = error?.name === "PasswordException";
      showError(password
        ? "Este PDF tiene contraseña. Ábrelo sin protección para leerlo aquí."
        : (error?.message?.includes("cabecera") ? error.message : "No se pudo abrir el PDF. Comprueba el archivo o tu conexión al cargar el lector."));
    } finally {
      elements.input.value = "";
      if (attempt === state.loadingRevision && !state.pdf) hideLoading();
    }
  }

  async function closeFile() {
    await exitReaderFullscreen();
    ++state.loadingRevision;
    await discardDocument();
    hideLoading();
    clearError();
    setStatus("Listo para abrir un PDF");
  }

  function changePage(value) {
    if (!state.pdf) return;
    const target = clamp(Math.trunc(Number(value) || 1), 1, state.total);
    if (target === state.page) return;
    state.page = target;
    render();
  }

  function setZoom(value) {
    if (!state.pdf) return;
    const next = clamp(Math.round(value * 100) / 100, .5, 5);
    if (Math.abs(next - state.zoom) < .005) return;
    state.zoom = next;
    render({ preserveCenter: true });
  }

  function rotate() {
    if (!state.pdf) return;
    state.rotation = (state.rotation + 90) % 360;
    render();
  }

  elements.input.addEventListener("change", (event) => openFile(event.target.files?.[0]));
  elements.close.addEventListener("click", closeFile);
  elements.prev.addEventListener("click", () => changePage(state.page - 1));
  elements.next.addEventListener("click", () => changePage(state.page + 1));
  elements.range.addEventListener("input", (event) => changePage(event.target.value));
  elements.zoomOut.addEventListener("click", () => setZoom(state.zoom - .2));
  elements.zoomIn.addEventListener("click", () => setZoom(state.zoom + .2));
  elements.zoomReset.addEventListener("click", () => setZoom(1));
  elements.rotate.addEventListener("click", rotate);
  elements.rotateMobile.addEventListener("click", rotate);
  elements.theme.addEventListener("change", () => {
    settings.theme = elements.theme.value;
    saveSettings();
    if (state.pdf) applyTheme();
  });
  elements.fit.addEventListener("change", () => {
    settings.fit = elements.fit.value;
    saveSettings();
    if (state.pdf) render({ preserveCenter: false });
  });
  elements.brightness.addEventListener("input", () => {
    settings.brightness = clamp(Number(elements.brightness.value) || 100, 50, 150);
    applyReadingFilters();
    saveSettings();
  });
  elements.blueLight.addEventListener("input", () => {
    settings.blueLight = clamp(Number(elements.blueLight.value) || 0, 0, 100);
    applyReadingFilters();
    saveSettings();
  });
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (_) {}
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (fullscreenActive()) {
        event.preventDefault();
        exitReaderFullscreen();
      }
      elements.settings.open = false;
      return;
    }
    if (!state.pdf || event.altKey || event.ctrlKey || event.metaKey ||
      event.target.closest?.("input,textarea,select,button,summary,[contenteditable]")) return;
    if (["ArrowRight", "PageDown"].includes(event.key)) { event.preventDefault(); changePage(state.page + 1); }
    else if (["ArrowLeft", "PageUp"].includes(event.key)) { event.preventDefault(); changePage(state.page - 1); }
    else if (["+", "="].includes(event.key)) { event.preventDefault(); setZoom(state.zoom + .2); }
    else if (event.key === "-") { event.preventDefault(); setZoom(state.zoom - .2); }
    else if (event.key === "0") { event.preventDefault(); setZoom(1); }
    else if (event.key.toLowerCase() === "r") { event.preventDefault(); rotate(); }
  });
  document.addEventListener("pointerdown", (event) => {
    if (!elements.settings.contains(event.target)) elements.settings.open = false;
  });
  window.addEventListener("resize", refreshViewport);

  elements.stage.addEventListener("dragenter", (event) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    ++state.dragDepth;
    elements.drop.hidden = false;
  });
  elements.stage.addEventListener("dragover", (event) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  elements.stage.addEventListener("dragleave", (event) => {
    event.preventDefault();
    if (--state.dragDepth <= 0) { state.dragDepth = 0; elements.drop.hidden = true; }
  });
  elements.stage.addEventListener("drop", (event) => {
    event.preventDefault();
    state.dragDepth = 0;
    elements.drop.hidden = true;
    openFile(event.dataTransfer?.files?.[0]);
  });

  updateUI();
})();
