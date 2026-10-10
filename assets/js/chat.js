/* EmLetter Chat · PeerJS, historial por sesión y archivos por WebRTC. */
(() => {
  'use strict';

  const KEY_ID = 'emletter.chat.id.v1';
  const KEY_HISTORY = 'emletter.chat.histories.v1';
  const KEY_LAST_PEER = 'emletter.chat.last-peer.v1';
  const MAX_FILE_BYTES = 25 * 1024 * 1024;
  const SAVED_FILE_BYTES = 220 * 1024; // sessionStorage tiene una cuota reducida.
  const CHUNK_BYTES = 16 * 1024;
  const CHUNKS_PER_BATCH = 8;
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
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
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
          dataUrl: typeof entry.dataUrl === 'string' && entry.dataUrl.length <= SAVED_FILE_BYTES * 2 ? entry.dataUrl : '',
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
        if (sessionSet(KEY_HISTORY, JSON.stringify(serializable))) { setStatus('Historial guardado; los archivos grandes no se conservan al recargar.'); return; }
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
    if (activePeerId === peerId) render();
  }
  function addMessage(message) {
    const list = chatHistory();
    if (!list.find((item) => item.id === message.id)) list.push(message);
    if (list.length > MAX_MESSAGES_PER_CHAT) list.splice(0, list.length - MAX_MESSAGES_PER_CHAT);
    saveHistories();
    render();
  }
  function updateMessage(id, updates) {
    const msg = getMessage(id);
    if (msg) { Object.assign(msg, updates); saveHistories(); render(); }
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
    const link = el(url ? 'a' : 'div', 'chat-file-link');
    if (url) { link.href = url; link.download = message.name || 'archivo'; }
    link.append(el('span', 'chat-file-icon', '⇩'));
    const details = el('span', 'chat-file-details');
    details.append(el('span', 'chat-file-name', message.name || 'Archivo'));
    const extension = String(message.name || '').split('.').pop();
    const label = extension && extension !== message.name ? extension.toUpperCase() : (type.split('/')[1] || 'ARCHIVO').toUpperCase();
    details.append(el('span', 'chat-file-type', `${label} · ${fmtBytes(message.size || 0)}`));
    link.append(details);
    wrapper.append(link);
    if (!url && message.status !== 'sending') wrapper.append(el('div', 'chat-file-unavailable', 'Archivo no disponible tras recargar esta página.'));
    if (message.status === 'sending') wrapper.append(el('div', 'chat-file-progress', message.progress || 'Transfiriendo archivo…'));
    bubble.append(wrapper);
  }
  function render() {
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
      const row = el('div', `chat-message ${msg.direction === 'out' ? 'outgoing' : 'incoming'}`);
      const bubble = el('div', 'chat-bubble');
      if (msg.kind === 'text') bubble.append(el('div', 'chat-text', msg.text));
      else addFileContent(bubble, msg);
      const meta = el('div', 'chat-metadata');
      const clock = el('time', '', fmtTime(msg.time));
      clock.dateTime = new Date(msg.time).toISOString();
      meta.append(clock);
      if (msg.direction === 'out') {
        const statusText = msg.status === 'delivered' ? 'Recibido' : msg.status === 'sent' ? 'Enviado' : msg.status === 'failed' ? 'No enviado' : 'Enviando';
        const mark = el('span', `chat-checks${msg.status === 'delivered' ? ' is-delivered' : ''}${msg.status === 'failed' ? ' is-failed' : ''}`,
          msg.status === 'delivered' ? '✓✓' : msg.status === 'sent' ? '✓' : msg.status === 'failed' ? '!' : '○');
        mark.title = statusText;
        mark.setAttribute('aria-label', statusText);
        meta.append(mark);
      }
      bubble.append(meta);
      row.append(bubble);
      ui.messages.append(row);
    }
    ui.messages.scrollTop = ui.messages.scrollHeight;
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
  function retainSmallFile(blob, id, peerId = activePeerId) {
    if (blob.size > SAVED_FILE_BYTES || typeof FileReader === 'undefined') return;
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') updateMessageInChat(peerId, id, { dataUrl: reader.result });
    });
    reader.readAsDataURL(blob);
  }
  async function sendFile(file) {
    if (!online()) { setStatus('Primero conecta con la otra persona.'); return; }
    if (file.size > MAX_FILE_BYTES) {
      setStatus(`«${file.name}» supera el límite de ${fmtBytes(MAX_FILE_BYTES)} por archivo.`);
      return;
    }
    const id = messageId();
    const recipient = activePeerId;
    const initialConnection = connection;
    const name = (file.name || 'archivo').slice(0, 180);
    const time = Date.now();
    const url = trackObjectUrl(file);
    addMessage({ id, kind: 'file', direction: 'out', name, mime: file.type || 'application/octet-stream',
      size: file.size, time, status: 'sending', objectUrl: url, progress: 'Preparando archivo…' });
    retainSmallFile(file, id, recipient);
    try {
      const buffer = await file.arrayBuffer();
      if (!online() || initialConnection !== connection || recipient !== activePeerId) throw new Error('Se cambió de conversación');
      outgoingFiles.set(id, { id, buffer, next: 0, total: Math.ceil(file.size / CHUNK_BYTES),
        connection, time, waiting: false });
      const result = safeSend({ kind: 'file-meta', id, name, mime: file.type || 'application/octet-stream',
        size: file.size, time, total: Math.ceil(file.size / CHUNK_BYTES) });
      if (!result) throw new Error('Error al iniciar el envío');
      updateMessage(id, { progress: 'Esperando al destinatario…' });
    } catch (_) {
      outgoingFiles.delete(id);
      updateMessageInChat(recipient, id, { status: 'failed' });
      setStatus('No se pudo preparar el archivo para transferirlo.');
    }
  }
  function sendFileWindow(id) {
    const transfer = outgoingFiles.get(id);
    if (!transfer || transfer.waiting || !online() || transfer.connection !== connection) return;
    transfer.waiting = true;
    let sentInBatch = 0;
    while (transfer.next < transfer.total && sentInBatch < CHUNKS_PER_BATCH) {
      const start = transfer.next * CHUNK_BYTES;
      const data = transfer.buffer.slice(start, start + CHUNK_BYTES);
      const ok = safeSend({ kind: 'file-chunk', id, index: transfer.next, data });
      if (!ok) {
        outgoingFiles.delete(id);
        updateMessage(id, { status: 'failed' });
        setStatus('La transferencia del archivo se interrumpió.');
        return;
      }
      transfer.next++;
      sentInBatch++;
    }
    const percentage = transfer.total ? Math.round(100 * transfer.next / transfer.total) : 100;
    updateMessage(id, { progress: `Enviando… ${percentage}%` });
    // El receptor debe confirmar cada grupo antes de seguir, evitando saturar WebRTC.
  }
  function handleFileMeta(packet) {
    if (!validMessageId(packet.id) || typeof packet.name !== 'string' || packet.name.length > 180 ||
        typeof packet.mime !== 'string' || packet.mime.length > 100 ||
        !Number.isSafeInteger(packet.size) || packet.size < 0 || packet.size > MAX_FILE_BYTES ||
        !Number.isInteger(packet.total) || packet.total !== Math.ceil(packet.size / CHUNK_BYTES) ||
        !validTime(packet.time)) return;
    if (getMessage(packet.id)) { safeSend({ kind: 'ack', id: packet.id }); return; }
    if (incomingFiles.has(packet.id)) return;
    incomingFiles.set(packet.id, { id: packet.id, name: packet.name, mime: packet.mime,
      size: packet.size, time: packet.time, total: packet.total, chunks: [], received: 0, next: 0 });
    safeSend({ kind: 'file-ready', id: packet.id });
    if (packet.size === 0) finishIncomingFile(packet.id);
  }
  function finishIncomingFile(id) {
    const transfer = incomingFiles.get(id);
    if (!transfer) return;
    if (transfer.received !== transfer.size || transfer.next !== transfer.total) {
      incomingFiles.delete(id);
      return;
    }
    incomingFiles.delete(id);
    const blob = new Blob(transfer.chunks, { type: transfer.mime });
    const url = trackObjectUrl(blob);
    addMessage({ id, kind: 'file', direction: 'in', name: transfer.name, mime: transfer.mime,
      size: transfer.size, time: transfer.time, status: 'delivered', objectUrl: url });
    retainSmallFile(blob, id);
    safeSend({ kind: 'ack', id });
    setStatus(`Archivo recibido: ${transfer.name}`);
  }
  function handleFileChunk(packet) {
    const transfer = incomingFiles.get(packet.id);
    if (!transfer || !Number.isInteger(packet.index) || packet.index !== transfer.next) return;
    const bytes = packet.data;
    const isBuffer = bytes instanceof ArrayBuffer || Object.prototype.toString.call(bytes) === '[object ArrayBuffer]';
    if (!isBuffer && !ArrayBuffer.isView(bytes)) return;
    const buffer = isBuffer ? bytes : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    if (buffer.byteLength > CHUNK_BYTES || transfer.received + buffer.byteLength > transfer.size) {
      incomingFiles.delete(packet.id);
      return;
    }
    transfer.chunks.push(buffer);
    transfer.received += buffer.byteLength;
    transfer.next++;
    if (transfer.next === transfer.total) finishIncomingFile(packet.id);
    else if (transfer.next % CHUNKS_PER_BATCH === 0) safeSend({ kind: 'file-progress', id: packet.id, next: transfer.next });
  }
  function handleData(packet) {
    if (!packet || typeof packet !== 'object' || typeof packet.kind !== 'string') return;
    switch (packet.kind) {
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
          if (transfer && transfer.total === 0) { /* El receptor enviará ACK directamente. */ }
          else if (transfer) sendFileWindow(packet.id);
        }
        break;
      case 'file-progress': {
        const transfer = outgoingFiles.get(packet.id);
        if (transfer && Number.isInteger(packet.next) && packet.next === transfer.next &&
            packet.next <= transfer.total) {
          transfer.waiting = false;
          sendFileWindow(packet.id);
        }
        break;
      }
      case 'file-chunk': handleFileChunk(packet); break;
    }
  }
  function clearTransfers() {
    for (const id of outgoingFiles.keys()) updateMessage(id, { status: 'failed', progress: '' });
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
    connectTo(ui.peerId.value.trim());
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
  window.addEventListener('beforeunload', () => {
    for (const url of objectUrls) URL.revokeObjectURL(url);
  });

  ui.ownId.textContent = localId;
  if (activePeerId) { ui.peerId.value = activePeerId; ui.person.textContent = `Conversación con ${activePeerId}`; }
  render();
  createPeer();
})();
