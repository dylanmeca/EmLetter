/* EmLetter Chat · PeerJS, historial por sesión, archivos en IndexedDB y WebRTC. */
(() => {
  'use strict';

  const KEY_ID = 'emletter.chat.id.v1';
  const KEY_HISTORY = 'emletter.chat.histories.v1';
  const KEY_LAST_PEER = 'emletter.chat.last-peer.v1';
  const CHUNK_BYTES = 16 * 1024; // Seguro para canales de datos WebRTC entre navegadores.
  const CHUNKS_PER_BATCH = 64; // Ventana de 1 MiB con confirmación tras persistir en IndexedDB.
  const MAX_BUFFERED_BYTES = 2 * 1024 * 1024;
  const INLINE_PREVIEW_BYTES = 128 * 1024 * 1024;
  const BLOB_DOWNLOAD_BYTES = 256 * 1024 * 1024;
  const DB_NAME = 'emletter-chat-files';
  const DB_VERSION = 1;
  const MAX_TEXT = 4000;
  const MAX_MESSAGES_PER_CHAT = 150;
  const MAX_CHATS = 10;
  const $ = (id) => document.getElementById(id);
  const ui = {
    ownId: $('chat-my-id'), copy: $('chat-copy-id'), connectForm: $('chat-connect-form'),
    peerId: $('chat-peer-id'), connectButton: $('chat-connect-button'), person: $('chat-person'),
    connectionStatus: $('chat-connection-status'), online: $('chat-online-indicator'),
    messages: $('chat-messages'), empty: $('chat-empty'), typing: $('chat-typing'),
    form: $('chat-message-form'), text: $('chat-text'), send: $('chat-send'),
    files: $('chat-files'), attach: document.querySelector('.chat-attach'), status: $('chat-status')
  };
  if (!ui.ownId || !ui.messages) return;

  function sessionGet(key) { try { return sessionStorage.getItem(key); } catch (_) { return null; } }
  function sessionSet(key, value) { try { sessionStorage.setItem(key, value); return true; } catch (_) { return false; } }
  function isFiveDigits(id) { return /^\d{5}$/.test(String(id || '')); }
  function makeFiveDigits() {
    const random = new Uint32Array(1);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(random);
    else random[0] = Math.floor(Math.random() * 4294967295);
    return String(10000 + random[0] % 90000);
  }
  function messageId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
  function validMessageId(id) { return typeof id === 'string' && /^[a-zA-Z0-9_-]{8,60}$/.test(id); }
  function validTime(time) { return Number.isFinite(time) && time > 0 && time < Date.now() + 86400000; }
  function fmtTime(timestamp) {
    try { return new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' }).format(timestamp); }
    catch (_) { return new Date(timestamp).toLocaleTimeString(); }
  }
  function fmtDay(timestamp) {
    try { return new Intl.DateTimeFormat('es', { dateStyle: 'medium' }).format(timestamp); }
    catch (_) { return new Date(timestamp).toLocaleDateString(); }
  }
  function fmtBytes(size) {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    if (size < 1024 ** 3) return `${(size / 1024 / 1024).toFixed(1)} MB`;
    return `${(size / 1024 ** 3).toFixed(2)} GB`;
  }
  function setStatus(message) { ui.status.textContent = message; }
  function setConnectionStatus(message, online = false) {
    ui.connectionStatus.textContent = message;
    ui.online.classList.toggle('is-online', online);
    ui.online.setAttribute('aria-label', online ? 'Conectado' : 'Sin conexión');
    ui.send.disabled = !online;
    ui.text.disabled = !online;
    ui.files.disabled = !online;
    ui.attach.classList.toggle('is-disabled', !online);
    ui.copy.disabled = !peerReady;
    ui.connectButton.textContent = online ? 'Desconectar' : 'Conectar';
    ui.connectButton.classList.toggle('is-disconnect', online);
    ui.connectButton.setAttribute('aria-label', online ? 'Desconectar a ambas personas' : 'Conectar con el ID del par');
    ui.peerId.readOnly = online;
  }

  function loadHistories() {
    try {
      const parsed = JSON.parse(sessionGet(KEY_HISTORY) || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const clean = {};
      for (const [peerId, messages] of Object.entries(parsed).slice(-MAX_CHATS)) {
        if (!isFiveDigits(peerId) || !Array.isArray(messages)) continue;
        clean[peerId] = messages.slice(-MAX_MESSAGES_PER_CHAT).filter((entry) =>
          entry && validMessageId(entry.id) && ['text', 'file'].includes(entry.kind) &&
          ['in', 'out'].includes(entry.direction) && validTime(entry.time)
        ).map((entry) => ({
          id: entry.id, kind: entry.kind, direction: entry.direction, time: entry.time,
          text: typeof entry.text === 'string' ? entry.text.slice(0, MAX_TEXT) : '',
          name: typeof entry.name === 'string' ? entry.name.slice(0, 180) : '',
          mime: typeof entry.mime === 'string' ? entry.mime.slice(0, 100) : '',
          size: Number.isFinite(entry.size) ? entry.size : 0,
          status: ['sending', 'sent', 'delivered', 'failed'].includes(entry.status) ? entry.status : 'sent',
          dataUrl: typeof entry.dataUrl === 'string' && entry.dataUrl.length <= 500000 ? entry.dataUrl : '',
          // Una transferencia interrumpida no sigue enviándose al recargar.
          ...(entry.status === 'sending' ? { status: 'failed' } : {})
        }));
      }
      return clean;
    } catch (_) { return {}; }
  }

  let histories = loadHistories();
  let activePeerId = isFiveDigits(sessionGet(KEY_LAST_PEER)) ? sessionGet(KEY_LAST_PEER) : '';
  let localId = isFiveDigits(sessionGet(KEY_ID)) ? sessionGet(KEY_ID) : makeFiveDigits();
  let peer = null;
  let connection = null;
  let peerReady = false;
  let connectingTimeout = null;
  let typingTimeout = null;
  let remoteTypingTimeout = null;
  let lastTypingSent = 0;
  let retrySignaling = null;
  const incomingFiles = new Map();
  const outgoingFiles = new Map();
  const objectUrls = new Set();
  const previewLoading = new Set();
  let dbPromise = null;

  function getDB() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB no disponible'));
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks', { keyPath: ['id', 'index'] });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => reject(request.error || new Error('Error al abrir IndexedDB'));
      request.onblocked = () => reject(new Error('IndexedDB bloqueada por otra pestaña'));
    }).catch((error) => { dbPromise = null; throw error; });
    return dbPromise;
  }
  async function readStoredFile(id) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction('files', 'readonly').objectStore('files').get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }
  async function saveStoredFile(info) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').put(info);
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || new Error('No hay espacio en IndexedDB'));
      tx.onerror = () => reject(tx.error);
    });
  }
  async function discardIncompleteFile(id) {
    try {
      const db = await getDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(['files', 'chunks'], 'readwrite');
        tx.objectStore('files').delete(id);
        tx.objectStore('chunks').delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch (_) { /* Se liberará espacio cuando el navegador purgue sus datos. */ }
  }
  async function saveChunkBatch(id, chunks) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('chunks', 'readwrite');
      const store = tx.objectStore('chunks');
      for (const chunk of chunks) store.put({ id, index: chunk.index, data: chunk.data });
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || new Error('Error de cuota / almacenamiento'));
      tx.onerror = () => reject(tx.error);
    });
  }
  // Recupera la vista previa en lotes de tamaño limitado.
  async function storedChunksAsBlob(id, mime, count) {
    const parts = [];
    const db = await getDB();
    for (let first = 0; first < count; first += 128) {
      const last = Math.min(count, first + 128);
      const batch = await new Promise((resolve, reject) => {
        const tx = db.transaction('chunks', 'readonly');
        const store = tx.objectStore('chunks');
        const result = new Array(last - first);
        for (let n = first; n < last; n++) {
          const req = store.get([id, n]);
          req.onsuccess = () => { result[n-first] = req.result?.data; };
        }
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
      });
      if (batch.some((part) => !(part instanceof ArrayBuffer) && !ArrayBuffer.isView(part))) {
        throw new Error('El archivo guardado está incompleto');
      }
      parts.push(...batch);
    }
    return new Blob(parts, { type: mime || 'application/octet-stream' });
  }
  async function downloadStoredFile(message) {
    try {
      // El selector exige activación del usuario: solicitarlo ANTES de hacer cualquier await.
      const needsStreaming = message.direction === 'in' && message.size > BLOB_DOWNLOAD_BYTES;
      const pickerPromise = needsStreaming && typeof window.showSaveFilePicker === 'function'
        ? window.showSaveFilePicker({ suggestedName: message.name || 'archivo' }) : null;
      const record = await readStoredFile(message.id);
      if (!record || !record.complete) throw new Error('Archivo no disponible en este navegador');
      if (record.blob) {
        const url = trackObjectUrl(record.blob);
        const a = document.createElement('a'); a.href = url; a.download = message.name || 'archivo';
        document.body.append(a); a.click(); a.remove();
        return;
      }
      if (pickerPromise) {
        // Streaming sin ensamblar gigabytes en un único Blob; requiere contexto seguro.
        const handle = await pickerPromise;
        const writer = await handle.createWritable();
        try {
          const db = await getDB();
          for (let i = 0; i < record.total; i += 128) {
            const end = Math.min(record.total, i + 128);
            const batch = await new Promise((resolve, reject) => {
              const tx = db.transaction('chunks', 'readonly');
              const store = tx.objectStore('chunks');
              const parts = new Array(end - i);
              for (let n = i; n < end; n++) {
                const req = store.get([message.id, n]);
                req.onsuccess = () => { parts[n-i] = req.result?.data; };
              }
              tx.oncomplete = () => resolve(parts);
              tx.onerror = () => reject(tx.error);
            });
            if (batch.some((part) => !part)) throw new Error('Archivo incompleto en IndexedDB');
            await writer.write(new Blob(batch));
          }
          await writer.close();
        } catch (error) { await writer.abort().catch(() => {}); throw error; }
      } else if (record.size <= BLOB_DOWNLOAD_BYTES) {
        const blob = await storedChunksAsBlob(message.id, record.mime, record.total);
        const url = trackObjectUrl(blob);
        const a = document.createElement('a'); a.href = url; a.download = message.name || 'archivo';
        document.body.append(a); a.click(); a.remove();
      } else {
        throw new Error('Para guardar este archivo grande utiliza Chrome o Edge en HTTPS, que permiten escritura directa al disco.');
      }
    } catch (error) {
      if (error?.name !== 'AbortError') setStatus(error.message || 'No se pudo recuperar el archivo.');
    }
  }
  async function loadFilePreview(message) {
    if (message.objectUrl || message.dataUrl || message.previewResolved ||
        previewLoading.has(message.id) || message.storageMissing) return;
    previewLoading.add(message.id);
    try {
      const file = await readStoredFile(message.id);
      if (!file?.complete) { message.storageMissing = true; return; }
      message.stored = true;
      message.previewResolved = true;
      if (file.blob) {
        message.objectUrl = trackObjectUrl(file.blob);
      } else if (file.size <= INLINE_PREVIEW_BYTES &&
          (allowedImage(file.mime) || allowedVideo(file.mime) || allowedAudio(file.mime))) {
        message.objectUrl = trackObjectUrl(await storedChunksAsBlob(message.id, file.mime, file.total));
      }
    } catch (_) { message.storageMissing = true; }
    finally {
      previewLoading.delete(message.id);
      if (activePeerId && histories[activePeerId]?.includes(message)) refreshFileContent(message);
    }
  }

  function saveHistories() {
    const serializable = {};
    for (const [id, entries] of Object.entries(histories).slice(-MAX_CHATS)) {
      serializable[id] = entries.slice(-MAX_MESSAGES_PER_CHAT).map((item) => ({
        id: item.id, kind: item.kind, direction: item.direction, time: item.time,
        ...(item.text ? { text: item.text } : {}),
        ...(item.name ? { name: item.name } : {}),
        ...(item.mime ? { mime: item.mime } : {}),
        ...(Number.isFinite(item.size) ? { size: item.size } : {}),
        status: item.status,
        ...(item.dataUrl ? { dataUrl: item.dataUrl } : {})
      }));
    }
    if (sessionSet(KEY_HISTORY, JSON.stringify(serializable))) return;
    // Primero descartamos solo los datos binarios; nunca el historial textual.
    for (const entries of Object.values(serializable)) {
      for (const item of entries) {
        if (!item.dataUrl) continue;
        delete item.dataUrl;
        const original = histories[Object.keys(serializable).find((id) => serializable[id] === entries)]?.find((m) => m.id === item.id);
        if (original) original.dataUrl = '';
        if (sessionSet(KEY_HISTORY, JSON.stringify(serializable))) { setStatus('Historial guardado. Los adjuntos nuevos se conservan en IndexedDB.'); return; }
      }
    }
    // Cuota extraordinariamente baja: conservar mensajes recientes en vez de fallar.
    for (let i = 0; i < 300; i++) {
      const oldest = Object.entries(serializable).find(([, entries]) => entries.length > 0);
      if (!oldest) break;
      oldest[1].shift();
      if (sessionSet(KEY_HISTORY, JSON.stringify(serializable))) {
        setStatus('El almacenamiento de sesión estaba lleno; se conservaron los mensajes más recientes.');
        return;
      }
    }
  }
  function chatHistory() {
    if (!activePeerId) return [];
    if (!histories[activePeerId]) histories[activePeerId] = [];
    return histories[activePeerId];
  }
  function getMessage(id) { return chatHistory().find((message) => message.id === id); }
  function updateMessageInChat(peerId, id, updates) {
    const msg = histories[peerId]?.find((entry) => entry.id === id);
    if (!msg) return;
    Object.assign(msg, updates);
    saveHistories();
    if (activePeerId === peerId) patchMessageInView(msg);
  }
  function addMessage(message) {
    const list = chatHistory();
    if (list.some((item) => item.id === message.id)) return;
    const previous = list[list.length - 1];
    list.push(message);
    const trimmed = list.length > MAX_MESSAGES_PER_CHAT;
    if (trimmed) list.splice(0, list.length - MAX_MESSAGES_PER_CHAT);
    saveHistories();
    // Al llegar un mensaje nuevo, se añade solo la nueva burbuja. Las anteriores
    // (incluidos los reproductores multimedia) no se recrean ni se desplazan.
    if (trimmed) render();
    else appendMessageToView(message, previous);
  }
  function updateMessage(id, updates) {
    const msg = getMessage(id);
    if (msg) { Object.assign(msg, updates); saveHistories(); patchMessageInView(msg); }
  }
  function setChatPartner(id) {
    if (!isFiveDigits(id)) return;
    if (activePeerId !== id) {
      activePeerId = id;
      sessionSet(KEY_LAST_PEER, id);
      ui.peerId.value = id;
      ui.person.textContent = `Conversación con ${id}`;
      hideTyping();
      render();
    } else {
      ui.person.textContent = `Conversación con ${id}`;
      ui.peerId.value = id;
    }
  }
  function el(tag, className, text) {
    const elem = document.createElement(tag);
    if (className) elem.className = className;
    if (text !== undefined) elem.textContent = text;
    return elem;
  }
  function allowedImage(mime) { return /^(image\/(png|jpeg|gif|webp|avif|bmp))$/i.test(mime); }
  function allowedVideo(mime) { return /^(video\/(mp4|webm|ogg|quicktime))$/i.test(mime); }
  function allowedAudio(mime) { return /^(audio\/(mpeg|mp4|ogg|wav|webm|aac|flac|x-wav))$/i.test(mime); }
  function fileUrl(message) {
    if (message.objectUrl) return message.objectUrl;
    if (message.dataUrl && /^data:[^,]{1,140};base64,/.test(message.dataUrl)) return message.dataUrl;
    return '';
  }
  function addFileContent(bubble, message) {
    const wrapper = el('div', 'chat-file');
    const url = fileUrl(message);
    const type = message.mime || '';
    if (url && allowedImage(type)) {
      const image = el('img', 'chat-file-image');
      image.src = url; image.alt = message.name || 'Imagen enviada'; image.loading = 'lazy';
      wrapper.append(image);
    } else if (url && allowedVideo(type)) {
      const video = el('video', 'chat-file-video');
      video.src = url; video.controls = true; video.preload = 'metadata';
      wrapper.append(video);
    } else if (url && allowedAudio(type)) {
      const audio = el('audio', 'chat-file-audio');
      audio.src = url; audio.controls = true; audio.preload = 'metadata';
      wrapper.append(audio);
    }
    const link = el(url && !message.stored ? 'a' : 'button', 'chat-file-link');
    if (link.tagName === 'A') {
      link.href = url; link.download = message.name || 'archivo';
    } else {
      link.type = 'button';
      link.addEventListener('click', () => downloadStoredFile(message));
      if (!message.stored && !url) link.disabled = true;
    }
    link.append(el('span', 'chat-file-icon', '⇩'));
    const details = el('span', 'chat-file-details');
    details.append(el('span', 'chat-file-name', message.name || 'Archivo'));
    const extension = String(message.name || '').split('.').pop();
    const label = extension && extension !== message.name ? extension.toUpperCase() : (type.split('/')[1] || 'ARCHIVO').toUpperCase();
    details.append(el('span', 'chat-file-type', `${label} · ${fmtBytes(message.size || 0)}`));
    link.append(details);
    wrapper.append(link);
    if (!url && message.status !== 'sending' && !message.stored) {
      wrapper.append(el('div', 'chat-file-unavailable', message.storageMissing ?
        'Este archivo no está disponible en este navegador.' : 'Buscando archivo en IndexedDB…'));
    }
    if (!url && message.stored && message.size > INLINE_PREVIEW_BYTES &&
        (allowedVideo(type) || allowedAudio(type) || allowedImage(type))) {
      wrapper.append(el('div', 'chat-file-unavailable', 'Archivo grande: disponible para guardar, sin vista previa en memoria.'));
    }
    if (message.status === 'sending') wrapper.append(el('div', 'chat-file-progress', message.progress || 'Transfiriendo archivo…'));
    bubble.append(wrapper);
    if (message.status !== 'sending' && !url && !message.storageMissing) void loadFilePreview(message);
  }
  function messageRow(msg) {
    const row = el('div', `chat-message ${msg.direction === 'out' ? 'outgoing' : 'incoming'}`);
    row.dataset.messageId = msg.id;
    const bubble = el('div', 'chat-bubble');
    if (msg.kind === 'text') bubble.append(el('div', 'chat-text', msg.text));
    else addFileContent(bubble, msg);
    const meta = el('div', 'chat-metadata');
    const clock = el('time', '', fmtTime(msg.time));
    clock.dateTime = new Date(msg.time).toISOString();
    meta.append(clock);
    if (msg.direction === 'out') {
      const mark = el('span', 'chat-checks');
      meta.append(mark);
      setMessageMark(mark, msg.status);
    }
    bubble.append(meta);
    row.append(bubble);
    return row;
  }
  function setMessageMark(mark, status) {
    const description = status === 'delivered' ? 'Recibido' : status === 'sent' ? 'Enviado' :
      status === 'failed' ? 'No enviado' : 'Enviando';
    mark.textContent = status === 'delivered' ? '✓✓' : status === 'sent' ? '✓' :
      status === 'failed' ? '!' : '○';
    mark.className = `chat-checks${status === 'delivered' ? ' is-delivered' : ''}${status === 'failed' ? ' is-failed' : ''}`;
    mark.title = description;
    mark.setAttribute('aria-label', description);
  }
  function rowForMessage(id) {
    return Array.from(ui.messages.children).find((child) => child.dataset.messageId === id) || null;
  }
  function refreshFileContent(message) {
    const row = rowForMessage(message.id);
    const bubble = row?.querySelector('.chat-bubble');
    if (!bubble || message.kind !== 'file') return;
    const current = bubble.querySelector('.chat-file');
    // Solo se recrea el adjunto que terminó: no se interrumpen otros videos,
    // audios ni la posición de desplazamiento de la conversación.
    const holder = document.createElement('div');
    addFileContent(holder, message);
    if (current) current.replaceWith(holder.firstElementChild);
    else bubble.prepend(holder.firstElementChild);
  }
  function patchMessageInView(message) {
    const row = rowForMessage(message.id);
    if (!row) return;
    if (message.direction === 'out') {
      const mark = row.querySelector('.chat-checks');
      if (mark) setMessageMark(mark, message.status);
    }
    if (message.kind !== 'file') return;
    const progress = row.querySelector('.chat-file-progress');
    if (message.status === 'sending') {
      if (progress) {
        // El cambio del porcentaje modifica solo este texto, sin reanimar las
        // burbujas ni forzar el scroll después de cada lote recibido.
        const nextText = message.progress || 'Transfiriendo archivo…';
        if (progress.textContent !== nextText) progress.textContent = nextText;
      } else refreshFileContent(message);
    } else {
      if (progress) refreshFileContent(message);
      else if (message.stored || message.objectUrl || message.storageMissing) {
        // En cambios posteriores (por ejemplo, IndexedDB listo), se actualiza
        // únicamente la tarjeta de este archivo.
        refreshFileContent(message);
      }
    }
  }
  function nearBottom() {
    return ui.messages.scrollHeight - ui.messages.scrollTop - ui.messages.clientHeight < 85;
  }
  function appendMessageToView(message, previous) {
    const shouldScroll = message.direction === 'out' || nearBottom();
    if (ui.empty.parentNode === ui.messages) ui.empty.remove();
    if (!previous || new Date(previous.time).toDateString() !== new Date(message.time).toDateString()) {
      ui.messages.append(el('div', 'chat-day-divider', fmtDay(message.time)));
    }
    ui.messages.append(messageRow(message));
    if (shouldScroll) ui.messages.scrollTop = ui.messages.scrollHeight;
  }
  function render() {
    const wasNearBottom = nearBottom();
    const previousScroll = ui.messages.scrollTop;
    ui.messages.replaceChildren();
    const list = chatHistory();
    if (!list.length) {
      ui.messages.append(ui.empty);
      ui.empty.hidden = false;
      return;
    }
    let day = '';
    for (const msg of list) {
      const date = new Date(msg.time).toDateString();
      if (day !== date) {
        day = date;
        ui.messages.append(el('div', 'chat-day-divider', fmtDay(msg.time)));
      }
      ui.messages.append(messageRow(msg));
    }
    // Solo al reconstruir una conversación o cargar el historial se reposiciona.
    if (wasNearBottom) ui.messages.scrollTop = ui.messages.scrollHeight;
    else ui.messages.scrollTop = previousScroll;
  }
  function online() { return !!(connection && connection.open); }
  function safeSend(payload) {
    if (!online()) return false;
    try { connection.send(payload); return true; }
    catch (_) { return false; }
  }
  function hideTyping() {
    clearTimeout(remoteTypingTimeout);
    ui.typing.hidden = true;
  }
  function showTyping() {
    ui.typing.hidden = false;
    clearTimeout(remoteTypingTimeout);
    remoteTypingTimeout = setTimeout(hideTyping, 2200);
  }
  function stopLocalTyping() {
    clearTimeout(typingTimeout);
    safeSend({ kind: 'typing', active: false });
    lastTypingSent = 0;
  }
  function onWriting() {
    ui.text.style.height = 'auto';
    ui.text.style.height = `${Math.min(ui.text.scrollHeight, 128)}px`;
    if (!online()) return;
    const now = Date.now();
    if (now - lastTypingSent > 900) {
      safeSend({ kind: 'typing', active: true });
      lastTypingSent = now;
    }
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(stopLocalTyping, 1400);
  }
  function sendText() {
    if (!online()) { setStatus('Conecta con alguien antes de enviar.'); return; }
    const text = ui.text.value.trim();
    if (!text) return;
    const id = messageId();
    const time = Date.now();
    ui.text.value = '';
    ui.text.style.height = 'auto';
    stopLocalTyping();
    addMessage({ id, kind: 'text', direction: 'out', text, time, status: 'sending' });
    if (safeSend({ kind: 'text', id, text, time })) updateMessage(id, { status: 'sent' });
    else { updateMessage(id, { status: 'failed' }); setStatus('No se pudo enviar el mensaje.'); }
  }
  function trackObjectUrl(blob) {
    const url = URL.createObjectURL(blob);
    objectUrls.add(url);
    return url;
  }
  async function sendFile(file) {
    if (!online()) { setStatus('Primero conecta con la otra persona.'); return; }
    const id = messageId();
    const recipient = activePeerId;
    const initialConnection = connection;
    const name = (file.name || 'archivo').slice(0, 180);
    const mime = (file.type || 'application/octet-stream').slice(0, 100);
    const time = Date.now();
    const total = Math.ceil(file.size / CHUNK_BYTES);
    if (!Number.isSafeInteger(file.size) || !Number.isSafeInteger(total)) {
      setStatus('Este archivo es demasiado grande para los límites numéricos del navegador.'); return;
    }
    const url = trackObjectUrl(file);
    addMessage({ id, kind: 'file', direction: 'out', name, mime, size: file.size,
      time, status: 'sending', objectUrl: url, progress: 'Preparando archivo…' });
    // Guardar en segundo plano, sin bloquear el envío. El Blob queda en IndexedDB.
    saveStoredFile({ id, peerId: recipient, name, mime, size: file.size,
      time, total, complete: true, blob: file }).then(() => {
      updateMessageInChat(recipient, id, { stored: true });
    }).catch(() => setStatus('Archivo enviado, pero no hay espacio para conservar una copia local.'));
    if (!online() || initialConnection !== connection || recipient !== activePeerId) {
      updateMessageInChat(recipient, id, { status: 'failed' }); return;
    }
    outgoingFiles.set(id, { id, file, next: 0, confirmed: 0, total, connection: initialConnection,
      peerId: recipient, sending: false, waiting: false, lastActivity: Date.now() });
    if (!safeSend({ kind: 'file-meta', id, name, mime, size: file.size, time, total })) {
      outgoingFiles.delete(id);
      updateMessageInChat(recipient, id, { status: 'failed' });
      setStatus('No se pudo iniciar la transferencia.');
      return;
    }
    updateMessageInChat(recipient, id, { progress: 'Esperando al destinatario…' });
  }
  async function sendFileWindow(id) {
    const transfer = outgoingFiles.get(id);
    if (!transfer || transfer.sending || transfer.waiting || !online() || transfer.connection !== connection) return;
    transfer.sending = true;
    try {
      const end = Math.min(transfer.next + CHUNKS_PER_BATCH, transfer.total);
      if (end === transfer.next) return;
      const startByte = transfer.next * CHUNK_BYTES;
      const block = await transfer.file.slice(startByte, end * CHUNK_BYTES).arrayBuffer();
      if (connection !== transfer.connection || !online()) throw new Error('Se perdió la conexión');
      for (let i = transfer.next; i < end; i++) {
        // Reduce picos del búfer del canal, especialmente en redes móviles.
        while (connection?.dataChannel && connection.dataChannel.bufferedAmount > MAX_BUFFERED_BYTES) {
          await new Promise((resolve) => setTimeout(resolve, 12));
          if (connection !== transfer.connection || !online()) throw new Error('Desconectado');
        }
        const from = (i - transfer.next) * CHUNK_BYTES;
        if (!safeSend({ kind: 'file-chunk', id, index: i, data: block.slice(from, from + CHUNK_BYTES) })) {
          throw new Error('No se pudo enviar un bloque');
        }
        // Cede el hilo cada 256 KB para que el compositor y los mensajes de texto
        // sigan respondiendo mientras se transfieren archivos voluminosos.
        if ((i - transfer.next + 1) % 16 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (connection !== transfer.connection || !online()) throw new Error('Desconectado');
        }
      }
      transfer.next = end;
      transfer.waiting = true;
      transfer.lastActivity = Date.now();
      updateMessageInChat(transfer.peerId, id, { progress: `Enviando… ${Math.round(100 * transfer.confirmed / (transfer.total || 1))}%` });
    } catch (_) {
      outgoingFiles.delete(id);
      updateMessageInChat(transfer.peerId, id, { status: 'failed', progress: '' });
      setStatus('La transferencia se interrumpió.');
    } finally { transfer.sending = false; }
  }
  async function handleFileMeta(packet) {
    if (!validMessageId(packet.id) || typeof packet.name !== 'string' || packet.name.length > 180 ||
        typeof packet.mime !== 'string' || packet.mime.length > 100 ||
        !Number.isSafeInteger(packet.size) || packet.size < 0 ||
        !Number.isSafeInteger(packet.total) || packet.total !== Math.ceil(packet.size / CHUNK_BYTES) ||
        !validTime(packet.time)) return;
    if (getMessage(packet.id)) { safeSend({ kind: 'ack', id: packet.id }); return; }
    if (incomingFiles.has(packet.id)) return;
    const bound = connection;
    const transfer = { id: packet.id, name: packet.name, mime: packet.mime, size: packet.size,
      time: packet.time, total: packet.total, next: 0, received: 0, pending: [], writing: false,
      connection: bound, peerId: activePeerId };
    incomingFiles.set(packet.id, transfer);
    try {
      if (window.navigator?.storage?.estimate) {
        const estimate = await window.navigator.storage.estimate();
        if (Number.isFinite(estimate.quota) && Number.isFinite(estimate.usage) &&
            transfer.size > Math.max(0, estimate.quota - estimate.usage - 4 * 1024 * 1024)) {
          throw new Error('Espacio disponible insuficiente para este archivo');
        }
      }
      await saveStoredFile({ id: transfer.id, peerId: transfer.peerId, name: transfer.name,
        mime: transfer.mime, size: transfer.size, time: transfer.time, total: transfer.total, complete: false });
      if (connection !== bound || incomingFiles.get(packet.id) !== transfer) return;
      // Mostrar el avance también en el lado receptor.
      addMessage({ id: transfer.id, kind: 'file', direction: 'in', name: transfer.name,
        mime: transfer.mime, size: transfer.size, time: transfer.time,
        status: 'sending', progress: 'Recibiendo… 0%' });
      if (transfer.total === 0) await finishIncomingFile(packet.id);
      else safeSend({ kind: 'file-ready', id: packet.id });
    } catch (_) {
      incomingFiles.delete(packet.id);
      void discardIncompleteFile(packet.id);
      safeSend({ kind: 'file-error', id: packet.id });
      setStatus('No se pudo guardar el archivo: IndexedDB no está disponible o no tiene espacio.');
    }
  }
  async function finishIncomingFile(id) {
    const transfer = incomingFiles.get(id);
    if (!transfer || transfer.received !== transfer.size || transfer.next !== transfer.total) return;
    try {
      await saveStoredFile({ id, peerId: transfer.peerId, name: transfer.name,
        mime: transfer.mime, size: transfer.size, time: transfer.time,
        total: transfer.total, complete: true });
      if (incomingFiles.get(id) !== transfer || connection !== transfer.connection) return;
      incomingFiles.delete(id);
      updateMessageInChat(transfer.peerId, id, { status: 'delivered', stored: true, progress: '' });
      safeSend({ kind: 'ack', id });
      setStatus(`Archivo recibido: ${transfer.name}`);
    } catch (_) {
      incomingFiles.delete(id);
      void discardIncompleteFile(id);
      updateMessageInChat(transfer.peerId, id, { status: 'failed', progress: '' });
      safeSend({ kind: 'file-error', id });
      setStatus('No se pudo finalizar el archivo en IndexedDB.');
    }
  }
  async function flushFileBatch(transfer) {
    if (transfer.writing) return;
    transfer.writing = true;
    const batch = transfer.pending.splice(0);
    try {
      await saveChunkBatch(transfer.id, batch);
      if (incomingFiles.get(transfer.id) !== transfer || connection !== transfer.connection) return;
      if (transfer.next === transfer.total) {
        await finishIncomingFile(transfer.id);
      } else {
        const percent = Math.round(100 * transfer.received / (transfer.size || 1));
        updateMessageInChat(transfer.peerId, transfer.id, { progress: `Recibiendo… ${percent}%` });
        safeSend({ kind: 'file-progress', id: transfer.id, next: transfer.next });
      }
    } catch (_) {
      incomingFiles.delete(transfer.id);
      void discardIncompleteFile(transfer.id);
      updateMessageInChat(transfer.peerId, transfer.id, { status: 'failed', progress: '' });
      safeSend({ kind: 'file-error', id: transfer.id });
      setStatus('No hay espacio suficiente en IndexedDB o falló la escritura del archivo.');
    } finally { transfer.writing = false; }
  }
  function handleFileChunk(packet) {
    const transfer = incomingFiles.get(packet.id);
    if (!transfer || transfer.writing || !Number.isSafeInteger(packet.index) || packet.index !== transfer.next) return;
    const bytes = packet.data;
    const isBuffer = bytes instanceof ArrayBuffer || Object.prototype.toString.call(bytes) === '[object ArrayBuffer]';
    if (!isBuffer && !ArrayBuffer.isView(bytes)) return;
    const buffer = isBuffer ? bytes : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    if (buffer.byteLength > CHUNK_BYTES || transfer.received + buffer.byteLength > transfer.size) return;
    transfer.pending.push({ index: transfer.next, data: buffer });
    transfer.received += buffer.byteLength;
    transfer.next++;
    if (transfer.next === transfer.total || transfer.pending.length === CHUNKS_PER_BATCH) {
      void flushFileBatch(transfer);
    }
  }
  function handleData(packet) {
    if (!packet || typeof packet !== 'object' || typeof packet.kind !== 'string') return;
    switch (packet.kind) {
      case 'disconnect': {
        if (connection) {
          const old = connection;
          connection = null;
          old.close();
          clearTransfers();
          setConnectionStatus('Desconectado · conversación finalizada');
          setStatus('La otra persona ha finalizado la conexión.');
        }
        break;
      }
      case 'file-error': {
        const outgoing = outgoingFiles.get(packet.id);
        if (outgoing) {
          outgoingFiles.delete(packet.id);
          updateMessageInChat(outgoing.peerId, packet.id, { status: 'failed', progress: '' });
          setStatus('El otro navegador no pudo guardar el archivo.');
        }
        const incoming = incomingFiles.get(packet.id);
        if (incoming) {
          incomingFiles.delete(packet.id);
          void discardIncompleteFile(packet.id);
          updateMessageInChat(incoming.peerId, packet.id, { status: 'failed', progress: '' });
          setStatus('La transferencia se interrumpió en el otro navegador.');
        }
        break;
      }
      case 'text': {
        if (!validMessageId(packet.id) || typeof packet.text !== 'string' ||
            !packet.text.trim() || packet.text.length > MAX_TEXT || !validTime(packet.time)) return;
        if (!getMessage(packet.id)) addMessage({ id: packet.id, kind: 'text', direction: 'in',
          text: packet.text, time: packet.time, status: 'delivered' });
        safeSend({ kind: 'ack', id: packet.id });
        break;
      }
      case 'typing':
        if (packet.active === true) showTyping();
        else if (packet.active === false) hideTyping();
        break;
      case 'ack':
        if (validMessageId(packet.id)) {
          const message = getMessage(packet.id);
          if (message && message.direction === 'out') {
            outgoingFiles.delete(packet.id);
            updateMessage(packet.id, { status: 'delivered', progress: '' });
          }
        }
        break;
      case 'file-meta': handleFileMeta(packet); break;
      case 'file-ready':
        if (validMessageId(packet.id)) {
          const transfer = outgoingFiles.get(packet.id);
          if (transfer && transfer.total > 0) void sendFileWindow(packet.id);
        }
        break;
      case 'file-progress': {
        const transfer = outgoingFiles.get(packet.id);
        if (transfer && Number.isInteger(packet.next) && packet.next === transfer.next &&
            packet.next > transfer.confirmed && packet.next <= transfer.total) {
          transfer.confirmed = packet.next;
          transfer.lastActivity = Date.now();
          transfer.waiting = false;
          updateMessageInChat(transfer.peerId, packet.id,
            { progress: `Enviando… ${Math.round(100 * transfer.confirmed / (transfer.total || 1))}%` });
          void sendFileWindow(packet.id);
        }
        break;
      }
      case 'file-chunk': handleFileChunk(packet); break;
    }
  }
  function clearTransfers() {
    for (const transfer of outgoingFiles.values())
      updateMessageInChat(transfer.peerId, transfer.id, { status: 'failed', progress: '' });
    for (const transfer of incomingFiles.values()) {
      updateMessageInChat(transfer.peerId, transfer.id, { status: 'failed', progress: '' });
      void discardIncompleteFile(transfer.id);
    }
    outgoingFiles.clear();
    incomingFiles.clear();
    hideTyping();
    clearTimeout(typingTimeout);
  }
  function bindConnection(conn) {
    if (!isFiveDigits(conn.peer) || conn.peer === localId) { conn.close(); return; }
    if (connection && connection !== conn && connection.open && connection.peer !== conn.peer) {
      setStatus(`No se aceptó el ID ${conn.peer}: ya tienes una conversación activa.`);
      conn.close();
      return;
    }
    if (connection && connection !== conn) {
      const old = connection;
      connection = null;
      old.close();
    }
    clearTimeout(connectingTimeout);
    connection = conn;
    setChatPartner(conn.peer);
    setConnectionStatus('Conectando…');
    setStatus(`Conectando con ${conn.peer}…`);
    conn.on('open', () => {
      if (connection !== conn) return;
      clearTimeout(connectingTimeout);
      setConnectionStatus('En línea · conexión establecida', true);
      setStatus(`Conectado con ${conn.peer}. Ya pueden conversar.`);
      ui.text.focus();
    });
    conn.on('data', (data) => { if (connection === conn) handleData(data); });
    conn.on('close', () => {
      if (connection !== conn) return;
      connection = null;
      clearTransfers();
      setConnectionStatus('Desconectado · vuelve a conectar');
      setStatus(`Se perdió la conexión con ${conn.peer}.`);
    });
    conn.on('error', () => {
      if (connection !== conn) return;
      setStatus(`Error de conexión con ${conn.peer}.`);
      if (!conn.open) {
        connection = null;
        setConnectionStatus('No se pudo conectar');
      }
    });
  }
  function disconnectChat() {
    if (!connection) return;
    const old = connection;
    const other = old.peer;
    if (old.open) safeSend({ kind: 'disconnect' });
    connection = null;
    clearTransfers();
    clearTimeout(connectingTimeout);
    setConnectionStatus('Desconectado · conversación finalizada');
    setStatus(`Has finalizado el chat con ${other}. Puedes volver a conectar.`);
    // Da tiempo a que el paquete de despedida salga antes de cerrar el canal.
    setTimeout(() => { try { old.close(); } catch (_) {} }, 180);
  }
  function connectTo(id) {
    if (!isFiveDigits(id)) { setStatus('Introduce un ID válido de cinco números.'); return; }
    if (id === localId) { setStatus('No puedes conectarte a tu propio ID.'); return; }
    if (!peerReady || !peer || peer.disconnected) { setStatus('Espera a que tu ID esté disponible en la red.'); return; }
    if (connection && connection.open && connection.peer === id) { setStatus(`Ya estás conectado con ${id}.`); return; }
    if (connection) { connection.close(); connection = null; clearTransfers(); }
    setChatPartner(id);
    try {
      bindConnection(peer.connect(id, { reliable: true, serialization: 'binary' }));
      connectingTimeout = setTimeout(() => {
        if (connection && !connection.open && connection.peer === id) {
          connection.close();
          connection = null;
          setConnectionStatus('Sin respuesta del otro ID');
          setStatus('El otro ID no respondió. Comprueba que está conectado.');
        }
      }, 18000);
    } catch (_) { setConnectionStatus('No se pudo iniciar conexión'); }
  }
  function createPeer() {
    if (typeof window.Peer !== 'function') {
      setConnectionStatus('No se pudo cargar PeerJS');
      setStatus('No se cargó la biblioteca PeerJS. Comprueba tu conexión a internet.');
      return;
    }
    peerReady = false;
    ui.ownId.textContent = localId;
    sessionSet(KEY_ID, localId);
    setConnectionStatus('Conectando con la red…');
    peer = new window.Peer(localId, { debug: 0 });
    const currentPeer = peer;
    peer.on('open', (id) => {
      if (peer !== currentPeer) return;
      peerReady = true;
      ui.ownId.textContent = id;
      ui.copy.disabled = false;
      if (!online()) setConnectionStatus('Listo para conversar · esperando conexión');
      setStatus('Tu ID está disponible. Compártelo o introduce el de otra persona.');
    });
    peer.on('connection', (incoming) => {
      if (peer !== currentPeer) { incoming.close(); return; }
      bindConnection(incoming); // El destinatario no necesita pulsar «Conectar».
    });
    peer.on('disconnected', () => {
      if (peer !== currentPeer) return;
      peerReady = false;
      if (!connection || !connection.open) setConnectionStatus('Reconectando con la red…');
      setStatus('Se perdió temporalmente el servidor de señalización. Reintentando…');
      clearTimeout(retrySignaling);
      retrySignaling = setTimeout(() => {
        if (peer === currentPeer && !currentPeer.destroyed && currentPeer.disconnected) {
          try { currentPeer.reconnect(); } catch (_) { /* El usuario podrá recargar. */ }
        }
      }, 2000);
    });
    peer.on('error', (error) => {
      if (peer !== currentPeer) return;
      if (error.type === 'unavailable-id') {
        // Un ID tiene solo 90.000 posibilidades: resolver colisiones automáticamente.
        currentPeer.destroy();
        localId = makeFiveDigits();
        setStatus('Tu ID ya estaba en uso. Generando otro…');
        createPeer();
        return;
      }
      if (error.type === 'peer-unavailable') {
        setStatus('No se encontró ese ID. Pide que abran EmLetter Chat y lo comprueben.');
        setConnectionStatus('El otro ID no está disponible');
        if (connection && !connection.open) { connection.close(); connection = null; }
        clearTimeout(connectingTimeout);
      } else {
        setStatus('Error de red. Comprueba internet e inténtalo nuevamente.');
        if (!connection || !connection.open) setConnectionStatus('Sin conexión con la red');
      }
    });
  }

  ui.connectForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (online()) disconnectChat();
    else connectTo(ui.peerId.value.trim());
  });
  ui.peerId.addEventListener('input', () => { ui.peerId.value = ui.peerId.value.replace(/\D/g, '').slice(0, 5); });
  ui.copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(localId);
      setStatus(`ID ${localId} copiado al portapapeles.`);
    } catch (_) {
      const temp = document.createElement('textarea');
      temp.value = localId; temp.style.position = 'fixed'; temp.style.opacity = '0';
      document.body.append(temp); temp.select();
      const copied = document.execCommand('copy'); temp.remove();
      setStatus(copied ? 'ID copiado.' : `Copia este ID: ${localId}`);
    }
  });
  ui.form.addEventListener('submit', (event) => { event.preventDefault(); sendText(); });
  ui.text.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault(); sendText();
    }
  });
  ui.text.addEventListener('input', onWriting);
  ui.text.addEventListener('blur', stopLocalTyping);
  ui.files.addEventListener('change', async () => {
    const files = Array.from(ui.files.files || []);
    ui.files.value = '';
    for (const file of files) await sendFile(file);
  });
  ui.attach.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (online()) ui.files.click();
      else setStatus('Primero conecta con la otra persona.');
    }
  });
  ui.attach.addEventListener('click', (event) => {
    if (!online()) { event.preventDefault(); setStatus('Primero conecta con la otra persona.'); }
  });
  // Detecta transferencias sin progreso; no deja la interfaz eternamente en «Enviando».
  setInterval(() => {
    const now = Date.now();
    for (const transfer of outgoingFiles.values()) {
      if (transfer.waiting && now - transfer.lastActivity > 60000) {
        outgoingFiles.delete(transfer.id);
        updateMessageInChat(transfer.peerId, transfer.id, { status: 'failed', progress: '' });
        safeSend({ kind: 'file-error', id: transfer.id });
        setStatus('La transferencia se detuvo por falta de respuesta.');
      }
    }
  }, 15000);
  window.addEventListener('beforeunload', () => {
    for (const url of objectUrls) URL.revokeObjectURL(url);
  });

  ui.ownId.textContent = localId;
  if (activePeerId) { ui.peerId.value = activePeerId; ui.person.textContent = `Conversación con ${activePeerId}`; }
  render();
  createPeer();
})();
