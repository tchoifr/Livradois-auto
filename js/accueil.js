/* Page d'accueil : dernières arrivées, recherche rapide, onglets services, avis */
(function () {
  "use strict";
  var LA = window.LA;
  var $ = LA.$, $$ = LA.$$;

  LA.ready.then(function (source) {
    /* ---------- Dernières arrivées ---------- */
    var featured = $("[data-featured]");
    if (featured) {
      var list = LA.stock()
        .filter(function (v) { return v.statut === "disponible"; })
        .sort(function (a, b) { return b.ajoutLe.localeCompare(a.ajoutLe); })
        .slice(0, 4);
      featured.innerHTML = source === "error" ? LA.unavailableHTML : list.map(LA.card).join("");
    }
    initQuickSearch();
  });

  /* ---------- Recherche rapide : compteur dynamique ---------- */
  function initQuickSearch() {
    var form = $("[data-quick-search]");
    if (!form) return;
    // Marques et carrosseries réellement présentes dans le stock
    var fill = function (select, key) {
      var current = select.value;
      var values = LA.stock().map(function (v) { return v[key]; }).filter(function (x, i, a) { return a.indexOf(x) === i; }).sort(function (a, b) { return a.localeCompare(b, "fr"); });
      select.innerHTML = select.options[0].outerHTML + values.map(function (x) { return '<option value="' + LA.esc(x) + '">' + LA.esc(x) + "</option>"; }).join("");
      select.value = values.indexOf(current) !== -1 ? current : "";
    };
    fill(form.marque, "marque");
    fill(form.carrosserie, "carrosserie");
    var count = $("[data-quick-count]", form);
    var update = function () {
      var marque = form.marque.value, carrosserie = form.carrosserie.value, prixMax = Number(form.prixMax.value) || Infinity;
      var n = LA.stock().filter(function (v) {
        return (!marque || v.marque === marque) && (!carrosserie || v.carrosserie === carrosserie) && v.prix <= prixMax;
      }).length;
      count.textContent = n + " véhicule" + (n > 1 ? "s" : "");
    };
    form.addEventListener("change", update);
    update();
    // N'envoie pas les champs vides dans l'URL
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var params = new URLSearchParams();
      ["marque", "carrosserie", "prixMax"].forEach(function (k) { if (form[k].value) params.set(k, form[k].value); });
      var qs = params.toString();
      window.location.href = form.getAttribute("action") + (qs ? "?" + qs : "");
    });
  }

  /* ---------- Onglets services ---------- */
  var tabs = $$('[role="tab"]');
  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () { select(tab); });
    tab.addEventListener("keydown", function (e) {
      var i = tabs.indexOf(tab);
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        var next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
        select(next);
        next.focus();
      }
    });
  });
  function select(tab) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute("aria-selected", on);
      t.tabIndex = on ? 0 : -1;
      var panel = document.getElementById(t.getAttribute("aria-controls"));
      panel.hidden = !on;
      if (on) LA.observe(panel);
    });
  }

  /* ---------- Carrousel d'avis ---------- */
  var track = $("[data-reviews]");
  if (track) {
    var prev = $("[data-reviews-prev]"), next = $("[data-reviews-next]");
    var step = function () { var c = track.firstElementChild; return c ? c.getBoundingClientRect().width + 24 : 300; };
    var sync = function () {
      prev.disabled = track.scrollLeft <= 4;
      next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
    };
    prev.addEventListener("click", function () { track.scrollBy({ left: -step(), behavior: "smooth" }); });
    next.addEventListener("click", function () { track.scrollBy({ left: step(), behavior: "smooth" }); });
    track.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    sync();
  }
})();
