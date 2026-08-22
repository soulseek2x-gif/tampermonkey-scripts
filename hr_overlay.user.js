// ==UserScript==
// @name         Hallenradsport Overlay
// @namespace    hallenradsport-overlay
// @version      1.12
// @description  Zeigt Live-Ergebnisse von hallenradsport-daum.de als flexibles Overlay (mit Autosize, Fullscreen-Fix & persistenter Auswahl)
// @author       you
// @match        *://sporteurope.tv/*
// @match        *://ergebnisse.hallenradsport-daum.de/*
// @match        *://*.hallenradsport-daum.de/*
// @downloadURL  https://raw.githubusercontent.com/soulseek2x-gif/tampermonkey-scripts/main/hr_overlay.user.js
// @updateURL    https://raw.githubusercontent.com/soulseek2x-gif/tampermonkey-scripts/main/hr_overlay.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      hallenradsport-daum.de
// @connect      ergebnisse.hallenradsport-daum.de
// ==/UserScript==

(function () {
    'use strict';

    const DEFAULT_SOURCE_URL = 'https://ergebnisse.hallenradsport-daum.de/livekunstrad/kunstradlive.xml';
    let SOURCE_URL = DEFAULT_SOURCE_URL;
    const REFRESH_INTERVAL = 30000;
    const STORAGE_KEY = 'hr_overlay_state_v4';
    const BASE_FONT_SIZE = 30; // Init-Schriftgröße (px)
    const DEFAULT_TIMER_SECONDS = 5 * 60;
    const COL_PLATZ = 0; // Spalte für Platzierung
    const COL_STARTER = 1; // Spalte für Startername
    const COL_EING = 3; // Spalte für Startername
    const COL_AUSG = 4; // Spalte für ausgefahrene Punkte
    const MAX_ROWS = 20; // Maximal angezeigte Reihen
    const DEFAULT_ALPHA = 0.8;
    const DEFAULT_HIGHLIGHTED_SEED_COUNT = 3;
    const UPCOMING_STARTER_EXCLUSIONS = []; // exact starter names or "starter|eing"
    let tables = []; // globale Tabelle für Hotkeys / render
    let SHOW_DROPDOWNS = false; // set to false to start with dropdowns hidden
    let showUpcomingStarter = false;
    let rankColoringEnabled = true;
    let highlightedSeedCount = DEFAULT_HIGHLIGHTED_SEED_COUNT;
    let timerUi = null;
    let timerState = null;
    let timerAudioContext = null;
    let ui = null;

    GM_addStyle(`
    #hr_overlay {
      position: fixed;
      top: 10px;
      right: 10px;
      z-index: 2147483647;
      background: rgba(0,0,0,0.8);
      color: #fff;
      padding: 6px 8px;
      border-radius: 10px;
      font-family: "Source Code Pro", monospace;
      font-size: 13px;
      min-width: 140px;
      min-height: 48px;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 4px;
      user-select: none;
      max-height: none !important;
      align-self: flex-start;
      flex: 0 0 auto;
    }
    #hr_overlay select {
      background: #222;
      color: #fff;
      border: 1px solid #444;
      border-radius: 4px;
      padding: 4px;
      font-size: inherit;
      transition: all 0.15s ease-out;
      flex-shrink: 0;
    }
    #hr_overlay .hr_row {
      display:flex;
      justify-content:flex-start;
      align-items:center;
      gap:6px;
    }
    #hr_overlay .hr_content {
      overflow:auto;
      white-space: pre; /* preserve multiple spaces for monospace alignment */
    }
    #hr_overlay .hr_upcoming {
      color: #fff3a3;
    }
    #hr_overlay .hr_menu {
      position: absolute;
      min-width: 220px;
      background: rgba(18,18,18,0.96);
      border: 1px solid rgba(255,255,255,0.16);
      border-radius: 10px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.35);
      padding: 10px;
      display: none;
      flex-direction: column;
      gap: 10px;
      z-index: 2147483647;
    }
    #hr_overlay .hr_menu label,
    #hr_overlay .hr_menu .hr_menu_label {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 0.72em;
    }
    #hr_overlay .hr_menu input[type="number"] {
      width: 56px;
    }
    #hr_overlay .hr_menu input[type="range"] {
      width: 110px;
    }
    #hr_overlay .hr_menu input,
    #hr_overlay .hr_menu button {
      background: #222;
      color: #fff;
      border: 1px solid #444;
      border-radius: 6px;
      padding: 4px 6px;
      font: inherit;
    }
    #hr_overlay .hr_menu button {
      cursor: pointer;
    }
    #hr_overlay .hr_menu button:hover {
      background: #2b2b2b;
    }
    #hr_overlay .hr_menu input[type="text"] {
      width: 150px;
    }
    #hr_timer_overlay {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 2147483646;
      background: rgba(0,0,0,0.85);
      color: #fff;
      padding: 6px;
      border-radius: 10px;
      box-sizing: border-box;
      min-width: 150px;
      width: max-content;
      user-select: none;
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-family: "Source Code Pro", monospace;
      box-shadow: 0 0 10px rgba(0,0,0,0.5);
    }
    #hr_timer_overlay .hr_timer_body {
      display: flex;
      align-items: stretch;
      gap: 4px;
    }
    #hr_timer_overlay .hr_timer_time {
      font-size: 28px;
      text-align: center;
      font-weight: bold;
      line-height: 1.1;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 5.2ch;
      min-width: 0;
      padding: 0;
    }
    #hr_timer_overlay.hr_timer_zero .hr_timer_time {
      color: #ff5c5c;
    }
    #hr_timer_overlay .hr_timer_buttons {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    #hr_timer_overlay .hr_timer_buttons button {
      width: 32px;
      height: 32px;
      background: #222;
      color: white;
      border: 1px solid #555;
      border-radius: 6px;
      padding: 0;
      cursor: pointer;
      font-size: 15px;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #hr_timer_overlay .hr_timer_buttons button:hover {
      background: #333;
    }
    #hr_timer_overlay .hr_timer_menu {
      position: absolute;
      min-width: 220px;
      background: rgba(18,18,18,0.96);
      border: 1px solid rgba(255,255,255,0.16);
      border-radius: 10px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.35);
      padding: 10px;
      display: none;
      flex-direction: column;
      gap: 10px;
      z-index: 2147483647;
      font-size: inherit;
    }
    #hr_timer_overlay .hr_timer_menu label,
    #hr_timer_overlay .hr_timer_menu .hr_menu_label {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: inherit;
    }
    #hr_timer_overlay .hr_timer_menu input[type="number"],
    #hr_timer_overlay .hr_timer_menu input[type="text"] {
      width: 72px;
    }
    #hr_timer_overlay .hr_timer_menu input,
    #hr_timer_overlay .hr_timer_menu button {
      background: #222;
      color: #fff;
      border: 1px solid #444;
      border-radius: 6px;
      padding: 4px 6px;
      font: inherit;
    }
    #hr_timer_overlay .hr_timer_menu button {
      cursor: pointer;
    }
    #hr_timer_overlay .hr_timer_menu button:hover {
      background: #2b2b2b;
    }
    #hr_overlay .resize-handle {
      width: 14px;
      height: 14px;
      position: absolute;
      right: 6px;
      bottom: 6px;
      cursor: se-resize;
    }
    #hr_overlay .resize-handle:after {
      content: "";
      position: absolute;
      right: 0;
      bottom: 0;
      width: 10px;
      height: 10px;
      border-right: 2px solid rgba(255,255,255,0.4);
      border-bottom: 2px solid rgba(255,255,255,0.4);
    }
    #hr_timer_overlay .resize-handle {
      width: 14px;
      height: 14px;
      position: absolute;
      right: 6px;
      bottom: 6px;
      cursor: se-resize;
    }
    #hr_timer_overlay .resize-handle:after {
      content: "";
      position: absolute;
      right: 0;
      bottom: 0;
      width: 10px;
      height: 10px;
      border-right: 2px solid rgba(255,255,255,0.4);
      border-bottom: 2px solid rgba(255,255,255,0.4);
    }
  `);

    /* --- Hilfsfunktionen --- */

    function gmFetch(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                onload: (r) => resolve(r.responseText),
                onerror: reject
            });
        });
    }

    function parseJSON(jsonText) {
        try {
            const data = typeof jsonText === 'string' ? JSON.parse(jsonText) : jsonText;
            if (!data) return null;

            let result = [];

            if (Array.isArray(data.disziplinen)) {
                data.disziplinen.forEach(dis => {
                    const title = (dis.name || "Disziplin").trim();
                    const rows = (dis.starter || []).map(st => ({
                        platz: String(st.platz || '').trim(),
                        starter: String(st.name || '').trim(),
                        verein: String(st.verein || '').trim(),
                        eing: String(st.eing || '').trim(),
                        ausg: String(st.ausg || '').trim(),
                        aktiv: String(st.aktiv || '0').trim()
                    }));
                    result.push({ title, rows });
                });
                return result.length > 0 ? result : null;
            }

            if (Array.isArray(data.tabelle) || Array.isArray(data.spiele)) {
                if (Array.isArray(data.spiele) && data.spiele.length > 0) {
                    const rows = data.spiele.map(s => ({
                        platz: String(s.nr || '').trim(),
                        starter: `${s.mannschaft1 || ''} vs ${s.mannschaft2 || ''}`.trim(),
                        eing: '',
                        ausg: `${s.tore1 ?? ''} : ${s.tore2 ?? ''}`.trim(),
                        aktiv: s.gespielt === "1" ? "1" : "0"
                    }));
                    result.push({ title: "Spiele", rows });
                }
                if (Array.isArray(data.tabelle) && data.tabelle.length > 0) {
                    const rows = data.tabelle.map(t => ({
                        platz: String(t.platz || '').trim(),
                        starter: String(t.name || '').trim(),
                        eing: String(t.punkte || '').trim(),
                        ausg: `${t.tore1 ?? ''}:${t.tore2 ?? ''} (${t.punkte ?? ''}P)`,
                        aktiv: t.spielt === "1" ? "1" : "0"
                    }));
                    result.push({ title: "Tabelle", rows });
                }
                return result.length > 0 ? result : null;
            }

            return null;
        } catch (e) {
            return null;
        }
    }

    function parseHTML(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const result = [];
        const h2s = doc.querySelectorAll('h2');
        h2s.forEach((h2) => {
            const txt = h2.textContent.trim();
            if (!txt) return;
            if (txt.toLowerCase() === 'menü' || txt.toLowerCase() === 'menu') return;

            let el = h2.nextElementSibling;
            while (el && el.tagName !== 'TABLE') el = el.nextElementSibling;
            if (!el) return;
            const rows = Array.from(el.querySelectorAll('tbody tr')).map(tr => {
                const cells = tr.querySelectorAll('td');
                if (cells.length < 4) return null;

                if (cells.length >= 5) {
                    return {
                        platz: cells[COL_PLATZ].textContent.trim(),
                        starter: cells[COL_STARTER].textContent.trim(),
                        eing: cells[COL_EING].textContent.trim(),
                        ausg: cells[COL_AUSG].textContent.trim(),
                        aktiv: tr.classList.contains('live') || tr.classList.contains('aktiv') ? "1" : "0"
                    };
                }

                return {
                    platz: cells[0].textContent.trim(),
                    starter: `${cells[1].textContent.trim()} vs ${cells[2].textContent.trim()}`,
                    eing: '',
                    ausg: cells[3].textContent.trim(),
                    aktiv: tr.classList.contains('live') || tr.classList.contains('aktiv') ? "1" : "0"
                };
            }).filter(Boolean);
            if (rows.length > 0) {
                result.push({ title: txt, rows });
            }
        });
        return result;
    }

    async function fetchData(sourceUrl) {
        let targetUrl = sourceUrl.trim();

        let apiUrl = null;
        if (targetUrl.includes('ergebnisse.hallenradsport-daum.de') && !targetUrl.includes('/api/')) {
            apiUrl = targetUrl.replace('ergebnisse.hallenradsport-daum.de/', 'ergebnisse.hallenradsport-daum.de/api/');
        }

        if (apiUrl) {
            try {
                const apiResponse = await gmFetch(apiUrl);
                const parsed = parseJSON(apiResponse);
                if (parsed && parsed.length > 0) {
                    return parsed;
                }
            } catch (e) {
                // fallback
            }
        }

        const responseText = await gmFetch(targetUrl);

        const parsedJSON = parseJSON(responseText);
        if (parsedJSON && parsedJSON.length > 0) {
            return parsedJSON;
        }

        const apiMatch = responseText.match(/fetch\(["'](\/api\/[^"']+)["']\)/i);
        if (apiMatch && apiMatch[1]) {
            try {
                const relativeApiUrl = apiMatch[1].split('?')[0];
                const fullApiUrl = new URL(relativeApiUrl, targetUrl).href;
                const apiResponse = await gmFetch(fullApiUrl);
                const parsed = parseJSON(apiResponse);
                if (parsed && parsed.length > 0) {
                    return parsed;
                }
            } catch (e) {
                // fallback
            }
        }

        const parsedHTML = parseHTML(responseText);
        if (parsedHTML && parsedHTML.length > 0) {
            return parsedHTML;
        }

        throw new Error('Keine gültigen Tabellendaten gefunden.');
    }

    /* --- Overlay erstellen --- */

    function createOverlay() {
        const root = document.createElement('div');
        root.id = 'hr_overlay';
        root.innerHTML = `
      <div class="hr_row" id="hr_header">
        <select id="hr_table"></select>
        <select id="hr_count"></select>
      </div>
      <div class="hr_content" id="hr_content">Lade Daten...</div>
      <div class="hr_menu" id="hr_menu">
        <label><span>Rank coloring</span><input type="checkbox" id="hr_rank_coloring"></label>
        <label><span>Highlighted finishers</span><input type="number" id="hr_highlight_count" min="0" max="10" step="1"></label>
        <label><span>Transparency</span><input type="range" id="hr_alpha" min="0" max="100" step="5"></label>
        <label><span>Source URL</span><input type="text" id="hr_source_url" spellcheck="false"></label>
        <label><span>Next by lowest Eing.</span><input type="checkbox" id="hr_next_by_points"></label>
        <label><span>Timer overlay</span><input type="checkbox" id="hr_timer_enabled"></label>
        <div class="hr_menu_label"><span id="hr_alpha_value">80%</span><button type="button" id="hr_reset_settings">Reset</button></div>
      </div>
      <div class="resize-handle"></div>
    `;
        document.body.appendChild(root);

        const header = root.querySelector('#hr_header');
        header.style.display = SHOW_DROPDOWNS ? 'flex' : 'none';

        return {
            root,
            header: root.querySelector('#hr_header'),
            selTable: root.querySelector('#hr_table'),
            selCount: root.querySelector('#hr_count'),
            content: root.querySelector('#hr_content'),
            menu: root.querySelector('#hr_menu'),
            menuRankColoring: root.querySelector('#hr_rank_coloring'),
            menuHighlightCount: root.querySelector('#hr_highlight_count'),
            menuAlpha: root.querySelector('#hr_alpha'),
            menuSourceUrl: root.querySelector('#hr_source_url'),
            menuNextByPoints: root.querySelector('#hr_next_by_points'),
            menuTimerEnabled: root.querySelector('#hr_timer_enabled'),
            menuAlphaValue: root.querySelector('#hr_alpha_value'),
            menuReset: root.querySelector('#hr_reset_settings'),
            resizeHandle: root.querySelector('.resize-handle')
        };
    }

    function loadState() {
        try {
            const s = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
            if (s.sourceUrl && (s.sourceUrl.includes('index.php/live/live-kunstradint') || s.sourceUrl.includes('www.hallenradsport-daum.de'))) {
                s.sourceUrl = DEFAULT_SOURCE_URL;
                saveState(s);
            }
            return s;
        } catch {
            return {};
        }
    }

    function saveState(s) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    }

    function applyOverlayAlpha(ui, alpha) {
        ui.root.style.backgroundColor = `rgba(0,0,0,${alpha})`;
    }

    function isSettingsMenuOpen(ui) {
        return !!ui?.menu && window.getComputedStyle(ui.menu).display !== 'none';
    }

    function isTimerMenuOpen(timerUi) {
        return !!timerUi?.menu && window.getComputedStyle(timerUi.menu).display !== 'none';
    }

    /* --- Drag & Resize --- */

    function makeDraggable(el, onSave, options = {}) {
        let dragging = false;
        const ignoreSelectors = options.ignoreSelectors || [];
        const shouldBlockDrag = options.shouldBlockDrag || (() => false);
        let startX, startY, origLeft, origTop;
        el.addEventListener('pointerdown', (ev) => {
            if (ev.button !== 0) return;
            if (shouldBlockDrag()) return;
            if (ev.target.tagName === 'SELECT' || ev.target.classList.contains('resize-handle')) return;
            if (ignoreSelectors.some(sel => ev.target.closest(sel))) return;
            if (ev.target.closest('button, input, textarea, [role="button"], [contenteditable="true"]')) return;
            ev.preventDefault();
            dragging = true;
            el.setPointerCapture(ev.pointerId);
            startX = ev.clientX;
            startY = ev.clientY;
            const rect = el.getBoundingClientRect();
            origLeft = rect.left;
            origTop = rect.top;
            el.style.left = rect.left + 'px';
            el.style.top = rect.top + 'px';
            el.style.right = 'auto';
        });
        window.addEventListener('pointermove', (ev) => {
            if (!dragging) return;
            const dx = ev.clientX - startX, dy = ev.clientY - startY;
            el.style.left = origLeft + dx + 'px';
            el.style.top = origTop + dy + 'px';
        });
        window.addEventListener('pointerup', (ev) => {
            if (!dragging) return;
            dragging = false;
            try { el.releasePointerCapture(ev.pointerId); } catch {}
            if (onSave) onSave();
        });
    }

    function makeResizable(el, handle, onEnd, options = {}) {
        let resizing = false;
        const onResize = options.onResize;
        let startX, startY, startW, startH;

        handle.addEventListener('pointerdown', (ev) => {
            if (ev.button !== 0) return;
            ev.preventDefault();
            resizing = true;
            handle.setPointerCapture(ev.pointerId);
            const rect = el.getBoundingClientRect();
            startX = ev.clientX; startY = ev.clientY;
            startW = rect.width; startH = rect.height;
            el.style.width = rect.width + 'px';
            el.style.height = rect.height + 'px';
        });

        window.addEventListener('pointermove', (ev) => {
            if (!resizing) return;
            const dx = ev.clientX - startX, dy = ev.clientY - startY;
            const newW = Math.max(140, startW + dx);
            const newH = Math.max(48, startH + dy);
            el.style.width = newW + 'px';
            el.style.height = newH + 'px';

            const scale = newW / 300;
            el.style.fontSize = (13 * scale) + 'px';
            if (onResize) {
                onResize({ newW, newH, scale, el });
            } else {
                el.querySelectorAll('select').forEach(sel => {
                    sel.style.fontSize = (13 * scale) + 'px';
                    sel.style.padding = `${(4 * scale)}px`;
                });
            }
        });

        window.addEventListener('pointerup', (ev) => {
            if (!resizing) return;
            resizing = false;
            try { handle.releasePointerCapture(ev.pointerId); } catch {}
            if (onEnd) onEnd();

            if (typeof ui !== 'undefined' && ui) {
                autoWidth(ui);
                autoHeight(ui);
            }
        });
    }

    /* --- Fullscreen stabil halten --- */
    function attachToFullscreen(overlay) {
        const fs = document.fullscreenElement;
        if (fs && !fs.contains(overlay)) {
            fs.appendChild(overlay);
            overlay.style.position = 'fixed';
        } else if (!fs && !document.body.contains(overlay)) {
            document.body.appendChild(overlay);
            overlay.style.position = 'fixed';
        }
    }

    function formatTimerTime(seconds) {
        const safeSeconds = Math.max(0, Math.floor(seconds));
        const mins = Math.floor(safeSeconds / 60);
        const secs = safeSeconds % 60;
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    function parseTimerDurationInput(value) {
        const raw = String(value ?? '').trim();
        if (!raw) return null;

        const mmssMatch = raw.match(/^(\d{1,3}):([0-5]?\d)$/);
        if (mmssMatch) {
            return Math.max(1, (parseInt(mmssMatch[1], 10) * 60) + parseInt(mmssMatch[2], 10));
        }

        if (/^\d+$/.test(raw)) {
            return Math.max(1, parseInt(raw, 10) * 60);
        }

        return null;
    }

    function resolveTimerSeconds(value) {
        const numeric = Number(value);
        return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : null;
    }

    function autoTimerHeight(timerUi) {
        if (!timerUi?.root) return;
        if (window.getComputedStyle(timerUi.root).display === 'none') return;

        const root = timerUi.root;
        const rootStyle = window.getComputedStyle(root);
        const borderTop = parseFloat(rootStyle.borderTopWidth || 0) || 0;
        const borderBottom = parseFloat(rootStyle.borderBottomWidth || 0) || 0;
        const handleReserve = 20;

        root.style.height = 'auto';
        const nextHeight = Math.max(
            48,
            Math.ceil(root.scrollHeight + borderTop + borderBottom + handleReserve)
        );
        root.style.height = `${nextHeight}px`;
    }

    function scheduleTimerHeightSync() {
        if (!timerUi?.root) return;
        requestAnimationFrame(() => autoTimerHeight(timerUi));
    }

    function ensureTimerAudioContext() {
        if (!timerAudioContext) {
            const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextCtor) return null;
            timerAudioContext = new AudioContextCtor();
        }

        if (timerAudioContext.state === 'suspended') {
            timerAudioContext.resume().catch(() => {});
        }

        return timerAudioContext;
    }

    function playTimerDing() {
        if (!state.timerDingEnabled) return;
        const ctx = ensureTimerAudioContext();
        if (!ctx) return;

        const now = ctx.currentTime;
        const frequencies = [880, 660];
        frequencies.forEach((frequency, index) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = frequency;
            gain.gain.setValueAtTime(0.0001, now + index * 0.16);
            gain.gain.exponentialRampToValueAtTime(0.2, now + index * 0.18);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.18 + 0.12);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + index * 0.16);
            osc.stop(now + index * 0.18 + 0.14);
        });
    }

    function updateTimerDisplay() {
        if (!timerUi || !timerState) return;
        timerUi.time.textContent = formatTimerTime(timerState.remainingSeconds);
        timerUi.root.classList.toggle('hr_timer_zero', timerState.remainingSeconds <= 0);
        timerUi.toggle.textContent = timerState.running ? '❚❚' : '▶';
        timerUi.toggle.title = timerState.running ? 'Pause' : 'Start';
        timerUi.reset.textContent = '↺';
        timerUi.reset.title = 'Reset';
        scheduleTimerHeightSync();
    }

    function pauseTimer() {
        if (!timerState) return;
        timerState.running = false;
        if (timerState.interval) {
            clearInterval(timerState.interval);
            timerState.interval = null;
        }
        updateTimerDisplay();
    }

    function resetTimer() {
        if (!timerState) return;
        pauseTimer();
        timerState.remainingSeconds = timerState.totalSeconds;
        timerState.alerted = false;
        updateTimerDisplay();
    }

    function startTimer() {
        if (!timerState) return;
        if (timerState.running) return;

        ensureTimerAudioContext();

        if (timerState.remainingSeconds <= 0) {
            timerState.remainingSeconds = timerState.totalSeconds;
            timerState.alerted = false;
        }

        timerState.running = true;
        timerState.interval = window.setInterval(() => {
            if (timerState.remainingSeconds > 0) {
                timerState.remainingSeconds -= 1;
                if (timerState.remainingSeconds === 0 && !timerState.alerted) {
                    timerState.alerted = true;
                    playTimerDing();
                }
                updateTimerDisplay();
                return;
            }

            timerState.running = false;
            if (timerState.interval) {
                clearInterval(timerState.interval);
                timerState.interval = null;
            }
            updateTimerDisplay();
        }, 1000);

        updateTimerDisplay();
    }

    function setTimerDuration(value) {
        if (!timerState) return;
        const normalized = typeof value === 'number'
            ? Math.max(1, Math.floor(value))
            : (parseTimerDurationInput(value) ?? DEFAULT_TIMER_SECONDS);
        pauseTimer();
        timerState.totalSeconds = normalized;
        timerState.remainingSeconds = timerState.totalSeconds;
        timerState.alerted = false;
        state.timerSeconds = normalized;
        delete state.timerMinutes;
        state.timerDuration = formatTimerTime(normalized);
        saveState(state);
        if (timerUi?.menuDuration) timerUi.menuDuration.value = formatTimerTime(normalized);
        scheduleTimerHeightSync();
        updateTimerDisplay();
    }

    function syncTimerMenu() {
        if (!timerUi) return;
        const storedSeconds = resolveTimerSeconds(state.timerSeconds) ?? parseTimerDurationInput(state.timerDuration) ?? DEFAULT_TIMER_SECONDS;
        timerUi.menuDuration.value = formatTimerTime(storedSeconds);
        timerUi.menuDing.checked = !!state.timerDingEnabled;
        scheduleTimerHeightSync();
    }

    function applyTimerVisibility() {
        if (!timerUi) return;
        timerUi.root.style.display = state.timerEnabled ? 'flex' : 'none';
        if (!state.timerEnabled) {
            pauseTimer();
        }
        scheduleTimerHeightSync();
    }

    function createTimerOverlay() {
        const root = document.createElement('div');
        root.id = 'hr_timer_overlay';
        root.innerHTML = `
      <div class="hr_timer_body">
        <div class="hr_timer_time" id="hr_timer_time">05:00</div>
        <div class="hr_timer_buttons">
          <button type="button" id="hr_timer_toggle" aria-label="Start">▶</button>
          <button type="button" id="hr_timer_reset" aria-label="Reset">↺</button>
        </div>
      </div>
      <div class="hr_timer_menu" id="hr_timer_menu">
        <label><span>Default time (mm:ss)</span><input type="text" id="hr_timer_duration" inputmode="numeric" spellcheck="false" placeholder="05:00"></label>
        <label><span>Ding on zero</span><input type="checkbox" id="hr_timer_ding"></label>
      </div>
      <div class="resize-handle"></div>
    `;
        document.body.appendChild(root);
        return {
            root,
            time: root.querySelector('#hr_timer_time'),
            toggle: root.querySelector('#hr_timer_toggle'),
            reset: root.querySelector('#hr_timer_reset'),
            menu: root.querySelector('#hr_timer_menu'),
            menuDuration: root.querySelector('#hr_timer_duration'),
            menuDing: root.querySelector('#hr_timer_ding'),
            resizeHandle: root.querySelector('.resize-handle')
        };
    }

    /* --- Inhalt / Anzeige --- */

    function autoWidth(ui) {
        if (!ui || !ui.content) return;

        const temp = document.createElement('div');
        temp.style.position = 'absolute';
        temp.style.visibility = 'hidden';
        temp.style.whiteSpace = 'pre';
        temp.style.fontSize = window.getComputedStyle(ui.root).fontSize;
        temp.style.fontFamily = window.getComputedStyle(ui.root).fontFamily;
        temp.style.fontWeight = window.getComputedStyle(ui.root).fontWeight;
        temp.style.lineHeight = window.getComputedStyle(ui.root).lineHeight;
        document.body.appendChild(temp);

        const lines = (ui.content.textContent || '').split('\n').map(line => line.replace(/<\/?[^>]+>/g, '').trim());

        let maxWidth = 0;
        for (const line of lines) {
            temp.textContent = line || ' ';
            const w = temp.scrollWidth;
            if (w > maxWidth) maxWidth = w;
        }

        let dropWidth = 0;
        if (ui.header) {
            const selects = ui.header.querySelectorAll('select');
            selects.forEach(s => {
                dropWidth += s.offsetWidth;
            });
            dropWidth += (selects.length - 1) * 5;
        }

        ui.root.style.width = Math.max(maxWidth + 40, dropWidth + 20) + 'px';

        document.body.removeChild(temp);
    }

    function autoHeight(ui) {
        if (!ui || !ui.content) return;

        const rootStyle = window.getComputedStyle(ui.root);
        const headerHeight = ui.header ? ui.header.getBoundingClientRect().height : 0;
        const paddingTop = parseFloat(rootStyle.paddingTop || 0);
        const paddingBottom = parseFloat(rootStyle.paddingBottom || 0);
        const borderTop = parseFloat(rootStyle.borderTopWidth || 0);
        const borderBottom = parseFloat(rootStyle.borderBottomWidth || 0);
        const handleReserve = 12;

        ui.root.style.height = 'auto';
        const contentHeight = ui.content.scrollHeight;
        const newHeight = Math.max(48, Math.ceil(headerHeight + contentHeight + paddingTop + paddingBottom + borderTop + borderBottom + handleReserve));
        ui.root.style.height = newHeight + 'px';

        ui.content.style.overflow = 'hidden';
    }

    function getUpcomingStarter(rows) {
        const unfinishedRows = rows.filter(r => {
            if (r.ausg && r.ausg.trim()) return false;
            return !UPCOMING_STARTER_EXCLUSIONS.includes(r.starter) && !UPCOMING_STARTER_EXCLUSIONS.includes(`${r.starter}|${r.eing}`);
        });
        if (!unfinishedRows.length) return null;

        const activeStarter = unfinishedRows.find(r => r.aktiv === "1" || r.aktiv === 1);
        if (activeStarter) return activeStarter;

        if (!state.nextStarterByPoints) {
            return unfinishedRows[0];
        }

        return unfinishedRows.reduce((bestRow, currentRow) => {
            const bestPoints = parsePoints(bestRow.eing);
            const currentPoints = parsePoints(currentRow.eing);

            if (bestPoints === null) return currentRow;
            if (currentPoints === null) return bestRow;
            return currentPoints < bestPoints ? currentRow : bestRow;
        });
    }

    function parsePoints(value) {
        const normalized = String(value || '').replace(',', '.').trim();
        if (!normalized) return null;
        const parsed = Number.parseFloat(normalized);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function getFinisherSeedMap(rows) {
        const finishers = rows
            .filter(r => r.ausg && r.ausg.trim())
            .map(r => ({ ...r, eingValue: parsePoints(r.eing) }))
            .filter(r => r.eingValue !== null)
            .sort((a, b) => b.eingValue - a.eingValue);

        const seedMap = new Map();
        finishers.forEach((row, index) => {
            seedMap.set(`${row.starter}|${row.eing}`, index + 1);
        });
        return seedMap;
    }

    function getLatestStarterVisibleCount(rows, finisherSeedMap, manualCount) {
        if (!rankColoringEnabled || highlightedSeedCount < 1) return manualCount;

        const latestStarterIndex = rows.findIndex(r => finisherSeedMap.get(`${r.starter}|${r.eing}`) === 1);
        if (latestStarterIndex === -1) return manualCount;

        return Math.max(manualCount, latestStarterIndex + 1);
    }

    function getSeedColor(seed) {
        const palette = [
            '#ff8a80',
            '#ffb74d',
            '#ffe082',
            '#fff59d',
            '#dced8b',
            '#b2df8a',
            '#80cbc4',
            '#80deea',
            '#90caf9',
            '#b39ddb'
        ];
        return palette[Math.max(0, Math.min(seed - 1, palette.length - 1))];
    }

    function formatSeedLine(lineText, seed) {
        const color = getSeedColor(seed);
        const fontWeight = seed === 1 ? '700' : '400';
        return `<span style="color:${color};font-weight:${fontWeight};">${escapeHTML(lineText)}</span>`;
    }

    function escapeHTML(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function syncCountOptions(ui, tables, preferredCount) {
        const tableIndex = parseInt(ui.selTable.value || '0', 10);
        const table = tables[tableIndex];
        const maxRows = Math.max(1, table?.rows?.length || 1);
        const currentCount = parseInt(ui.selCount.value || '1', 10) || 1;
        const previousValue = preferredCount ?? currentCount;
        const nextValue = Math.min(previousValue, maxRows);

        ui.selCount.innerHTML = '';
        for (let i = 1; i <= maxRows; i++) {
            const o = document.createElement('option');
            o.value = i;
            o.textContent = i;
            ui.selCount.appendChild(o);
        }

        ui.selCount.value = String(nextValue);
        selection.countValue = nextValue;
        state.countValue = nextValue;
        saveState(state);
    }

    function updateLayout(ui, tables) {
        render(ui, tables);
        autoWidth(ui);
        autoHeight(ui);
    }

    function applyDisplayMode(ui) {
        if (!ui?.header) return;
        ui.header.style.display = SHOW_DROPDOWNS ? 'flex' : 'none';
    }

    function hideSettingsMenu(ui) {
        if (!ui?.menu) return;
        ui.menu.style.display = 'none';
    }

    function hideTimerMenu(timerUi) {
        if (!timerUi?.menu) return;
        timerUi.menu.style.display = 'none';
    }

    function syncSettingsMenu(ui, state) {
        if (!ui?.menu) return;
        ui.menuRankColoring.checked = rankColoringEnabled;
        ui.menuHighlightCount.value = String(highlightedSeedCount);
        ui.menuAlpha.value = String(Math.round((state.alpha ?? DEFAULT_ALPHA) * 100));
        ui.menuSourceUrl.value = state.sourceUrl || DEFAULT_SOURCE_URL;
        ui.menuNextByPoints.checked = !!state.nextStarterByPoints;
        ui.menuTimerEnabled.checked = !!state.timerEnabled;
        ui.menuAlphaValue.textContent = `${ui.menuAlpha.value}%`;
    }

    function isTypingTarget(target) {
        if (!target) return false;
        const tagName = target.tagName?.toLowerCase();
        return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable;
    }

    function getActiveVideo() {
        const videos = Array.from(document.querySelectorAll('video'));
        if (!videos.length) return null;

        const visibleVideos = videos.filter(video => {
            const rect = video.getBoundingClientRect();
            const style = window.getComputedStyle(video);
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        });

        const candidates = visibleVideos.length ? visibleVideos : videos;
        return candidates.sort((a, b) => {
            const rectA = a.getBoundingClientRect();
            const rectB = b.getBoundingClientRect();
            return (rectB.width * rectB.height) - (rectA.width * rectA.height);
        })[0] || null;
    }

    function showSettingsMenu(ui, ev, state) {
        if (!ui?.menu) return;
        syncSettingsMenu(ui, state);

        const rootRect = ui.root.getBoundingClientRect();
        ui.menu.style.display = 'flex';
        const menuWidth = ui.menu.offsetWidth;
        const menuHeight = ui.menu.offsetHeight;
        const left = Math.min(Math.max(0, ev.clientX - rootRect.left), Math.max(0, rootRect.width - menuWidth - 8));
        const top = Math.min(Math.max(0, ev.clientY - rootRect.top), Math.max(0, rootRect.height - menuHeight - 8));
        ui.menu.style.left = `${left}px`;
        ui.menu.style.top = `${top}px`;
    }

    function showTimerMenu(timerUi, ev) {
        if (!timerUi?.menu) return;
        syncTimerMenu();

        const rootRect = timerUi.root.getBoundingClientRect();
        timerUi.menu.style.display = 'flex';
        const menuWidth = timerUi.menu.offsetWidth;
        const menuHeight = timerUi.menu.offsetHeight;
        const left = Math.min(Math.max(0, ev.clientX - rootRect.left), Math.max(0, rootRect.width - menuWidth - 8));
        const top = Math.min(Math.max(0, ev.clientY - rootRect.top), Math.max(0, rootRect.height - menuHeight - 8));
        timerUi.menu.style.left = `${left}px`;
        timerUi.menu.style.top = `${top}px`;
    }

    function cycleDisplayMode(ui) {
        if (!showUpcomingStarter && !SHOW_DROPDOWNS) {
            showUpcomingStarter = true;
            SHOW_DROPDOWNS = false;
        } else if (showUpcomingStarter && !SHOW_DROPDOWNS) {
            showUpcomingStarter = true;
            SHOW_DROPDOWNS = true;
        } else {
            showUpcomingStarter = false;
            SHOW_DROPDOWNS = false;
        }

        applyDisplayMode(ui);
    }

    function render(ui, tables) {
        const i = parseInt(ui.selTable.value || '0', 10);
        const t = tables[i];
        if (!t) return (ui.content.textContent = 'Keine Tabelle gefunden.');

        const upcomingStarter = getUpcomingStarter(t.rows);
        const finisherSeedMap = getFinisherSeedMap(t.rows);
        const manualCount = Math.max(1, parseInt(selection.countValue || '3', 10) || 3);
        const visibleCount = getLatestStarterVisibleCount(t.rows, finisherSeedMap, manualCount);
        const rows = t.rows.slice(0, visibleCount);

        if (ui.selCount.value !== String(visibleCount)) {
            ui.selCount.value = String(visibleCount);
        }

        const fallbackStarterName = 'nicht verfuegbar';
        const maxStarterLen = Math.max(...rows.map(r => r.starter.length), fallbackStarterName.length);
        const maxPointsLen = Math.max(...rows.map(r => r.ausg.length), 0);

        const lines = rows.map(r => {
            const platz = r.platz.padStart(2, ' ');
            const starter = r.starter.padEnd(maxStarterLen, ' ');
            const points = r.ausg.padStart(maxPointsLen, ' ');
            const lineText = `${platz}: ${starter} - ${points} Punkte`;
            const seed = finisherSeedMap.get(`${r.starter}|${r.eing}`);
            if (rankColoringEnabled && seed >= 1 && seed <= highlightedSeedCount) {
                return formatSeedLine(lineText, seed);
            }
            return lineText;
        });

        if (showUpcomingStarter) {
            const platz = 'N'.padStart(2, ' ');
            const starterName = upcomingStarter ? upcomingStarter.starter : fallbackStarterName;
            const starter = starterName.padEnd(maxStarterLen, ' ');
            const pointsValue = upcomingStarter ? upcomingStarter.eing : '';
            const points = pointsValue.padStart(maxPointsLen, ' ');
            lines.push(`<span class="hr_upcoming">${escapeHTML(`${platz}: ${starter} - ${points} Punkte`)}</span>`);
        }

        ui.content.innerHTML = lines.map(line => line.startsWith('<span') ? line : escapeHTML(line)).join('\n');
    }


    /* --- Hauptlogik --- */

    let state, selection;
    let overlayVisible = true;
    let overlayHovered = false;

    async function refresh() {
        try {
            tables = await fetchData(SOURCE_URL);

            ui.selTable.innerHTML = '';
            tables.forEach((t, i) => {
                const o = document.createElement('option');
                o.value = i;
                o.textContent = t.title.replace(/^Disziplin:\s*/i, '').trim();
                ui.selTable.appendChild(o);
            });

            if (selection.tableIndex < tables.length) {
                ui.selTable.value = selection.tableIndex;
            } else {
                selection.tableIndex = 0;
                ui.selTable.value = 0;
            }

            syncCountOptions(ui, tables, selection.countValue);

            ui.selTable.onchange = () => {
                selection.tableIndex = parseInt(ui.selTable.value, 10);
                state.tableIndex = selection.tableIndex;
                saveState(state);
                syncCountOptions(ui, tables, selection.countValue);
                updateLayout(ui, tables);
            };

            ui.selCount.onchange = () => {
                selection.countValue = parseInt(ui.selCount.value, 10);
                state.countValue = selection.countValue;
                saveState(state);
                updateLayout(ui, tables);
            };

            requestAnimationFrame(() => {
                updateLayout(ui, tables);
            });

        } catch (err) {
            ui.content.textContent = 'Fehler beim Laden.';
        }
    }

    function init() {
        if (!document.body) {
            window.addEventListener('DOMContentLoaded', init, { once: true });
            return;
        }

        state = loadState();
        state.sourceUrl = (state.sourceUrl || DEFAULT_SOURCE_URL).trim() || DEFAULT_SOURCE_URL;
        state.nextStarterByPoints = state.nextStarterByPoints ?? true;
        state.timerEnabled = state.timerEnabled ?? false;
        state.timerDingEnabled = state.timerDingEnabled ?? true;
        state.timerAutoFit = state.timerAutoFit ?? true;
        state.timerSeconds = resolveTimerSeconds(state.timerSeconds)
            ?? parseTimerDurationInput(state.timerDuration)
            ?? (Number.isFinite(parseInt(state.timerMinutes, 10)) ? Math.max(1, parseInt(state.timerMinutes, 10) * 60) : null)
            ?? DEFAULT_TIMER_SECONDS;
        state.timerDuration = formatTimerTime(state.timerSeconds);
        delete state.timerMinutes;
        SOURCE_URL = (state.sourceUrl || DEFAULT_SOURCE_URL).trim() || DEFAULT_SOURCE_URL;

        ui = createOverlay();
        ui.root.style.fontSize = BASE_FONT_SIZE + 'px';
        rankColoringEnabled = state.rankColoringEnabled ?? true;
        highlightedSeedCount = Math.max(0, Math.min(10, parseInt(state.highlightedSeedCount ?? DEFAULT_HIGHLIGHTED_SEED_COUNT, 10) || DEFAULT_HIGHLIGHTED_SEED_COUNT));

        state.alpha = state.alpha ?? DEFAULT_ALPHA;
        applyOverlayAlpha(ui, state.alpha);

        makeDraggable(ui.root, () => {
            const rect = ui.root.getBoundingClientRect();
            Object.assign(state, { left: rect.left + 'px', top: rect.top + 'px' });
            saveState(state);
        }, {
            shouldBlockDrag: () => isSettingsMenuOpen(ui),
            ignoreSelectors: ['.hr_menu']
        });
        makeResizable(ui.root, ui.resizeHandle, () => {
            const rect = ui.root.getBoundingClientRect();
            Object.assign(state, { width: rect.width + 'px', height: rect.height + 'px', fontSize: ui.root.style.fontSize });
            saveState(state);
        }, {
            onResize: ({ scale, el }) => {
                el.querySelectorAll('select').forEach(sel => {
                    sel.style.fontSize = (13 * scale) + 'px';
                    sel.style.padding = `${(4 * scale)}px`;
                });
            }
        });

        selection = {
            tableIndex: state.tableIndex || 0,
            countValue: state.countValue || 3
        };

        timerUi = createTimerOverlay();
        timerState = {
            totalSeconds: state.timerSeconds,
            remainingSeconds: state.timerSeconds,
            running: false,
            interval: null,
            alerted: false
        };
        timerUi.root.style.fontSize = BASE_FONT_SIZE + 'px';
        if (!state.timerAutoFit && state.timerWidth) timerUi.root.style.width = state.timerWidth;
        if (state.timerLeft && state.timerTop) {
            timerUi.root.style.left = state.timerLeft;
            timerUi.root.style.top = state.timerTop;
            timerUi.root.style.right = 'auto';
            timerUi.root.style.bottom = 'auto';
        }
        timerUi.root.style.fontSize = state.timerFontSize || '13px';
        delete state.timerHeight;
        if (state.timerAutoFit) {
            delete state.timerWidth;
        }

        makeDraggable(timerUi.root, () => {
            const rect = timerUi.root.getBoundingClientRect();
            Object.assign(state, { timerLeft: rect.left + 'px', timerTop: rect.top + 'px' });
            saveState(state);
        }, {
            shouldBlockDrag: () => isTimerMenuOpen(timerUi),
            ignoreSelectors: ['.hr_timer_menu']
        });
        makeResizable(timerUi.root, timerUi.resizeHandle, () => {
            const rect = timerUi.root.getBoundingClientRect();
            Object.assign(state, {
                timerFontSize: timerUi.root.style.fontSize
            });
            state.timerAutoFit = true;
            delete state.timerWidth;
            delete state.timerHeight;
            saveState(state);
            timerUi.root.style.width = 'max-content';
            scheduleTimerHeightSync();
        }, {
            onResize: ({ scale, el }) => {
                const timeEl = el.querySelector('.hr_timer_time');
                const buttonsEl = el.querySelector('.hr_timer_buttons');
                const buttonEls = el.querySelectorAll('.hr_timer_buttons button');
                const bodyEl = el.querySelector('.hr_timer_body');

                if (bodyEl) {
                    bodyEl.style.gap = `${Math.max(3, 6 * scale)}px`;
                }
                if (timeEl) {
                    timeEl.style.fontSize = `${28 * scale}px`;
                    timeEl.style.width = `${5.2 * scale}ch`;
                }
                if (buttonsEl) {
                    buttonsEl.style.gap = `${Math.max(2, 3 * scale)}px`;
                }
                buttonEls.forEach(btn => {
                    const size = Math.max(22, 32 * scale);
                    btn.style.width = `${size}px`;
                    btn.style.height = `${size}px`;
                    btn.style.fontSize = `${Math.max(10, 15 * scale)}px`;
                });
                scheduleTimerHeightSync();
            }
        });

        syncTimerMenu();
        updateTimerDisplay();
        applyTimerVisibility();

        document.addEventListener('fullscreenchange', () => {
            attachToFullscreen(ui.root);
            attachToFullscreen(timerUi.root);
            requestAnimationFrame(() => updateLayout(ui, tables));
        });

        window.addEventListener('resize', () => {
            if (ui.root.style.display === 'none' && timerUi.root.style.display === 'none') return;
            requestAnimationFrame(() => updateLayout(ui, tables));
        });

        refresh();
        setInterval(refresh, REFRESH_INTERVAL);

        // --- Keyboard Controls ---
        window.addEventListener('keydown', (ev) => {
            if (!overlayVisible || !overlayHovered || !ui || !ui.root) return;
            switch (ev.key) {
                case '#': {
                    SHOW_DROPDOWNS = !SHOW_DROPDOWNS;
                    applyDisplayMode(ui);
                    updateLayout(ui, tables);
                    break;
                }

                case '+': {
                    state.alpha = Math.min((state.alpha ?? 0.8) + 0.05, 1);
                    applyOverlayAlpha(ui, state.alpha);
                    syncSettingsMenu(ui, state);
                    saveState(state);
                    break;
                }

                case '-': {
                    state.alpha = Math.max((state.alpha ?? 0.8) - 0.05, 0);
                    applyOverlayAlpha(ui, state.alpha);
                    syncSettingsMenu(ui, state);
                    saveState(state);
                    break;
                }

                case 'F1': {
                    ev.preventDefault();
                    window.open(SOURCE_URL, '_blank');
                    break;
                }

                case 'F2': {
                    ev.preventDefault();
                    showUpcomingStarter = !showUpcomingStarter;
                    applyDisplayMode(ui);
                    updateLayout(ui, tables);
                    break;
                }
            }
        });

        // --- Video Controls ---
        window.addEventListener('keydown', (ev) => {
            if (isTypingTarget(ev.target)) return;
            if (overlayVisible && overlayHovered) return;

            const video = getActiveVideo();
            if (!video) return;

            switch (ev.key) {
                case ' ':
                case 'Spacebar': {
                    ev.preventDefault();
                    ev.stopPropagation();
                    ev.stopImmediatePropagation?.();
                    if (video.paused) {
                        video.play?.().catch(() => {});
                    } else {
                        video.pause?.();
                    }
                    break;
                }

                case 'ArrowLeft': {
                    ev.preventDefault();
                    ev.stopPropagation();
                    ev.stopImmediatePropagation?.();
                    video.currentTime = Math.max(0, (video.currentTime || 0) - 5);
                    break;
                }

                case 'ArrowRight': {
                    ev.preventDefault();
                    ev.stopPropagation();
                    ev.stopImmediatePropagation?.();
                    const duration = Number.isFinite(video.duration) ? video.duration : Number.POSITIVE_INFINITY;
                    video.currentTime = Math.min(duration, (video.currentTime || 0) + 5);
                    break;
                }

                case 'm':
                case 'M': {
                    ev.preventDefault();
                    ev.stopPropagation();
                    ev.stopImmediatePropagation?.();
                    video.muted = !video.muted;
                    break;
                }
            }
        }, true);

        /* --- Mouse Controls --- */
        ui.root.addEventListener('mouseenter', () => { overlayHovered = true; });
        ui.root.addEventListener('mouseleave', () => { overlayHovered = false; });

        ui.root.addEventListener('contextmenu', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            showSettingsMenu(ui, ev, state);
        });

        ui.menu.addEventListener('mousedown', (ev) => { ev.stopPropagation(); });
        ui.menu.addEventListener('click', (ev) => { ev.stopPropagation(); });

        ui.menuRankColoring.addEventListener('change', () => {
            rankColoringEnabled = ui.menuRankColoring.checked;
            state.rankColoringEnabled = rankColoringEnabled;
            saveState(state);
            updateLayout(ui, tables);
        });

        ui.menuHighlightCount.addEventListener('input', () => {
            let nextValue = parseInt(ui.menuHighlightCount.value, 10);
            if (!Number.isFinite(nextValue)) nextValue = DEFAULT_HIGHLIGHTED_SEED_COUNT;
            highlightedSeedCount = Math.max(0, Math.min(10, nextValue));
            ui.menuHighlightCount.value = String(highlightedSeedCount);
            state.highlightedSeedCount = highlightedSeedCount;
            saveState(state);
            updateLayout(ui, tables);
        });

        ui.menuAlpha.addEventListener('input', () => {
            state.alpha = Math.max(0, Math.min(1, parseInt(ui.menuAlpha.value, 10) / 100));
            ui.menuAlphaValue.textContent = `${ui.menuAlpha.value}%`;
            applyOverlayAlpha(ui, state.alpha);
            saveState(state);
        });

        ui.menuSourceUrl.addEventListener('change', () => {
            const nextUrl = ui.menuSourceUrl.value.trim() || DEFAULT_SOURCE_URL;
            SOURCE_URL = nextUrl;
            state.sourceUrl = nextUrl;
            saveState(state);
            refresh();
        });

        ui.menuNextByPoints.addEventListener('change', () => {
            state.nextStarterByPoints = ui.menuNextByPoints.checked;
            saveState(state);
            updateLayout(ui, tables);
        });

        ui.menuTimerEnabled.addEventListener('change', () => {
            state.timerEnabled = ui.menuTimerEnabled.checked;
            saveState(state);
            applyTimerVisibility();
        });

        ui.menuReset.addEventListener('click', () => {
            rankColoringEnabled = true;
            highlightedSeedCount = DEFAULT_HIGHLIGHTED_SEED_COUNT;
            state.rankColoringEnabled = true;
            state.highlightedSeedCount = DEFAULT_HIGHLIGHTED_SEED_COUNT;
            state.alpha = DEFAULT_ALPHA;
            state.sourceUrl = DEFAULT_SOURCE_URL;
            state.nextStarterByPoints = true;
            SOURCE_URL = DEFAULT_SOURCE_URL;
            state.timerEnabled = false;
            state.timerSeconds = DEFAULT_TIMER_SECONDS;
            state.timerDuration = formatTimerTime(DEFAULT_TIMER_SECONDS);
            state.timerDingEnabled = true;
            state.timerAutoFit = true;
            delete state.timerHeight;
            delete state.timerWidth;
            applyOverlayAlpha(ui, state.alpha);
            syncSettingsMenu(ui, state);
            saveState(state);
            updateLayout(ui, tables);
            setTimerDuration(DEFAULT_TIMER_SECONDS);
            state.timerDingEnabled = true;
            syncTimerMenu();
            applyTimerVisibility();
        });

        timerUi.root.addEventListener('contextmenu', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            hideSettingsMenu(ui);
            showTimerMenu(timerUi, ev);
        });

        timerUi.menu.addEventListener('mousedown', (ev) => { ev.stopPropagation(); });
        timerUi.menu.addEventListener('click', (ev) => { ev.stopPropagation(); });

        timerUi.toggle.addEventListener('click', (ev) => {
            ev.stopPropagation();
            if (timerState.remainingSeconds <= 0) resetTimer();
            if (timerState.running) pauseTimer(); else startTimer();
        });

        timerUi.reset.addEventListener('click', (ev) => {
            ev.stopPropagation();
            resetTimer();
        });

        timerUi.menuDuration.addEventListener('change', () => {
            setTimerDuration(timerUi.menuDuration.value);
        });

        timerUi.menuDing.addEventListener('change', () => {
            state.timerDingEnabled = timerUi.menuDing.checked;
            saveState(state);
        });

        document.addEventListener('mousedown', (ev) => {
            if (ui.root.contains(ev.target) || timerUi.root.contains(ev.target)) return;
            hideSettingsMenu(ui);
            hideTimerMenu(timerUi);
        });

        ui.root.addEventListener('mousedown', (ev) => {
            if (ev.button !== 1) return;
            ev.preventDefault();
        });

        window.addEventListener('mousedown', (ev) => {
            if (ev.button !== 1) return;
            if (ui.root.contains(ev.target)) return;
            ev.preventDefault();
        }, true);

        function toggleOverlay() {
            overlayVisible = !overlayVisible;
            ui.root.style.display = overlayVisible ? 'flex' : 'none';
            if (!overlayVisible) overlayHovered = false;
        }

        ui.root.addEventListener('auxclick', (ev) => {
            if (ev.button !== 1) return;
            ev.preventDefault();
            ev.stopPropagation();
            ev.stopImmediatePropagation?.();
            cycleDisplayMode(ui);
            updateLayout(ui, tables);
        });

        window.addEventListener('auxclick', (ev) => {
            if (ev.button !== 1) return;
            if (ui.root.contains(ev.target)) return;
            ev.preventDefault();
            toggleOverlay();
        });

        window.addEventListener('wheel', (ev) => {
            if (!overlayVisible || !overlayHovered || !ui || !ui.selTable || !ui.selCount) return;

            ev.preventDefault();

            if (Math.abs(ev.deltaY) > Math.abs(ev.deltaX)) {
                let current = parseInt(ui.selCount.value, 10) || 3;
                const maxRows = ui.selCount.options.length || 1;
                if (ev.deltaY < 0) current = Math.min(current + 1, maxRows);
                if (ev.deltaY > 0) current = Math.max(current - 1, 1);
                ui.selCount.value = current;
                selection.countValue = current;
                state.countValue = current;
                saveState(state);
                updateLayout(ui, tables);
                return;
            }

            if (Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) {
                let idx = parseInt(ui.selTable.value, 10) || 0;
                const total = ui.selTable.options.length;
                if (ev.deltaX < 0) idx = (idx - 1 + total) % total;
                if (ev.deltaX > 0) idx = (idx + 1) % total;
                ui.selTable.value = idx;
                selection.tableIndex = idx;
                state.tableIndex = idx;
                saveState(state);
                syncCountOptions(ui, tables, selection.countValue);
                updateLayout(ui, tables);
                return;
            }
        }, { passive: false });
    }

    init();
})();
