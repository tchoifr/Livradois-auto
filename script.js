/* ==========================================================================
   Livradois Automobiles — scripts communs à toutes les pages
   ========================================================================== */
(function () {
  "use strict";

  var ICONS = "public/assets/icons.svg";
  var FAV_KEY = "la-favoris";
  var NEW_DAYS = 10;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function icon(name, cls) {
    return '<svg class="i' + (cls ? " " + cls : "") + '" aria-hidden="true"><use href="' + ICONS + "#" + name + '"/></svg>';
  }

  var nf = new Intl.NumberFormat("fr-FR");
  var fmt = {
    price: function (n) { return nf.format(n) + " €"; },
    km: function (n) { return nf.format(n) + " km"; },
    num: function (n) { return nf.format(n); },
  };

  /* ---------- Favoris (stockés dans le navigateur) ---------- */
  var favs = {
    get: function () {
      try { return JSON.parse(localStorage.getItem(FAV_KEY)) || []; } catch (e) { return []; }
    },
    has: function (id) { return favs.get().indexOf(id) !== -1; },
    toggle: function (id) {
      var list = favs.get();
      var i = list.indexOf(id);
      if (i === -1) list.push(id); else list.splice(i, 1);
      try { localStorage.setItem(FAV_KEY, JSON.stringify(list)); } catch (e) { /* navigation privée */ }
      document.dispatchEvent(new CustomEvent("favs:change", { detail: { id: id, active: i === -1 } }));
      return i === -1;
    },
  };

  function updateFavCounts() {
    var n = favs.get().length;
    $$("[data-fav-count]").forEach(function (el) { el.textContent = n; el.hidden = n === 0; });
    $$("[data-fav-count-inline]").forEach(function (el) { el.textContent = n; });
  }

  /* ---------- Véhicules : helpers partagés ---------- */
  function photo(v, i, small) {
    var p = v.photos[i || 0];
    if (!p) return "public/assets/logo-footer.webp";
    if (p.url) return small && p.urlSmall ? p.urlSmall : p.url;
    return "public/assets/vehicules/" + p.fichier + (small ? "-sm" : "") + ".webp";
  }

  function isNew(v) {
    if (!v.ajoutLe) return false;
    var days = (Date.now() - new Date(v.ajoutLe + "T00:00:00").getTime()) / 864e5;
    return days >= 0 && days <= NEW_DAYS;
  }

  function badges(v) {
    var list = [];
    if (v.statut === "reserve") list.push({ cls: "badge--reserved", label: "Réservé" });
    if (isNew(v)) list.push({ cls: "badge--new", label: "Nouveauté" });
    if (v.prixBarre && v.prixBarre > v.prix) list.push({ cls: "badge--drop", label: "Prix en baisse" });
    if (v.badge) list.push({ cls: "", label: v.badge });
    return list;
  }

  function title(v) { return v.marque + " " + v.modele; }
  function url(v) { return "vehicule.html?id=" + encodeURIComponent(v.id); }

  function card(v) {
    var fav = favs.has(v.id);
    var b = badges(v).slice(0, 2).map(function (x) { return '<span class="badge ' + x.cls + '">' + esc(x.label) + "</span>"; }).join("");
    return '<article class="vcard' + (v.statut === "reserve" ? " is-reserved" : "") + '">' +
      '<div class="vcard__media">' +
        '<img src="' + photo(v, 0, true) + '" alt="' + esc(title(v) + " " + v.version) + '" loading="lazy" width="600" height="400">' +
        '<div class="vcard__badges">' + b + "</div>" +
        (v.photos.length > 1 ? '<span class="vcard__photos">' + icon("camera") + v.photos.length + "</span>" : "") +
      "</div>" +
      '<button class="fav-btn" type="button" data-fav="' + esc(v.id) + '" aria-pressed="' + fav + '" aria-label="Favori : ' + esc(title(v)) + '">' + icon("heart") + "</button>" +
      '<div class="vcard__body">' +
        '<h3 class="vcard__title"><a href="' + url(v) + '">' + esc(title(v)) + "</a></h3>" +
        '<p class="vcard__version">' + esc(v.version) + "</p>" +
        '<ul class="vcard__specs">' +
          "<li>" + icon("calendar") + v.annee + "</li>" +
          "<li>" + icon("gauge") + fmt.km(v.km) + "</li>" +
          "<li>" + icon("fuel") + esc(v.energie) + "</li>" +
          "<li>" + icon("gearbox") + esc(v.boite) + "</li>" +
        "</ul>" +
        '<div class="vcard__foot">' +
          '<div class="price">' + (v.prixBarre ? "<s>" + fmt.price(v.prixBarre) + "</s>" : "") +
            "<strong>" + fmt.price(v.prix) + "</strong><small>Garantie " + v.garantie + " mois</small></div>" +
          '<span class="vcard__cta" aria-hidden="true">' + icon("arrow-right") + "</span>" +
        "</div>" +
      "</div>" +
    "</article>";
  }

  /* ---------- Stock : API du back-office si configurée, sinon js/vehicules-data.js ---------- */
  var API = ((window.LA_CONFIG || {}).api || "").replace(/\/+$/, "");
  var apiStock = null;

  var ready = new Promise(function (resolve) {
    if (!API) { resolve("static"); return; }
    var ctrl = "AbortController" in window ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 8000);
    fetch(API + "?r=vehicules", { signal: ctrl ? ctrl.signal : undefined, credentials: "omit" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (list) { apiStock = list; resolve("api"); })
      .catch(function () { apiStock = []; resolve("error"); })
      .then(function () { clearTimeout(timer); });
  });

  function stock() {
    return (apiStock || window.VEHICULES || []).filter(function (v) { return v.statut !== "vendu"; });
  }

  /** Envoie une demande / offre au back-office. Rejette si l'API n'est pas configurée ou injoignable. */
  function sendRequest(data) {
    if (!API) return Promise.reject(new Error("no-api"));
    return fetch(API + "?r=demandes", {
      method: "POST", credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (body) {
        if (!r.ok) { var e = new Error(body.error || "Erreur " + r.status); e.status = r.status; throw e; }
        return body;
      });
    });
  }

  var unavailableHTML = '<div class="empty" style="grid-column:1/-1">' + icon("info") +
    "<h3>Stock momentanément indisponible</h3><p>Nos annonces n'ont pas pu être chargées. Réessayez dans un instant ou appelez-nous au 04 73 95 85 46.</p>" +
    '<a class="btn btn--primary" href="tel:0473958546">' + icon("phone") + "Appeler le garage</a></div>";

  /* ---------- Toast ---------- */
  var toastTimer;
  function toast(msg) {
    var el = $("[data-toast]");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("is-visible"); }, 2600);
  }

  /* ---------- Apparition au défilement ---------- */
  var revealObserver = "IntersectionObserver" in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add("is-visible"); revealObserver.unobserve(e.target); }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }) : null;

  function observe(root) {
    $$(".reveal:not(.is-visible)", root).forEach(function (el) {
      if (revealObserver) revealObserver.observe(el); else el.classList.add("is-visible");
    });
  }

  /* ---------- Horaires : ouvert / fermé (heure de Paris) ---------- */
  var SCHEDULE = { 1: [[480, 720], [840, 1080]], 2: [[480, 720], [840, 1080]], 3: [[480, 720], [840, 1080]], 4: [[480, 720], [840, 1080]], 5: [[480, 720], [840, 1080]], 6: [[480, 720]], 0: [] };
  var DAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

  function parisNow() {
    var parts = {};
    new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" })
      .formatToParts(new Date()).forEach(function (p) { parts[p.type] = p.value; });
    var day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
    return { day: day, min: parseInt(parts.hour, 10) * 60 + parseInt(parts.minute, 10) };
  }

  function hhmm(m) { return Math.floor(m / 60) + "h" + String(m % 60).padStart(2, "0"); }

  function openStatus() {
    var now = parisNow();
    var today = SCHEDULE[now.day];
    for (var i = 0; i < today.length; i++) {
      if (now.min >= today[i][0] && now.min < today[i][1]) return { open: true, text: "Ouvert · ferme à " + hhmm(today[i][1]) };
    }
    for (var j = 0; j < today.length; j++) {
      if (now.min < today[j][0]) return { open: false, text: "Fermé · ouvre à " + hhmm(today[j][0]) };
    }
    for (var d = 1; d <= 7; d++) {
      var day = (now.day + d) % 7;
      if (SCHEDULE[day].length) {
        return { open: false, text: "Fermé · ouvre " + (d === 1 ? "demain" : DAYS[day]) + " à " + hhmm(SCHEDULE[day][0][0]) };
      }
    }
    return { open: false, text: "Fermé" };
  }

  function renderOpenStatus() {
    var s = openStatus();
    var day = parisNow().day;
    $$("[data-open-status]").forEach(function (el) {
      el.innerHTML = '<span class="status-dot' + (s.open ? " is-open" : "") + '"></span>' + esc(s.text);
    });
    $$(".hours li[data-day]").forEach(function (li) {
      li.classList.toggle("is-today", li.getAttribute("data-day").split(",").indexOf(String(day)) !== -1);
    });
  }

  /* ---------- En-tête & navigation ---------- */
  function initHeader() {
    var header = $(".site-header");
    var toggle = $(".menu-toggle");
    var nav = $("#nav");
    if (header) {
      var onScroll = function () { header.classList.toggle("is-scrolled", window.scrollY > 8); };
      onScroll();
      window.addEventListener("scroll", onScroll, { passive: true });
    }
    if (!toggle || !nav) return;
    var setOpen = function (open) {
      toggle.setAttribute("aria-expanded", open);
      toggle.setAttribute("aria-label", open ? "Fermer le menu" : "Ouvrir le menu");
      nav.classList.toggle("is-open", open);
    };
    toggle.addEventListener("click", function () { setOpen(toggle.getAttribute("aria-expanded") !== "true"); });
    $$("a", nav).forEach(function (a) { a.addEventListener("click", function () { setOpen(false); }); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") setOpen(false); });
    document.addEventListener("click", function (e) {
      if (nav.classList.contains("is-open") && !nav.contains(e.target) && !toggle.contains(e.target)) setOpen(false);
    });
  }

  /* ---------- Boutons favoris (délégation) ---------- */
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-fav]");
    if (!btn) return;
    e.preventDefault();
    var id = btn.getAttribute("data-fav");
    var active = favs.toggle(id);
    $$('[data-fav="' + id + '"]').forEach(function (b) {
      b.setAttribute("aria-pressed", active);
      b.classList.remove("is-pop");
      void b.offsetWidth;
      b.classList.add("is-pop");
    });
    toast(active ? "Ajouté à vos favoris" : "Retiré de vos favoris");
  });
  document.addEventListener("favs:change", updateFavCounts);

  /* ---------- Init ---------- */
  document.addEventListener("DOMContentLoaded", function () {
    initHeader();
    updateFavCounts();
    renderOpenStatus();
    setInterval(renderOpenStatus, 60000);
    $$("[data-year]").forEach(function (el) { el.textContent = new Date().getFullYear(); });
    observe(document);
  });

  window.LA = {
    $: $, $$: $$, esc: esc, icon: icon, fmt: fmt, favs: favs,
    photo: photo, isNew: isNew, badges: badges, title: title, url: url, card: card, stock: stock,
    toast: toast, observe: observe, ready: ready, sendRequest: sendRequest, unavailableHTML: unavailableHTML,
  };
})();
