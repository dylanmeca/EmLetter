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
    annotations: $("pdf-annotation-layer"), redactions: $("pdf-redaction-layer"),
    redactToggle: $("pdf-redaction-toggle"), redactDownload: $("pdf-redaction-download"), loading: $("pdf-loading"),
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
    viewport: null, redactionMode: false, redactionBoxes: new Map(), drawing: null,
    exporting: false, exportLibPromise: null,
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
    elements.close.disabled = !opened || state.exporting;
    elements.input.disabled = state.exporting;
    elements.redactToggle.disabled = !opened || state.exporting;
    elements.redactDownload.disabled = !opened || state.exporting || !hasRedactions();
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
    elements.redactions.replaceChildren();
    state.viewport = null;
    state.drawing = null;
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
    state.redactionBoxes.clear();
    setRedactionMode(false);
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
    // Mientras se censura, mostrar el fondo original para distinguir las barras negras.
    const isDark = !state.redactionMode && (settings.theme === "dark" ||
      (settings.theme === "auto" && canvasLooksLight(elements.canvas)));
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
      state.viewport = viewport;
      paintRedactions();
      await Promise.allSettled([renderText(page, viewport, renderToken), renderLinks(page, viewport, renderToken)]);
      if (renderToken !== state.revision || state.pdf !== currentPdf) return;
      setStatus(state.redactionMode ? "Lápiz activo: pulsa una palabra o arrastra para cubrir un área" : `Página ${state.page} de ${state.total}`);
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
    if (!file || state.exporting) return;
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
    if (state.exporting) return;
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

  // Las censuras se guardan como rectángulos en coordenadas originales del PDF.
  // La exportación rasteriza TODAS las páginas y no copia bytes ni objetos del PDF de origen:
  // dibujar solo una barra en un PDF vectorial dejaría el texto extraíble debajo.
  function hasRedactions() {
    for (const boxes of state.redactionBoxes.values()) if (boxes.length) return true;
    return false;
  }

  function setRedactionMode(active) {
    state.redactionMode = !!active && !!state.pdf && !state.exporting;
    state.drawing = null;
    elements.redactions.classList.toggle("is-active", state.redactionMode);
    elements.redactToggle.setAttribute("aria-pressed", String(state.redactionMode));
    elements.redactToggle.setAttribute("aria-label", state.redactionMode ? "Desactivar lápiz de censura" : "Activar lápiz de censura");
    elements.redactToggle.title = state.redactionMode ? "Desactivar lápiz de censura" : "Activar lápiz de censura";
    elements.redactDownload.hidden = !state.redactionMode;
    if (state.pdf && elements.canvas.width) applyTheme();
    paintRedactions();
    if (state.redactionMode) setStatus("Lápiz activo: pulsa una palabra o arrastra para cubrir un área");
    else if (state.pdf) setStatus(`Página ${state.page} de ${state.total}`);
    updateUI();
  }

  function clampSheetPoint(clientX, clientY) {
    const rect = elements.sheet.getBoundingClientRect();
    return {
      x: clamp(clientX - rect.left, 0, rect.width),
      y: clamp(clientY - rect.top, 0, rect.height),
    };
  }

  function boxFromScreenRect(left, top, right, bottom) {
    if (!state.viewport) return null;
    const sheetRect = elements.sheet.getBoundingClientRect();
    const width = sheetRect.width;
    const height = sheetRect.height;
    const x1 = clamp(left - sheetRect.left, 0, width);
    const y1 = clamp(top - sheetRect.top, 0, height);
    const x2 = clamp(right - sheetRect.left, 0, width);
    const y2 = clamp(bottom - sheetRect.top, 0, height);
    if (Math.abs(x2 - x1) < 1 || Math.abs(y2 - y1) < 1) return null;
    // La hoja redondea a enteros, mientras que el viewport tiene decimales.
    const a = state.viewport.convertToPdfPoint(x1 * state.viewport.width / width, y1 * state.viewport.height / height);
    const b = state.viewport.convertToPdfPoint(x2 * state.viewport.width / width, y2 * state.viewport.height / height);
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  }

  function paintRedactions() {
    elements.redactions.replaceChildren();
    if (!state.viewport || !state.pdf) return;
    const boxes = state.redactionBoxes.get(state.page) || [];
    const factorX = elements.sheet.clientWidth / state.viewport.width;
    const factorY = elements.sheet.clientHeight / state.viewport.height;
    for (const box of boxes) {
      const coords = state.viewport.convertToViewportRectangle(box);
      const node = document.createElement("div");
      node.className = "pdf-reader-redaction-mark";
      node.style.left = `${Math.min(coords[0], coords[2]) * factorX}px`;
      node.style.top = `${Math.min(coords[1], coords[3]) * factorY}px`;
      node.style.width = `${Math.abs(coords[2] - coords[0]) * factorX}px`;
      node.style.height = `${Math.abs(coords[3] - coords[1]) * factorY}px`;
      elements.redactions.appendChild(node);
    }
  }

  function appendRedaction(rectangles) {
    if (!state.pdf || !state.viewport) return;
    const boxes = (state.redactionBoxes.get(state.page) || []).slice();
    for (const rect of rectangles) {
      if (rect && rect[2] > rect[0] && rect[3] > rect[1]) boxes.push(rect);
    }
    if (!boxes.length) return;
    state.redactionBoxes.set(state.page, boxes);
    paintRedactions();
    updateUI();
    setStatus(`${boxes.length} ${boxes.length === 1 ? "censura" : "censuras"} en la página ${state.page}. Descarga el PDF para aplicar las censuras definitivamente.`);
  }

  // PDF.js divide el texto en fragmentos: Range permite encontrar la PALABRA bajo
  // el cursor, no bloquear accidentalmente toda la línea del documento.
  function wordUnderPointer(clientX, clientY) {
    for (const span of elements.text.querySelectorAll("span")) {
      const textNode = span.firstChild;
      if (!textNode || textNode.nodeType !== Node.TEXT_NODE || !textNode.length) continue;
      const bounds = span.getBoundingClientRect();
      if (clientX < bounds.left - 2 || clientX > bounds.right + 2 ||
          clientY < bounds.top - 2 || clientY > bounds.bottom + 2) continue;
      const content = textNode.textContent;
      const matches = content.matchAll(/\S+/gu);
      for (const match of matches) {
        const range = document.createRange();
        range.setStart(textNode, match.index);
        range.setEnd(textNode, match.index + match[0].length);
        for (const wordRect of range.getClientRects()) {
          if (clientX < wordRect.left - 2 || clientX > wordRect.right + 2 ||
              clientY < wordRect.top - 2 || clientY > wordRect.bottom + 2) continue;
          // Un margen evita dejar píxeles de los bordes/antialiasing de las letras.
          return boxFromScreenRect(wordRect.left - 2, wordRect.top - 2, wordRect.right + 2, wordRect.bottom + 2);
        }
      }
    }
    return null;
  }

  function drawSelectionPreview(start, end) {
    elements.redactions.querySelector(".pdf-reader-redaction-preview")?.remove();
    const preview = document.createElement("div");
    preview.className = "pdf-reader-redaction-preview";
    preview.style.left = `${Math.min(start.x, end.x)}px`;
    preview.style.top = `${Math.min(start.y, end.y)}px`;
    preview.style.width = `${Math.abs(end.x - start.x)}px`;
    preview.style.height = `${Math.abs(end.y - start.y)}px`;
    elements.redactions.appendChild(preview);
  }

  elements.redactions.addEventListener("pointerdown", (event) => {
    if (!state.redactionMode || !state.viewport || event.button !== 0) return;
    event.preventDefault();
    const point = clampSheetPoint(event.clientX, event.clientY);
    state.drawing = { id: event.pointerId, start: point, last: point, clientX: event.clientX, clientY: event.clientY };
    elements.redactions.setPointerCapture(event.pointerId);
  });
  elements.redactions.addEventListener("pointermove", (event) => {
    if (!state.drawing || event.pointerId !== state.drawing.id) return;
    const point = clampSheetPoint(event.clientX, event.clientY);
    state.drawing.last = point;
    if (Math.hypot(point.x - state.drawing.start.x, point.y - state.drawing.start.y) > 5) {
      drawSelectionPreview(state.drawing.start, point);
    }
  });
  elements.redactions.addEventListener("pointerup", (event) => {
    const drawing = state.drawing;
    if (!drawing || event.pointerId !== drawing.id) return;
    state.drawing = null;
    elements.redactions.querySelector(".pdf-reader-redaction-preview")?.remove();
    const end = clampSheetPoint(event.clientX, event.clientY);
    if (Math.hypot(end.x - drawing.start.x, end.y - drawing.start.y) > 5) {
      const sheet = elements.sheet.getBoundingClientRect();
      appendRedaction([boxFromScreenRect(
        sheet.left + drawing.start.x, sheet.top + drawing.start.y,
        sheet.left + end.x, sheet.top + end.y,
      )]);
    } else {
      const word = wordUnderPointer(event.clientX, event.clientY);
      if (word) appendRedaction([word]);
      else setStatus("No hay texto reconocible aquí. Arrastra el lápiz para cubrir una zona, incluso en documentos escaneados.");
    }
  });
  elements.redactions.addEventListener("pointercancel", () => {
    state.drawing = null;
    elements.redactions.querySelector(".pdf-reader-redaction-preview")?.remove();
  });

  async function exportRedactedPdf() {
    if (!state.pdf || state.exporting || !hasRedactions()) return;
    const original = state.pdf;
    state.exporting = true;
    updateUI();
    clearError();
    try {
      setLoading("Preparando PDF censurado…");
      if (!state.exportLibPromise) {
        state.exportLibPromise = import("https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm").catch((error) => {
          state.exportLibPromise = null;
          throw error;
        });
      }
      const { PDFDocument } = await state.exportLibPromise;
      const result = await PDFDocument.create();
      for (let number = 1; number <= state.total; number++) {
        setLoading(`Censurando página ${number} de ${state.total}…`);
        // Dar tiempo al navegador para pintar el progreso antes del siguiente render.
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const page = await original.getPage(number);
        const base = page.getViewport({ scale: 1, rotation: page.rotate });
        const scale = Math.min(2.5, Math.sqrt(16000000 / (base.width * base.height)));
        const viewport = page.getViewport({ scale, rotation: page.rotate });
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) throw new Error("No se pudo crear el lienzo para exportar.");
        try {
          await page.render({ canvasContext: ctx, viewport, background: "#ffffff" }).promise;
          ctx.fillStyle = "#000000";
          for (const box of state.redactionBoxes.get(number) || []) {
            const rect = viewport.convertToViewportRectangle(box);
            const left = Math.floor(Math.min(rect[0], rect[2])) - 2;
            const top = Math.floor(Math.min(rect[1], rect[3])) - 2;
            const right = Math.ceil(Math.max(rect[0], rect[2])) + 2;
            const bottom = Math.ceil(Math.max(rect[1], rect[3])) + 2;
            ctx.fillRect(left, top, right - left, bottom - top);
          }
          // Solo se incorpora una imagen de píxeles por página: no quedan textos,
          // capas, adjuntos ni metadatos del PDF original debajo de las barras.
          const blob = await new Promise((resolve, reject) => canvas.toBlob(
            (value) => value ? resolve(value) : reject(new Error("No se pudo convertir la página a imagen.")),
            "image/jpeg", .94,
          ));
          const img = await result.embedJpg(await blob.arrayBuffer());
          const output = result.addPage([base.width, base.height]);
          output.drawImage(img, { x: 0, y: 0, width: base.width, height: base.height });
        } finally {
          canvas.width = canvas.height = 0;
        }
      }
      setLoading("Guardando PDF censurado…");
      const bytes = await result.save({ useObjectStreams: true });
      const objectUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = (state.fileName.replace(/\.pdf$/i, "") || "documento") + "-censurado.pdf";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
      setStatus("PDF censurado descargado. El documento exportado está aplanado en imágenes.");
    } catch (error) {
      console.error("EmLetter: error al exportar PDF censurado:", error);
      showError("No se pudo descargar el PDF censurado. Comprueba tu conexión y la memoria disponible.");
    } finally {
      state.exporting = false;
      hideLoading();
      updateUI();
    }
  }

  elements.redactToggle.addEventListener("click", () => setRedactionMode(!state.redactionMode));
  elements.redactDownload.addEventListener("click", exportRedactedPdf);

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
