// ==UserScript==
// @name         YouTube Subscriptions Numpad Navigator
// @namespace    https://github.com/soulseek2x-gif/
// @version      0.1.0
// @description  Numpad navigation, selection outline, and watched shortcut for the YouTube subscriptions feed.
// @author       Codex
// @match        https://www.youtube.com/feed/subscriptions*
// @run-at       document-idle
// @grant        GM_openInTab
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEYS = {
        enabled: 'yt_subs_numpad_enabled',
    };

    const SELECTORS = {
        item: 'ytd-rich-item-renderer',
        watchLink: 'a[href^="/watch?v="]',
        titleLink: 'a.ytLockupMetadataViewModelTitle, h3 a[href^="/watch?v="]',
        channelLink: 'a[href^="/@"]',
        watchedButton: 'button[id^="osasoft-better-subscriptions_mark-"]',
        watchedContainer: '.subs-btn-container, #osasoft-better-subscriptions_metadata-line',
        hideWatchedToggle: '#osasoft-better-subscriptions_hide-watched-toggle',
    };

    const FALLBACK_ITEMS_PER_ROW = 5;
    const TOP_GROUP_THRESHOLD = 24;
    const SELECTION_SCROLL_MARGIN_TOP = 96;
    const SELECTION_SCROLL_MARGIN_BOTTOM = 24;
    const NAV_OVERLAY_ID = 'yt-subs-numpad-nav-overlay';
    const STYLE_ID = 'yt-subs-numpad-nav-style';
    const SELECTED_CLASS = 'yt-subs-numpad-selected';
    const HIDDEN_CLASS = 'yt-subs-numpad-hidden-watched';

    const state = {
        enabled: readEnabled(),
        items: [],
        selectedIndex: -1,
        itemsPerRow: FALLBACK_ITEMS_PER_ROW,
        observer: null,
        refreshTimer: null,
        lastUrl: location.href,
        hasPageFocus: document.visibilityState === 'visible' && document.hasFocus(),
    };

    function readEnabled() {
        const raw = localStorage.getItem(STORAGE_KEYS.enabled);
        return raw === null ? true : raw === 'true';
    }

    function writeEnabled(value) {
        state.enabled = value;
        localStorage.setItem(STORAGE_KEYS.enabled, String(value));
        updateSelectionStyles();
    }

    function isSubscriptionsPage() {
        return location.pathname === '/feed/subscriptions';
    }

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            ${SELECTORS.item}.${SELECTED_CLASS} {
                outline: 4px solid #ff2b2b !important;
                outline-offset: 2px !important;
                border-radius: 12px !important;
                box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.55) !important;
            }

            body .${HIDDEN_CLASS} {
                opacity: 0 !important;
                position: absolute !important;
                width: 1px !important;
                height: 1px !important;
                min-width: 1px !important;
                min-height: 1px !important;
                margin: 0 !important;
                padding: 0 !important;
                overflow: hidden !important;
                pointer-events: none !important;
            }

            #${NAV_OVERLAY_ID} {
                position: fixed;
                top: 12px;
                left: 200px;
                z-index: 2147483647;
                background: rgba(15, 15, 15, 0.92);
                color: #fff;
                border: 1px solid rgba(255, 255, 255, 0.18);
                border-radius: 10px;
                padding: 8px 10px;
                font: 12px/1.35 system-ui, sans-serif;
                display: flex;
                align-items: center;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
                cursor: pointer;
            }
        `;

        document.head.appendChild(style);
    }

    function ensureOverlay() {
        let overlay = document.getElementById(NAV_OVERLAY_ID);
        if (overlay) return overlay;

        overlay = document.createElement('div');
        overlay.id = NAV_OVERLAY_ID;

        overlay.addEventListener('click', () => {
            writeEnabled(!state.enabled);
        });

        const status = document.createElement('div');
        status.id = `${NAV_OVERLAY_ID}-status`;

        overlay.append(status);
        document.body.appendChild(overlay);
        return overlay;
    }

    function renderOverlay() {
        const overlay = ensureOverlay();
        overlay.style.display = isSubscriptionsPage() ? 'flex' : 'none';

        const status = document.getElementById(`${NAV_OVERLAY_ID}-status`);

        status.textContent = `Subs nav: ${state.enabled ? 'ON' : 'OFF'}`;
        overlay.style.background = state.enabled ? 'rgba(120, 0, 0, 0.92)' : 'rgba(15, 15, 15, 0.92)';
        overlay.style.borderColor = state.enabled ? 'rgba(255, 77, 77, 0.55)' : 'rgba(255, 255, 255, 0.18)';
    }

    function getVideoIdFromItem(item) {
        const link = item.querySelector(SELECTORS.watchLink);
        if (!link) return '';
        return new URL(link.href, location.origin).searchParams.get('v') || '';
    }

    function collectItems() {
        if (!isSubscriptionsPage()) {
            state.items = [];
            state.selectedIndex = -1;
            updateSelectionStyles();
            return;
        }

        const previousVideoId = state.items[state.selectedIndex]?.videoId || '';
        const candidates = Array.from(document.querySelectorAll(SELECTORS.item))
        .filter((item) => item.querySelector(SELECTORS.watchLink))
        .filter((item) => item.offsetParent !== null);

        state.items = candidates.map((item) => {
            const watchLink = item.querySelector(SELECTORS.watchLink);
            const titleLink = item.querySelector(SELECTORS.titleLink) || watchLink;
            const channelLink = item.querySelector(SELECTORS.channelLink);
            const watchedButton = item.querySelector(SELECTORS.watchedButton);
            const title = titleLink?.textContent?.trim() || '';
            const rect = item.getBoundingClientRect();

            item.querySelectorAll(SELECTORS.watchedContainer).forEach((node) => {
                node.classList.add(HIDDEN_CLASS);
            });
            if (watchedButton) {
                watchedButton.classList.add(HIDDEN_CLASS);
            }

            return {
                element: item,
                watchLink,
                titleLink,
                channelLink,
                watchedButton,
                title,
                videoId: getVideoIdFromItem(item),
                top: rect.top,
            };
        });

        state.itemsPerRow = detectItemsPerRow(state.items);

        if (!state.items.length) {
            state.selectedIndex = -1;
        } else if (previousVideoId) {
            const matchedIndex = state.items.findIndex((item) => item.videoId === previousVideoId);
            state.selectedIndex = matchedIndex >= 0 ? matchedIndex : clampIndex(state.selectedIndex);
        } else if (state.selectedIndex < 0) {
            state.selectedIndex = 0;
        } else {
            state.selectedIndex = clampIndex(state.selectedIndex);
        }

        updateSelectionStyles();
    }

    function detectItemsPerRow(items) {
        if (items.length <= 1) return FALLBACK_ITEMS_PER_ROW;

        const firstTop = items[0].top;
        const firstRowCount = items.filter((item) => Math.abs(item.top - firstTop) <= TOP_GROUP_THRESHOLD).length;
        return firstRowCount > 0 ? firstRowCount : FALLBACK_ITEMS_PER_ROW;
    }

    function clampIndex(index) {
        if (!state.items.length) return -1;
        return Math.max(0, Math.min(index, state.items.length - 1));
    }

    function hasActivePageFocus() {
        return document.visibilityState === 'visible' && state.hasPageFocus;
    }

    function updateSelectionStyles() {
        state.items.forEach((item, index) => {
            item.element.classList.toggle(
                SELECTED_CLASS,
                state.enabled && hasActivePageFocus() && index === state.selectedIndex
            );
        });

        renderOverlay();
    }

    function syncPageFocusState() {
        state.hasPageFocus = document.hasFocus();
        updateSelectionStyles();
    }

    function selectIndex(index, { scroll = true } = {}) {
        if (!state.items.length) return;

        state.selectedIndex = clampIndex(index);
        updateSelectionStyles();

        if (state.enabled && scroll) {
            scrollSelectionIntoView(state.items[state.selectedIndex].element);
        }
    }

    function scrollSelectionIntoView(element) {
        const rect = element.getBoundingClientRect();
        const viewportTop = SELECTION_SCROLL_MARGIN_TOP;
        const viewportBottom = window.innerHeight - SELECTION_SCROLL_MARGIN_BOTTOM;

        if (rect.top < viewportTop) {
            window.scrollBy({
                top: rect.top - viewportTop,
                behavior: 'smooth',
            });
            return;
        }

        if (rect.bottom > viewportBottom) {
            window.scrollBy({
                top: rect.bottom - viewportBottom,
                behavior: 'smooth',
            });
        }
    }

    function moveHorizontal(delta) {
        if (!state.items.length) return;
        selectIndex(state.selectedIndex + delta);
    }

    function moveVertical(deltaRows) {
        if (!state.items.length) return;
        const step = state.itemsPerRow || FALLBACK_ITEMS_PER_ROW;
        selectIndex(state.selectedIndex + (deltaRows * step));
    }

    function openInNewTab(url) {
        if (!url) return;

        if (typeof GM_openInTab === 'function') {
            GM_openInTab(url, {
                active: false,
                insert: true,
                setParent: true,
            });
            return;
        }

        window.open(url, '_blank', 'noopener,noreferrer');
    }

    function activateSelectedVideo() {
        const selected = state.items[state.selectedIndex];
        const url = selected?.titleLink?.href || selected?.watchLink?.href;
        openInNewTab(url);
    }

    function activateSelectedChannel() {
        const selected = state.items[state.selectedIndex];
        openInNewTab(selected?.channelLink?.href);
    }

    function activateWatched() {
        const selected = state.items[state.selectedIndex];
        clickWatchedButton(selected);

        // The page often mutates after marking watched, so recollect soon after.
        window.setTimeout(() => {
            collectItems();
        }, 150);
    }

    function clickWatchedButton(selected) {
        const button = selected?.watchedButton;
        if (!button) return;

        temporarilyExposeForClick(button);
        dispatchPointerLikeClick(button);
    }

    function toggleHideWatched() {
        const toggle = document.querySelector(SELECTORS.hideWatchedToggle);
        if (!toggle) return;

        temporarilyExposeForClick(toggle);
        toggle.click();

        window.setTimeout(() => {
            collectItems();
        }, 200);
    }

    function dispatchPointerLikeClick(element) {
        const mouseInit = { bubbles: true, cancelable: true, composed: true };
        if (typeof PointerEvent === 'function') {
            element.dispatchEvent(new PointerEvent('pointerdown', mouseInit));
        }
        element.dispatchEvent(new MouseEvent('mousedown', mouseInit));
        if (typeof PointerEvent === 'function') {
            element.dispatchEvent(new PointerEvent('pointerup', mouseInit));
        }
        element.dispatchEvent(new MouseEvent('mouseup', mouseInit));
        element.dispatchEvent(new MouseEvent('click', mouseInit));
        element.click();
    }

    function temporarilyExposeForClick(element) {
        const hiddenNodes = [];
        let current = element;

        while (current && current !== document.body) {
            if (current.classList?.contains(HIDDEN_CLASS)) {
                hiddenNodes.push(current);
                current.classList.remove(HIDDEN_CLASS);
            }
            current = current.parentElement;
        }

        if (!hiddenNodes.length) return;

        window.setTimeout(() => {
            hiddenNodes.forEach((node) => node.classList.add(HIDDEN_CLASS));
        }, 0);
    }

    function shouldIgnoreHotkey(event) {
        const target = event.target;
        if (!target) return false;

        const tag = target.tagName;
        return target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    }

    function handleKeydown(event) {
        if (!isSubscriptionsPage() || shouldIgnoreHotkey(event)) return;

        if (!state.enabled) return;

        switch (event.code) {
            case 'Numpad0':
                event.preventDefault();
                GM.closeTab();
                break;
            case 'Numpad1':
                event.preventDefault();
                moveHorizontal(-1);
                break;
            case 'Numpad2':
                event.preventDefault();
                moveVertical(1);
                break;
            case 'Numpad3':
                event.preventDefault();
                moveHorizontal(1);
                break;
            case 'Numpad4':
                event.preventDefault();
                activateWatched();
                break;
            case 'Numpad5':
                event.preventDefault();
                moveVertical(-1);
                break;
            case 'Numpad6':
                event.preventDefault();
                activateSelectedVideo();
                break;
            case 'Numpad7':
                event.preventDefault();
                activateSelectedChannel();
                break;
            case 'Numpad8':
                event.preventDefault();
                activateSelectedVideo();
                window.close();
                break;
            case 'NumpadDecimal':
                event.preventDefault();
                toggleHideWatched();
                break;
            default:
                break;
        }
    }

    function scheduleCollect() {
        window.clearTimeout(state.refreshTimer);
        state.refreshTimer = window.setTimeout(() => {
            collectItems();
        }, 120);
    }

    function observeFeed() {
        state.observer?.disconnect();

        const host = document.querySelector('ytd-app') || document.body;
        if (!host) return;

        state.observer = new MutationObserver(() => {
            if (location.href !== state.lastUrl) {
                state.lastUrl = location.href;
                scheduleCollect();
                renderOverlay();
                return;
            }
            scheduleCollect();
        });

        state.observer.observe(host, {
            childList: true,
            subtree: true,
        });
    }

    function waitForFeed() {
        const interval = window.setInterval(() => {
            const hasItems = document.querySelector(SELECTORS.item);
            if (!isSubscriptionsPage()) {
                renderOverlay();
                return;
            }
            if (!hasItems) return;

            window.clearInterval(interval);
            collectItems();
            observeFeed();
        }, 300);
    }

    function init() {
        ensureStyle();
        ensureOverlay();
        renderOverlay();
        window.addEventListener('keydown', handleKeydown, true);
        window.addEventListener('focus', syncPageFocusState);
        window.addEventListener('blur', syncPageFocusState);
        document.addEventListener('visibilitychange', syncPageFocusState);
        waitForFeed();
        window.setInterval(() => {
            if (location.href !== state.lastUrl) {
                state.lastUrl = location.href;
                waitForFeed();
                renderOverlay();
            }
        }, 500);
    }

    init();
})();
