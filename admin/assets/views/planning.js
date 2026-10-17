/* Planning : calendrier jour / semaine / mois / liste, prise de rendez-vous par téléphone, détail */
(function () {
  "use strict";
  var BO = window.BO, esc = BO.esc, icon = BO.icon, fmt = BO.fmt, $ = BO.$, $$ = BO.$$;
  var DAYS = ["Dim.", "Lun.", "Mar.", "Mer.", "Jeu.", "Ven.", "Sam."];
  var H_START = 8, H_END = 19, PX = 72; // pixels par heure

  function monday(d) { var x = new Date(d); var w = (x.getDay() + 6) % 7; x.setDate(x.getDate() - w); x.setHours(0, 0, 0, 0); return x; }
  function parseDay(s) { var p = String(s).split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function minutes(s) { return +s.slice(11, 13) * 60 + +s.slice(14, 16); }

  /* ---------------------------------------------------------------- calendrier */
  BO.route(/^\/planning$/, function (view, _p, q) {
    var mobile = window.matchMedia("(max-width: 700px)").matches;
    var st = {
      vue: q.vue || (mobile ? "liste" : "semaine"), date: q.date || BO.isoDate(new Date()), vehicule: q.vehicule || "",
      assigne: q.assigne || "", motif: q.motif || "", statut: q.statut || "", retard: q.retard || "", annules: q.annules || "",
    };
    BO.actions('<a class="btn btn--primary" href="#/planning/nouveau">' + icon("plus") + "<span>Nouveau rendez-vous</span></a>");
    view.innerHTML = '<div class="cal-toolbar">' +
      '<div class="seg" data-vues>' + [["jour", "Jour"], ["semaine", "Semaine"], ["mois", "Mois"], ["liste", "Liste"]].map(function (v) { return '<button type="button" data-vue="' + v[0] + '">' + v[1] + "</button>"; }).join("") + "</div>" +
      '<div class="cal-nav"><button class="icon-btn" type="button" data-prev aria-label="Précédent">' + icon("chevron-left") + '</button><button class="btn btn--ghost btn--sm" type="button" data-today>Aujourd\'hui</button><button class="icon-btn" type="button" data-next aria-label="Suivant">' + icon("chevron-right") + '</button><strong data-label></strong></div>' +
      '<div class="cal-filters">' +
        '<select class="select" data-f="motif" aria-label="Motif"><option value="">Tous les motifs</option>' + (BO.ref("motifs") || []).map(function (m) { return '<option value="' + m.code + '">' + esc(m.libelle) + "</option>"; }).join("") + "</select>" +
        '<select class="select" data-f="statut" aria-label="Statut"><option value="">Tous les statuts</option>' + Object.keys(BO.ref("statutsRdv") || {}).map(function (k) { return '<option value="' + k + '">' + esc(BO.ref("statutsRdv")[k]) + "</option>"; }).join("") + "</select>" +
        '<select class="select" data-f="assigne" aria-label="Secrétaire">' + BO.f.userOptions("Toute l'équipe").map(function (o) { return '<option value="' + o.value + '">' + esc(o.label) + "</option>"; }).join("") + "</select>" +
        '<select class="select" data-f="vehicule" aria-label="Véhicule"><option value="">Tous les véhicules</option></select>' +
        BO.f.check("annules", "Afficher les annulés", st.annules === "1") +
      "</div></div>" +
      '<div class="cal-legend"><span class="ev ev--confirme">Confirmé</span><span class="ev ev--en_attente">En attente</span><span class="ev ev--termine">Terminé</span><span class="ev ev--absent">Absent</span><span class="ev ev--annule">Annulé</span></div>' +
      '<div data-cal><p class="loading">Chargement…</p></div>';

    BO.$$("[data-f]", view).forEach(function (s) { s.value = st[s.getAttribute("data-f")]; });
    BO.api("admin/vehicules", { query: { parc: BO.parcFilter() } }).then(function (vs) {
      var sel = $('[data-f="vehicule"]', view);
      sel.innerHTML += vs.filter(function (v) { return ["vendu", "livre", "retire"].indexOf(v.statut) === -1 || String(v.dbId) === st.vehicule; })
        .map(function (v) { return '<option value="' + v.dbId + '">' + esc(v.numeroStock + " · " + v.marque + " " + v.modele) + "</option>"; }).join("");
      sel.value = st.vehicule;
    }).catch(function () {});

    function range() {
      var d = parseDay(st.date);
      if (st.vue === "jour") return [d, d];
      if (st.vue === "semaine") { var m = monday(d); return [m, BO.addDays(m, 6)]; }
      if (st.vue === "mois") { var first = new Date(d.getFullYear(), d.getMonth(), 1), last = new Date(d.getFullYear(), d.getMonth() + 1, 0); return [monday(first), BO.addDays(monday(last), 6)]; }
      return st.retard ? [new Date(2000, 0, 1), new Date()] : [d, BO.addDays(d, 30)];
    }

    function load() {
      BO.setQuery(st);
      $$("[data-vue]", view).forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-vue") === st.vue); });
      var r = range(), d = parseDay(st.date);
      $("[data-label]", view).textContent = st.vue === "jour" ? fmt.dateLong(st.date) : st.vue === "mois" ? d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })
        : st.vue === "semaine" ? "Semaine du " + r[0].toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) : st.retard ? "Rendez-vous à clôturer" : "À partir du " + fmt.date(st.date);
      var query = { du: BO.isoDate(r[0]), au: BO.isoDate(r[1]), parc: BO.parcFilter(), vehicule: st.vehicule, assigne: st.assigne, motif: st.motif, statut: st.statut, retard: st.retard };
      return BO.api("admin/rendez-vous", { query: query }).then(function (list) {
        if (!st.annules && !st.statut) list = list.filter(function (x) { return x.statut !== "annule"; });
        var box = $("[data-cal]", view);
        if (st.vue === "liste") box.innerHTML = renderList(list);
        else if (st.vue === "mois") box.innerHTML = renderMonth(list, parseDay(st.date), r[0]);
        else box.innerHTML = renderGrid(list, st.vue === "jour" ? [parseDay(st.date)] : Array.from({ length: 7 }, function (_, i) { return BO.addDays(r[0], i); }));
        if (q.rdv) { openDetail(+q.rdv, load); q.rdv = null; }
      });
    }

    view.addEventListener("click", function (e) {
      var v = e.target.closest("[data-vue]");
      if (v) { st.vue = v.getAttribute("data-vue"); st.retard = ""; load().catch(BO.fail); return; }
      var step = e.target.closest("[data-prev]") ? -1 : e.target.closest("[data-next]") ? 1 : 0;
      if (step) {
        var d = parseDay(st.date);
        if (st.vue === "jour") d = BO.addDays(d, step); else if (st.vue === "mois") d = new Date(d.getFullYear(), d.getMonth() + step, 1); else d = BO.addDays(d, 7 * step);
        st.date = BO.isoDate(d); load().catch(BO.fail); return;
      }
      if (e.target.closest("[data-today]")) { st.date = BO.isoDate(new Date()); st.retard = ""; load().catch(BO.fail); return; }
      var ev = e.target.closest("[data-rdv]");
      if (ev) { openDetail(+ev.getAttribute("data-rdv"), load); return; }
      var cell = e.target.closest("[data-slot]");
      if (cell) { BO.go("#/planning/nouveau?date=" + cell.getAttribute("data-slot").slice(0, 10) + "&heure=" + cell.getAttribute("data-slot").slice(11, 16) + (st.vehicule ? "&vehicule=" + st.vehicule : "")); return; }
      var day = e.target.closest("[data-day]");
      if (day) { st.vue = "jour"; st.date = day.getAttribute("data-day"); load().catch(BO.fail); }
    });
    view.addEventListener("change", function (e) {
      if (e.target.matches("[data-f]")) { st[e.target.getAttribute("data-f")] = e.target.value; load().catch(BO.fail); }
      if (e.target.name === "annules") { st.annules = e.target.checked ? "1" : ""; load().catch(BO.fail); }
    });
    return load();
  }, { nav: "planning", title: "Planning", perm: "rdv.gerer" });

  function evClass(r) { return "ev ev--" + r.statut + (r.enRetard ? " ev--retard" : ""); }

  function renderGrid(list, days) {
    var today = BO.isoDate(new Date());
    var hours = "";
    for (var h = H_START; h < H_END; h++) hours += '<div class="cal-hour" style="height:' + PX + 'px">' + h + "h</div>";
    var cols = days.map(function (d) {
      var iso = BO.isoDate(d);
      var evs = list.filter(function (r) { return r.debut.slice(0, 10) === iso; });
      // Répartition en colonnes des rendez-vous simultanés (véhicules différents)
      var lanes = [];
      evs.sort(function (a, b) { return a.debut.localeCompare(b.debut); }).forEach(function (r) {
        var lane = 0;
        while (lanes[lane] && lanes[lane] > r.debut) lane++;
        lanes[lane] = r.fin;
        r._lane = lane;
      });
      var n = Math.max(1, lanes.length);
      var slots = "";
      for (var h2 = H_START; h2 < H_END; h2++) {
        ["00", "30"].forEach(function (mm) {
          slots += '<div class="cal-slot" style="height:' + PX / 2 + 'px" data-slot="' + iso + " " + String(h2).padStart(2, "0") + ":" + mm + '" title="Nouveau rendez-vous à ' + h2 + "h" + mm + '"></div>';
        });
      }
      var items = evs.map(function (r) {
        var top = Math.max(0, (minutes(r.debut) - H_START * 60) / 60 * PX), height = Math.max(24, (minutes(r.fin) - minutes(r.debut)) / 60 * PX - 2);
        return '<button type="button" class="' + evClass(r) + '" data-rdv="' + r.id + '" title="' + esc(fmt.time(r.debut) + "–" + fmt.time(r.fin) + " · " + r.motifLabel + " · " + r.vehicule + (r.client ? " · " + r.client : "")) + '" style="top:' + top + "px;height:" + height + "px;left:calc(" + (r._lane / n * 100) + "% + 2px);width:calc(" + (100 / n) + '% - 4px)">' +
          "<strong>" + fmt.time(r.debut) + " · " + esc(r.vehicule) + "</strong><span>" + esc(r.motifLabel) + (r.client ? " · " + esc(r.client) : "") + "</span></button>";
      }).join("");
      return '<div class="cal-col' + (iso === today ? " is-today" : "") + '"><div class="cal-colhead"><button type="button" data-day="' + iso + '">' + DAYS[d.getDay()] + " " + d.getDate() + "</button></div>" +
        '<div class="cal-body" style="height:' + (H_END - H_START) * PX + 'px">' + slots + items + "</div></div>";
    }).join("");
    return '<div class="cal-grid' + (days.length === 1 ? " cal-grid--day" : "") + '"><div class="cal-hours"><div class="cal-colhead"></div>' + hours + "</div>" + cols + "</div>";
  }

  function renderMonth(list, ref, start) {
    var html = '<div class="cal-month">' + ["Lun.", "Mar.", "Mer.", "Jeu.", "Ven.", "Sam.", "Dim."].map(function (d) { return '<div class="cal-mhead">' + d + "</div>"; }).join("");
    var today = BO.isoDate(new Date());
    for (var i = 0; i < 42; i++) {
      var d = BO.addDays(start, i), iso = BO.isoDate(d);
      if (i >= 35 && d.getMonth() !== ref.getMonth()) break;
      var evs = list.filter(function (r) { return r.debut.slice(0, 10) === iso; });
      html += '<div class="cal-mday' + (d.getMonth() !== ref.getMonth() ? " is-out" : "") + (iso === today ? " is-today" : "") + '"><button type="button" class="cal-mnum" data-day="' + iso + '">' + d.getDate() + "</button>" +
        evs.slice(0, 4).map(function (r) { return '<button type="button" class="' + evClass(r) + ' ev--chip" data-rdv="' + r.id + '">' + fmt.time(r.debut) + " " + esc(r.vehicule) + "</button>"; }).join("") +
        (evs.length > 4 ? '<button type="button" class="cal-more" data-day="' + iso + '">+ ' + (evs.length - 4) + " autres</button>" : "") + "</div>";
    }
    return html + "</div>";
  }

  function renderList(list) {
    if (!list.length) return '<div class="card empty">' + icon("calendar") + "<p>Aucun rendez-vous sur cette période.</p></div>";
    var byDay = {};
    list.forEach(function (r) { (byDay[r.debut.slice(0, 10)] = byDay[r.debut.slice(0, 10)] || []).push(r); });
    return Object.keys(byDay).sort().map(function (d) {
      return '<section class="card day-list"><div class="card__head"><h2>' + esc(fmt.dateLong(d)) + "</h2><span class=\"muted\">" + fmt.plural(byDay[d].length, "rendez-vous") + "</span></div>" +
        '<ul class="mini-list">' + byDay[d].map(function (r) {
          return '<li class="is-click" data-rdv="' + r.id + '"><span class="mini-time">' + fmt.time(r.debut) + "<small>" + fmt.time(r.fin) + "</small></span>" +
            '<div class="grow"><strong>' + esc(r.motifLabel) + " · " + esc(r.vehicule) + ' <span class="muted">' + esc(r.numeroStock || "") + "</span></strong><span>" +
            esc(r.client || "Sans client") + (r.clientTelephone ? " · " + esc(r.clientTelephone) : "") + (r.parc ? " · " + esc(r.parc) : "") + (r.assigne ? " · " + esc(r.assigne) : "") + "</span></div>" +
            (r.enRetard ? '<span class="tag tag--warn">' + icon("clock") + "À clôturer</span>" : "") + BO.pill("r", r.statut, r.statutLabel) + "</li>";
        }).join("") + "</ul></section>";
    }).join("");
  }

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
        body: '<div class="detail-grid">' +
          '<dl class="kv">' +
            "<dt>Statut</dt><dd>" + BO.pill("r", r.statut, r.statutLabel) + (r.enRetard ? ' <span class="tag tag--warn">À clôturer</span>' : "") + "</dd>" +
            "<dt>Horaire</dt><dd>" + fmt.time(r.debut) + " – " + fmt.time(r.fin) + "</dd>" +
            '<dt>Véhicule</dt><dd><a href="#/vehicules/' + r.vehiculeId + '">' + esc(r.vehicule) + "</a> · " + esc(r.numeroStock || "") + " " + esc(r.immatriculation || "") +
              (r.vehiculePret ? ' <span class="tag tag--ok">' + icon("check") + "Prêt</span>" : ' <a class="tag tag--warn" href="#/vehicules/' + r.vehiculeId + '/preparation">' + icon("clock") + "À préparer</a>") + "</dd>" +
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
