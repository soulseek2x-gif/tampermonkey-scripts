// ==UserScript==
// @name         SportEurope - Sort by Date
// @namespace    https://tampermonkey.net/
// @version      1.1
// @description  Sort SportEurope search results newest first
// @author       SoulSeek2
// @match        https://sporteurope.tv/suche/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    let sorting = false;

    function parseGermanDate(text) {
        const m = text.match(/(\d{2})\.(\d{2})\.(\d{2}),\s*(\d{2}):(\d{2})/);
        if (!m) return 0;

        let [, d, mo, y, h, mi] = m;

        y = Number(y);
        y += (y < 70 ? 2000 : 1900);

        return new Date(y, mo - 1, d, h, mi).getTime();
    }

    function sortResults() {

        if (sorting) return;
        sorting = true;

        const grid = document.querySelector('div[style*="display: grid"]');

        if (!grid) {
            sorting = false;
            return;
        }

        const items = [...grid.children].map(container => {

            const dateEl = [...container.querySelectorAll("p")]
                .find(p => /\d{2}\.\d{2}\.\d{2}/.test(p.textContent));

            return {
                element: container,
                date: dateEl ? parseGermanDate(dateEl.textContent) : 0
            };
        });

        items.sort((a, b) => b.date - a.date);

        items.forEach(item => grid.appendChild(item.element));

        console.log(
            "Sorted",
            items.length,
            "items. Newest:",
            new Date(items[0].date).toLocaleString()
        );

        sorting = false;
    }

    // expose for console
    window.sortSportEurope = sortResults;

    // Ctrl+S = resort
    document.addEventListener("keydown", e => {
        if (e.ctrlKey && e.key.toLowerCase() === "s") {
            e.preventDefault();
            sortResults();
        }
    });

    // Initial sort after load
    setTimeout(sortResults, 1500);

    // Re-sort whenever Angular changes the grid
    const observer = new MutationObserver(() => {
        clearTimeout(observer.timer);
        observer.timer = setTimeout(sortResults, 400);
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

})();
