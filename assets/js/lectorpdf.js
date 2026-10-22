/* EmLetter · Lector PDF. Lectura local con PDF.js; ningún documento se envía a EmLetter. */
(() => {
  "use strict";

  const PDFJS_VERSION = "6.3.289";
  const PDFJS_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.mjs`;
  const PDFJS_WORKER = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.mjs`;
  // OCR en el propio navegador: se descargan motor y diccionarios, NO se sube el PDF.
  const OCR_VERSION = "7.0.0";
  const OCR_SCRIPT = `https://cdn.jsdelivr.net/npm/tesseract.js@${OCR_VERSION}/dist/tesseract.min.js`;
  const OCR_WORKER = `https://cdn.jsdelivr.net/npm/tesseract.js@${OCR_VERSION}/dist/worker.min.js`;
  const OCR_CORE = "https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0";
  const OCR_LANG = "https://tessdata.projectnaptha.com/4.0.0";
  const $ = (id) => document.getElementById(id);
  const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
  // PDF.js 6.3 eliminó convertToViewportRectangle: convertir ambas esquinas
  // mantiene las posiciones correctas con zoom y giros de 0/90/180/270 grados.
  const viewportRect = (viewport, pdfRect) => [
    ...viewport.convertToViewportPoint(pdfRect[0], pdfRect[1]),
    ...viewport.convertToViewportPoint(pdfRect[2], pdfRect[3]),
  ];
  const elements = {
    input: $("pdf-file-input"), name: $("pdf-document-name"), detail: $("pdf-document-detail"),
    close: $("pdf-close"), prev: $("pdf-prev"), next: $("pdf-next"),
    current: $("pdf-current"), total: $("pdf-total"), range: $("pdf-page-range"),
    zoomOut: $("pdf-zoom-out"), zoomIn: $("pdf-zoom-in"), zoomReset: $("pdf-zoom-reset"),
    rotate: $("pdf-rotate"), rotateMobile: $("pdf-rotate-mobile"), theme: $("pdf-theme"), fit: $("pdf-fit"), settings: $("pdf-preferences"),
    ocrEnabled: $("pdf-ocr-enabled"),
    brightness: $("pdf-brightness"), brightnessValue: $("pdf-brightness-value"),
    blueLight: $("pdf-blue-light"), blueLightValue: $("pdf-blue-light-value"),
    temperatureMatrix: $("pdf-reader-temperature-matrix"),
    luminanceChannels: [$("pdf-reader-luminance-r"), $("pdf-reader-luminance-g"), $("pdf-reader-luminance-b")],
    card: document.querySelector(".pdf-reader-card"),
    fullscreen: $("pdf-fullscreen-toggle"), fullscreenLabel: $("pdf-fullscreen-label"),
    fullscreenIcon: $("pdf-fullscreen-icon"),
    stage: $("pdf-reader-stage"), empty: $("pdf-empty"), scroll: $("pdf-scroll"),
    sheet: $("pdf-sheet"), canvas: $("pdf-canvas"), text: $("pdf-text-layer"), ocrLayer: $("pdf-ocr-layer"),
    annotations: $("pdf-annotation-layer"), redactions: $("pdf-redaction-layer"),
    redactToggle: $("pdf-redaction-toggle"), redactDownload: $("pdf-redaction-download"), loading: $("pdf-loading"),
    loadingText: $("pdf-loading-text"), error: $("pdf-error"), status: $("pdf-status"), drop: $("pdf-drop"),
  };
  if (!elements.stage) return;

  const SETTINGS_KEY = "emletter-pdf-reader-prefs-v1";
  let settings = { theme: "auto", fit: "width", brightness: 100, blueLight: 0, ocrEnabled: true };
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    if (["auto", "original", "dark"].includes(stored.theme)) settings.theme = stored.theme;
    if (["width", "page"].includes(stored.fit)) settings.fit = stored.fit;
    if (typeof stored.ocrEnabled === "boolean") settings.ocrEnabled = stored.ocrEnabled;
    if (typeof stored.brightness === "number" && Number.isFinite(stored.brightness)) {
      settings.brightness = clamp(Math.round(stored.brightness / 5) * 5, 50, 150);
    }
    if (typeof stored.blueLight === "number" && Number.isFinite(stored.blueLight)) {
      settings.blueLight = clamp(Math.round(stored.blueLight / 5) * 5, 0, 100);
    }
  } catch (_) { /* El lector también funciona sin almacenamiento. */ }
  elements.theme.value = settings.theme;
  elements.fit.value = settings.fit;
  elements.ocrEnabled.checked = settings.ocrEnabled;
  elements.brightness.value = String(settings.brightness);
  elements.blueLight.value = String(settings.blueLight);

  // Aproximación del locus planckiano: temperatura correlacionada (K) ->
  // cromaticidad CIE xy -> blanco lineal sRGB. El factor R se conserva en 1;
  // G y B se atenúan por canal, sin recolorear el PDF mediante un velo ámbar.
  // No es un ajuste de la retroiluminación ni un filtro óptico calibrado.
  function whitepointLinearRgb(kelvin) {
    const t = kelvin;
    const x = t <= 4000
      ? -.2661239e9 / t ** 3 - .2343580e6 / t ** 2 + .8776956e3 / t + .179910
      : -3.0258469e9 / t ** 3 + 2.1070379e6 / t ** 2 + .2226347e3 / t + .240390;
    const y = t <= 4000
      ? -.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - .16748867
      : 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - .37001483;
    const X = x / y;
    const Z = (1 - x - y) / y;
    return [
      3.2404542 * X - 1.5371385 - .4985314 * Z,
      -.969266 * X + 1.8760108 + .0415560 * Z,
      .0556434 * X - .2040259 + 1.0572252 * Z,
    ];
  }
  const neutralWhite = whitepointLinearRgb(6500);
  function applyReadingFilters() {
    const kelvin = Math.round((6500 - 3800 * settings.blueLight / 100) / 50) * 50;
    const target = whitepointLinearRgb(kelvin);
    const redRatio = target[0] / neutralWhite[0];
    const greenGain = clamp((target[1] / neutralWhite[1]) / redRatio, 0, 1);
    const blueGain = clamp((target[2] / neutralWhite[2]) / redRatio, 0, 1);
    elements.temperatureMatrix.setAttribute("values", [
      "1 0 0 0 0",
      `0 ${greenGain.toFixed(5)} 0 0 0`,
      `0 0 ${blueGain.toFixed(5)} 0 0`,
      "0 0 0 1 0",
    ].join(" "));
    // Modificar la luminancia real de los píxeles del canvas en RGB lineal.
    // Al oscurecer se reduce la luminancia de toda la página, incluso del blanco.
    // Al iluminar se realzan sombras y tonos medios con gamma (un blanco puro ya
    // está en el máximo de la pantalla y no puede aclararse más desde una web).
    // Las barras de censura están fuera del canvas y conservan su negro absoluto.
    const level = settings.brightness;
    let amplitude = 1, exponent = 1, offset = 0;
    if (level < 100) {
      amplitude = level / 100;
    } else if (level > 100) {
      const strength = (level - 100) / 50;
      exponent = 1 - .38 * strength;
      offset = .012 * strength;
      amplitude = 1 - offset;
    }
    for (const channel of elements.luminanceChannels) {
      channel.setAttribute("amplitude", amplitude.toFixed(5));
      channel.setAttribute("exponent", exponent.toFixed(5));
      channel.setAttribute("offset", offset.toFixed(5));
    }
    elements.brightnessValue.textContent = `${settings.brightness}%`;
    elements.blueLightValue.textContent = `${settings.blueLight}% · ${kelvin} K`;
    elements.brightness.setAttribute("aria-valuetext", `${settings.brightness}%`);
    elements.blueLight.setAttribute("aria-valuetext", `${settings.blueLight}%, temperatura de color aproximada ${kelvin} kelvin`);
  }
  applyReadingFilters();

  const state = {
    lib: null, libPromise: null, pdf: null, page: 1, total: 0,
    zoom: 1, rotation: 0, fileName: "", renderTask: null, textTask: null,
    revision: 0, loadingRevision: 0, errorTimer: null, resizeTimer: null, dragDepth: 0,
    fallbackFullscreen: false, previousBodyOverflow: "",
    viewport: null, redactionMode: false, redactionBoxes: new Map(), drawing: null,
    exporting: false, exportLibPromise: null, ocrJob: null, viewportPage: 0, preparing: false,
    ocrPreparation: 0, pinch: null,
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
    const opened = !!state.pdf && !state.preparing;
    elements.current.textContent = String(state.pdf ? state.page : 0);
    elements.total.textContent = String(state.total);
    elements.range.max = String(Math.max(state.total, 1));
    elements.range.value = String(state.page);
    elements.prev.disabled = !opened || state.page <= 1;
    elements.next.disabled = !opened || state.page >= state.total;
    elements.range.disabled = !opened || state.total < 2;
    // Cerrar y reemplazar el archivo siguen disponibles durante el OCR.
    elements.close.disabled = !state.pdf || state.exporting;
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
    cancelPinchPreview();
    ++state.revision;
    try { state.renderTask?.cancel(); } catch (_) { /* Se puede cancelar al terminar. */ }
    try { state.textTask?.cancel(); } catch (_) {}
    state.renderTask = null;
    state.textTask = null;
    elements.text.replaceChildren();
    elements.ocrLayer.replaceChildren();
    elements.annotations.replaceChildren();
    elements.redactions.replaceChildren();
    state.viewport = null;
    state.viewportPage = 0;
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
      if (state.pdf && !state.preparing) render({ preserveCenter: true });
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
    ++state.ocrPreparation;
    cancelOcr();
    stopRender();
    const previous = state.pdf;
    state.pdf = null;
    state.page = 1;
    state.total = 0;
    state.zoom = 1;
    state.rotation = 0;
    state.fileName = "";
    state.redactionBoxes.clear();
    state.preparing = false;
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

  // Un único motor OCR por documento. Se procesan todas las páginas una a una,
  // empezando por la visible; así los PDFs grandes no saturan RAM ni bloquean la lectura.
  let ocrScriptPromise = null;
  function loadOcrLibrary() {
    if (window.Tesseract?.createWorker) return Promise.resolve(window.Tesseract);
    if (!ocrScriptPromise) {
      ocrScriptPromise = new Promise((resolve, reject) => {
        const tag = document.createElement("script");
        tag.src = OCR_SCRIPT;
        tag.async = true;
        tag.onload = () => window.Tesseract?.createWorker
          ? resolve(window.Tesseract)
          : reject(new Error("El motor OCR no está disponible."));
        tag.onerror = () => reject(new Error("No se pudo descargar el motor OCR."));
        document.head.appendChild(tag);
      }).catch((error) => { ocrScriptPromise = null; throw error; });
    }
    return ocrScriptPromise;
  }

  function ocrCurrent(job) {
    return !!job && state.ocrJob === job && state.pdf === job.pdf && !job.cancelled;
  }

  function cancelOcr() {
    const job = state.ocrJob;
    state.ocrJob = null;
    if (!job) return;
    job.cancelled = true;
    job.worker?.terminate().catch(() => {});
  }

  function updateOcrProgress(job) {
    if (!ocrCurrent(job) || !state.preparing) return;
    const done = job.pages.size;
    setLoading(job.failed
      ? "No se completó el reconocimiento. Abriendo documento…"
      : `Reconociendo texto… ${done} de ${job.pdf.numPages} páginas`);
  }

  function prioritizeOcr(pageNumber) {
    const job = state.ocrJob;
    if (!ocrCurrent(job) || job.pages.has(pageNumber)) return;
    job.priority = [pageNumber, ...job.priority.filter((n) => n !== pageNumber)];
  }

  // Capa invisible de texto seleccionable alineada con las cajas OCR. Las coordenadas
  // se guardan en puntos PDF: no se pierden al cambiar zoom, ajustar o girar la página.
  function paintOcrText() {
    elements.ocrLayer.replaceChildren();
    if (!state.pdf || !state.viewport || state.viewportPage !== state.page) return;
    const result = settings.ocrEnabled ? state.ocrJob?.pages.get(state.page) : null;
    if (!result?.words?.length) return;
    const viewport = state.viewport;
    const pageWidth = elements.sheet.clientWidth;
    const pageHeight = elements.sheet.clientHeight;
    const sx = pageWidth / viewport.width;
    const sy = pageHeight / viewport.height;
    const delta = ((viewport.rotation - result.rotation) % 360 + 360) % 360;
    elements.ocrLayer.style.width = `${pageWidth}px`;
    elements.ocrLayer.style.height = `${pageHeight}px`;
    // Se omiten palabras duplicadas si PDF.js ya ofrece texto seleccionable.
    const nativeBounds = [...elements.text.querySelectorAll("span")]
      .filter((node) => node.textContent.trim())
      .map((node) => node.getBoundingClientRect());
    const sheetBounds = elements.sheet.getBoundingClientRect();
    const measuring = document.createElement("canvas").getContext("2d");
    const fragment = document.createDocumentFragment();
    for (const word of result.words) {
      const r = viewportRect(viewport, word.box);
      const left = Math.min(r[0], r[2]) * sx;
      const top = Math.min(r[1], r[3]) * sy;
      const width = Math.abs(r[2] - r[0]) * sx;
      const height = Math.abs(r[3] - r[1]) * sy;
      if (width < 2 || height < 2) continue;
      const screen = { left: sheetBounds.left + left, top: sheetBounds.top + top,
        right: sheetBounds.left + left + width, bottom: sheetBounds.top + top + height };
      // Se compara área de intersección, no solo proximidad: un PDF mixto puede
      // combinar párrafos nativos con imágenes escaneadas en una misma página.
      const duplicated = nativeBounds.some((rect) => {
        const w = Math.max(0, Math.min(screen.right, rect.right) - Math.max(screen.left, rect.left));
        const h = Math.max(0, Math.min(screen.bottom, rect.bottom) - Math.max(screen.top, rect.top));
        return w * h > width * height * .48;
      });
      if (duplicated) continue;
      const vertical = delta === 90 || delta === 270;
      const lineLength = vertical ? height : width;
      const letterHeight = Math.max(3, vertical ? width : height);
      const fontSize = Math.max(4, letterHeight * .87);
      const span = document.createElement("span");
      span.className = "pdf-reader-ocr-word";
      span.textContent = word.text + " ";
      span.style.fontSize = `${fontSize}px`;
      span.style.lineHeight = "1";
      measuring.font = `${fontSize}px Arial, sans-serif`;
      const measured = measuring.measureText(word.text + " ").width || lineLength;
      const stretch = clamp(lineLength / measured, .2, 5);
      let x = left;
      let y = top;
      if (delta === 90) x += width;
      if (delta === 180) { x += width; y += height; }
      if (delta === 270) y += height;
      span.style.left = `${x}px`;
      span.style.top = `${y}px`;
      span.style.transform = `rotate(${delta}deg) scaleX(${stretch})`;
      fragment.appendChild(span);
    }
    elements.ocrLayer.appendChild(fragment);
  }

  // Output `blocks` en Tesseract.js 7 (desactivado por defecto). Extraer palabras
  // y convertir píxeles del bitmap de entrada a coordenadas PDF originales.
  function collectOcrWords(data, viewport, width, height) {
    const words = [];
    const blocks = Array.isArray(data.blocks) ? data.blocks : [];
    for (const block of blocks) for (const paragraph of block.paragraphs || [])
      for (const line of paragraph.lines || []) for (const word of line.words || []) {
        const text = String(word.text || "").trim();
        const b = word.bbox;
        if (!text || !b || ![b.x0, b.y0, b.x1, b.y1].every(Number.isFinite)) continue;
        if (b.x1 - b.x0 < 1 || b.y1 - b.y0 < 1) continue;
        // El lienzo puede redondear 1 px las medidas de getViewport.
        const a = viewport.convertToPdfPoint(b.x0 * viewport.width / width, b.y0 * viewport.height / height);
        const z = viewport.convertToPdfPoint(b.x1 * viewport.width / width, b.y1 * viewport.height / height);
        words.push({ text, box: [Math.min(a[0], z[0]), Math.min(a[1], z[1]), Math.max(a[0], z[0]), Math.max(a[1], z[1])] });
      }
    return words;
  }

  async function scanOcrPage(job, number) {
    const page = await job.pdf.getPage(number);
    if (!ocrCurrent(job)) return null;
    const base = page.getViewport({ scale: 1, rotation: page.rotate });
    const scale = Math.min(3.5, 2200 / Math.max(base.width, base.height),
      Math.sqrt(4400000 / (base.width * base.height)));
    const viewport = page.getViewport({ scale, rotation: page.rotate });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    try {
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("No se pudo generar el lienzo OCR.");
      const rendering = page.render({ canvasContext: context, viewport, background: "#ffffff" });
      await rendering.promise;
      if (!ocrCurrent(job)) return null;
      const { data } = await job.worker.recognize(canvas, {}, { blocks: true, text: true });
      if (!ocrCurrent(job)) return null;
      return { rotation: viewport.rotation,
        words: collectOcrWords(data, viewport, canvas.width, canvas.height) };
    } finally {
      canvas.width = canvas.height = 0; // liberar memoria de bitmap tras cada página
      // No limpiar los recursos de PDF.js mientras el visor podría usarlos.
    }
  }

  async function runOcr(job) {
    try {
      const engine = await loadOcrLibrary();
      if (!ocrCurrent(job)) return;
      job.worker = await engine.createWorker(["spa", "eng"], 1, {
        workerPath: OCR_WORKER, corePath: OCR_CORE, langPath: OCR_LANG,
      });
      if (!ocrCurrent(job)) return;
      while (ocrCurrent(job) && job.pages.size < job.pdf.numPages) {
        let number = job.priority.shift();
        while (number && job.pages.has(number)) number = job.priority.shift();
        if (!number) {
          while (job.next <= job.pdf.numPages && job.pages.has(job.next)) ++job.next;
          number = job.next++;
        }
        if (number > job.pdf.numPages) break;
        const recognized = await scanOcrPage(job, number);
        if (!ocrCurrent(job)) return;
        if (recognized) job.pages.set(number, recognized);
        updateOcrProgress(job);
        // La vista permanece oculta hasta completar todas las páginas.
        // Dar al navegador una oportunidad de actualizar el progreso.
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    } catch (error) {
      if (ocrCurrent(job)) {
        job.failed = true;
        console.warn("EmLetter: OCR no disponible", error);
        updateOcrProgress(job);
      }
    } finally {
      const worker = job.worker;
      job.worker = null;
      if (worker) try { await worker.terminate(); } catch (_) {}
    }
  }

  async function beginOcr(pdf) {
    const job = { pdf, cancelled: false, worker: null, failed: false,
      pages: new Map(), priority: [state.page], next: 1 };
    state.ocrJob = job;
    updateOcrProgress(job);
    // No publicar la página hasta terminar el reconocimiento de todo el PDF.
    await runOcr(job);
    return job;
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
        const bounds = viewportRect(viewport, annotation.rect);
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

  async function render({ preserveCenter = false, anchor = null } = {}) {
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
      state.viewportPage = state.page;
      prioritizeOcr(state.page);
      paintRedactions();
      await Promise.allSettled([renderText(page, viewport, renderToken), renderLinks(page, viewport, renderToken)]);
      if (renderToken !== state.revision || state.pdf !== currentPdf) return;
      paintOcrText();
      setStatus(`Página ${state.page} de ${state.total}`);
      requestAnimationFrame(() => {
        if (renderToken !== state.revision) return;
        if (anchor) {
          // Mantener bajo los dedos el mismo punto del documento al finalizar el gesto.
          const scrollRect = elements.scroll.getBoundingClientRect();
          const sheetRect = elements.sheet.getBoundingClientRect();
          const originX = sheetRect.left - scrollRect.left + elements.scroll.scrollLeft;
          const originY = sheetRect.top - scrollRect.top + elements.scroll.scrollTop;
          elements.scroll.scrollLeft = Math.max(0, originX + anchor.x * elements.sheet.clientWidth - (anchor.clientX - scrollRect.left));
          elements.scroll.scrollTop = Math.max(0, originY + anchor.y * elements.sheet.clientHeight - (anchor.clientY - scrollRect.top));
        } else if (preserveCenter) {
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

  // El interruptor puede cambiar mientras se reconoce un documento.
  // Un número de preparación evita que un OCR cancelado vuelva a mostrar una vista vieja.
  async function preparePdfForReading(pdf) {
    if (state.pdf !== pdf) return;
    const loadId = state.loadingRevision;
    const preparationId = ++state.ocrPreparation;
    cancelOcr();
    const needsOcr = settings.ocrEnabled;
    state.preparing = needsOcr;
    elements.scroll.hidden = true;
    if (needsOcr) setLoading("Preparando reconocimiento de texto…");
    updateUI();
    const result = needsOcr ? await beginOcr(pdf) : { failed: false };
    if (loadId !== state.loadingRevision || preparationId !== state.ocrPreparation || state.pdf !== pdf) return;
    state.preparing = false;
    elements.scroll.hidden = false;
    updateUI();
    await render();
    if (loadId !== state.loadingRevision || preparationId !== state.ocrPreparation || state.pdf !== pdf) return;
    if (needsOcr && result.failed) {
      // Advertir sobre un fallo real, sin poner mensajes de OCR en la barra inferior.
      elements.error.textContent = "No se pudo reconocer todo el texto. Puedes leer el PDF y censurar áreas manualmente.";
      elements.error.hidden = false;
      clearTimeout(state.errorTimer);
      state.errorTimer = setTimeout(() => { elements.error.hidden = true; }, 6500);
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
      state.preparing = settings.ocrEnabled;
      state.page = 1;
      state.total = pdf.numPages;
      state.fileName = file.name;
      elements.name.textContent = file.name;
      elements.name.title = file.name;
      elements.detail.textContent = `${state.total} ${state.total === 1 ? "página" : "páginas"} · lectura local`;
      elements.empty.hidden = true;
      elements.scroll.hidden = true;
      elements.settings.open = false;
      updateUI();
      await preparePdfForReading(pdf);
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
    if (!state.pdf || state.preparing) return;
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
    state.redactionMode = !!active && !!state.pdf && !state.preparing && !state.exporting;
    state.drawing = null;
    elements.redactions.classList.toggle("is-active", state.redactionMode);
    elements.redactToggle.setAttribute("aria-pressed", String(state.redactionMode));
    elements.redactToggle.setAttribute("aria-label", state.redactionMode ? "Desactivar lápiz de censura" : "Activar lápiz de censura");
    elements.redactToggle.title = state.redactionMode ? "Desactivar lápiz de censura" : "Activar lápiz de censura";
    elements.redactDownload.hidden = !state.redactionMode;
    if (state.pdf && elements.canvas.width) applyTheme();
    paintRedactions();
    if (state.pdf) setStatus(`Página ${state.page} de ${state.total}`);
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
      const coords = viewportRect(state.viewport, box);
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
  }

  // PDF.js divide el texto en fragmentos: Range permite encontrar la PALABRA bajo
  // el cursor, no bloquear accidentalmente toda la línea del documento.
  function wordUnderPointer(clientX, clientY) {
    for (const span of [...elements.text.querySelectorAll("span"), ...elements.ocrLayer.querySelectorAll("span")]) {
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
    }
  });
  elements.redactions.addEventListener("pointercancel", () => {
    state.drawing = null;
    elements.redactions.querySelector(".pdf-reader-redaction-preview")?.remove();
  });

  // Sustituye los píxeles censurados por nuevos píxeles negros opacos, sin
  // mezclarlos con el contenido que existía previamente. putImageData ignora
  // el color, el alpha, las transformaciones y los filtros del canvas.
  // Se procesa en franjas pequeñas para no reservar otro bitmap de toda la página.
  function destroyRedactedPixels(ctx, left, top, right, bottom) {
    const startX = clamp(left, 0, ctx.canvas.width);
    const startY = clamp(top, 0, ctx.canvas.height);
    const endX = clamp(right, 0, ctx.canvas.width);
    const endY = clamp(bottom, 0, ctx.canvas.height);
    const width = endX - startX;
    const height = endY - startY;
    if (width <= 0 || height <= 0) throw new Error("La zona censurada queda fuera de la página.");
    const rows = Math.min(256, height);
    const black = ctx.createImageData(width, rows);
    // createImageData entrega RGB=0, alpha=0: lo reemplazamos por negro opaco.
    for (let i = 3; i < black.data.length; i += 4) black.data[i] = 255;
    for (let y = 0; y < height; y += rows) {
      ctx.putImageData(black, startX, startY + y, 0, 0, width, Math.min(rows, height - y));
    }
  }

  // La seguridad de la copia no depende de volver a renderizarla con PDF.js.
  // El PDF se crea desde cero y SOLO recibe imágenes rasterizadas, nunca
  // fuentes, texto, anotaciones ni objetos del archivo original. Después se
  // reabre con el mismo serializador para comprobar que la copia es válida.
  // Volver a abrirla en el worker de PDF.js puede fallar por memoria o por la
  // implementación del visor, aunque el PDF ya se haya generado correctamente.
  async function verifySanitizedPdf(bytes, expectedPages, PDFDocument, imageCount, redactionCount) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 100) {
      throw new Error("El PDF generado está vacío o incompleto.");
    }
    const header = new TextDecoder("ascii").decode(bytes.subarray(0, 8));
    if (!header.startsWith("%PDF-")) throw new Error("El archivo generado no es un PDF válido.");
    if (imageCount !== expectedPages || redactionCount < 1) {
      throw new Error("No se incorporaron todas las páginas o las censuras.");
    }
    const check = await PDFDocument.load(bytes, { updateMetadata: false });
    if (check.getPageCount() !== expectedPages) {
      throw new Error("El PDF generado tiene un número de páginas incorrecto.");
    }
    for (const page of check.getPages()) {
      if (!(page.getWidth() > 0 && page.getHeight() > 0)) {
        throw new Error("El PDF generado contiene una página inválida.");
      }
      // pdf-lib no añade anotaciones en ninguna fase de esta exportación.
      const annotations = page.node?.Annots?.();
      if (annotations?.size?.() > 0) {
        throw new Error("Se detectaron anotaciones inesperadas en el PDF generado.");
      }
    }
  }

  async function importPdfLib() {
    if (!state.exportLibPromise) {
      state.exportLibPromise = import("https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm")
        .catch(async (firstError) => {
          console.warn("EmLetter: primera fuente de pdf-lib inaccesible:", firstError);
          return import("https://esm.sh/pdf-lib@1.17.1?bundle");
        }).catch((error) => {
          state.exportLibPromise = null;
          throw error;
        });
    }
    return state.exportLibPromise;
  }

  async function exportRedactedPdf() {
    if (!state.pdf || state.exporting || !hasRedactions()) return;
    const original = state.pdf;
    state.exporting = true;
    updateUI();
    clearError();
    let stage = "cargar el generador de PDF";
    try {
      setLoading("Preparando PDF censurado…");
      const { PDFDocument } = await importPdfLib();
      const result = await PDFDocument.create();
      let imageCount = 0;
      let redactionCount = 0;
      for (let number = 1; number <= state.total; number++) {
        stage = `renderizar la página ${number}`;
        setLoading(`Censurando página ${number} de ${state.total}…`);
        // Dar tiempo al navegador para pintar el progreso antes del siguiente render.
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const page = await original.getPage(number);
        const base = page.getViewport({ scale: 1, rotation: page.rotate });
        // Limitar memoria: cada canvas requiere hasta 4 bytes/píxel, y pdf-lib
        // reserva memoria adicional al incrustar imágenes PNG en el documento.
        const scale = Math.min(2, Math.sqrt(5000000 / (base.width * base.height)));
        const viewport = page.getViewport({ scale, rotation: page.rotate });
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) throw new Error("No se pudo crear el lienzo para exportar.");
        try {
          await page.render({ canvasContext: ctx, viewport, background: "#ffffff" }).promise;
          const boxes = state.redactionBoxes.get(number) || [];
          stage = `aplicar las censuras de la página ${number}`;
          for (const box of boxes) {
            const rect = viewportRect(viewport, box);
            if (!rect.every(Number.isFinite)) throw new Error("Las coordenadas de censura no son válidas.");
            // Margen extra para cubrir el suavizado del texto en los bordes.
            const guard = Math.max(4, Math.ceil(scale * 2));
            const left = Math.floor(Math.min(rect[0], rect[2])) - guard;
            const top = Math.floor(Math.min(rect[1], rect[3])) - guard;
            const right = Math.ceil(Math.max(rect[0], rect[2])) + guard;
            const bottom = Math.ceil(Math.max(rect[1], rect[3])) + guard;
            destroyRedactedPixels(ctx, left, top, right, bottom);
            // Comprobar un píxel dentro de la zona reemplazada, no solo la
            // existencia de la barra superpuesta en el visor.
            const x = Math.max(0, Math.floor(Math.max(left, 0)));
            const y = Math.max(0, Math.floor(Math.max(top, 0)));
            const pixel = ctx.getImageData(x, y, 1, 1).data;
            if (pixel[0] !== 0 || pixel[1] !== 0 || pixel[2] !== 0 || pixel[3] !== 255) {
              throw new Error("No se pudo reemplazar la zona censurada por píxeles negros.");
            }
            redactionCount++;
          }
          // Imagen sin pérdida en las páginas censuradas. El PDF original no se
          // incorpora: la única fuente del documento nuevo es este bitmap.
          stage = `codificar la página ${number}`;
          const imageType = boxes.length ? "image/png" : "image/jpeg";
          const blob = await new Promise((resolve, reject) => canvas.toBlob(
            (value) => value ? resolve(value) : reject(new Error("No se pudo convertir la página a imagen.")),
            imageType, .94,
          ));
          const img = boxes.length
            ? await result.embedPng(await blob.arrayBuffer())
            : await result.embedJpg(await blob.arrayBuffer());
          const output = result.addPage([base.width, base.height]);
          output.drawImage(img, { x: 0, y: 0, width: base.width, height: base.height });
          imageCount++;
        } finally {
          canvas.width = canvas.height = 0;
        }
      }
      stage = "guardar el PDF";
      setLoading("Guardando PDF censurado…");
      const bytes = await result.save({ useObjectStreams: true });
      stage = "validar el PDF exportado";
      setLoading("Verificando el PDF censurado…");
      await verifySanitizedPdf(bytes, state.total, PDFDocument, imageCount, redactionCount);
      stage = "descargar el PDF";
      const objectUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = objectUrl;
      // Evitar revelar datos privados que puedan figurar en el nombre original.
      link.download = "documento-censurado.pdf";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
      setStatus(`Página ${state.page} de ${state.total}`);
    } catch (error) {
      console.error(`EmLetter: error al ${stage}:`, error);
      showError(`No se pudo ${stage}. No se descargó ningún archivo. Revisa la consola para ver el motivo.`);
    } finally {
      state.exporting = false;
      hideLoading();
      updateUI();
    }
  }

  elements.redactToggle.addEventListener("click", () => setRedactionMode(!state.redactionMode));
  elements.redactDownload.addEventListener("click", exportRedactedPdf);

  function setZoom(value, { anchor = null } = {}) {
    if (!state.pdf || state.preparing || state.exporting) return;
    const next = clamp(Math.round(value * 100) / 100, .5, 5);
    if (Math.abs(next - state.zoom) < .005) return;
    state.zoom = next;
    render({ preserveCenter: !anchor, anchor });
  }

  // Zoom táctil con dos dedos: la hoja se escala durante el gesto para que la
  // respuesta sea fluida, pero PDF.js solo vuelve a renderizar al soltar los dedos.
  // Un dedo sigue desplazando la página de forma nativa; no se interceptan clics,
  // selección de texto ni enlaces mientras no haya dos contactos simultáneos.
  function pinchGeometry(touches) {
    const a = touches[0], b = touches[1];
    return {
      distance: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY),
      clientX: (a.clientX + b.clientX) / 2,
      clientY: (a.clientY + b.clientY) / 2,
    };
  }

  function cancelPinchPreview() {
    if (!state.pinch) return;
    state.pinch = null;
    elements.sheet.style.transform = "";
    elements.sheet.style.transformOrigin = "";
    elements.sheet.style.willChange = "";
    elements.zoomReset.textContent = `${Math.round(state.zoom * 100)}%`;
  }

  elements.scroll.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 2 || state.pinch || !state.pdf || state.preparing ||
        state.exporting || !state.viewport || elements.scroll.hidden) return;
    const center = pinchGeometry(event.touches);
    if (center.distance < 8) return;
    const sheet = elements.sheet.getBoundingClientRect();
    if (!sheet.width || !sheet.height) return;
    // Si el lápiz estaba haciendo una marca con el primer dedo, la descartamos:
    // apoyar un segundo dedo significa zoom, nunca una nueva censura.
    if (state.drawing) {
      try { elements.redactions.releasePointerCapture(state.drawing.id); } catch (_) {}
      state.drawing = null;
      elements.redactions.querySelector(".pdf-reader-redaction-preview")?.remove();
    }
    const x = clamp((center.clientX - sheet.left) / sheet.width, 0, 1);
    const y = clamp((center.clientY - sheet.top) / sheet.height, 0, 1);
    state.pinch = {
      startDistance: center.distance,
      startZoom: state.zoom,
      zoom: state.zoom,
      startX: center.clientX,
      startY: center.clientY,
      clientX: center.clientX,
      clientY: center.clientY,
      anchorX: x,
      anchorY: y,
    };
    elements.sheet.style.transformOrigin = `${x * elements.sheet.clientWidth}px ${y * elements.sheet.clientHeight}px`;
    elements.sheet.style.willChange = "transform";
  }, { passive: true });

  elements.scroll.addEventListener("touchmove", (event) => {
    const pinch = state.pinch;
    if (!pinch || event.touches.length < 2) return;
    // Bloquea el zoom de la página web solo durante el pellizco dentro del PDF.
    if (event.cancelable) event.preventDefault();
    const center = pinchGeometry(event.touches);
    const zoom = clamp(pinch.startZoom * center.distance / pinch.startDistance, .5, 5);
    pinch.zoom = zoom;
    pinch.clientX = center.clientX;
    pinch.clientY = center.clientY;
    const dx = center.clientX - pinch.startX;
    const dy = center.clientY - pinch.startY;
    elements.sheet.style.transform = `translate(${dx}px, ${dy}px) scale(${zoom / pinch.startZoom})`;
    elements.zoomReset.textContent = `${Math.round(zoom * 100)}%`;
  }, { passive: false });

  function finishPinch(commit) {
    const pinch = state.pinch;
    if (!pinch) return;
    cancelPinchPreview();
    if (commit && state.pdf && !state.preparing) {
      setZoom(pinch.zoom, {
        anchor: { x: pinch.anchorX, y: pinch.anchorY, clientX: pinch.clientX, clientY: pinch.clientY },
      });
    }
  }

  elements.scroll.addEventListener("touchend", (event) => {
    if (state.pinch && event.touches.length < 2) finishPinch(true);
  }, { passive: true });
  elements.scroll.addEventListener("touchcancel", () => finishPinch(false), { passive: true });
  window.addEventListener("blur", () => finishPinch(false));

  function rotate() {
    if (!state.pdf || state.preparing) return;
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
  elements.ocrEnabled.addEventListener("change", () => {
    settings.ocrEnabled = elements.ocrEnabled.checked;
    saveSettings();
    if (!state.pdf) return;
    // Cambiar la preferencia afecta también al documento abierto. Si el OCR
    // sigue en curso, se cancela y la página aparece con el render estándar.
    preparePdfForReading(state.pdf).catch((error) => {
      console.error("EmLetter: no se pudo actualizar la preferencia OCR", error);
      if (state.pdf) showError("No se pudo actualizar el lector. Intenta abrir de nuevo el PDF.");
    });
  });
  elements.fit.addEventListener("change", () => {
    settings.fit = elements.fit.value;
    saveSettings();
    if (state.pdf && !state.preparing) render({ preserveCenter: false });
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
    if (!state.pdf || state.preparing || event.altKey || event.ctrlKey || event.metaKey ||
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
