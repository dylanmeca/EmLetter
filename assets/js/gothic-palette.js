/* EmLetter · rueda cromática HEX, con acentos góticos y soporte táctil.
   Se conserva cada input de color original (oculto) y sus eventos de la aplicación. */
(() => {
  'use strict';

  const WHEEL_SIZE = 280;
  const moods = [
    ['Obsidiana', '#111722'], ['Vino', '#663044'], ['Carmesí', '#913B49'],
    ['Bosque', '#315A4D'], ['Petróleo', '#315E6C'], ['Medianoche', '#333F79'],
    ['Amatista', '#684A80'], ['Ceniza', '#8B8993'], ['Marfil', '#DDD2C3']
  ];
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const normalizeHex = value => {
    const raw = String(value || '').trim().replace(/^#/, '');
    if (/^[\da-f]{3}$/i.test(raw)) return '#' + [...raw].map(n => n + n).join('').toUpperCase();
    if (/^[\da-f]{6}$/i.test(raw)) return '#' + raw.toUpperCase();
    return null;
  };
  const hexToRgb = value => [1, 3, 5].map(n => parseInt(value.slice(n, n + 2), 16));
  // Hue, saturation and lightness are percentages (except hue, expressed in degrees).
  function hslToRgb(h, s, l) {
    s /= 100;
    l /= 100;
    const a = s * Math.min(l, 1 - l);
    const channel = n => {
      const k = (n + h / 30) % 12;
      return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    return [channel(0), channel(8), channel(4)];
  }
  const hslToHex = (h, s, l) => '#' + hslToRgb(h, s, l).map(n => n.toString(16).padStart(2, '0')).join('').toUpperCase();
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      switch (max) {
        case r: h = ((g - b) / d) % 6; break;
        case g: h = (b - r) / d + 2; break;
        default: h = (r - g) / d + 4;
      }
      h = (h * 60 + 360) % 360;
    }
    return [h, s * 100, l * 100];
  }
  const make = (tag, className, content) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content !== undefined) element.textContent = content;
    return element;
  };

  function init() {
    const inputs = [...document.querySelectorAll('#composer input[type="color"], #atmosphere-dialog input[type="color"]')];
    if (!inputs.length) return;

    const picker = make('dialog', 'gothic-palette-dialog');
    picker.setAttribute('aria-labelledby', 'gothic-palette-title');
    picker.innerHTML = `
      <form id="gothic-palette-form" novalidate>
        <header class="gothic-palette-heading">
          <div><span class="gothic-palette-kicker">EMLETTER · CROMÁTICA</span>
            <h2 id="gothic-palette-title">Círculo cromático</h2>
            <p id="gothic-palette-subtitle"></p></div>
          <button type="button" class="gothic-palette-close" aria-label="Cerrar paleta">×</button>
        </header>
        <div class="gothic-palette-scroll">
          <div class="gothic-wheel-section">
            <div class="gothic-wheel-frame">
              <div class="gothic-wheel-wrap">
                <canvas id="gothic-wheel" width="${WHEEL_SIZE}" height="${WHEEL_SIZE}" tabindex="0"
                  role="slider" aria-label="Círculo cromático: flechas para matiz, Mayús y flechas para intensidad"
                  aria-valuemin="0" aria-valuemax="360" aria-valuenow="0"></canvas>
                <span class="gothic-wheel-marker" aria-hidden="true"></span>
              </div>
            </div>
            <div class="gothic-wheel-note">Elige un color moviéndote por el círculo. Hacia el centro, el tono se vuelve más suave.</div>
          </div>
          <div class="gothic-tone-control">
            <div class="gothic-tone-label"><label for="gothic-palette-lightness">Luminosidad</label><output id="gothic-palette-lightness-value" for="gothic-palette-lightness">35%</output></div>
            <input id="gothic-palette-lightness" type="range" min="0" max="100" step="1" value="35">
            <div class="gothic-tone-extremes"><span>Sombras</span><span>Luz</span></div>
          </div>
          <div class="gothic-moods">
            <p class="gothic-moods-title">Inspiración gótica <span>· tonos sugeridos</span></p>
            <div class="gothic-moods-colors" aria-label="Tonos góticos sugeridos"></div>
          </div>
        </div>
        <div class="gothic-palette-footer">
          <div class="gothic-palette-current">
            <span class="gothic-palette-preview" aria-hidden="true"></span>
            <label for="gothic-palette-hex">Color HEX <small>#RRGGBB</small></label>
            <input id="gothic-palette-hex" type="text" maxlength="7" spellcheck="false" autocomplete="off" autocapitalize="characters" aria-describedby="gothic-palette-error" placeholder="#663044">
          </div>
          <p class="gothic-palette-error" id="gothic-palette-error" role="alert" aria-live="polite"></p>
          <div class="gothic-palette-actions"><button type="button" class="gothic-palette-cancel">Cancelar</button><button type="submit" class="gothic-palette-apply">Aplicar color</button></div>
        </div>
      </form>`;
    document.body.append(picker);

    const canvas = picker.querySelector('#gothic-wheel');
    const ctx = canvas.getContext('2d', {willReadFrequently: false});
    const marker = picker.querySelector('.gothic-wheel-marker');
    const brightness = picker.querySelector('#gothic-palette-lightness');
    const brightnessValue = picker.querySelector('#gothic-palette-lightness-value');
    const inputHex = picker.querySelector('#gothic-palette-hex');
    const colorPreview = picker.querySelector('.gothic-palette-preview');
    const error = picker.querySelector('#gothic-palette-error');
    const subtitle = picker.querySelector('#gothic-palette-subtitle');
    const moodRow = picker.querySelector('.gothic-moods-colors');
    let target = null, returnFocus = null, selected = '#663044';
    let [hue, saturation, lightness] = rgbToHsl(...hexToRgb(selected));
    let drawQueued = false;

    // Every point on the disc is a valid hue/saturation combination.
    // Lightness is controlled separately, so the entire RGB gamut is accessible.
    function drawWheel() {
      drawQueued = false;
      if (!ctx) return;
      const pixels = ctx.createImageData(WHEEL_SIZE, WHEEL_SIZE);
      const data = pixels.data;
      const r = WHEEL_SIZE / 2 - 1;
      const center = WHEEL_SIZE / 2;
      for (let y = 0; y < WHEEL_SIZE; y++) {
        for (let x = 0; x < WHEEL_SIZE; x++) {
          const dx = x + .5 - center, dy = y + .5 - center;
          const distance = Math.hypot(dx, dy);
          if (distance > r) continue;
          const currentHue = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
          const currentSat = Math.min(distance / r, 1) * 100;
          const [red, green, blue] = hslToRgb(currentHue, currentSat, lightness);
          const offset = (y * WHEEL_SIZE + x) * 4;
          data[offset] = red;
          data[offset + 1] = green;
          data[offset + 2] = blue;
          data[offset + 3] = distance > r - 1 ? Math.round(255 * (r - distance)) : 255;
        }
      }
      ctx.putImageData(pixels, 0, 0);
    }
    function scheduleWheelDraw() {
      if (drawQueued) return;
      drawQueued = true;
      requestAnimationFrame(drawWheel);
    }
    function positionMarker() {
      const rad = hue * Math.PI / 180;
      const normalizedRadius = saturation / 100 * 49.5;
      marker.style.left = `${50 + Math.sin(rad) * normalizedRadius}%`;
      marker.style.top = `${50 - Math.cos(rad) * normalizedRadius}%`;
      marker.style.backgroundColor = selected;
      canvas.setAttribute('aria-valuenow', String(Math.round(hue)));
      canvas.setAttribute('aria-valuetext', `Matiz ${Math.round(hue)} grados, intensidad ${Math.round(saturation)} por ciento, ${selected}`);
    }
    function refreshSelection(redraw) {
      selected = hslToHex(hue, saturation, lightness);
      inputHex.value = selected;
      inputHex.removeAttribute('aria-invalid');
      error.textContent = '';
      colorPreview.style.backgroundColor = selected;
      brightness.value = String(Math.round(lightness));
      brightnessValue.textContent = `${Math.round(lightness)}%`;
      brightness.style.background = `linear-gradient(90deg, hsl(${hue} ${saturation}% 0%), hsl(${hue} ${saturation}% 50%), hsl(${hue} ${saturation}% 100%))`;
      positionMarker();
      moodRow.querySelectorAll('button').forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.hex === selected)));
      if (redraw) scheduleWheelDraw();
    }
    function choose(value) {
      const valid = normalizeHex(value);
      if (!valid) return;
      [hue, saturation, lightness] = rgbToHsl(...hexToRgb(valid));
      refreshSelection(true);
      // Preserve exact RGB after HSL conversion, including uncommon HEX values.
      selected = valid;
      inputHex.value = valid;
      colorPreview.style.backgroundColor = valid;
      positionMarker();
      moodRow.querySelectorAll('button').forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.hex === valid)));
    }
    function chooseFromWheel(event) {
      const bounds = canvas.getBoundingClientRect();
      const dx = event.clientX - bounds.left - bounds.width / 2;
      const dy = event.clientY - bounds.top - bounds.height / 2;
      const distance = Math.hypot(dx, dy);
      const radius = Math.min(bounds.width, bounds.height) / 2;
      if (!radius) return;
      hue = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
      saturation = clamp(distance / radius * 100, 0, 100);
      refreshSelection(false);
    }
    canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      canvas.setPointerCapture(event.pointerId);
      chooseFromWheel(event);
    });
    canvas.addEventListener('pointermove', event => {
      if (canvas.hasPointerCapture(event.pointerId)) chooseFromWheel(event);
    });
    canvas.addEventListener('keydown', event => {
      if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const step = event.shiftKey ? 5 : 3;
      const direction = ['ArrowRight', 'ArrowUp'].includes(event.key) ? 1 : -1;
      if (event.shiftKey) saturation = clamp(saturation + step * direction, 0, 100);
      else hue = (hue + step * direction + 360) % 360;
      refreshSelection(false);
    });
    brightness.addEventListener('input', () => {
      lightness = Number(brightness.value);
      refreshSelection(true);
    });
    for (const [name, color] of moods) {
      const button = make('button', 'gothic-mood-swatch');
      button.type = 'button';
      button.title = `${name} · ${color}`;
      button.setAttribute('aria-label', `${name}, ${color}`);
      button.setAttribute('aria-pressed', 'false');
      button.dataset.hex = color;
      button.style.backgroundColor = color;
      button.addEventListener('click', () => choose(color));
      moodRow.append(button);
    }
    function labelOf(colorInput) {
      return colorInput.dataset.gothicLabel || colorInput.getAttribute('aria-label') ||
        colorInput.closest('label')?.textContent?.trim().replace(/\s+/g, ' ') || 'Color de la carta';
    }
    function open(colorInput, trigger) {
      if (picker.open) return;
      target = colorInput;
      returnFocus = trigger;
      subtitle.textContent = labelOf(colorInput);
      choose(colorInput.value || '#A8BCE8');
      picker.showModal();
    }
    function sync(colorInput) {
      const current = normalizeHex(colorInput.value) || '#A8BCE8';
      const trigger = colorInput._gothicTrigger;
      if (!trigger) return;
      trigger.style.setProperty('--gothic-color', current);
      const text = trigger.querySelector('.gothic-color-value');
      if (text) text.textContent = current;
      if (trigger.matches('.tool-color')) trigger.title = `${labelOf(colorInput)}: ${current}`;
      else trigger.setAttribute('aria-label', `Elegir ${labelOf(colorInput)}. Actual: ${current}`);
    }
    for (const colorInput of inputs) {
      // Only the native UI is replaced; the app's pre-existing events are retained.
      const label = colorInput.closest('label');
      colorInput.dataset.gothicLabel = labelOf(colorInput);
      colorInput.type = 'hidden';
      colorInput.classList.add('gothic-color-original');
      colorInput.tabIndex = -1;
      colorInput.setAttribute('aria-hidden', 'true');
      const toolbar = label?.classList.contains('tool-color');
      let trigger;
      if (toolbar) {
        trigger = label;
        trigger.classList.add('gothic-color-tool');
        trigger.setAttribute('role', 'button');
        trigger.setAttribute('aria-haspopup', 'dialog');
        trigger.tabIndex = 0;
        trigger.addEventListener('click', e => { e.preventDefault(); open(colorInput, trigger); });
        trigger.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(colorInput, trigger); }
        });
      } else {
        trigger = make('button', 'gothic-color-trigger');
        trigger.type = 'button';
        trigger.setAttribute('aria-haspopup', 'dialog');
        trigger.innerHTML = '<span class="gothic-color-dot" aria-hidden="true"></span><span class="gothic-color-value"></span><span class="gothic-color-chevron" aria-hidden="true">⌄</span>';
        colorInput.after(trigger);
        trigger.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); open(colorInput, trigger); });
      }
      colorInput._gothicTrigger = trigger;
      colorInput.addEventListener('input', () => sync(colorInput));
      colorInput.addEventListener('change', () => sync(colorInput));
      sync(colorInput);
    }
    picker.querySelector('.gothic-palette-close').addEventListener('click', () => picker.close());
    picker.querySelector('.gothic-palette-cancel').addEventListener('click', () => picker.close());
    picker.addEventListener('close', () => {
      if (picker.open) return;
      returnFocus?.focus({preventScroll: true});
      target = null;
    });
    picker.addEventListener('click', event => { if (event.target === picker) picker.close(); });
    inputHex.addEventListener('input', () => {
      const typed = inputHex.value;
      const valid = normalizeHex(typed);
      if (valid) {
        choose(valid);
        // Do not auto-expand #ABC in the middle of typing #AABBCC.
        inputHex.value = typed;
      } else {
        inputHex.removeAttribute('aria-invalid');
        error.textContent = '';
      }
    });
    picker.querySelector('form').addEventListener('submit', e => {
      e.preventDefault();
      const value = normalizeHex(inputHex.value);
      if (!value || !target) {
        inputHex.setAttribute('aria-invalid', 'true');
        error.textContent = 'Escribe un HEX válido, por ejemplo #663044 o #638.';
        inputHex.focus();
        return;
      }
      target.value = value.toLowerCase();
      target.dispatchEvent(new Event('input', {bubbles: true}));
      target.dispatchEvent(new Event('change', {bubbles: true}));
      sync(target);
      picker.close();
    });
    // Existing style/atmosphere presets may change values without input events.
    let queued = false;
    const updateAll = () => { queued = false; inputs.forEach(sync); };
    new MutationObserver(() => {
      if (!queued) { queued = true; requestAnimationFrame(updateAll); }
    }).observe(document.documentElement, {attributes: true, attributeFilter: ['style']});
    const atmosphereDialog = document.getElementById('atmosphere-dialog');
    if (atmosphereDialog) {
      new MutationObserver(() => requestAnimationFrame(updateAll))
        .observe(atmosphereDialog, {attributes: true, attributeFilter: ['open']});
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true});
  else init();
})();
