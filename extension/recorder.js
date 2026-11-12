/* DBETTER, GPL-3.0-only. Replay to video: records a DuelingBook replay while it plays
 * fast-forwarded and downloads a video file when it ends (Low / Medium / High: about 6 / 8 / 24 MB a minute).
 * The browser asks which tab to share for each recording; the video never leaves the computer.
 * A finished Solo duel offers its replay for recording. */
(() => {
  'use strict';
  if (window.__dbetterRecorder) return;
  window.__dbetterRecorder = true;
  const rules = window.DBLiteRules;
  let config = rules.settings(JSON.parse(document.currentScript?.dataset.settings || '{}'));
  // Quality presets (user, 2026-11-07): video bitrate and largest frame; Medium is the 0.8–0.9 recording
  // (1.2 Mbit/s, 1280 × 800). Sound adds 48 kbit/s. The browser's encoder treats the bitrate as a target: sizes
  // per minute are as measured with ffprobe on a 2× replay in Chrome (2026-11-07: 0.81, 1.11, 3.15 Mbit/s).
  const QUALITIES = {
    low: { label: 'Low', bits: 600000, width: 960, height: 600, perMinute: '6 MB' },
    medium: { label: 'Medium', bits: 1200000, width: 1280, height: 800, perMinute: '8 MB' },
    high: { label: 'High', bits: 4000000, width: 1920, height: 1200, perMinute: '24 MB' },
  };
  const AUDIO_BITS = 48000, FPS = 30, QUIET_MS = 2500;
  // The timeline's speeds, with its sounds (user, 2026-10-29: the video played DuelingBook's old way). Without the
  // timeline (Enhancer's controls, or the timeline turned off) these map to DuelingBook's own playback.
  const SPEEDS = [['normal', '1×'], ['ff2', '2×'], ['ff4', '4×']], RATES = { normal: 1, ff2: 2, ff4: 4 };
  const timeline = () => window.DBETTERRewind?.recordPlayback;
  const RECORD_HASH = '#dbetter-record';
  const supported = () => !!(navigator.mediaDevices?.getDisplayMedia && window.MediaRecorder);
  const visible = node => !!node?.isConnected && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
  const stored = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
  const store = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
  let panel = null, record = null, speed = null, quality = null, audio = null, status = null, solo = null, session = null, endedDuel = null, duelOverHook = null;
  let dock = null, expanded = false, dockAnchor = null;

  function mimeType(withAudio) {
    // WebM (VP9) first: Chrome's MP4 (H.264) recorder produced garbled frames in a real replay recording.
    const types = withAudio
      ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/mp4;codecs=avc1.42E01F,mp4a.40.2', 'video/webm', 'video/mp4']
      : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/mp4;codecs=avc1.42E01F', 'video/webm', 'video/mp4'];
    return types.find(type => MediaRecorder.isTypeSupported?.(type)) || '';
  }
  const inReplay = () => !!window.replay && visible(document.getElementById('duel'));
  // The replay has played every action and its last animations have finished.
  const replayFinished = () => session?.timeline ? timeline()?.finished() : !window.replay_arr?.length && !window.actionsQueue?.length && !window.stopQueue;
  function press(id) { const button = document.getElementById(id); if (visible(button)) { button.click(); return true; } return false; }
  // Fast-forward at DBETTER's rate (its Fast forward selector), or DuelingBook's normal play.
  function startPlayback(choice) {
    if (session && timeline()?.available() && timeline().start(RATES[choice] || 2)) { session.timeline = true; return; }
    const rate = { ff2: 2, ff4: 4 }[choice], select = document.querySelector('#dblite-replay-rate select');
    if (rate && select && select.value !== String(rate)) { select.value = String(rate); select.dispatchEvent(new Event('change', { bubbles: true })); }
    if (rate) { if (!window.fast_forwarding || window.paused) press('fast_btn'); }
    else if (window.fast_forwarding || window.paused) press('play_btn') || press('pause_replay_btn');
  }
  const clock = ms => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const megabytes = bytes => (bytes / 1048576).toFixed(1) + ' MB';
  function fileName(type) {
    const id = window.duelId || new URLSearchParams(location.search).get('id') || 'replay', now = new Date();
    const stamp = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map(n => String(n).padStart(2, '0')).join('') + '-' + [now.getHours(), now.getMinutes()].map(n => String(n).padStart(2, '0')).join('');
    return `duelingbook-replay-${id}-${stamp}.${/mp4/.test(type) ? 'mp4' : 'webm'}`;
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = name; link.style.display = 'none';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // Chrome's WebM recorder writes no Duration (players read Infinity until they reach the end; pre-launch pass,
  // 2026-10-29). Inserts one into the Segment's Info, in its TimecodeScale units: returns the new head of the file
  // and where the old file continues, or null when the head is not the live layout browsers record: a Segment of
  // unknown size with no SeekHead or Cues before the first Cluster (their offsets would point past the insert).
  const EBML = 0x1A45DFA3, SEGMENT = 0x18538067, INFO = 0x1549A966, SEEK_HEAD = 0x114D9B74, CUES = 0x1C53BB6B, CLUSTER = 0x1F43B675, TIMECODE_SCALE = 0x2AD7B1, DURATION = 0x4489;
  function vint(bytes, at, id) {
    const first = bytes[at]; if (!first || at >= bytes.length) return null;
    let length = 1; while (!(first & (0x80 >> (length - 1)))) length++;
    if (length > 8 || at + length > bytes.length) return null;
    let value = id ? first : first & (0xff >> length), unknown = value === (0xff >> length);
    for (let k = 1; k < length; k++) { value = value * 256 + bytes[at + k]; if (bytes[at + k] !== 0xff) unknown = false; }
    return { length, value, unknown: !id && unknown };
  }
  function element(bytes, at) {
    const id = vint(bytes, at, true), size = id && vint(bytes, at + id.length, false);
    if (!size) return null;
    const start = at + id.length + size.length;
    return { id: id.value, at, sizeAt: at + id.length, sizeLength: size.length, size: size.value, unknown: size.unknown, start, end: size.unknown ? Infinity : start + size.value };
  }
  const sizeField = (value, length) => { const out = new Uint8Array(length); for (let k = length - 1; k >= 0; k--, value = Math.floor(value / 256)) out[k] = value & 0xff; out[0] |= 0x80 >> (length - 1); return out; };
  function webmDuration(bytes, ms) {
    const header = element(bytes, 0); if (header?.id !== EBML || header.end > bytes.length) return null;
    const segment = element(bytes, header.end); if (segment?.id !== SEGMENT || !segment.unknown) return null;
    // The Segment's children up to the first Cluster: one Info, nothing that holds offsets.
    let info = null, cluster = false;
    for (let at = segment.start; at < bytes.length;) {
      const child = element(bytes, at);
      if (!child || child.id === SEEK_HEAD || child.id === CUES) return null;
      if (child.id === CLUSTER) { cluster = true; break; }
      if (child.unknown || child.end > bytes.length) return null;
      if (child.id === INFO) info = child;
      at = child.end;
    }
    if (!info || !cluster) return null;
    let scale = 1000000;
    for (let at = info.start; at < info.end;) {
      const field = element(bytes, at); if (!field || field.end > info.end) return null;
      if (field.id === DURATION) return null;
      if (field.id === TIMECODE_SCALE) { scale = 0; for (let k = field.start; k < field.end; k++) scale = scale * 256 + bytes[k]; }
      at = field.end;
    }
    if (!scale) return null;
    const duration = new Uint8Array(11); duration.set([0x44, 0x89, 0x88]); new DataView(duration.buffer).setFloat64(3, ms * 1000000 / scale);
    const content = info.end - info.start + duration.length, patched = new Uint8Array(4 + 8 + content);
    patched.set(bytes.subarray(info.at, info.sizeAt)); patched.set(sizeField(content, 8), 4);
    patched.set(bytes.subarray(info.start, info.end), 12); patched.set(duration, 12 + info.end - info.start);
    const head = new Uint8Array(info.at + patched.length); head.set(bytes.subarray(0, info.at)); head.set(patched, info.at);
    return { head, rest: info.end };
  }
  async function withDuration(blob, ms) {
    if (!/webm/.test(blob.type) || !(ms > 0)) return blob;
    try {
      const patched = webmDuration(new Uint8Array(await blob.slice(0, 65536).arrayBuffer()), ms);
      return patched ? new Blob([patched.head, blob.slice(patched.rest)], { type: blob.type }) : blob;
    } catch (error) { console.warn('Spellspeed video duration:', error); return blob; }
  }

  // A fixed-size copy of the capture, a multiple of 16 pixels each way: the encoder never sees the frame size
  // change (a resized window, the crop settling) or an odd size. Null where canvases cannot be captured.
  async function fixedFrames(stream, preset = QUALITIES.medium) {
    const [track] = stream.getVideoTracks(), canvas = document.createElement('canvas');
    if (!track || typeof canvas.captureStream !== 'function') return null;
    const video = document.createElement('video'); video.muted = true; video.playsInline = true; video.srcObject = stream;
    try { await video.play(); } catch { return null; }
    if (!video.videoWidth) await new Promise(resolve => { video.addEventListener('loadedmetadata', resolve, { once: true }); setTimeout(resolve, 1500); });
    const width = video.videoWidth || preset.width, height = video.videoHeight || preset.height, ratio = Math.min(1, preset.width / width, preset.height / height);
    canvas.width = Math.max(16, Math.round(width * ratio / 16) * 16); canvas.height = Math.max(16, Math.round(height * ratio / 16) * 16);
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return null;
    let running = true;
    const draw = () => {
      if (!running) return;
      const w = video.videoWidth, h = video.videoHeight;
      if (w && h) {
        const scale = Math.min(canvas.width / w, canvas.height / h), dw = w * scale, dh = h * scale;
        context.fillStyle = '#000'; context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(video, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
      }
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(draw); else setTimeout(draw, 1000 / FPS);
    };
    draw();
    const output = canvas.captureStream(FPS);
    for (const sound of stream.getAudioTracks()) output.addTrack(sound);
    return { stream: output, stop: () => { running = false; output.getVideoTracks().forEach(t => t.stop()); video.srcObject = null; } };
  }
  async function startRecording() {
    if (session || !supported() || !inReplay()) return;
    const choice = speed.value, withAudio = audio.checked, preset = QUALITIES[quality.value] || QUALITIES.medium;
    let stream;
    try {
      // The current tab, without its audio unless asked: the browser asks the user to confirm.
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: FPS, displaySurface: 'browser', cursor: 'never' }, audio: withAudio,
        preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude', monitorTypeSurfaces: 'exclude' });
    } catch (error) { setStatus(error?.name === 'NotAllowedError' ? 'Recording cancelled.' : 'This browser cannot record the tab.'); return; }
    const [track] = stream.getVideoTracks();
    // Only the duel screen (Chrome's Region Capture), scaled down to the preset's largest frame. The tab's own size
    // caps it: High is never sharper than the duel screen is on this monitor.
    try { const duel = document.getElementById('duel'); if (window.CropTarget && track?.cropTo && duel) await track.cropTo(await window.CropTarget.fromElement(duel)); } catch (error) { console.warn('Spellspeed video crop:', error); }
    try { await track?.applyConstraints({ width: { max: preset.width }, height: { max: preset.height }, frameRate: { max: FPS } }); } catch {}
    const type = mimeType(withAudio && stream.getAudioTracks().length > 0), frames = await fixedFrames(stream, preset).catch(() => null);
    // An encoder that refuses the preset's bitrate gets Medium's, then the browser's own choice.
    let recorder = null, used = preset;
    for (const bits of [...new Set([preset.bits, QUALITIES.medium.bits, 0])]) {
      try { recorder = new MediaRecorder(frames?.stream || stream, { ...(type ? { mimeType: type } : {}), ...(bits ? { videoBitsPerSecond: bits } : {}), ...(withAudio ? { audioBitsPerSecond: AUDIO_BITS } : {}) }); }
      catch (error) { console.warn(`Spellspeed video encoder at ${bits || 'default'} bit/s:`, error); continue; }
      if (bits !== preset.bits) used = bits === QUALITIES.medium.bits ? QUALITIES.medium : null;
      break;
    }
    if (!recorder) { frames?.stop(); stream.getTracks().forEach(t => t.stop()); setStatus('This browser cannot encode the video.'); return; }
    const chunks = [], started = performance.now();
    session = { stream, frames, recorder, chunks, bytes: 0, started, quietSince: 0, title: document.title, type: recorder.mimeType || type || 'video/webm',
      quality: used ? used.label : 'browser default', fellBack: used !== preset };
    recorder.addEventListener('dataavailable', event => { if (event.data?.size) { chunks.push(event.data); session && (session.bytes += event.data.size); } });
    recorder.addEventListener('start', () => { if (session) session.recordStart = performance.now(); });
    recorder.addEventListener('stop', () => finish(chunks, session?.type || type));
    track?.addEventListener('ended', () => stopRecording());
    // Out of the picture before the first frame: this panel and DBETTER's other floating controls.
    document.documentElement.classList.toggle('dblite-recording', true); update();
    recorder.start(1000);
    startPlayback(choice);
    session.timer = setInterval(watch, 500);
    watch();
  }
  // Stops at the end of the replay (after its last animations), when it is left, or on Esc.
  function watch() {
    if (!session) return;
    const now = performance.now();
    document.title = `⏺ ${clock(now - session.started)} · ${megabytes(session.bytes)} — ${session.title}`;
    if (!inReplay()) { stopRecording(); return; }
    if (replayFinished()) { session.quietSince ||= now; if (now - session.quietSince >= QUIET_MS) stopRecording(); }
    else session.quietSince = 0;
  }
  function stopRecording() {
    if (!session || session.stopping) return;
    session.stopping = true; clearInterval(session.timer);
    if (session.timeline) timeline()?.stop();
    if (session.recorder.state !== 'inactive') session.recorder.stop(); else finish(session.chunks, session.type);
  }
  function finish(chunks, type) {
    const current = session; if (!current) return;
    session = null;
    current.frames?.stop(); current.stream.getTracks().forEach(track => track.stop());
    document.title = current.title;
    document.documentElement.classList.toggle('dblite-recording', false);
    const blob = new Blob(chunks, { type }), ms = performance.now() - (current.recordStart || current.started);
    // Named now: the page may move on (another replay) while the file is read.
    const name = fileName(type);
    const note = current.fellBack ? ` (${current.quality}: this browser refused the chosen quality)` : ` (${current.quality})`;
    if (blob.size) withDuration(blob, ms).then(file => { download(file, name); setStatus(`Saved ${megabytes(file.size)} · ${clock(performance.now() - current.started)}${note}.`); });
    else setStatus('Nothing was recorded.');
    update();
  }
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !session) return;
    event.preventDefault(); event.stopImmediatePropagation(); stopRecording();
  }, true);
  window.addEventListener('pagehide', stopRecording);

  function setStatus(text) { if (status) { status.textContent = text; status.hidden = !text; } }
  function build() {
    panel = document.createElement('div'); panel.id = 'dblite-record'; panel.setAttribute('role', 'group'); panel.setAttribute('aria-label', 'Replay video');
    dock = document.createElement('button'); dock.type = 'button'; dock.className = 'dblite-record-dock'; dock.textContent = 'Record video';
    dock.setAttribute('aria-expanded', 'false');
    dock.addEventListener('click', () => {
      expanded = !expanded; dock.setAttribute('aria-expanded', String(expanded));
      // Open where it was clicked: keep the dock's right edge and top, don't search for a new spot.
      const r = panel.getBoundingClientRect(); dockAnchor = expanded ? { right: r.right, top: r.top } : null;
      placePanel();
    });
    record = document.createElement('button'); record.type = 'button'; record.className = 'dblite-record-start'; record.textContent = '⏺ Record video';
    record.addEventListener('click', startRecording);
    speed = document.createElement('select'); speed.setAttribute('aria-label', 'Video speed');
    for (const [value, label] of SPEEDS) { const option = document.createElement('option'); option.value = value; option.textContent = label; speed.append(option); }
    speed.value = SPEEDS.some(([value]) => value === stored('dbetter-video-speed', 'ff2')) ? stored('dbetter-video-speed', 'ff2') : 'ff2';
    speed.addEventListener('change', () => store('dbetter-video-speed', speed.value));
    quality = document.createElement('select'); quality.className = 'dblite-record-quality'; quality.setAttribute('aria-label', 'Video quality');
    for (const [value, preset] of Object.entries(QUALITIES)) { const option = document.createElement('option'); option.value = value; option.textContent = preset.label; option.title = `About ${preset.perMinute} a minute`; quality.append(option); }
    quality.value = QUALITIES[stored('dbetter-video-quality', 'medium')] ? stored('dbetter-video-quality', 'medium') : 'medium';
    const describe = () => {
      const preset = QUALITIES[quality.value];
      record.title = `Records this replay from here (from the start when it is at the end) at the chosen speed, and downloads a video file when it ends (${preset.label}: about ${preset.perMinute} a minute). Your browser asks which tab to share. Esc stops early.`;
      quality.title = `${preset.label} quality: about ${preset.perMinute} a minute.`;
    };
    quality.addEventListener('change', () => { store('dbetter-video-quality', quality.value); describe(); });
    describe();
    const sound = document.createElement('label'); sound.className = 'dblite-record-audio'; sound.title = 'Include the game sounds (a slightly larger file).';
    audio = document.createElement('input'); audio.type = 'checkbox'; audio.checked = stored('dbetter-video-audio', '0') === '1';
    audio.addEventListener('change', () => store('dbetter-video-audio', audio.checked ? '1' : '0'));
    sound.append(audio, document.createTextNode(' Sound'));
    solo = document.createElement('a'); solo.className = 'dblite-record-solo'; solo.target = '_blank'; solo.rel = 'noopener noreferrer'; solo.textContent = '▶ Replay of this duel';
    solo.title = 'Opens this duel’s replay in a new tab, where Record video is too. DuelingBook decides when the replay is available.';
    status = document.createElement('span'); status.className = 'dblite-record-status'; status.setAttribute('role', 'status'); status.hidden = true;
    for (const type of ['keydown', 'keyup', 'mousedown', 'click']) panel.addEventListener(type, event => event.stopPropagation());
    panel.append(dock, record, speed, quality, sound, solo, status); document.body.append(panel);
  }
  // A finished Solo duel: DuelingBook's duelOver marks it.
  function hookDuelOver() {
    const original = window.duelOver;
    if (typeof original !== 'function' || rules.hasHook(original, duelOverHook)) return;
    duelOverHook = function (...args) { if (window.solo && window.duelist && !window.replay) endedDuel = window.duelId; return original.apply(this, args); };
    rules.markHook(duelOverHook, original); window.duelOver = duelOverHook;
  }
  function update() {
    if (window.DBETTERRebuilding) return;
    hookDuelOver();
    const replaying = config.replay && config.replayVideo && supported() && inReplay();
    // A deck-constructor Solo session has its own buttons (Reset deck, Back to deck): a Replay link joins them for
    // the whole duel, since DuelingBook's View Replay works mid-Solo. Record video is on the replay page (user,
    // 2026-10-27). Other Solo duels get a link once over.
    const column = config.replay && window.solo && window.duelist && !window.replay && window.duelId ? document.querySelector('#duel .dblite-solo-session') : null;
    let inColumn = column?.querySelector('.dblite-solo-replay');
    if (column && !inColumn) {
      inColumn = document.createElement('a'); inColumn.className = 'dblite-solo-replay'; inColumn.target = '_blank'; inColumn.rel = 'noopener noreferrer'; inColumn.textContent = '▶ Replay';
      inColumn.title = 'Opens this duel’s replay in a new tab, where Record video is too'; column.append(inColumn);
    }
    if (inColumn) inColumn.href = rules.replayUrl(window.duelId);
    document.querySelectorAll('.dblite-solo-replay').forEach(node => { if (node !== inColumn) node.remove(); });
    const soloUrl = !column && config.replay && config.replayVideo && window.solo && window.duelist && !window.replay && endedDuel && endedDuel === window.duelId && visible(document.getElementById('duel')) ? rules.replayUrl(window.duelId) : null;
    if (!replaying && !soloUrl && !session) { if (panel) panel.hidden = true; return; }
    if (!panel) build();
    panel.hidden = !!session;
    for (const node of [record, speed, quality, audio.parentElement]) node.hidden = !replaying;
    solo.hidden = !soloUrl; if (soloUrl) solo.href = soloUrl;
    placePanel();
    // Opened from a finished Solo duel: point at the button (recording itself needs a click).
    panel.classList.toggle('dblite-record-invite', replaying && location.hash === RECORD_HASH);
  }
  // Search the actual free rectangles; adaptive layout can move every column.
  // All obstacle edges are candidates, so a narrow free band is not missed by a grid.
  function placePanel() {
    if (window.DBETTERRebuilding) return;
    if (!window.document || !panel?.isConnected || panel.hidden) return;
    const gap = 8, width = innerWidth, height = innerHeight;
    const obstacles = [...document.querySelectorAll('#field,#field_stats,#duel .card img,#preview,#duel_log,#chats,.chat,#duel .cout_txt,#duel .os_viewport,#duel input,#duel textarea,#duel button,#duel .button,#duel [id$="_btn"],#duel [id*="show_hand"],#duel [id*="hide_hand"],#duel [id*="show_both"],#watchers,#avatar1,#avatar2,.dblite-target-notices,.dblite-action-history,#dblite-replay-rate,#dblite-duel-tools,#dblite-vfx-volume,#dblite-next-game')]
      .filter(n => !panel.contains(n) && visible(n)).map(n => n.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0);
    // The replay field's zones are drawn without measurable boxes. With a side gutter wide enough for the
    // panel, the whole stage is an obstacle, so the panel lands in the gutter (live v932 replay: 249 px at 1920).
    const stage = document.getElementById('content'), stageBox = stage && visible(stage) ? stage.getBoundingClientRect() : null;
    const gutter = stageBox ? Math.max(stageBox.left, width - stageBox.right) : 0;
    if (gutter >= 200) obstacles.push(stageBox);
    const overlaps = (x, y, w, h, r) => x < r.right + gap && x + w > r.left - gap && y < r.bottom + gap && y + h > r.top - gap;
    const find = (w, h, edgeOnly = false) => {
      const xs = [gap, width - w - gap, ...obstacles.flatMap(r => [r.right + gap, r.left - w - gap])];
      const ys = [gap, height - h - gap, ...obstacles.flatMap(r => [r.bottom + gap, r.top - h - gap])];
      for (const y of [...new Set(ys)].sort((a,b) => a-b)) for (const x of [...new Set(xs)].sort((a,b) => b-a)) {
        if (edgeOnly && x !== gap && y !== gap && x !== width-w-gap && y !== height-h-gap) continue;
        if (x >= gap && y >= gap && x + w <= width - gap && y + h <= height - gap && !obstacles.some(r => overlaps(x,y,w,h,r))) return { x, y };
      }
      return null;
    };
    // Measure at the top-left corner: where the panel sits now must not change its size (near the right edge
    // it would wrap taller, then flip between full and compact on every placement). No paint happens in between.
    // border-box: the max width includes padding and border, so a panel sized for the gutter fits in it.
    const measure = () => { Object.assign(panel.style, { left: '0px', top: '0px', bottom: 'auto', boxSizing: 'border-box' }); return panel.getBoundingClientRect(); };
    panel.classList.remove('dblite-record-compact'); dock.hidden = true;
    // Under Find card (user, 2026-11-09): the search below starts at the top and, in replays, put the panel over the top
    // player's zones (DuelingBook draws them without measurable boxes). It now follows Spellspeed's duel tools (placed by
    // content.js from the free space), as wide as they are: under them, else above them, else the search below.
    const tools = document.querySelector('body>.dblite-duel-tools'), toolsBox = tools && visible(tools) ? tools.getBoundingClientRect() : null;
    if (toolsBox && toolsBox.width >= 96) {
      // DuelingBook's corner icons and the replay options (Hide Hands, Show Hand, Show Both, like) are added here.
      const near = [...obstacles, ...[...document.querySelectorAll('#online_btn,#chat_btn,#private_btn,#duel>.radiobutton,#show_lbl,#show1_lbl,#show2_lbl,#duel>.like_btn')].filter(visible).map(n => n.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0)];
      const clear = (x, y, w, h) => !near.some(r => x < r.right + 4 && x + w > r.left - 4 && y < r.bottom + 4 && y + h > r.top - 4);
      panel.style.maxWidth = ''; panel.style.width = `${Math.round(toolsBox.width)}px`;
      const fits = box => [toolsBox.bottom + 4, toolsBox.top - 4 - box.height].find(y => y >= 2 && y + box.height <= height - 2 && clear(toolsBox.left, y, box.width, box.height));
      const put = y => Object.assign(panel.style, { left: `${Math.round(toolsBox.left)}px`, top: `${Math.round(y)}px`, bottom: 'auto' });
      let y = fits(measure());
      if (y !== undefined) {
        expanded = false; dockAnchor = null; dock.setAttribute('aria-expanded', 'false'); panel.classList.remove('dblite-record-expanded');
        put(y); return;
      }
      // Fullscreen replay at 1920×1080 (ch07 take, 2026-11-09): at Find card's width the panel wraps to 83 px, which fits
      // neither under Find card (64 px to the screen's edge) nor above it (Watchers). The one-line Record video button does;
      // a click opens the whole panel where the button is, which may cover the options until it is closed.
      dock.hidden = false; panel.classList.add('dblite-record-compact'); panel.classList.remove('dblite-record-expanded');
      y = fits(measure());
      if (y !== undefined) {
        if (expanded && dockAnchor) {
          panel.classList.add('dblite-record-expanded');
          const open = measure();
          put(Math.max(gap, Math.min(dockAnchor.top, height - open.height - gap)));
        } else put(y);
        return;
      }
      panel.classList.remove('dblite-record-compact'); dock.hidden = true;
    }
    panel.style.width = '';
    panel.style.maxWidth = `${Math.max(1, Math.min(280, (gutter >= 200 ? gutter : width) - gap * 2))}px`;
    let box = measure(), spot = find(box.width, box.height);
    if (!spot) {
      dock.hidden = false; panel.classList.add('dblite-record-compact');
      panel.classList.toggle('dblite-record-expanded', expanded);
      box = measure();
      spot = expanded && dockAnchor
        ? { x: Math.max(gap, Math.min(dockAnchor.right - box.width, width - box.width - gap)), y: Math.max(gap, Math.min(dockAnchor.top, height - box.height - gap)) }
        : find(box.width, box.height, true);
      // No free area even for a compact control: dock at the least obstructed
      // edge. Expanding is an explicit click and can temporarily cover content.
      if (!spot) {
        const candidates = [{ x: gap, y: gap }, { x: width-box.width-gap, y: gap }, { x: gap, y: height-box.height-gap }, { x: width-box.width-gap, y: height-box.height-gap }];
        const area = p => obstacles.reduce((sum,r) => sum + Math.max(0,Math.min(p.x+box.width,r.right)-Math.max(p.x,r.left))*Math.max(0,Math.min(p.y+box.height,r.bottom)-Math.max(p.y,r.top)),0);
        spot = candidates.sort((a,b) => area(a)-area(b))[0];
      }
    } else { expanded = false; dockAnchor = null; dock.setAttribute('aria-expanded', 'false'); panel.classList.remove('dblite-record-expanded'); }
    Object.assign(panel.style, { left: `${Math.max(0, Math.round(spot.x))}px`, top: `${Math.max(0, Math.round(spot.y))}px`, bottom: 'auto' });
  }
  window.addEventListener('resize', placePanel);
  // Ignore our own positioning writes, but catch native and DBETTER layout
  // mutations (including stylesheet changes in the adaptive layout).
  // Card animations write styles every frame: skip them, and place at most once per 200 ms.
  let placeTimer = null;
  const layoutObserver = new MutationObserver(records => {
    if (placeTimer || !panel || panel.hidden) return;
    if (records.some(r => !panel.contains(r.target) && r.target !== panel && !r.target.closest?.('#field,.card,.dblite-fan') &&
        (r.type === 'attributes' || ![...r.addedNodes, ...r.removedNodes].every(n => n === panel))))
      placeTimer = setTimeout(() => { placeTimer = null; placePanel(); }, 200);
  });
  window.addEventListener('dbetter-rebuild-begin', () => { layoutObserver.disconnect(); if (placeTimer) clearTimeout(placeTimer); placeTimer = null; });
  window.addEventListener('dbetter-rebuild-end', () => { layoutObserver.observe(document.documentElement, {subtree:true,childList:true,attributes:true,attributeFilter:['style','class','hidden']}); update(); });
  layoutObserver.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'DBLITE_SETTINGS') return;
    config = rules.settings(event.data.settings || {}); if (!config.replayVideo) stopRecording(); update();
  });
  // Small panel (user, 2026-11-09: "very, very big for no reason"): 10 px, two rows at Find card's width. The controls'
  // font is !important because DuelingBook writes an inline font-size on every select when the window resizes.
  const style = document.createElement('style');
  style.textContent = `
    #dblite-record{position:fixed;left:12px;bottom:62px;z-index:2147483000;display:flex;flex-wrap:wrap;gap:2px;align-items:center;max-width:min(560px,calc(100vw - 24px));background:var(--ssp-panel);border:1px solid var(--ssp-line);border-radius:6px;padding:3px 4px;color:var(--ssp-text);font:10px/1.25 system-ui,sans-serif;box-shadow:0 6px 18px #0007}
    #dblite-record[hidden],#dblite-record [hidden]{display:none!important}
    #dblite-record.dblite-record-compact:not(.dblite-record-expanded)>:not(.dblite-record-dock){display:none!important}
    #dblite-record button,#dblite-record select,#dblite-record a{background:var(--ssp-input);color:var(--ssp-text);border:1px solid var(--ssp-line);border-radius:4px;padding:1px 2px;font:inherit!important;text-decoration:none;cursor:pointer}
    #dblite-record .dblite-record-start{background:var(--ssp-panel);border-color:var(--ssp-line);font-weight:600}#dblite-record .dblite-record-start:hover{background:var(--ssp-panel-2)}
    #dblite-record label{display:flex;align-items:center;gap:2px;cursor:pointer}#dblite-record input[type=checkbox]{margin:0;width:11px;height:11px}
    #dblite-record.dblite-record-invite{outline:3px solid var(--ssp-accent);outline-offset:2px}
    .dblite-record-status{opacity:.85}
    #duel .dblite-solo-session .dblite-solo-replay{display:block;width:98px;height:22px;box-sizing:border-box;line-height:20px;text-align:center;border:1px solid var(--ssp-line);border-radius:4px;background:var(--ssp-panel);color:var(--ssp-text);font:11px system-ui;text-decoration:none;cursor:pointer}
    #duel .dblite-solo-session .dblite-solo-replay:hover{background:var(--ssp-panel-2)}
    html.dblite-recording :is(#dblite-replay-rate,#dblite-vfx-volume,#dblite-status,#dblite-replay){visibility:hidden!important}
  `;
  document.head.append(style);
  setInterval(update, 1000); update();
  window.DBETTERRecorder = Object.freeze({ start: startRecording, stop: stopRecording, recording: () => !!session, mimeType, fileName, update, webmDuration, qualities: QUALITIES });
})();
