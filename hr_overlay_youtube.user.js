// ==UserScript==
// @name         Hallenradsport Overlay YouTube
// @namespace    hallenradsport-overlay
// @version      1.8
// @description  Zeigt Live-Ergebnisse von hallenradsport-daum.de als flexibles Overlay (mit Autosize, Fullscreen-Fix & persistenter Auswahl)
// @author       you
// @match        *://www.youtube.com/*
// @match        *://youtube.com/*
// @downloadURL  https://raw.githubusercontent.com/soulseek2x-gif/tampermonkey-scripts/main/hr_overlay_youtube.user.js
// @updateURL    https://raw.githubusercontent.com/soulseek2x-gif/tampermonkey-scripts/main/hr_overlay_youtube.user.js
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      hallenradsport-daum.de
// ==/UserScript==

(function () {
    'use strict';

    const SOURCE_URL = 'https://www.hallenradsport-daum.de/index.php/live/live-kunstradgc';
    const REFRESH_INTERVAL = 30000;
    const STORAGE_KEY = 'hr_overlay_youtube_state_v1';
    const BASE_FONT_SIZE = 30; // Init-Schriftgröße (px)
    const COL_PLATZ = 0; // Spalte für Platzierung
    const COL_STARTER = 1; // Spalte für Startername
    const COL_EING = 3; // Spalte für Startername
    const COL_AUSG = 4; // Spalte für ausgefahrene Punkte
    const MAX_ROWS = 20; // Maximal angezeigte Reihen
    const DEFAULT_ALPHA = 0.8;
    const DEFAULT_HIGHLIGHTED_SEED_COUNT = 3;
    const trustedHTMLPolicy = window.trustedTypes?.createPolicy?.('hr-overlay-youtube', {
        createHTML: (input) => input
    });
    let tables = []; // globale Tabelle für Hotkeys / render
    let SHOW_DROPDOWNS = false; // set to false to start with dropdowns hidden
    let showUpcomingStarter = false;
    let rankColoringEnabled = true;
    let highlightedSeedCount = DEFAULT_HIGHLIGHTED_SEED_COUNT;

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
  `);

    /* --- Hilfsfunktionen --- */

    function gmFetchHTML() {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: SOURCE_URL,
                onload: (r) => resolve(r.responseText),
                onerror: reject
            });
        });
    }

    function parseHTML(html) {
        const parser = new DOMParser();
        const trustedHTML = trustedHTMLPolicy ? trustedHTMLPolicy.createHTML(html) : html;
        const doc = parser.parseFromString(trustedHTML, 'text/html');
        const result = [];
        const h2s = doc.querySelectorAll('h2');
        h2s.forEach((h2) => {
            const txt = h2.textContent.trim();
            if (!txt.toLowerCase().startsWith('disziplin')) return;
            let el = h2.nextElementSibling;
            while (el && el.tagName !== 'TABLE') el = el.nextElementSibling;
            if (!el) return;
            const rows = Array.from(el.querySelectorAll('tbody tr')).map(tr => {
                const cells = tr.querySelectorAll('td');
                if (cells.length < 5) return null;
                return {
                    platz: cells[COL_PLATZ].textContent.trim(),
                    starter: cells[COL_STARTER].textContent.trim(),
                    eing: cells[COL_EING].textContent.trim(),
                    ausg: cells[COL_AUSG].textContent.trim()
                };
            }).filter(Boolean);
            result.push({ title: txt, rows });
        });
        return result;
    }

    /* --- Overlay erstellen --- */

    function getOverlayHost() {
        return document.querySelector('ytd-app') || document.body || document.documentElement;
    }

    function createOverlay() {
        const host = getOverlayHost();
        const root = document.createElement('div');
        root.id = 'hr_overlay';

        const header = document.createElement('div');
        header.className = 'hr_row';
        header.id = 'hr_header';

        const selTable = document.createElement('select');
        selTable.id = 'hr_table';
        const selCount = document.createElement('select');
        selCount.id = 'hr_count';
        header.append(selTable, selCount);

        const content = document.createElement('div');
        content.className = 'hr_content';
        content.id = 'hr_content';
        content.textContent = 'Lade Daten...';

        const menu = document.createElement('div');
        menu.className = 'hr_menu';
        menu.id = 'hr_menu';

        const rankLabel = document.createElement('label');
        const rankText = document.createElement('span');
        rankText.textContent = 'Rank coloring';
        const rankInput = document.createElement('input');
        rankInput.type = 'checkbox';
        rankInput.id = 'hr_rank_coloring';
        rankLabel.append(rankText, rankInput);

        const countLabel = document.createElement('label');
        const countText = document.createElement('span');
        countText.textContent = 'Highlighted finishers';
        const countInput = document.createElement('input');
        countInput.type = 'number';
        countInput.id = 'hr_highlight_count';
        countInput.min = '0';
        countInput.max = '10';
        countInput.step = '1';
        countLabel.append(countText, countInput);

        const alphaLabel = document.createElement('label');
        const alphaText = document.createElement('span');
        alphaText.textContent = 'Transparency';
        const alphaInput = document.createElement('input');
        alphaInput.type = 'range';
        alphaInput.id = 'hr_alpha';
        alphaInput.min = '0';
        alphaInput.max = '100';
        alphaInput.step = '5';
        alphaLabel.append(alphaText, alphaInput);

        const menuLabel = document.createElement('div');
        menuLabel.className = 'hr_menu_label';
        const alphaValue = document.createElement('span');
        alphaValue.id = 'hr_alpha_value';
        alphaValue.textContent = '80%';
        const resetButton = document.createElement('button');
        resetButton.type = 'button';
        resetButton.id = 'hr_reset_settings';
        resetButton.textContent = 'Reset';
        menuLabel.append(alphaValue, resetButton);

        menu.append(rankLabel, countLabel, alphaLabel, menuLabel);

        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'resize-handle';

        root.append(header, content, menu, resizeHandle);
        host.appendChild(root);

        // Apply initial dropdown visibility
        header.style.display = SHOW_DROPDOWNS ? 'flex' : 'none';

        return {
            root,
            header, // Header für Breiten/Höhenberechnung
            selTable,
            selCount,
            content,
            menu,
            menuRankColoring: rankInput,
            menuHighlightCount: countInput,
            menuAlpha: alphaInput,
            menuAlphaValue: alphaValue,
            menuReset: resetButton,
            resizeHandle
        };
    }

    function loadState() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
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

    /* --- Drag & Resize --- */

    function makeDraggable(el, onSave) {
        let dragging = false;
        let startX, startY, origLeft, origTop;
        el.addEventListener('pointerdown', (ev) => {
            if (ev.button !== 0) return;
            if (isSettingsMenuOpen(ui)) return;
            if (ev.target.tagName === 'SELECT' || ev.target.classList.contains('resize-handle')) return;
            if (ev.target.closest('.hr_menu')) return;
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

    function makeResizable(el, handle, onEnd) {
        let resizing = false;
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
            el.querySelectorAll('select').forEach(sel => {
                sel.style.fontSize = (13 * scale) + 'px';
                sel.style.padding = `${(4 * scale)}px`;
            });
        });

        window.addEventListener('pointerup', (ev) => {
            if (!resizing) return;
            resizing = false;
            try { handle.releasePointerCapture(ev.pointerId); } catch {}
            if (onEnd) onEnd();

            // Nach Resize Auto-Anpassung aufrufen
            if (typeof ui !== 'undefined') {
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

    /* --- Inhalt / Anzeige --- */

    function autoWidth(ui) {
        if (!ui.content) return;

        const temp = document.createElement('div');
        temp.style.position = 'absolute';
        temp.style.visibility = 'hidden';
        temp.style.whiteSpace = 'pre'; // must match display mode
        temp.style.fontSize = window.getComputedStyle(ui.root).fontSize;
        temp.style.fontFamily = window.getComputedStyle(ui.root).fontFamily;
        temp.style.fontWeight = window.getComputedStyle(ui.root).fontWeight;
        temp.style.lineHeight = window.getComputedStyle(ui.root).lineHeight;
        document.body.appendChild(temp);

        // Use textContent and split on newline (render now uses textContent with \n)
        const lines = (ui.content.textContent || '').split('\n').map(line => line.replace(/<\/?[^>]+>/g, '').trim());

        let maxWidth = 0;
        for (const line of lines) {
            temp.textContent = line || ' ';
            const w = temp.scrollWidth;
            if (w > maxWidth) maxWidth = w;
        }

        // Width of dropdowns (header)
        let dropWidth = 0;
        if (ui.header) {
            const selects = ui.header.querySelectorAll('select');
            selects.forEach(s => {
                dropWidth += s.offsetWidth;
            });
            dropWidth += (selects.length - 1) * 5; // spacing between dropdowns
        }

        ui.root.style.width = Math.max(maxWidth + 40, dropWidth + 20) + 'px';

        document.body.removeChild(temp);
    }

    function autoHeight(ui) {
        if (!ui.content) return;

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

        // Optional: Overlay scrollbar verhindern
        ui.content.style.overflow = 'hidden';
    }

    function getUpcomingStarter(rows) {
        return rows.find(r => !r.ausg || !r.ausg.trim()) || null;
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

        ui.selCount.replaceChildren();
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

    function ensureOverlayAttached(ui) {
        if (!ui?.root) return;
        const fs = document.fullscreenElement;
        if (fs?.contains(ui.root)) return;

        const host = getOverlayHost();
        if (host && !host.contains(ui.root)) {
            host.appendChild(ui.root);
            ui.root.style.position = 'fixed';
        }
    }

    function hideSettingsMenu(ui) {
        if (!ui?.menu) return;
        ui.menu.style.display = 'none';
    }

    function syncSettingsMenu(ui, state) {
        if (!ui?.menu) return;
        ui.menuRankColoring.checked = rankColoringEnabled;
        ui.menuHighlightCount.value = String(highlightedSeedCount);
        ui.menuAlpha.value = String(Math.round((state.alpha ?? DEFAULT_ALPHA) * 100));
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

        // Determine longest starter and points strings
        const fallbackStarterName = 'nicht verfuegbar';
        const maxStarterLen = Math.max(...rows.map(r => r.starter.length), fallbackStarterName.length);
        const maxPointsLen = Math.max(...rows.map(r => r.ausg.length), 0);

        // Pad everything for alignment
        const lines = rows.map(r => {
            const platz = r.platz.padStart(2, ' ');
            const starter = r.starter.padEnd(maxStarterLen, ' ');
            const points = r.ausg.padStart(maxPointsLen, ' ');
            const lineText = `${platz}: ${starter} - ${points} Punkte`;
            const seed = finisherSeedMap.get(`${r.starter}|${r.eing}`);
            if (rankColoringEnabled && seed >= 1 && seed <= highlightedSeedCount) {
                return { text: lineText, color: getSeedColor(seed), fontWeight: seed === 1 ? '700' : '400' };
            }
            return { text: lineText };
        });

        if (showUpcomingStarter) {
            const platz = 'N'.padStart(2, ' ');
            const starterName = upcomingStarter ? upcomingStarter.starter : fallbackStarterName;
            const starter = starterName.padEnd(maxStarterLen, ' ');
            const pointsValue = upcomingStarter ? upcomingStarter.eing : '';
            const points = pointsValue.padStart(maxPointsLen, ' ');
            lines.push({ text: `${platz}: ${starter} - ${points} Punkte`, className: 'hr_upcoming' });
        }

        ui.content.replaceChildren();
        lines.forEach((line, index) => {
            if (index > 0) ui.content.appendChild(document.createTextNode('\n'));
            const node = document.createElement('span');
            node.textContent = line.text;
            if (line.className) node.className = line.className;
            if (line.color) node.style.color = line.color;
            if (line.fontWeight) node.style.fontWeight = line.fontWeight;
            ui.content.appendChild(node);
        });
    }


    /* --- Hauptlogik --- */

    const state = loadState();
    const ui = createOverlay();
    ui.root.style.fontSize = BASE_FONT_SIZE + 'px';
    rankColoringEnabled = state.rankColoringEnabled ?? true;
    highlightedSeedCount = Math.max(0, Math.min(10, parseInt(state.highlightedSeedCount ?? DEFAULT_HIGHLIGHTED_SEED_COUNT, 10) || DEFAULT_HIGHLIGHTED_SEED_COUNT));

    // --- initialize overlay transparency ---
    state.alpha = state.alpha ?? DEFAULT_ALPHA; // default alpha if not stored
    applyOverlayAlpha(ui, state.alpha);

    makeDraggable(ui.root, () => {
        const rect = ui.root.getBoundingClientRect();
        Object.assign(state, { left: rect.left + 'px', top: rect.top + 'px' });
        saveState(state);
    });
    makeResizable(ui.root, ui.resizeHandle, () => {
        const rect = ui.root.getBoundingClientRect();
        Object.assign(state, { width: rect.width + 'px', height: rect.height + 'px', fontSize: ui.root.style.fontSize });
        saveState(state);
    });

    const selection = {
        tableIndex: state.tableIndex || 0,
        countValue: state.countValue || 3
    };

    document.addEventListener('fullscreenchange', () => {
        attachToFullscreen(ui.root);
        requestAnimationFrame(() => updateLayout(ui, tables));
    });

    window.addEventListener('resize', () => {
        if (ui.root.style.display === 'none') return;
        requestAnimationFrame(() => updateLayout(ui, tables));
    });

    async function refresh() {
        try {
            ensureOverlayAttached(ui);
            const html = await gmFetchHTML();
            tables = parseHTML(html);

            // --- Tabelle Dropdown ---
            ui.selTable.replaceChildren();
            tables.forEach((t, i) => {
                const o = document.createElement('option');
                o.value = i;
                o.textContent = t.title.replace(/^Disziplin:\s*/i, '').trim();
                ui.selTable.appendChild(o);
            });

            // --- Auswahl aus State setzen ---
            if (selection.tableIndex < tables.length) ui.selTable.value = selection.tableIndex;
            syncCountOptions(ui, tables, selection.countValue);

            // --- Eventhandler für Dropdowns ---
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

            // --- Initiales Rendern + Auto-Größe ---
            requestAnimationFrame(() => {
                updateLayout(ui, tables);
            });

        } catch (err) {
            ui.content.textContent = 'Fehler beim Laden.';
        }
    }

    refresh();
    setInterval(refresh, REFRESH_INTERVAL);
    setInterval(() => ensureOverlayAttached(ui), 1000);

    document.addEventListener('yt-navigate-finish', () => {
        requestAnimationFrame(() => ensureOverlayAttached(ui));
    });

    // --- Keyboard Controls (overlay hovered only) ---
    window.addEventListener('keydown', (ev) => {
        if (!overlayVisible || !overlayHovered || !ui || !ui.root) return;
        switch (ev.key) {
            case '#': {
                SHOW_DROPDOWNS = !SHOW_DROPDOWNS;
                applyDisplayMode(ui);
                updateLayout(ui, tables);
                break;
            }

            case '+': { // more opaque
                state.alpha = Math.min((state.alpha ?? 0.8) + 0.05, 1);
                applyOverlayAlpha(ui, state.alpha);
                syncSettingsMenu(ui, state);
                saveState(state);
                break;
            }

            case '-': { // more transparent
                state.alpha = Math.max((state.alpha ?? 0.8) - 0.05, 0);
                applyOverlayAlpha(ui, state.alpha);
                syncSettingsMenu(ui, state);
                saveState(state);
                break;
            }

            case 'F1': { // open const url
                ev.preventDefault(); // stop browser help
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


    /* --- Mouse Controls (replace # / + / - shortcuts) --- */
    let overlayVisible = true;
    let overlayHovered = false;

    ui.root.addEventListener('mouseenter', () => {
        overlayHovered = true;
    });

    ui.root.addEventListener('mouseleave', () => {
        overlayHovered = false;
    });

    ui.root.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        showSettingsMenu(ui, ev, state);
    });

    ui.menu.addEventListener('mousedown', (ev) => {
        ev.stopPropagation();
    });

    ui.menu.addEventListener('click', (ev) => {
        ev.stopPropagation();
    });

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

    ui.menuReset.addEventListener('click', () => {
        rankColoringEnabled = true;
        highlightedSeedCount = DEFAULT_HIGHLIGHTED_SEED_COUNT;
        state.rankColoringEnabled = true;
        state.highlightedSeedCount = DEFAULT_HIGHLIGHTED_SEED_COUNT;
        state.alpha = DEFAULT_ALPHA;
        applyOverlayAlpha(ui, state.alpha);
        syncSettingsMenu(ui, state);
        saveState(state);
        updateLayout(ui, tables);
    });

    document.addEventListener('mousedown', (ev) => {
        if (ui.root.contains(ev.target)) return;
        hideSettingsMenu(ui);
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

    // Handle middle-click directly on the overlay to cycle display mode
    ui.root.addEventListener('auxclick', (ev) => {
        if (ev.button !== 1) return;
        ev.preventDefault();
        ev.stopPropagation();
        ev.stopImmediatePropagation?.();
        cycleDisplayMode(ui);
        updateLayout(ui, tables);
    });

    // Handle middle-click outside the overlay to toggle overlay visibility
    window.addEventListener('auxclick', (ev) => {
        if (ev.button !== 1) return;
        if (ui.root.contains(ev.target)) return;
        ev.preventDefault();
        toggleOverlay();
    });

    // Handle mouse wheel actions when overlay is hovered
    window.addEventListener('wheel', (ev) => {
        if (!overlayVisible || !overlayHovered || !ui || !ui.selTable || !ui.selCount) return;

        ev.preventDefault();

        // Scroll up/down changes right dropdown (count)
        if (Math.abs(ev.deltaY) > Math.abs(ev.deltaX)) {
            let current = parseInt(ui.selCount.value, 10) || 3;
            const maxRows = ui.selCount.options.length || 1;
            if (ev.deltaY < 0) current = Math.min(current + 1, maxRows); // scroll up
            if (ev.deltaY > 0) current = Math.max(current - 1, 1); // scroll down
            ui.selCount.value = current;
            selection.countValue = current;
            state.countValue = current;
            saveState(state);
            updateLayout(ui, tables);
            return;
        }

        // Scroll left/right cycles through left dropdown (tables)
        if (Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) {
            let idx = parseInt(ui.selTable.value, 10) || 0;
            const total = ui.selTable.options.length;
            if (ev.deltaX < 0) idx = (idx - 1 + total) % total; // scroll left
            if (ev.deltaX > 0) idx = (idx + 1) % total; // scroll right
            ui.selTable.value = idx;
            selection.tableIndex = idx;
            state.tableIndex = idx;
            saveState(state);
            syncCountOptions(ui, tables, selection.countValue);
            updateLayout(ui, tables);
            return;
        }
    }, { passive: false });

})();
