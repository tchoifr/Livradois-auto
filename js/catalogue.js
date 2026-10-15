/* Page « Nos véhicules » : filtres, tri, favoris, synchronisation avec l'URL */
(function () {
  "use strict";
  var LA = window.LA;
  var $ = LA.$, $$ = LA.$$, esc = LA.esc, icon = LA.icon, fmt = LA.fmt;

  var ALL = LA.stock();
  var PAGE = 12;
  var CARROSSERIES = ["Citadine", "Compacte", "Berline", "SUV", "Break", "4x4", "Utilitaire"];
  var ENERGIES = ["Essence", "Diesel", "Hybride", "Électrique"];

  var priceMinBound = Math.floor(Math.min.apply(null, ALL.map(function (v) { return v.prix; })) / 1000) * 1000;
  var priceMaxBound = Math.ceil(Math.max.apply(null, ALL.map(function (v) { return v.prix; })) / 1000) * 1000;
  var kmBound = Math.ceil(Math.max.apply(null, ALL.map(function (v) { return v.km; })) / 10000) * 10000;
  var years = ALL.map(function (v) { return v.annee; }).filter(function (y, i, a) { return a.indexOf(y) === i; }).sort().reverse();
  var marques = ALL.map(function (v) { return v.marque; }).filter(function (m, i, a) { return a.indexOf(m) === i; }).sort(function (a, b) { return a.localeCompare(b, "fr"); });

  function defaults() {
    return { q: "", marques: [], carrosseries: [], energies: [], boite: "", prixMin: priceMinBound, prixMax: priceMaxBound, kmMax: kmBound, anneeMin: 0, x4: false, pm: false, dispo: false, favoris: false, tri: "recent" };
  }
  var state = defaults();
  var shown = PAGE;

  /* ---------- URL <-> état ---------- */
  function readURL() {
    var p = new URLSearchParams(location.search);
    var list = function (k) { return p.get(k) ? p.get(k).split(",").filter(Boolean) : []; };
    var num = function (k, d) { var n = Number(p.get(k)); return p.get(k) && !isNaN(n) ? n : d; };
    state.q = p.get("q") || "";
    state.marques = list("marque");
    state.carrosseries = list("carrosserie");
    state.energies = list("energie");
    state.boite = p.get("boite") || "";
    state.prixMin = Math.max(priceMinBound, num("prixMin", priceMinBound));
    state.prixMax = Math.min(priceMaxBound, num("prixMax", priceMaxBound));
    state.kmMax = Math.min(kmBound, num("kmMax", kmBound));
    state.anneeMin = num("anneeMin", 0);
    state.x4 = p.get("x4") === "1";
    state.pm = p.get("pm") === "1";
    state.dispo = p.get("dispo") === "1";
    state.favoris = p.get("favoris") === "1";
    state.tri = p.get("tri") || "recent";
  }

  function writeURL() {
    var d = defaults(), p = new URLSearchParams();
    if (state.q) p.set("q", state.q);
    if (state.marques.length) p.set("marque", state.marques.join(","));
    if (state.carrosseries.length) p.set("carrosserie", state.carrosseries.join(","));
    if (state.energies.length) p.set("energie", state.energies.join(","));
    if (state.boite) p.set("boite", state.boite);
    if (state.prixMin !== d.prixMin) p.set("prixMin", state.prixMin);
    if (state.prixMax !== d.prixMax) p.set("prixMax", state.prixMax);
    if (state.kmMax !== d.kmMax) p.set("kmMax", state.kmMax);
    if (state.anneeMin) p.set("anneeMin", state.anneeMin);
    if (state.x4) p.set("x4", "1");
    if (state.pm) p.set("pm", "1");
    if (state.dispo) p.set("dispo", "1");
    if (state.favoris) p.set("favoris", "1");
    if (state.tri !== "recent") p.set("tri", state.tri);
    var qs = p.toString();
    history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
  }

  /* ---------- Filtrage ---------- */
  function norm(s) { return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }

  function matches(v, skip) {
    if (state.q) {
      var hay = norm([v.marque, v.modele, v.version, v.energie, v.carrosserie, v.couleur, v.boite, v.annee, v.quatreRoues ? "4x4 4 roues motrices integrale" : ""].join(" "));
      var ok = norm(state.q).split(/\s+/).every(function (w) { return hay.indexOf(w) !== -1; });
      if (!ok) return false;
    }
    if (skip !== "marques" && state.marques.length && state.marques.indexOf(v.marque) === -1) return false;
    if (skip !== "carrosseries" && state.carrosseries.length && state.carrosseries.indexOf(v.carrosserie) === -1) return false;
    if (skip !== "energies" && state.energies.length && state.energies.indexOf(v.energie) === -1) return false;
    if (state.boite && v.boite !== state.boite) return false;
    if (v.prix < state.prixMin || v.prix > state.prixMax) return false;
    if (v.km > state.kmMax) return false;
    if (state.anneeMin && v.annee < state.anneeMin) return false;
    if (state.x4 && !v.quatreRoues) return false;
    if (state.pm && !v.premiereMain) return false;
    if (state.dispo && v.statut !== "disponible") return false;
    if (state.favoris && !LA.favs.has(v.id)) return false;
    return true;
  }

  var SORTS = {
    recent: function (a, b) { return b.ajoutLe.localeCompare(a.ajoutLe); },
    "prix-asc": function (a, b) { return a.prix - b.prix; },
    "prix-desc": function (a, b) { return b.prix - a.prix; },
    "km-asc": function (a, b) { return a.km - b.km; },
    "annee-desc": function (a, b) { return b.annee - a.annee || a.km - b.km; },
  };

  function countBy(key, skip) {
    var c = {};
    ALL.forEach(function (v) { if (matches(v, skip)) c[v[key]] = (c[v[key]] || 0) + 1; });
    return c;
  }

  /* ---------- Construction des filtres ---------- */
  var elMarques = $("[data-f-marques]"), elCarr = $("[data-f-carrosseries]"), elEner = $("[data-f-energies]");

  elMarques.innerHTML = marques.map(function (m) {
    return '<label class="check"><input type="checkbox" value="' + esc(m) + '"> ' + esc(m) + ' <span class="check__count" data-c></span></label>';
  }).join("");
  var chip = function (val) { return '<button type="button" class="chip" data-value="' + esc(val) + '" aria-pressed="false">' + esc(val) + " <small data-c></small></button>"; };
  elCarr.innerHTML = CARROSSERIES.filter(function (c) { return ALL.some(function (v) { return v.carrosserie === c; }); }).map(chip).join("");
  elEner.innerHTML = ENERGIES.filter(function (c) { return ALL.some(function (v) { return v.energie === c; }); }).map(chip).join("");

  var selAnnee = $("[data-f-annee]");
  selAnnee.innerHTML = '<option value="0">Toutes les années</option>' + years.map(function (y) { return '<option value="' + y + '">' + y + " et plus récent</option>"; }).join("");

  var rMin = $("[data-price-min]"), rMax = $("[data-price-max]"), rKm = $("[data-km]");
  [rMin, rMax].forEach(function (r) { r.min = priceMinBound; r.max = priceMaxBound; r.step = 500; });
  rKm.min = 10000; rKm.max = kmBound; rKm.step = 5000;

  /* ---------- Événements ---------- */
  function change() { shown = PAGE; render(); writeURL(); }

  elMarques.addEventListener("change", function () {
    state.marques = $$("input:checked", elMarques).map(function (i) { return i.value; });
    change();
  });
  function chipGroup(el, key) {
    el.addEventListener("click", function (e) {
      var b = e.target.closest(".chip");
      if (!b) return;
      var v = b.getAttribute("data-value"), arr = state[key], i = arr.indexOf(v);
      if (i === -1) arr.push(v); else arr.splice(i, 1);
      change();
    });
  }
  chipGroup(elCarr, "carrosseries");
  chipGroup(elEner, "energies");

  $("[data-f-boite]").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    state.boite = b.getAttribute("data-value");
    change();
  });

  rMin.addEventListener("input", function () {
    state.prixMin = Math.min(Number(rMin.value), state.prixMax - 500);
    rMin.value = state.prixMin;
    change();
  });
  rMax.addEventListener("input", function () {
    state.prixMax = Math.max(Number(rMax.value), state.prixMin + 500);
    rMax.value = state.prixMax;
    change();
  });
  rKm.addEventListener("input", function () { state.kmMax = Number(rKm.value); change(); });
  selAnnee.addEventListener("change", function () { state.anneeMin = Number(selAnnee.value); change(); });

  [["x4", "[data-f-x4]"], ["pm", "[data-f-pm]"], ["dispo", "[data-f-dispo]"]].forEach(function (pair) {
    var el = $(pair[1]);
    el.addEventListener("change", function () { state[pair[0]] = el.checked; change(); });
  });

  var sortSel = $("[data-sort]");
  sortSel.addEventListener("change", function () { state.tri = sortSel.value; change(); });

  var favBtn = $("[data-fav-toggle]");
  favBtn.addEventListener("click", function () { state.favoris = !state.favoris; change(); });
  document.addEventListener("favs:change", function () { if (state.favoris) render(); });

  var searchForm = $("[data-search-form]"), searchInput = $("#q");
  var searchTimer;
  searchInput.addEventListener("input", function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { state.q = searchInput.value.trim(); change(); }, 200);
  });
  searchForm.addEventListener("submit", function (e) {
    e.preventDefault();
    state.q = searchInput.value.trim();
    change();
    $("#resultats").scrollIntoView({ behavior: "smooth" });
  });

  function reset() {
    var keepFav = state.favoris;
    state = defaults();
    state.favoris = keepFav;
    searchInput.value = "";
    change();
  }
  $$("[data-reset]").forEach(function (b) { b.addEventListener("click", reset); });

  $("[data-more] button").addEventListener("click", function () { shown += PAGE; render(); });

  /* Pastilles des filtres actifs */
  $("[data-active]").addEventListener("click", function (e) {
    var b = e.target.closest("[data-remove]");
    if (!b) return;
    var parts = b.getAttribute("data-remove").split(":"), k = parts[0], val = parts.slice(1).join(":");
    var d = defaults();
    if (Array.isArray(state[k])) state[k].splice(state[k].indexOf(val), 1);
    else if (k === "prix") { state.prixMin = d.prixMin; state.prixMax = d.prixMax; }
    else { state[k] = d[k]; if (k === "q") searchInput.value = ""; }
    change();
  });

  /* ---------- Tiroir de filtres (mobile) ---------- */
  var panel = $("#filtres"), backdrop = $("[data-backdrop]"), openBtn = $("[data-open-filters]");
  function drawer(open) {
    panel.classList.toggle("is-open", open);
    backdrop.classList.toggle("is-open", open);
    openBtn.setAttribute("aria-expanded", open);
    document.body.style.overflow = open ? "hidden" : "";
    if (open) $("button, input", panel).focus(); else openBtn.focus();
  }
  openBtn.addEventListener("click", function () { drawer(true); });
  $$("[data-close-filters]").forEach(function (b) { b.addEventListener("click", function () { drawer(false); }); });
  backdrop.addEventListener("click", function () { drawer(false); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && panel.classList.contains("is-open")) drawer(false); });

  /* ---------- Rendu ---------- */
  function syncControls() {
    var cm = countBy("marque", "marques"), cc = countBy("carrosserie", "carrosseries"), ce = countBy("energie", "energies");
    $$(".check", elMarques).forEach(function (l) {
      var inp = $("input", l), n = cm[inp.value] || 0;
      inp.checked = state.marques.indexOf(inp.value) !== -1;
      $("[data-c]", l).textContent = n;
      l.style.opacity = n || inp.checked ? 1 : 0.45;
    });
    [[elCarr, "carrosseries", cc], [elEner, "energies", ce]].forEach(function (g) {
      $$(".chip", g[0]).forEach(function (b) {
        var v = b.getAttribute("data-value");
        b.setAttribute("aria-pressed", state[g[1]].indexOf(v) !== -1);
        $("[data-c]", b).textContent = g[2][v] || 0;
      });
    });
    $$("[data-f-boite] button").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-value") === state.boite); });
    rMin.value = state.prixMin;
    rMax.value = state.prixMax;
    var span = priceMaxBound - priceMinBound;
    var fill = $(".range__fill");
    fill.style.left = ((state.prixMin - priceMinBound) / span) * 100 + "%";
    fill.style.right = ((priceMaxBound - state.prixMax) / span) * 100 + "%";
    $("[data-price-out-min]").textContent = fmt.price(state.prixMin);
    $("[data-price-out-max]").textContent = fmt.price(state.prixMax);
    rKm.value = state.kmMax;
    $("[data-km-out]").textContent = state.kmMax >= kmBound ? "Tous" : fmt.km(state.kmMax);
    selAnnee.value = state.anneeMin;
    $("[data-f-x4]").checked = state.x4;
    $("[data-f-pm]").checked = state.pm;
    $("[data-f-dispo]").checked = state.dispo;
    sortSel.value = state.tri;
    favBtn.setAttribute("aria-pressed", state.favoris);
    if (searchInput.value.trim() !== state.q && document.activeElement !== searchInput) searchInput.value = state.q;
  }

  function activePills() {
    var d = defaults(), out = [];
    var pill = function (key, label) { out.push('<button type="button" class="pill-remove" data-remove="' + esc(key) + '">' + esc(label) + icon("x") + "</button>"); };
    if (state.q) pill("q", "« " + state.q + " »");
    state.marques.forEach(function (m) { pill("marques:" + m, m); });
    state.carrosseries.forEach(function (m) { pill("carrosseries:" + m, m); });
    state.energies.forEach(function (m) { pill("energies:" + m, m); });
    if (state.boite) pill("boite", state.boite);
    if (state.prixMin !== d.prixMin || state.prixMax !== d.prixMax) pill("prix", fmt.price(state.prixMin) + " – " + fmt.price(state.prixMax));
    if (state.kmMax !== d.kmMax) pill("kmMax", "≤ " + fmt.km(state.kmMax));
    if (state.anneeMin) pill("anneeMin", "Depuis " + state.anneeMin);
    if (state.x4) pill("x4", "4 roues motrices");
    if (state.pm) pill("pm", "Première main");
    if (state.dispo) pill("dispo", "Disponibles uniquement");
    if (state.favoris) pill("favoris", "Mes favoris");
    return out.join("");
  }

  var grid = $("[data-results]"), empty = $("[data-empty]"), more = $("[data-more]");
  function render() {
    var res = ALL.filter(function (v) { return matches(v); }).sort(SORTS[state.tri] || SORTS.recent);
    var n = res.length;
    $$("[data-count]").forEach(function (el) { el.textContent = n; });
    $("[data-count-label]").textContent = n > 1 ? "véhicules" : "véhicule";
    grid.innerHTML = res.slice(0, shown).map(LA.card).join("");
    empty.hidden = n > 0;
    $("[data-empty-fav]").hidden = !(state.favoris && LA.favs.get().length === 0);
    more.hidden = n <= shown;
    $("[data-active]").innerHTML = activePills();
    syncControls();
  }

  readURL();
  render();
})();
