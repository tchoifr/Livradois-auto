/* Planning : calendrier jour / semaine / mois / liste, filtres, glisser-déposer, prise de rendez-vous, détail */
(function () {
  "use strict";
  var BO = window.BO, esc = BO.esc, icon = BO.icon, fmt = BO.fmt, $ = BO.$, $$ = BO.$$;
  var JOURS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
  var VUES = [["jour", "Jour", "J"], ["semaine", "Semaine", "S"], ["mois", "Mois", "M"], ["liste", "Liste", "L"]];
  var PX = 76;          // hauteur d'une heure dans la grille (px) : 30 min = 2 lignes lisibles
  var SNAP = 15;        // pas de placement et de déplacement (minutes)
  var ACTIFS = ["en_attente", "confirme"];

  function pad(n) { return String(n).padStart(2, "0"); }
  function monday(d) { var x = new Date(d); x.setDate(x.getDate() - (x.getDay() + 6) % 7); x.setHours(0, 0, 0, 0); return x; }
  function parseDay(s) { var p = String(s).split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function minutes(s) { return +s.slice(11, 13) * 60 + +s.slice(14, 16); }
  function toMin(hm) { return +hm.slice(0, 2) * 60 + +hm.slice(3, 5); }
  function hm(m) { return pad(Math.floor(m / 60)) + ":" + pad(m % 60); }
  function hLabel(m) { return Math.floor(m / 60) + "h" + (m % 60 ? pad(m % 60) : ""); }
  function endMin(r) { return r.fin.slice(0, 10) > r.debut.slice(0, 10) ? 24 * 60 : minutes(r.fin); }
  function capital(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function openings(d) { return ((BO.ref("horaires") || {})[String(d.getDay())] || []).map(function (x) { return [toMin(x[0]), toMin(x[1])]; }); }
  function isMobile() { return window.matchMedia("(max-width: 700px)").matches; }
  function late(r) { return ACTIFS.indexOf(r.statut) !== -1 && r.enRetard; }

  /** Rendez-vous qui se chevauchent : répartis côte à côte, les autres gardent toute la largeur. */
  function layout(evs) {
    var group = [], groupEnd = "";
    function close() {
      var cols = [];
      group.forEach(function (r) { var i = 0; while (cols[i] && cols[i] > r.debut) i++; cols[i] = r.fin; r._col = i; });
      group.forEach(function (r) { r._cols = cols.length; });
    }
    evs.forEach(function (r) {
      if (group.length && r.debut >= groupEnd) { close(); group = []; groupEnd = ""; }
      group.push(r);
      if (r.fin > groupEnd) groupEnd = r.fin;
    });
    if (group.length) close();
  }

  /* ================================================================ calendrier */
  BO.route(/^\/planning$/, function (view, _p, q) {
    var split = function (s) { return String(s || "").split(",").filter(Boolean); };
    var st = {
      vue: VUES.some(function (v) { return v[0] === q.vue; }) ? q.vue : (isMobile() ? "liste" : "semaine"),
      date: /^\d{4}-\d{2}-\d{2}$/.test(q.date || "") ? q.date : BO.isoDate(new Date()),
      motif: split(q.motif), statut: split(q.statut), assigne: q.assigne || "", vehicule: q.vehicule || "",
      annules: q.annules === "1", retard: q.retard === "1",
    };
    var data = [], vehicles = [], pendingRdv = q.rdv ? +q.rdv : 0, drag = null, justDragged = false;
    var motifs = BO.ref("motifs") || [], statuts = BO.ref("statutsRdv") || {}, users = BO.ref("utilisateurs") || [];

    BO.actions('<a class="btn btn--primary" href="#/planning/nouveau">' + icon("plus") + "<span>Nouveau rendez-vous</span></a>");
    view.innerHTML =
      '<div class="pl-bar">' +
        '<div class="pl-nav">' +
          '<button type="button" class="btn btn--ghost btn--sm" data-today title="Aujourd\'hui (T)">Aujourd\'hui</button>' +
          '<span class="pl-arrows"><button type="button" class="icon-btn" data-prev title="Précédent (←)" aria-label="Période précédente">' + icon("chevron-left") + "</button>" +
          '<button type="button" class="icon-btn" data-next title="Suivant (→)" aria-label="Période suivante">' + icon("chevron-right") + "</button></span>" +
          '<span class="pl-title"><button type="button" data-goto-btn title="Choisir une date"><span data-label></span>' + icon("chevron-down", "i--sm") + '</button><input type="date" data-goto tabindex="-1" aria-label="Aller à une date"></span>' +
        "</div>" +
        '<div class="pl-right">' +
          '<div class="segmented" role="group" aria-label="Affichage">' + VUES.map(function (v) { return '<button type="button" data-vue="' + v[0] + '" title="' + v[1] + " (" + v[2] + ')">' + v[1] + "</button>"; }).join("") + "</div>" +
          '<button type="button" class="btn btn--ghost btn--sm" data-open-filters aria-controls="pl-filtres" aria-expanded="false">' + icon("sliders") + 'Filtres<span class="fbadge" data-fcount hidden></span></button>' +
        "</div>" +
      "</div>" +
      '<div class="pl-sub"><div class="active-filters" data-active></div>' +
        '<div class="pl-legend">' + ["confirme", "en_attente", "termine", "absent"].map(function (k) { return '<span><i class="lg lg--' + k + '"></i>' + esc(statuts[k] || k) + "</span>"; }).join("") +
        '<span><i class="lg lg--late"></i>À clôturer</span></div></div>' +
      '<div data-cal><p class="loading">Chargement…</p></div>' +
      // Panneau de filtres (même principe que le catalogue du site)
      '<aside class="fdrawer" id="pl-filtres" aria-label="Filtres du planning" aria-hidden="true">' +
        '<div class="fdrawer__head"><h2>' + icon("sliders") + 'Filtres</h2><span><button type="button" class="fdrawer__reset" data-reset>Réinitialiser</button>' +
          '<button type="button" class="icon-btn" data-close-filters aria-label="Fermer les filtres">' + icon("x") + "</button></span></div>" +
        '<div class="fdrawer__body">' +
          '<div class="fgroup"><h3 class="fgroup__title">Motif</h3><div class="chips">' + motifs.map(function (m) { return '<button type="button" class="chip" data-chip="motif" data-value="' + esc(m.code) + '">' + esc(m.libelle) + "</button>"; }).join("") + "</div></div>" +
          '<div class="fgroup"><h3 class="fgroup__title">Statut</h3><div class="chips">' + Object.keys(statuts).map(function (k) { return '<button type="button" class="chip" data-chip="statut" data-value="' + k + '"><i class="lg lg--' + k + '"></i>' + esc(statuts[k]) + "</button>"; }).join("") + "</div></div>" +
          (users.length > 1 ? '<div class="fgroup"><h3 class="fgroup__title">Personne assignée</h3><div class="chips">' +
            [{ id: "", nom: "Toute l'équipe" }].concat(users, [{ id: "aucun", nom: "Non assigné" }]).map(function (u) { return '<button type="button" class="chip" data-chip="assigne" data-value="' + esc(u.id) + '">' + esc(u.nom) + "</button>"; }).join("") + "</div></div>" : "") +
          '<div class="fgroup"><label class="fgroup__title" for="pl-veh">Véhicule</label><select class="select" id="pl-veh" data-fvehicule><option value="">Tous les véhicules</option></select></div>' +
          '<div class="fgroup"><h3 class="fgroup__title">Options</h3>' +
            '<label class="check"><input type="checkbox" data-fopt="annules"> Afficher les rendez-vous annulés</label>' +
            '<label class="check"><input type="checkbox" data-fopt="retard"> Seulement les rendez-vous à clôturer</label></div>' +
        "</div>" +
        '<div class="fdrawer__foot"><button type="button" class="btn btn--primary btn--block" data-close-filters>Voir les <span data-fresult>0</span> rendez-vous</button></div>' +
      "</aside><div class=\"fbackdrop\" data-close-filters></div>";

    var cal = $("[data-cal]", view), drawer = $(".fdrawer", view), backdrop = $(".fbackdrop", view);

    /* ---------- période affichée ---------- */
    function range() {
      var d = parseDay(st.date);
      if (st.retard) return [new Date(2000, 0, 1), new Date()];
      if (st.vue === "jour") return [d, d];
      if (st.vue === "mois") { var first = new Date(d.getFullYear(), d.getMonth(), 1), last = new Date(d.getFullYear(), d.getMonth() + 1, 0); return [monday(first), BO.addDays(monday(last), 6)]; }
      var m = monday(d);
      return [m, BO.addDays(m, 6)];
    }
    function label() {
      var d = parseDay(st.date), r = range(), small = isMobile();
      if (st.retard) return "Rendez-vous à clôturer";
      if (st.vue === "jour") return capital(d.toLocaleDateString("fr-FR", small ? { weekday: "short", day: "numeric", month: "short" } : { weekday: "long", day: "numeric", month: "long", year: "numeric" }));
      if (st.vue === "mois") return capital(d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }));
      var a = r[0], b = r[1], same = a.getMonth() === b.getMonth();
      return a.getDate() + (same ? "" : " " + a.toLocaleDateString("fr-FR", { month: "short" })) + " – " + b.toLocaleDateString("fr-FR", { day: "numeric", month: same && !small ? "long" : "short", year: small ? undefined : "numeric" });
    }
    function step(n) {
      var d = parseDay(st.date);
      if (st.vue === "jour") d = BO.addDays(d, n);
      else if (st.vue === "mois") d = new Date(d.getFullYear(), d.getMonth() + n, 1);
      else d = BO.addDays(d, 7 * n);
      st.date = BO.isoDate(d);
      load();
    }

    /* ---------- filtres ---------- */
    function visible() {
      return data.filter(function (r) {
        if (st.motif.length && st.motif.indexOf(r.motif) === -1) return false;
        if (st.statut.length) { if (st.statut.indexOf(r.statut) === -1) return false; }
        else if (r.statut === "annule" && !st.annules) return false;
        if (st.assigne === "aucun" ? r.assigneId : st.assigne && String(r.assigneId) !== st.assigne) return false;
        if (st.vehicule && String(r.vehiculeId) !== st.vehicule) return false;
        return true;
      });
    }
    function activeFilters() {
      var a = [];
      st.motif.forEach(function (c) { a.push(["motif", c, BO.motifLabel(c)]); });
      st.statut.forEach(function (c) { a.push(["statut", c, statuts[c] || c]); });
      if (st.assigne) a.push(["assigne", st.assigne, st.assigne === "aucun" ? "Non assigné" : (users.filter(function (u) { return String(u.id) === st.assigne; })[0] || {}).nom || "Personne"]);
      if (st.vehicule) { var v = vehicles.filter(function (x) { return String(x.dbId) === st.vehicule; })[0]; a.push(["vehicule", st.vehicule, v ? v.marque + " " + v.modele + " · " + v.numeroStock : "Un véhicule"]); }
      if (st.annules) a.push(["annules", "1", "Annulés affichés"]);
      if (st.retard) a.push(["retard", "1", "À clôturer"]);
      return a;
    }
    function syncFilters(count) {
      var a = activeFilters();
      $("[data-fcount]", view).textContent = a.length;
      $("[data-fcount]", view).hidden = !a.length;
      $("[data-active]", view).innerHTML = a.map(function (f) {
        return '<button type="button" class="pill-remove" data-remove="' + f[0] + '" data-value="' + esc(f[1]) + '">' + esc(f[2]) + icon("x") + "</button>";
      }).join("") + (a.length > 1 ? '<button type="button" class="link small" data-reset>Tout effacer</button>' : "");
      $$("[data-chip]", view).forEach(function (c) {
        var k = c.getAttribute("data-chip"), v = c.getAttribute("data-value");
        c.setAttribute("aria-pressed", k === "assigne" ? String(st.assigne === v) : String(st[k].indexOf(v) !== -1));
      });
      $$("[data-fopt]", view).forEach(function (c) { c.checked = st[c.getAttribute("data-fopt")]; });
      $("[data-fvehicule]", view).value = st.vehicule;
      $("[data-fresult]", view).textContent = count;
    }
    function openFilters(open) {
      drawer.classList.toggle("is-open", open);
      backdrop.classList.toggle("is-open", open);
      drawer.setAttribute("aria-hidden", String(!open));
      $("[data-open-filters]", view).setAttribute("aria-expanded", String(open));
      if (open) setTimeout(function () { var f = $("[data-chip], select", drawer); if (f) f.focus(); }, 50);
    }
    function saveQuery() {
      BO.setQuery({ vue: st.vue, date: st.date, motif: st.motif.join(","), statut: st.statut.join(","), assigne: st.assigne, vehicule: st.vehicule, annules: st.annules ? "1" : "", retard: st.retard ? "1" : "" });
    }

    /* ---------- chargement et affichage ---------- */
    var seq = 0;
    function load() {
      saveQuery();
      $$("[data-vue]", view).forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-vue") === st.vue && !st.retard)); });
      $("[data-label]", view).textContent = label();
      $("[data-goto]", view).value = st.date;
      $$("[data-prev], [data-next]", view).forEach(function (b) { b.disabled = st.retard; });
      var r = range(), my = ++seq;
      cal.classList.add("is-busy");
      return BO.api("admin/rendez-vous", { query: { du: BO.isoDate(r[0]), au: BO.isoDate(r[1]), parc: BO.parcFilter(), retard: st.retard ? "1" : "" } }).then(function (list) {
        if (my !== seq) return;
        data = list;
        render();
        if (pendingRdv) { openDetail(pendingRdv, load); pendingRdv = 0; }
      }).catch(BO.fail).then(function () { cal.classList.remove("is-busy"); });
    }
    var lastKey = "";
    function render() {
      var list = visible(), key = st.vue + st.date, prev = $(".tg-scroll", cal);
      // Même période : on garde la position de défilement (filtres, mise à jour de l'heure)
      var keep = prev && key === lastKey ? [prev.scrollTop, prev.scrollLeft] : null;
      syncFilters(list.length);
      if (st.retard || st.vue === "liste") cal.innerHTML = renderAgenda(list);
      else if (st.vue === "mois") cal.innerHTML = renderMonth(list);
      else {
        cal.innerHTML = renderGrid(list);
        var box = $(".tg-scroll", cal);
        if (keep && box) { box.scrollTop = keep[0]; box.scrollLeft = keep[1]; } else scrollGrid(list);
      }
      lastKey = key;
    }

    /* ---------- grille horaire (jour, semaine) ---------- */
    function days() { var r = range(); return st.vue === "jour" ? [r[0]] : Array.from({ length: 7 }, function (_, i) { return BO.addDays(r[0], i); }); }
    function hourRange(ds, list) {
      var lo = 24 * 60, hi = 0;
      for (var i = 0; i < 7; i++) openings(BO.addDays(monday(ds[0]), i)).forEach(function (o) { lo = Math.min(lo, o[0]); hi = Math.max(hi, o[1]); });
      if (lo >= hi) { lo = 8 * 60; hi = 19 * 60; }
      list.forEach(function (r) { lo = Math.min(lo, minutes(r.debut)); hi = Math.max(hi, endMin(r)); });
      return [Math.max(0, Math.floor(lo / 60) * 60 - 60), Math.min(24 * 60, Math.ceil(hi / 60) * 60 + 60)];
    }
    var grid = null; // [début, fin] en minutes de la grille affichée
    function renderGrid(list) {
      var ds = days(), today = BO.isoDate(new Date()), hr = hourRange(ds, list);
      grid = hr;
      var height = (hr[1] - hr[0]) / 60 * PX, now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
      var hours = "";
      for (var m = hr[0] + 60; m < hr[1]; m += 60) hours += '<span style="top:' + ((m - hr[0]) / 60 * PX) + 'px">' + hLabel(m) + "</span>";
      var head = "", cols = "";
      ds.forEach(function (d) {
        var iso = BO.isoDate(d), evs = list.filter(function (r) { return r.debut.slice(0, 10) === iso; }).sort(function (a, b) { return a.debut.localeCompare(b.debut); });
        var open = openings(d), closed = !open.length;
        head += '<button type="button" class="tg-dayhead' + (iso === today ? " is-today" : "") + (closed ? " is-closed" : "") + '" data-day="' + iso + '" title="Voir la journée">' +
          "<span>" + JOURS[d.getDay()] + "</span><strong>" + d.getDate() + "</strong><em>" + (closed ? "Fermé" : evs.length ? fmt.plural(evs.length, "RDV", "RDV") : "") + "</em></button>";
        // Zones fermées (hors horaires d'ouverture)
        var shade = "", cur = hr[0];
        open.concat([[hr[1], hr[1]]]).forEach(function (o) {
          var a = Math.max(o[0], hr[0]), b = Math.min(o[1], hr[1]);
          if (a > cur) shade += '<div class="tg-closed" style="top:' + ((cur - hr[0]) / 60 * PX) + "px;height:" + ((a - cur) / 60 * PX) + 'px"></div>';
          cur = Math.max(cur, b);
        });
        layout(evs);
        var items = evs.map(function (r) {
          var s = Math.max(minutes(r.debut), hr[0]), e = Math.min(endMin(r), hr[1]);
          var top = (s - hr[0]) / 60 * PX, h = Math.max(22, (e - s) / 60 * PX - 2), w = 100 / r._cols;
          var movable = ACTIFS.indexOf(r.statut) !== -1, day = st.vue === "jour";
          // Hauteur disponible : 1 ligne (< 30 px), 2 lignes (< 50 px) ou détail complet
          var mode = h < 30 ? " is-short is-compact" : h < 50 ? " is-compact" : "";
          var sub = day ? [r.motifLabel, r.client, r.clientTelephone, r.assigne && "→ " + r.assigne] : [h >= 50 ? r.motifLabel : "", r.client];
          return '<div role="button" tabindex="0" class="tg-ev ev--' + r.statut + (late(r) ? " is-late" : "") + mode + (movable ? " is-movable" : "") + '" data-rdv="' + r.id + '" ' +
            'style="top:' + top + "px;height:" + h + "px;left:calc(" + (r._col * w) + "% + 2px);width:calc(" + w + '% - 4px)" ' +
            'title="' + esc(fmt.time(r.debut) + " – " + fmt.time(r.fin) + " · " + r.motifLabel + " · " + r.vehicule + (r.client ? " · " + r.client : "") + (late(r) ? " · à clôturer" : "") + (movable ? "\nGlisser pour déplacer" : "")) + '">' +
            (day && h >= 34 ? BO.thumb(r.vehiculePhoto, "tg-ev__img") : "") +
            '<span class="tg-ev__txt"><span class="tg-ev__time">' + fmt.time(r.debut) + (h >= 50 || day ? " – " + fmt.time(r.fin) : "") + (late(r) ? " " + icon("clock", "i--xs") : "") + "</span>" +
            "<strong>" + esc(r.vehicule) + (day && r.numeroStock ? ' <small>' + esc(r.numeroStock) + "</small>" : "") + "</strong>" +
            '<span class="tg-ev__sub">' + esc(sub.filter(Boolean).join(" · ")) + "</span></span>" +
            (movable ? '<span class="tg-ev__resize" data-resize title="Changer la durée"></span>' : "") + "</div>";
        }).join("");
        var nowLine = iso === today && nowMin >= hr[0] && nowMin <= hr[1] ? '<div class="tg-now" style="top:' + ((nowMin - hr[0]) / 60 * PX) + 'px"></div>' : "";
        cols += '<div class="tg-col' + (iso === today ? " is-today" : "") + '" data-date="' + iso + '" style="height:' + height + 'px">' + shade + nowLine + items + '<div class="tg-hover" hidden></div></div>';
      });
      return '<div class="tg-scroll"><div class="tg' + (ds.length === 1 ? " tg--day" : "") + '" style="--cols:' + ds.length + ";--px:" + PX + 'px">' +
        '<div class="tg-head"><div class="tg-corner"></div>' + head + "</div>" +
        '<div class="tg-body"><div class="tg-hours" style="height:' + height + 'px">' + hours + "</div>" + cols + "</div></div></div>" +
        (ds.length === 1 && !openings(ds[0]).length ? '<p class="note">' + icon("info") + "Le garage est fermé ce jour-là (horaires dans Paramètres). Vous pouvez quand même placer un rendez-vous.</p>" : "") +
        '<p class="pl-hint muted small">Cliquez dans une case libre pour créer un rendez-vous · glissez un rendez-vous pour le déplacer, tirez son bord inférieur pour changer sa durée.</p>';
    }
    // Place la vue sur l'heure utile : maintenant (si aujourd'hui est affiché), sinon le premier rendez-vous, sinon l'ouverture
    function scrollGrid(list) {
      var box = $(".tg-scroll", cal);
      if (!box || !grid) return;
      var target;
      if ($(".tg-col.is-today", cal)) { var n = new Date(); target = n.getHours() * 60 + n.getMinutes() - 90; }
      else if (list.length) target = Math.min.apply(null, list.map(function (r) { return minutes(r.debut); })) - 30;
      else { var o = openings(days()[0])[0]; target = o ? o[0] - 30 : 8 * 60; }
      box.scrollTop = Math.max(0, (target - grid[0]) / 60 * PX);
    }
    function pointMinutes(col, clientY) {
      var y = clientY - col.getBoundingClientRect().top;
      return grid[0] + Math.floor(y / PX * 60 / SNAP) * SNAP;
    }

    /* ---------- mois ---------- */
    function renderMonth(list) {
      var d = parseDay(st.date), r = range(), today = BO.isoDate(new Date()), mob = isMobile();
      var html = '<div class="mg"><div class="mg-head">' + ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."].map(function (x) { return "<span>" + x + "</span>"; }).join("") + '</div><div class="mg-grid">';
      for (var i = 0; ; i++) {
        var day = BO.addDays(r[0], i), iso = BO.isoDate(day);
        if (day > r[1]) break;
        var evs = list.filter(function (x) { return x.debut.slice(0, 10) === iso; });
        var out = day.getMonth() !== d.getMonth(), closed = !openings(day).length, max = mob ? 0 : 3;
        html += '<div class="mg-day' + (out ? " is-out" : "") + (iso === today ? " is-today" : "") + (closed ? " is-closed" : "") + '" data-day="' + iso + '">' +
          '<span class="mg-num">' + day.getDate() + "</span>" +
          evs.slice(0, max).map(function (x) {
            return '<button type="button" class="mg-ev ev--' + x.statut + (late(x) ? " is-late" : "") + '" data-rdv="' + x.id + '" title="' + esc(x.motifLabel + " · " + x.vehicule + (x.client ? " · " + x.client : "")) + '"><b>' + fmt.time(x.debut) + "</b> " + esc(x.vehicule) + "</button>";
          }).join("") +
          (evs.length > max ? '<span class="mg-more">' + (max ? "+ " + (evs.length - max) + " autre" + (evs.length - max > 1 ? "s" : "") : evs.length + " RDV") + "</span>" : "") + "</div>";
      }
      return html + "</div></div>";
    }

    /* ---------- liste (agenda de la semaine ou rendez-vous à clôturer) ---------- */
    function renderAgenda(list) {
      var byDay = {};
      list.forEach(function (r) { (byDay[r.debut.slice(0, 10)] = byDay[r.debut.slice(0, 10)] || []).push(r); });
      var keys = st.retard ? Object.keys(byDay).sort() : days().map(BO.isoDate);
      if (st.retard && !keys.length) return '<div class="card empty">' + icon("check") + "<p>Aucun rendez-vous à clôturer : tout est à jour.</p></div>";
      var today = BO.isoDate(new Date());
      return '<div class="ag">' + keys.map(function (k) {
        var evs = (byDay[k] || []).sort(function (a, b) { return a.debut.localeCompare(b.debut); }), d = parseDay(k);
        return '<section class="ag-day' + (k === today ? " is-today" : "") + '"><header class="ag-dayhead"><button type="button" data-day="' + k + '">' + capital(d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })) + "</button>" +
          '<span class="muted small">' + (openings(d).length ? (evs.length ? fmt.plural(evs.length, "rendez-vous") : "") : "Fermé") + "</span>" +
          (st.retard ? "" : '<a class="ag-add" href="#/planning/nouveau?date=' + k + '" title="Nouveau rendez-vous ce jour-là">' + icon("plus", "i--sm") + "<span>Ajouter</span></a>") + "</header>" +
          (evs.length ? evs.map(function (r) {
            return '<button type="button" class="ag-item ev--' + r.statut + '" data-rdv="' + r.id + '">' +
              '<span class="ag-time">' + fmt.time(r.debut) + "<small>" + fmt.time(r.fin) + "</small></span>" + BO.thumb(r.vehiculePhoto, "ag-img") +
              '<span class="ag-main"><strong>' + esc(r.motifLabel) + " · " + esc(r.vehicule) + ' <span class="muted">' + esc(r.numeroStock || "") + "</span></strong>" +
              "<span>" + esc([r.client || "Sans client", r.clientTelephone, r.parc, r.assigne].filter(Boolean).join(" · ")) + "</span></span>" +
              '<span class="ag-tags">' + (late(r) ? '<span class="tag tag--warn">' + icon("clock") + "À clôturer</span>" : "") + (r.vehiculePret || ACTIFS.indexOf(r.statut) === -1 ? "" : '<span class="tag tag--muted">À préparer</span>') +
              BO.pill("r", r.statut, r.statutLabel) + "</span></button>";
          }).join("") : '<p class="ag-empty">Aucun rendez-vous</p>') + "</section>";
      }).join("") + "</div>";
    }

    /* ---------- déplacement / durée par glisser-déposer ---------- */
    function moveTo(r, debut, duree) {
      var oldTxt = fmt.dateLong(r.debut) + " à " + fmt.time(r.debut) + " (" + (endMin(r) - minutes(r.debut)) + " min)";
      var newDur = duree || endMin(r) - minutes(r.debut);
      var newTxt = fmt.dateLong(debut) + " à " + fmt.time(debut) + " (" + newDur + " min)";
      var done = false;
      BO.modal({
        title: duree ? "Changer la durée du rendez-vous ?" : "Déplacer le rendez-vous ?",
        body: '<p><strong>' + esc(r.motifLabel + " · " + r.vehicule) + "</strong>" + (r.client ? " — " + esc(r.client) : "") + "</p>" +
          '<dl class="kv"><dt>Avant</dt><dd>' + esc(capital(oldTxt)) + "</dd><dt>Après</dt><dd><strong>" + esc(capital(newTxt)) + "</strong></dd></dl>" +
          '<p class="muted small">La disponibilité du véhicule est vérifiée au moment d\'enregistrer. Les rappels sont reprogrammés automatiquement.</p>',
        actions: [{ label: "Annuler" }, {
          label: duree ? "Changer la durée" : "Déplacer", primary: true, icon: "check", onClick: function () {
            done = true;
            var body = { id: r.id, debut: debut };
            if (duree) body.duree = duree;
            return BO.api("admin/rendez-vous/modifier", { body: body }).then(function (res) {
              BO.toast(duree ? "Durée modifiée" : "Rendez-vous déplacé");
              if (res.avertissements && res.avertissements.length) setTimeout(function () { BO.toast(res.avertissements.join(" ")); }, 1800);
              BO.refreshCounts();
              load();
              // Proposition de message au client (nouvelle date), après fermeture de cette fenêtre
              setTimeout(function () { BO.proposeMessage(res.proposition); }, 0);
            }).catch(function (err) { BO.toast(err.message, true); render(); });
          },
        }],
        onClose: function () { if (!done) render(); },
      });
    }
    function dragMove(e) {
      if (!drag) return;
      var dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
      if (!drag.started && Math.abs(dx) + Math.abs(dy) < 6) return;
      if (!drag.started) { drag.started = true; drag.el.classList.add("is-dragging"); cal.classList.add("is-dragging"); $$(".tg-hover", cal).forEach(function (h) { h.hidden = true; }); }
      e.preventDefault();
      var dur = endMin(drag.r) - minutes(drag.r.debut), t = $(".tg-ev__time", drag.el);
      if (drag.resize) {
        var nd = Math.max(SNAP, Math.round((drag.h0 + 2 + dy) / PX * 60 / SNAP) * SNAP);
        nd = Math.min(nd, grid[1] - minutes(drag.r.debut));
        drag.dur = nd;
        drag.el.style.height = (nd / 60 * PX - 2) + "px";
        t.textContent = fmt.time(drag.r.debut) + " – " + hm(minutes(drag.r.debut) + nd).replace(":", "h");
        return;
      }
      drag.el.style.pointerEvents = "none";
      var under = document.elementFromPoint(e.clientX, e.clientY), col = under && under.closest(".tg-col");
      drag.el.style.pointerEvents = "";
      if (col && col !== drag.el.parentElement) { col.appendChild(drag.el); drag.el.style.left = "2px"; drag.el.style.width = "calc(100% - 4px)"; }
      var start = minutes(drag.r.debut) + Math.round(dy / PX * 60 / SNAP) * SNAP;
      start = Math.max(grid[0], Math.min(grid[1] - dur, start));
      drag.start = start;
      drag.el.style.top = ((start - grid[0]) / 60 * PX) + "px";
      t.textContent = hm(start).replace(":", "h") + " – " + hm(start + dur).replace(":", "h");
    }
    function dragEnd() {
      window.removeEventListener("pointermove", dragMove);
      window.removeEventListener("pointerup", dragEnd);
      window.removeEventListener("pointercancel", dragEnd);
      if (!drag) return;
      var d = drag;
      drag = null;
      cal.classList.remove("is-dragging");
      if (!d.started) return;
      justDragged = true;
      setTimeout(function () { justDragged = false; }, 80);
      d.el.classList.remove("is-dragging");
      if (d.resize) {
        if (!d.dur || d.dur === endMin(d.r) - minutes(d.r.debut)) { render(); return; }
        moveTo(d.r, d.r.debut.slice(0, 16), d.dur);
        return;
      }
      var debut = d.el.parentElement.getAttribute("data-date") + " " + hm(d.start == null ? minutes(d.r.debut) : d.start);
      if (debut === d.r.debut.slice(0, 16)) { render(); return; }
      moveTo(d.r, debut, 0);
    }
    cal.addEventListener("pointerdown", function (e) {
      var ev = e.target.closest(".tg-ev.is-movable");
      if (!ev || e.button !== 0 || e.pointerType === "touch") return;
      var r = data.filter(function (x) { return x.id === +ev.getAttribute("data-rdv"); })[0];
      if (!r) return;
      e.preventDefault(); // pas de sélection de texte pendant le glisser
      drag = { el: ev, r: r, resize: !!e.target.closest("[data-resize]"), x0: e.clientX, y0: e.clientY, started: false, h0: parseFloat(ev.style.height) };
      window.addEventListener("pointermove", dragMove);
      window.addEventListener("pointerup", dragEnd);
      window.addEventListener("pointercancel", dragEnd);
    });
    cal.addEventListener("pointermove", function (e) {
      if (drag) return;
      // Aperçu de création au survol d'une case libre
      var colH = e.target.closest(".tg-col");
      $$(".tg-hover:not([hidden])", cal).forEach(function (h) { if (!colH || h.parentElement !== colH) h.hidden = true; });
      if (!colH || e.target.closest(".tg-ev") || e.pointerType === "touch") { if (colH) $(".tg-hover", colH).hidden = true; return; }
      var mm = pointMinutes(colH, e.clientY), hv = $(".tg-hover", colH);
      hv.hidden = false;
      hv.style.top = ((mm - grid[0]) / 60 * PX) + "px";
      hv.style.height = (30 / 60 * PX) + "px";
      hv.textContent = "+ " + hm(mm).replace(":", "h");
    });
    cal.addEventListener("pointerleave", function () { $$(".tg-hover", cal).forEach(function (h) { h.hidden = true; }); });

    /* ---------- clics ---------- */
    view.addEventListener("click", function (e) {
      var t = e.target;
      if (justDragged) return;
      if (t.closest("[data-vue]")) { st.vue = t.closest("[data-vue]").getAttribute("data-vue"); st.retard = false; load(); return; }
      if (t.closest("[data-prev]")) { step(-1); return; }
      if (t.closest("[data-next]")) { step(1); return; }
      if (t.closest("[data-today]")) { st.date = BO.isoDate(new Date()); st.retard = false; load(); return; }
      if (t.closest("[data-goto-btn]")) { var gi = $("[data-goto]", view); try { gi.showPicker(); } catch (x) { gi.focus(); } return; }
      if (t.closest("[data-open-filters]")) { openFilters(true); return; }
      if (t.closest("[data-close-filters]")) { openFilters(false); return; }
      if (t.closest("[data-reset]")) { st.motif = []; st.statut = []; st.assigne = ""; st.vehicule = ""; st.annules = false; var wasLate = st.retard; st.retard = false; if (wasLate) load(); else { saveQuery(); render(); } return; }
      var chip = t.closest("[data-chip]");
      if (chip) {
        var k = chip.getAttribute("data-chip"), v = chip.getAttribute("data-value");
        if (k === "assigne") st.assigne = v;
        else { var i = st[k].indexOf(v); if (i === -1) st[k].push(v); else st[k].splice(i, 1); }
        saveQuery(); render(); return;
      }
      var rm = t.closest("[data-remove]");
      if (rm) {
        var key = rm.getAttribute("data-remove"), val = rm.getAttribute("data-value");
        if (key === "motif" || key === "statut") st[key] = st[key].filter(function (x) { return x !== val; });
        else if (key === "retard") { st.retard = false; load(); return; }
        else st[key] = key === "annules" ? false : "";
        saveQuery(); render(); return;
      }
      var ev = t.closest("[data-rdv]");
      if (ev) { openDetail(+ev.getAttribute("data-rdv"), load); return; }
      var col = t.closest(".tg-col");
      if (col) { BO.go("#/planning/nouveau?date=" + col.getAttribute("data-date") + "&heure=" + hm(pointMinutes(col, e.clientY)) + (st.vehicule ? "&vehicule=" + st.vehicule : "")); return; }
      var day = t.closest("[data-day]");
      if (day) { st.vue = "jour"; st.date = day.getAttribute("data-day"); st.retard = false; load(); }
    });
    view.addEventListener("keydown", function (e) {
      var ev = e.target.closest && e.target.closest(".tg-ev");
      if (ev && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openDetail(+ev.getAttribute("data-rdv"), load); }
    });
    view.addEventListener("change", function (e) {
      if (e.target.matches("[data-goto]") && e.target.value) { st.date = e.target.value; st.retard = false; load(); }
      if (e.target.matches("[data-fvehicule]")) { st.vehicule = e.target.value; saveQuery(); render(); }
      if (e.target.matches("[data-fopt]")) {
        var k = e.target.getAttribute("data-fopt");
        st[k] = e.target.checked;
        if (k === "retard") { if (st.retard) st.vue = "liste"; load(); } else { saveQuery(); render(); }
      }
    });

    /* ---------- clavier et balayage ---------- */
    function onKey(e) {
      if (!document.body.contains(view)) { document.removeEventListener("keydown", onKey); return; }
      if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || document.querySelector("dialog[open]")) return;
      if (e.key === "Escape" && drawer.classList.contains("is-open")) { openFilters(false); return; }
      if (drawer.classList.contains("is-open")) return;
      var k = e.key.toLowerCase();
      if (e.key === "ArrowLeft" && !st.retard) step(-1);
      else if (e.key === "ArrowRight" && !st.retard) step(1);
      else if (k === "t") { st.date = BO.isoDate(new Date()); st.retard = false; load(); }
      else { var v = VUES.filter(function (x) { return x[2].toLowerCase() === k; })[0]; if (v) { st.vue = v[0]; st.retard = false; load(); } }
    }
    document.addEventListener("keydown", onKey);
    var touch = null;
    cal.addEventListener("touchstart", function (e) { touch = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
    cal.addEventListener("touchend", function (e) {
      if (!touch || st.retard || st.vue === "semaine") return;
      var dx = e.changedTouches[0].clientX - touch.x, dy = e.changedTouches[0].clientY - touch.y;
      if (Math.abs(dx) > 70 && Math.abs(dy) < 50) step(dx < 0 ? 1 : -1);
      touch = null;
    }, { passive: true });
    // Ligne « maintenant » tenue à jour
    var timer = setInterval(function () {
      if (!document.body.contains(view)) { clearInterval(timer); return; }
      if (!drag && !document.querySelector("dialog[open]") && $(".tg-col.is-today", cal)) render();
    }, 60000);

    // Véhicules pour le filtre
    BO.api("admin/vehicules", { query: { parc: BO.parcFilter() } }).then(function (vs) {
      vehicles = vs.filter(function (v) { return ["vendu", "livre", "retire"].indexOf(v.statut) === -1 || String(v.dbId) === st.vehicule; })
        .sort(function (a, b) { return String(a.numeroStock).localeCompare(String(b.numeroStock)); });
      $("[data-fvehicule]", view).innerHTML = '<option value="">Tous les véhicules</option>' + vehicles.map(function (v) { return '<option value="' + v.dbId + '">' + esc(v.numeroStock + " · " + v.marque + " " + v.modele) + "</option>"; }).join("");
      $("[data-fvehicule]", view).value = st.vehicule;
      if (data.length || st.vehicule) syncFilters(visible().length);
    }).catch(function () {});

    return load();
  }, { nav: "planning", title: "Planning", perm: "rdv.gerer" });

  /* ---------------------------------------------------------------- détail d'un rendez-vous */
  function openDetail(id, reload) {
    BO.api("admin/rendez-vous/detail", { query: { id: id } }).then(function (r) {
      var actif = r.statut === "confirme" || r.statut === "en_attente";
      var msgs = r.messages.length ? '<ul class="msg-list">' + r.messages.map(function (m) {
        return "<li>" + BO.pill("m", m.statut, m.statutLabel) + " <strong>" + esc(m.templateLabel) + "</strong> · " + (m.canal === "sms" ? "SMS" : "e-mail") + " · " + (m.envoyeLe ? "envoyé " + fmt.datetime(m.envoyeLe) : "prévu " + fmt.datetime(m.prevuLe)) + (m.erreur ? ' <span class="muted">(' + esc(m.erreur) + ")</span>" : "") + "</li>";
      }).join("") + "</ul>" : '<p class="muted">Aucun message.</p>';
      var actions = [];
      if (r.statut === "en_attente") actions.push({ label: "Confirmer", primary: true, icon: "check", onClick: function () { return setStatut(r, "confirme", reload); } });
      if (actif) {
        actions.push({ label: "Terminé", icon: "check", onClick: function () { return setStatut(r, "termine", reload); } });
        actions.push({ label: "Absent", onClick: function () { return setStatut(r, "absent", reload); } });
        actions.push({ label: "Déplacer", icon: "edit", onClick: function () { BO.go("#/planning/" + r.id + "/modifier"); } });
        actions.push({ label: "Message", icon: "mail", onClick: function () { return BO.api("admin/notifications/apercu", { query: { rendezVousId: r.id, template: r.statut === "confirme" ? "confirmation" : "rappel" } }).then(BO.proposeMessage); } });
        actions.push({ label: "Annuler le RDV", danger: true, onClick: function () { return cancel(r, reload); } });
      }
      BO.modal({
        title: r.motifLabel + " — " + fmt.dateLong(r.debut) + " à " + fmt.time(r.debut),
        wide: true,
        body: '<a class="rdv-veh" href="#/vehicules/' + r.vehiculeId + '">' + BO.thumb(r.vehiculePhoto, "rdv-veh__img") +
            '<span class="rdv-veh__info"><strong>' + esc(r.vehicule) + "</strong>" + (r.vehiculeVersion ? "<small>" + esc(r.vehiculeVersion) + "</small>" : "") +
            "<small>" + esc([r.numeroStock, r.immatriculation].filter(Boolean).join(" · ")) + "</small>" +
            '<span class="rdv-veh__tags">' + (r.vehiculePret ? '<span class="tag tag--ok">' + icon("check") + "Prêt pour le rendez-vous</span>" : '<span class="tag tag--warn">' + icon("clock") + "À préparer</span>") +
            '<span class="rdv-veh__link">Voir la fiche ' + icon("chevron-right", "i--sm") + "</span></span></span></a>" +
          '<div class="detail-grid">' +
          '<dl class="kv">' +
            "<dt>Statut</dt><dd>" + BO.pill("r", r.statut, r.statutLabel) + (r.enRetard ? ' <span class="tag tag--warn">À clôturer</span>' : "") + "</dd>" +
            "<dt>Horaire</dt><dd>" + fmt.time(r.debut) + " – " + fmt.time(r.fin) + "</dd>" +
            "<dt>Client</dt><dd>" + (r.clientId ? '<a href="#/clients/' + r.clientId + '">' + esc(r.client) + "</a>" : "—") +
              (r.clientTelephone ? ' · <a href="tel:' + esc(r.clientTelephone.replace(/[^\d+]/g, "")) + '">' + icon("phone", "i--sm") + esc(r.clientTelephone) + "</a>" : "") + "</dd>" +
            "<dt>Parc</dt><dd>" + esc(r.parc || "—") + "</dd>" +
            "<dt>Assigné à</dt><dd>" + esc(r.assigne || "—") + "</dd>" +
            "<dt>Créé par</dt><dd>" + esc(r.creePar || "—") + " · " + fmt.datetime(r.createdAt) + "</dd>" +
            (r.notes ? "<dt>Notes</dt><dd>" + esc(r.notes) + "</dd>" : "") +
            (r.motifAnnulation ? "<dt>Annulation</dt><dd>" + esc(r.motifAnnulation) + "</dd>" : "") +
          "</dl><div><h3 class=\"subhead\">Messages</h3>" + msgs + "</div></div>",
        actions: actions,
      });
    }).catch(BO.fail);
  }
  BO.openRdv = openDetail;

  function setStatut(r, statut, reload) {
    return BO.api("admin/rendez-vous/statut", { body: { id: r.id, statut: statut } }).then(function () {
      BO.toast("Rendez-vous : " + BO.label("statutsRdv", statut).toLowerCase());
      BO.refreshCounts();
      if (reload) reload();
    });
  }

  function cancel(r, reload) {
    return BO.prompt("Annuler le rendez-vous", "Motif de l'annulation (facultatif)", "Ex. : le client a trouvé un autre véhicule").then(function (raison) {
      if (raison === null) return true;
      return BO.api("admin/rendez-vous/annuler", { body: { id: r.id, raison: raison } }).then(function (res) {
        BO.toast("Rendez-vous annulé" + (res.rappelsAnnules ? " · " + BO.fmt.plural(res.rappelsAnnules, "rappel annulé", "rappels annulés") : ""));
        BO.refreshCounts();
        if (reload) reload();
        return BO.proposeMessage(res.proposition);
      });
    });
  }

  /* ---------------------------------------------------------------- prise de rendez-vous (appel téléphonique) */
  BO.route(/^\/planning\/nouveau$/, function (view, _p, q) { return rdvForm(view, null, q); }, { nav: "planning", title: "Nouveau rendez-vous", perm: "rdv.gerer" });
  BO.route(/^\/planning\/(\d+)\/modifier$/, function (view, p) {
    return BO.api("admin/rendez-vous/detail", { query: { id: p[0] } }).then(function (r) { return rdvForm(view, r, {}); });
  }, { nav: "planning", title: "Déplacer / modifier le rendez-vous", perm: "rdv.gerer" });

  function rdvForm(view, existing, q) {
    var st = {
      vehicule: null, client: null, nouveauClient: false, slot: existing ? existing.debut : null,
      date: existing ? existing.debut.slice(0, 10) : q.date || BO.isoDate(new Date()),
      motif: existing ? existing.motif : q.motif || "visite",
    };
    var motifs = BO.ref("motifs") || [];
    var dureeDefaut = function (code) { var m = motifs.filter(function (x) { return x.code === code; })[0]; return m ? m.duree : 30; };
    var duree = existing ? (minutes(existing.fin) - minutes(existing.debut)) : dureeDefaut(st.motif);
    BO.actions('<a class="btn btn--ghost" href="#/planning">' + icon("arrow-left") + "<span>Planning</span></a>");

    view.innerHTML = '<form class="rdv-form" novalidate>' +
      '<section class="card"><div class="card__head"><h2><span class="step">1</span>Véhicule</h2></div><div class="card__body">' +
        '<label class="search-inline">' + icon("search") + '<input class="input" data-vsearch placeholder="N° de stock, immatriculation ou modèle" autocomplete="off"></label>' +
        '<div class="pick-list" data-vresults></div><div data-vchosen></div></div></section>' +
      '<section class="card"><div class="card__head"><h2><span class="step">2</span>Client</h2><button class="btn btn--ghost btn--sm" type="button" data-newclient>' + icon("plus") + 'Nouveau client</button></div><div class="card__body">' +
        '<label class="search-inline" data-csearch-wrap>' + icon("search") + '<input class="input" data-csearch placeholder="Nom, téléphone ou e-mail" autocomplete="off"></label>' +
        '<div class="pick-list" data-cresults></div><div data-cchosen></div>' +
        '<div class="form-grid" data-cnew hidden>' +
          BO.f.input("c_prenom", "Prénom", "", 'maxlength="80"') + BO.f.input("c_nom", "Nom *", "", 'maxlength="120"') +
          BO.f.input("c_telephone", "Téléphone *", "", 'type="tel" maxlength="40"') + BO.f.input("c_email", "E-mail", "", 'type="email" maxlength="190"') +
          BO.f.select("c_preference", "Préférence de contact", BO.ref("preferences") || {}, "telephone") +
          '<div class="span-2 checks">' + BO.f.check("c_serviceEmail", "Accepte les e-mails liés au rendez-vous", true) + BO.f.check("c_serviceSms", "Accepte les SMS liés au rendez-vous", false) + "</div>" +
        "</div></div></section>" +
      '<section class="card"><div class="card__head"><h2><span class="step">3</span>Motif et créneau</h2></div><div class="card__body">' +
        '<div class="form-grid">' +
          BO.f.select("motif", "Motif", motifs.map(function (m) { return { value: m.code, label: m.libelle + " (" + m.duree + " min)" }; }), st.motif) +
          BO.f.input("duree", "Durée (minutes)", duree, 'type="number" min="5" max="600" step="5"') +
          BO.f.input("date", "Date", st.date, 'type="date"') +
        "</div>" +
        '<div class="slots" data-slots><p class="muted">Choisissez d\'abord le véhicule pour voir ses créneaux.</p></div>' +
        '<div class="form-grid"><label class="field">Ou heure précise<input class="input" type="time" name="heure" step="300" value="' + esc(existing ? existing.debut.slice(11, 16) : q.heure || "") + '"></label></div>' +
      "</div></section>" +
      '<section class="card"><div class="card__head"><h2><span class="step">4</span>Détails</h2></div><div class="card__body form-grid">' +
        BO.f.select("statut", "Statut", { confirme: "Confirmé", en_attente: "En attente de confirmation" }, existing ? existing.statut : "confirme") +
        BO.f.select("assigneId", "Assigné à", BO.f.userOptions("Personne"), existing ? existing.assigneId : (BO.state.user.role === "admin" ? "" : BO.state.user.id)) +
        '<div class="span-3">' + BO.f.textarea("notes", "Notes internes", existing ? existing.notes : "", 'rows="3" maxlength="2000"', "jamais envoyées au client") + "</div>" +
      "</div></section>" +
      '<p class="alert" data-error hidden></p>' +
      '<div class="form-actions"><a class="btn btn--ghost" href="#/planning">Annuler</a><button class="btn btn--primary" type="submit">' + icon("check") + (existing ? "Enregistrer les modifications" : "Enregistrer le rendez-vous") + "</button></div>" +
    "</form>";

    var form = $("form", view), vehicles = [];
    var showError = function (msg) { var e = $("[data-error]", view); e.textContent = msg || ""; e.hidden = !msg; if (msg) e.scrollIntoView({ block: "center", behavior: "smooth" }); };

    // Véhicules du périmètre (en stock en priorité)
    BO.api("admin/vehicules", { query: { parc: BO.parcFilter() } }).then(function (vs) {
      vehicles = vs;
      var pre = existing ? existing.vehiculeId : +q.vehicule;
      if (pre) { var v = vs.filter(function (x) { return x.dbId === pre; })[0]; if (v) chooseVehicle(v); }
      renderVehicles("");
    }).catch(BO.fail);

    function renderVehicles(text) {
      var t = text.toLowerCase().replace(/[^a-z0-9]/g, "");
      var list = vehicles.filter(function (v) {
        if (st.vehicule && v.dbId === st.vehicule.dbId) return false;
        var hay = (v.numeroStock + v.immatriculation + v.marque + v.modele + v.version).toLowerCase().replace(/[^a-z0-9]/g, "");
        return (!t || hay.indexOf(t) !== -1) && (t || ["vendu", "livre", "retire"].indexOf(v.statut) === -1);
      }).slice(0, t ? 12 : 6);
      $("[data-vresults]", view).innerHTML = st.vehicule && !t ? "" : list.map(function (v) {
        return '<button type="button" class="pick" data-pickv="' + v.dbId + '">' + BO.thumb(v.photos[0], "pick-img") + "<span><strong>" + esc(v.marque + " " + v.modele) + "</strong><small>" +
          esc([v.numeroStock, v.immatriculation, v.parc, BO.label("statutsVehicule", v.statut)].filter(Boolean).join(" · ")) + "</small></span></button>";
      }).join("") || (t ? '<p class="muted">Aucun véhicule ne correspond.</p>' : "");
    }
    function chooseVehicle(v) {
      st.vehicule = v;
      $("[data-vchosen]", view).innerHTML = '<div class="chosen">' + BO.thumb(v.photos[0], "pick-img") + '<div class="grow"><strong>' + esc(v.marque + " " + v.modele) + "</strong> " + BO.statutVehicule(v) +
        "<small>" + esc([v.numeroStock, v.immatriculation, v.parc].filter(Boolean).join(" · ")) + "</small>" +
        '<span class="chosen-tags">' + (v.pretVisite ? '<span class="tag tag--ok">' + icon("check") + "Prêt pour les rendez-vous</span>" : '<span class="tag tag--warn">' + icon("clock") + "Pas encore prêt</span>") +
        BO.ctBadge(v.ct) + BO.progress(v.preparation) + "</span></div>" +
        '<button type="button" class="btn btn--ghost btn--sm" data-unpickv>Changer</button></div>';
      $("[data-vsearch]", view).value = "";
      $("[data-vsearch]", view).closest(".search-inline").hidden = true;
      renderVehicles("");
      loadSlots();
    }

    // Clients
    var ctimer;
    function searchClients(text) {
      clearTimeout(ctimer);
      ctimer = setTimeout(function () {
        if (text.length < 2) { $("[data-cresults]", view).innerHTML = ""; return; }
        BO.api("admin/clients", { query: { q: text, limite: 8 } }).then(function (cs) {
          $("[data-cresults]", view).innerHTML = cs.map(function (c) {
            return '<button type="button" class="pick" data-pickc="' + c.id + '"><span class="sr-avatar">' + icon("user") + "</span><span><strong>" + esc(c.nomComplet) + "</strong><small>" + esc([c.telephone, c.email].filter(Boolean).join(" · ")) + "</small></span></button>";
          }).join("") || '<p class="muted">Aucun client trouvé : créez la fiche avec « Nouveau client ».</p>';
          $("[data-cresults]", view)._list = cs;
        }).catch(BO.fail);
      }, 220);
    }
    function chooseClient(c) {
      st.client = c;
      st.nouveauClient = false;
      $("[data-cnew]", view).hidden = true;
      $("[data-csearch-wrap]", view).hidden = true;
      $("[data-cresults]", view).innerHTML = "";
      $("[data-cchosen]", view).innerHTML = '<div class="chosen"><span class="sr-avatar">' + icon("user") + '</span><div class="grow"><strong>' + esc(c.nomComplet) + "</strong><small>" +
        esc([c.telephone, c.email, "préfère : " + BO.label("preferences", c.preference)].filter(Boolean).join(" · ")) + '</small></div><button type="button" class="btn btn--ghost btn--sm" data-unpickc>Changer</button></div>';
    }
    if (existing && existing.clientId) chooseClient({ id: existing.clientId, nomComplet: existing.client, telephone: existing.clientTelephone, email: existing.clientEmail, preference: "" });
    else if (q.client) BO.api("admin/client", { query: { id: q.client } }).then(chooseClient).catch(function () {});

    // Créneaux
    function loadSlots() {
      if (!st.vehicule) return;
      var box = $("[data-slots]", view);
      box.innerHTML = '<p class="muted">Recherche des créneaux…</p>';
      BO.api("admin/rendez-vous/creneaux", { query: { vehicule: st.vehicule.dbId, date: form.date.value, motif: form.motif.value, duree: form.duree.value, exclure: existing ? existing.id : "" } }).then(function (r) {
        var res = r.reservations.filter(function (x) { return !existing || x.id !== existing.id; });
        box.innerHTML = (r.creneaux.length ? '<p class="slots-title">Créneaux du ' + esc(fmt.dateLong(form.date.value)) + " (" + r.duree + " min) :</p>" +
          '<div class="slot-grid">' + r.creneaux.map(function (s) {
            var sel = st.slot && st.slot.slice(0, 16) === s.debut.slice(0, 16);
            return '<button type="button" class="slot' + (s.libre ? "" : " is-busy") + (sel ? " is-selected" : "") + '" ' + (s.libre ? 'data-pick-slot="' + s.debut + '"' : "disabled") + ' title="' + (s.libre ? "Libre" : s.passe ? "Passé" : "Occupé") + '">' + fmt.time(s.debut) + "</button>";
          }).join("") + "</div>" : '<p class="muted">Le garage est fermé ce jour-là : saisissez une heure précise si nécessaire.</p>') +
          (res.length ? '<ul class="day-bookings">' + res.map(function (b) { return "<li>" + BO.pill("r", b.statut, b.statutLabel) + " " + fmt.time(b.debut) + "–" + fmt.time(b.fin) + " · " + esc(b.motif) + "</li>"; }).join("") + "</ul>" : "");
      }).catch(BO.fail);
    }

    view.addEventListener("input", function (e) {
      if (e.target.matches("[data-vsearch]")) renderVehicles(e.target.value);
      if (e.target.matches("[data-csearch]")) searchClients(e.target.value.trim());
      BO.state.dirty = true;
    });
    view.addEventListener("change", function (e) {
      if (e.target.name === "motif") { form.duree.value = dureeDefaut(e.target.value); st.slot = null; loadSlots(); }
      if (e.target.name === "duree" || e.target.name === "date") { st.slot = null; loadSlots(); }
      if (e.target.name === "heure" && e.target.value) { st.slot = null; $$(".slot.is-selected", view).forEach(function (s) { s.classList.remove("is-selected"); }); }
    });
    view.addEventListener("click", function (e) {
      var pv = e.target.closest("[data-pickv]");
      if (pv) { chooseVehicle(vehicles.filter(function (v) { return v.dbId === +pv.getAttribute("data-pickv"); })[0]); return; }
      if (e.target.closest("[data-unpickv]")) { st.vehicule = null; $("[data-vchosen]", view).innerHTML = ""; $("[data-vsearch]", view).closest(".search-inline").hidden = false; renderVehicles(""); $("[data-slots]", view).innerHTML = ""; return; }
      var pc = e.target.closest("[data-pickc]");
      if (pc) { chooseClient($("[data-cresults]", view)._list.filter(function (c) { return c.id === +pc.getAttribute("data-pickc"); })[0]); return; }
      if (e.target.closest("[data-unpickc]")) { st.client = null; $("[data-cchosen]", view).innerHTML = ""; $("[data-csearch-wrap]", view).hidden = false; return; }
      if (e.target.closest("[data-newclient]")) {
        st.client = null; st.nouveauClient = true;
        $("[data-cchosen]", view).innerHTML = ""; $("[data-csearch-wrap]", view).hidden = true; $("[data-cresults]", view).innerHTML = "";
        $("[data-cnew]", view).hidden = false; form.c_prenom.focus(); return;
      }
      var sl = e.target.closest("[data-pick-slot]");
      if (sl) { st.slot = sl.getAttribute("data-pick-slot"); form.heure.value = ""; $$(".slot", view).forEach(function (s) { s.classList.toggle("is-selected", s === sl); }); }
    });

    function payload(confirmDup) {
      var b = { motif: form.motif.value, duree: form.duree.value, statut: form.statut.value, assigneId: form.assigneId.value, notes: form.notes.value.trim() };
      if (existing) b.id = existing.id;
      if (st.vehicule) b.vehiculeId = st.vehicule.dbId;
      b.debut = form.heure.value ? form.date.value + " " + form.heure.value : st.slot;
      if (st.client) b.clientId = st.client.id;
      else if (st.nouveauClient) {
        b.nouveauClient = { prenom: form.c_prenom.value.trim(), nom: form.c_nom.value.trim(), telephone: form.c_telephone.value.trim(), email: form.c_email.value.trim(),
          preference: form.c_preference.value, serviceEmail: form.c_serviceEmail.checked, serviceSms: form.c_serviceSms.checked, confirmerDoublon: !!confirmDup };
      }
      return b;
    }

    function submit(confirmDup) {
      showError("");
      var b = payload(confirmDup);
      if (!b.vehiculeId) return showError("Choisissez le véhicule.");
      if (!b.clientId && !b.nouveauClient) return showError("Choisissez le client ou créez sa fiche.");
      if (!b.debut) return showError("Choisissez un créneau libre ou saisissez une heure précise.");
      var btn = $("button[type=submit]", view);
      btn.disabled = true;
      BO.api(existing ? "admin/rendez-vous/modifier" : "admin/rendez-vous", { body: b }).then(function (res) {
        BO.state.dirty = false;
        BO.refreshCounts();
        BO.toast(existing ? "Rendez-vous modifié" : "Rendez-vous enregistré");
        if (res.avertissements && res.avertissements.length) BO.toast(res.avertissements.join(" "));
        return BO.proposeMessage(res.proposition).then(function () { BO.go("#/planning?vue=jour&date=" + res.rendezVous.debut.slice(0, 10)); });
      }).catch(function (err) {
        if (err.status === 409 && err.data && err.data.doublons) {
          var d = err.data.doublons;
          BO.modal({
            title: "Ce client existe peut-être déjà",
            body: "<p>Une fiche porte le même téléphone ou e-mail :</p><ul class=\"pick-list\">" + d.map(function (c) {
              return '<li><button type="button" class="pick" data-dup="' + c.id + '"><span class="sr-avatar">' + icon("user") + "</span><span><strong>" + esc(c.nomComplet) + "</strong><small>" + esc([c.telephone, c.email].filter(Boolean).join(" · ")) + "</small></span></button></li>";
            }).join("") + "</ul><p class=\"muted\">Choisissez la fiche existante, ou créez quand même une nouvelle fiche.</p>",
            actions: [{ label: "Créer quand même", onClick: function () { submit(true); } }],
            onOpen: function (m) {
              m.body.addEventListener("click", function (ev) {
                var p = ev.target.closest("[data-dup]");
                if (p) { chooseClient(d.filter(function (c) { return c.id === +p.getAttribute("data-dup"); })[0]); m.close(); submit(); }
              });
            },
          });
          return;
        }
        showError(err.message);
        if (err.status === 409) { st.slot = null; loadSlots(); }
      }).then(function () { btn.disabled = false; });
    }
    form.addEventListener("submit", function (e) { e.preventDefault(); submit(false); });
  }
})();
