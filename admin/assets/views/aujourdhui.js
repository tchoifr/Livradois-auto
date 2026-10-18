/* Aujourd'hui : le programme de la journée pour toute l'équipe (rendez-vous, préparation, secrétariat, propriétaire) */
(function () {
  "use strict";
  var BO = window.BO, esc = BO.esc, icon = BO.icon, fmt = BO.fmt, $ = BO.$, $$ = BO.$$;
  var ACTIFS = ["en_attente", "confirme"];

  function parseDay(s) { var p = String(s).split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function capital(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function tel(t) { return t ? '<a href="tel:' + esc(String(t).replace(/[^\d+]/g, "")) + '">' + icon("phone", "i--sm") + esc(t) + "</a>" : ""; }

  BO.route(/^\/aujourdhui$/, function (view, _p, q) {
    var st = { date: /^\d{4}-\d{2}-\d{2}$/.test(q.date || "") ? q.date : BO.isoDate(new Date()), pour: q.pour || "" };
    var data = null, users = BO.ref("utilisateurs") || [];

    var acts = [];
    if (BO.can("rdv.gerer")) acts.push('<a class="btn btn--primary" href="#/planning/nouveau">' + icon("plus") + "<span>Rendez-vous</span></a>");
    acts.push('<button type="button" class="btn btn--ghost" data-print>' + icon("file-text") + "<span>Imprimer</span></button>");
    BO.actions(acts.join(""));
    $("[data-print]").addEventListener("click", function () { window.print(); });

    view.innerHTML =
      '<div class="pl-bar jr-bar"><div class="pl-nav">' +
        '<div class="pl-step"><button type="button" class="pl-step__btn" data-step="-1" title="Jour précédent" aria-label="Jour précédent">' + icon("chevron-left") + "</button>" +
        '<button type="button" class="pl-step__today" data-today>Aujourd\'hui</button>' +
        '<button type="button" class="pl-step__btn" data-step="1" title="Jour suivant" aria-label="Jour suivant">' + icon("chevron-right") + "</button></div>" +
        '<h2 class="jr-title" data-label></h2></div>' +
        (users.length > 1 ? '<div class="chips jr-pour" role="group" aria-label="Pour qui">' +
          [{ id: "", nom: "Tout le monde" }].concat(users, [{ id: "aucun", nom: "Non attribué" }]).map(function (u) {
            return '<button type="button" class="chip" data-pour="' + esc(u.id) + '">' + esc(u.nom) + "</button>";
          }).join("") + "</div>" : "") +
      "</div>" +
      '<div data-jour><p class="loading">Chargement…</p></div>';
    var box = $("[data-jour]", view);

    function load() {
      BO.setQuery({ date: st.date === BO.isoDate(new Date()) ? "" : st.date, pour: st.pour });
      var d = parseDay(st.date), today = BO.isoDate(new Date()), demain = BO.isoDate(BO.addDays(new Date(), 1));
      $("[data-label]", view).innerHTML = esc(capital(d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }))) +
        (st.date === today ? ' <span class="pl-week">aujourd\'hui</span>' : st.date === demain ? ' <span class="pl-week">demain</span>' : "");
      $$("[data-pour]", view).forEach(function (c) { c.setAttribute("aria-pressed", String(c.getAttribute("data-pour") === st.pour)); });
      box.classList.add("is-busy");
      return BO.api("admin/journee", { query: { date: st.date, parc: BO.parcFilter() } }).then(function (j) { data = j; render(); })
        .catch(BO.fail).then(function () { box.classList.remove("is-busy"); });
    }

    // Filtre « pour qui » : rendez-vous (personne assignée) et tâches (responsable)
    function mine(id) { return !st.pour || (st.pour === "aucun" ? id == null : String(id) === st.pour); }

    function render() {
      var j = data, today = BO.isoDate(new Date()) === j.date;
      var rdv = j.rendezVous.filter(function (r) { return mine(r.assigneId); });
      var taches = j.preparation.taches.filter(function (t) { return mine(t.responsableId); });
      var ouvertes = taches.filter(function (t) { return t.statut !== "termine"; });
      var sec = j.secretariat, aTraiter = sec.demandesTotal + sec.aConfirmer.length + sec.aCloturer.length + sec.messagesEchec.length;
      var next = rdv.filter(function (r) { return ACTIFS.indexOf(r.statut) !== -1 && (!today || r.fin.slice(11, 16) > nowHm()); })[0];
      var kpi = function (ic, label, value, small, cls) { return '<div class="kpi ' + (cls || "") + '"><span class="kpi__label">' + icon(ic) + label + "</span><strong>" + value + "</strong><small>" + small + "</small></div>"; };

      box.innerHTML =
        '<div class="kpis kpis--4 jr-kpis">' +
          kpi("calendar", "Rendez-vous", rdv.length, next ? "prochain à " + fmt.time(next.debut) + " · " + esc(next.vehicule) : rdv.length ? "tous passés" : "aucun prévu", rdv.length ? "kpi--hot" : "") +
          kpi("droplet", "Préparation", ouvertes.length, ouvertes.filter(function (t) { return t.avantRdv; }).length + " avant un RDV · " + ouvertes.filter(function (t) { return !t.avantRdv && t.echeance && t.echeance < j.date; }).length + " en retard") +
          kpi("clipboard", "Contrôles techniques", j.preparation.ct.length, j.preparation.ct.filter(function (c) { return c.ct.etat === "echu"; }).length + " échu(s)", j.preparation.ct.some(function (c) { return c.ct.etat === "echu"; }) ? "kpi--warn" : "") +
          kpi("inbox", "Secrétariat", aTraiter, sec.demandesTotal + " à rappeler · " + sec.aConfirmer.length + " à confirmer") +
        "</div>" +
        (j.horaires.length ? "" : '<p class="note">' + icon("info") + "<span>Le garage est fermé ce jour-là (horaires dans Paramètres).</span></p>") +
        '<div class="grid-2 jr-grid">' +
          '<section class="card"><div class="card__head"><h2>' + icon("calendar") + "Programme de la journée</h2>" +
            (BO.can("rdv.gerer") ? '<a class="btn btn--ghost btn--sm" href="#/planning?vue=jour&date=' + j.date + '">Planning du jour</a>' : "") + "</div>" + programme(rdv, j, today) + "</section>" +
          '<div class="stack">' +
            '<section class="card"><div class="card__head"><h2>' + icon("phone") + "Secrétariat</h2></div>" + secretariat(sec) + "</section>" +
            (j.proprietaire ? '<section class="card"><div class="card__head"><h2>' + icon("key") + "Propriétaire</h2></div>" + proprietaire(j.proprietaire) + "</section>" : "") +
          "</div>" +
        "</div>" +
        '<section class="card jr-grid"><div class="card__head"><h2>' + icon("droplet") + "Préparation des véhicules</h2>" +
          '<span class="muted small">' + fmt.plural(ouvertes.length, "tâche") + " à faire · cochez dès que c'est fait</span></div>" + preparation(taches, j) + "</section>";
    }

    function nowHm() { var n = new Date(); return String(n.getHours()).padStart(2, "0") + ":" + String(n.getMinutes()).padStart(2, "0"); }

    /* ---------- programme : rendez-vous dans l'ordre, avec ce qu'il reste à préparer ---------- */
    function programme(rdv, j, today) {
      if (!rdv.length) {
        return '<div class="empty">' + icon("calendar") + "<p>Aucun rendez-vous" + (st.pour ? " pour cette personne" : "") + " ce jour-là.</p>" +
          (BO.can("rdv.gerer") ? '<a class="btn btn--ghost btn--sm" href="#/planning/nouveau?date=' + j.date + '">' + icon("plus") + "Prendre un rendez-vous</a>" : "") + "</div>";
      }
      var now = nowHm(), placed = !today, html = '<ol class="jr-timeline">';
      rdv.forEach(function (r) {
        if (!placed && r.debut.slice(11, 16) > now) { html += '<li class="jr-now"><span>Maintenant · ' + now.replace(":", "h") + "</span></li>"; placed = true; }
        var prep = j.preparation.taches.filter(function (t) { return t.vehiculeId === r.vehiculeId && t.avantRdv === r.debut.slice(11, 16); });
        var late = ACTIFS.indexOf(r.statut) !== -1 && r.enRetard;
        html += '<li class="jr-item ev--' + r.statut + '">' +
          '<span class="jr-time">' + fmt.time(r.debut) + "<small>" + fmt.time(r.fin) + "</small></span>" +
          '<div class="jr-card" data-rdv="' + r.id + '" role="button" tabindex="0">' +
            BO.thumb(r.vehiculePhoto, "jr-img") +
            '<div class="jr-main"><p class="jr-what"><strong>' + esc(r.motifLabel) + "</strong> · " + esc(r.vehicule) + ' <span class="muted">' + esc(r.numeroStock || "") + "</span></p>" +
              '<p class="jr-who">' + esc(r.client || "Sans client") + (r.clientTelephone ? " · " + tel(r.clientTelephone) : "") + (r.parc ? " · " + esc(r.parc) : "") + "</p>" +
              '<p class="jr-tags">' + BO.pill("r", r.statut, r.statutLabel) + (late ? ' <span class="tag tag--warn">' + icon("clock") + "À clôturer</span>" : "") +
                (r.assigne ? ' <span class="tag">' + icon("user") + esc(r.assigne) + "</span>" : ' <span class="tag tag--muted">Personne assignée</span>') +
                (ACTIFS.indexOf(r.statut) !== -1 && !r.vehiculePret && !prep.length ? ' <span class="tag tag--warn">Véhicule pas marqué prêt</span>' : "") + "</p>" +
              (prep.length && ACTIFS.indexOf(r.statut) !== -1 ? '<div class="jr-prep"><span class="muted small">À faire avant :</span>' + prep.map(checkbox).join("") + "</div>" : "") +
          "</div></div></li>";
      });
      if (!placed) html += '<li class="jr-now"><span>Maintenant · ' + now.replace(":", "h") + "</span></li>";
      return html + "</ol>";
    }

    function checkbox(t) {
      var done = t.statut === "termine";
      return '<label class="jr-check' + (done ? " is-done" : "") + '"><input type="checkbox" data-task="' + t.vehiculeId + ":" + t.itemId + '"' + (done ? " checked" : "") + (BO.can("vehicules.preparer") ? "" : " disabled") + "> " + esc(t.libelle) + "</label>";
    }

    /* ---------- préparation : tâches par véhicule, puis contrôles techniques ---------- */
    function preparation(taches, j) {
      var byVeh = [], idx = {};
      taches.forEach(function (t) {
        if (!(t.vehiculeId in idx)) { idx[t.vehiculeId] = byVeh.length; byVeh.push({ v: t, list: [] }); }
        byVeh[idx[t.vehiculeId]].list.push(t);
      });
      var html = byVeh.length ? '<ul class="jr-veh-list">' + byVeh.map(function (g) {
        var v = g.v;
        return '<li class="jr-veh"><a class="jr-veh__head" href="#/vehicules/' + v.vehiculeId + '/preparation">' + BO.thumb(v.photo, "row-img") +
          "<span><strong>" + esc(v.vehicule) + "</strong><small>" + esc([v.numeroStock, v.parc].filter(Boolean).join(" · ")) + "</small></span></a>" +
          '<ul class="jr-tasks">' + g.list.map(function (t) {
            var cls = t.avantRdv ? "tag--offer" : t.echeance && t.echeance < j.date ? "tag--warn" : "tag--muted";
            return "<li>" + checkbox(t) + '<span class="jr-task-meta"><span class="tag ' + cls + '">' + esc(t.raison) + "</span>" +
              (t.responsable ? '<span class="tag">' + icon("user") + esc(t.responsable) + "</span>" : "") + "</span>" +
              (t.commentaire ? '<small class="block muted">' + esc(t.commentaire) + "</small>" : "") + "</li>";
          }).join("") + "</ul></li>";
      }).join("") + "</ul>" : '<div class="empty">' + icon("check") + "<p>Aucune tâche de préparation " + (st.pour ? "pour cette personne " : "") + "ce jour-là.</p></div>";
      var ct = j.preparation.ct;
      if (ct.length) {
        html += '<div class="card__sub"><h3>' + icon("clipboard") + "Contrôles techniques à passer</h3><ul class=\"mini-list jr-ct\">" + ct.map(function (c) {
          return "<li>" + BO.thumb(c.photo, "row-img") + '<div class="grow"><strong><a href="#/vehicules/' + c.vehiculeId + '/preparation">' + esc(c.vehicule) + "</a></strong><span>" + esc([c.numeroStock, c.parc].filter(Boolean).join(" · ")) + "</span></div>" +
            BO.ctBadge(c.ct) + (c.rdvCt ? ' <span class="tag tag--ok">' + icon("calendar") + "RDV " + fmt.date(c.rdvCt).slice(0, 5) + " " + fmt.time(c.rdvCt) + "</span>"
              : BO.can("rdv.gerer") ? ' <a class="btn btn--ghost btn--sm" href="#/planning/nouveau?vehicule=' + c.vehiculeId + '&motif=controle_technique">Planifier</a>' : "") + "</li>";
        }).join("") + "</ul></div>";
      }
      return html;
    }

    /* ---------- secrétariat ---------- */
    function secretariat(s) {
      var parts = [];
      if (s.demandesTotal) {
        parts.push('<div class="jr-block"><h3>' + icon("inbox") + "À rappeler · demandes du site <span class=\"count-inline\">" + s.demandesTotal + "</span></h3><ul class=\"mini-list\">" + s.demandes.map(function (d) {
          return '<li><div class="grow"><strong><a href="#/demandes?statut=nouvelle">' + esc(d.nom) + "</a> · " + esc(d.typeLabel) + (d.montant ? " " + fmt.euros(d.montant) : "") + "</strong><span>" + esc(d.vehicule || "Demande générale") + " · " + BO.when(d.createdAt) + "</span></div>" + tel(d.tel) + "</li>";
        }).join("") + (s.demandesTotal > s.demandes.length ? '<li class="muted small"><a href="#/demandes?statut=nouvelle">… et ' + (s.demandesTotal - s.demandes.length) + " autre(s)</a></li>" : "") + "</ul></div>");
      }
      var rdvList = function (list) {
        return '<ul class="mini-list">' + list.map(function (r) {
          return '<li class="is-click" data-rdv="' + r.id + '"><span class="mini-time">' + fmt.date(r.debut).slice(0, 5) + "<small>" + fmt.time(r.debut) + "</small></span>" +
            '<div class="grow"><strong>' + esc(r.motifLabel + " · " + r.vehicule) + "</strong><span>" + esc(r.client || "Sans client") + "</span></div>" + tel(r.clientTelephone) + "</li>";
        }).join("") + "</ul>";
      };
      if (s.aConfirmer.length) parts.push('<div class="jr-block"><h3>' + icon("phone") + 'À confirmer (aujourd\'hui et demain) <span class="count-inline">' + s.aConfirmer.length + "</span></h3>" + rdvList(s.aConfirmer) + "</div>");
      if (s.aCloturer.length) parts.push('<div class="jr-block"><h3>' + icon("clock") + 'Rendez-vous passés à clôturer <span class="count-inline">' + s.aCloturer.length + "</span></h3>" + rdvList(s.aCloturer.slice(0, 5)) + "</div>");
      if (s.messagesEchec.length) {
        parts.push('<div class="jr-block"><h3>' + icon("mail") + 'Messages en échec <span class="count-inline">' + s.messagesEchec.length + '</span></h3><ul class="mini-list">' + s.messagesEchec.map(function (n) {
          return '<li><div class="grow"><strong><a href="#/messages?statut=echec">' + esc(n.templateLabel) + "</a></strong><span>" + esc((n.client || "Garage") + " · " + (n.erreur || "")) + "</span></div></li>";
        }).join("") + "</ul></div>");
      }
      return parts.join("") || '<div class="empty">' + icon("check") + "<p>Rien en attente : pas de rappel, de confirmation ni de message en échec.</p></div>";
    }

    /* ---------- propriétaire ---------- */
    function proprietaire(p) {
      var parts = [];
      var venteList = function (list, extra) {
        return '<ul class="mini-list">' + list.map(function (x) {
          return '<li><div class="grow"><strong><a href="#/vehicules/' + x.vehiculeId + '/finance">' + esc(x.vehicule) + "</a> · " + esc(x.acheteur || "—") + "</strong><span>" + extra(x) + "</span></div></li>";
        }).join("") + "</ul>";
      };
      if (p.livraisons.length) parts.push('<div class="jr-block"><h3>' + icon("truck") + 'Livraisons prévues <span class="count-inline">' + p.livraisons.length + "</span></h3>" + venteList(p.livraisons, function (x) { return "Livraison le " + fmt.date(x.dateLivraison) + " · reste " + fmt.cents(x.resteCentimes); }) + "</div>");
      if (p.reservations.length) parts.push('<div class="jr-block"><h3>' + icon("key") + 'Réservations qui expirent <span class="count-inline">' + p.reservations.length + "</span></h3>" + venteList(p.reservations, function (x) { return "Jusqu'au " + fmt.date(x.dateLimiteReservation) + " · encaissé " + fmt.cents(x.encaisseCentimes); }) + "</div>");
      if (p.aEncaisser.nombre) parts.push('<div class="jr-block"><h3>' + icon("euro") + "À encaisser · " + fmt.cents(p.aEncaisser.totalCentimes) + ' <span class="count-inline">' + p.aEncaisser.nombre + "</span></h3>" + venteList(p.aEncaisser.ventes, function (x) { return esc(x.statutLabel) + " · reste " + fmt.cents(x.resteCentimes); }) + "</div>");
      if (p.aPayer.length) {
        parts.push('<div class="jr-block"><h3>' + icon("file-text") + 'Factures à payer <span class="count-inline">' + p.aPayer.length + '</span></h3><ul class="mini-list">' + p.aPayer.map(function (f) {
          return '<li><div class="grow"><strong><a href="#/vehicules/' + f.vehiculeId + '/finance">' + esc(f.libelle) + "</a></strong><span>" + esc([f.vehicule, f.tiers, fmt.date(f.date)].filter(Boolean).join(" · ")) + '</span></div><span class="num strong">' + fmt.cents(f.montantCentimes) + "</span></li>";
        }).join("") + "</ul></div>");
      }
      return parts.join("") || '<div class="empty">' + icon("check") + "<p>Aucune livraison, réservation, encaissement ni facture en attente.</p></div>";
    }

    /* ---------- actions ---------- */
    view.addEventListener("click", function (e) {
      var t = e.target, s;
      if ((s = t.closest("[data-step]"))) { st.date = BO.isoDate(BO.addDays(parseDay(st.date), +s.getAttribute("data-step"))); load(); return; }
      if (t.closest("[data-today]")) { st.date = BO.isoDate(new Date()); load(); return; }
      if ((s = t.closest("[data-pour]"))) { st.pour = s.getAttribute("data-pour"); BO.setQuery({ date: st.date === BO.isoDate(new Date()) ? "" : st.date, pour: st.pour }); $$("[data-pour]", view).forEach(function (c) { c.setAttribute("aria-pressed", String(c === s)); }); render(); return; }
      if (t.closest("a, input, label")) return;
      var r = t.closest("[data-rdv]");
      if (r) BO.openRdv(+r.getAttribute("data-rdv"), load);
    });
    view.addEventListener("keydown", function (e) {
      var r = e.target.closest && e.target.closest(".jr-card");
      if (r && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); BO.openRdv(+r.getAttribute("data-rdv"), load); }
    });
    view.addEventListener("change", function (e) {
      var cb = e.target.closest("[data-task]");
      if (!cb) return;
      var k = cb.getAttribute("data-task").split(":"), vid = +k[0], item = +k[1], statut = cb.checked ? "termine" : "a_faire";
      cb.disabled = true;
      BO.api("admin/vehicule/checklist", { body: { vehiculeId: vid, itemId: item, statut: statut } }).then(function () {
        data.preparation.taches.forEach(function (t) { if (t.vehiculeId === vid && t.itemId === item) t.statut = statut; });
        BO.toast(cb.checked ? "Tâche faite : " + cb.parentElement.textContent.trim() : "Tâche remise à faire");
        render();
      }).catch(function (err) { BO.fail(err); cb.checked = !cb.checked; cb.disabled = false; });
    });

    return load();
  }, { nav: "aujourdhui", title: "Aujourd'hui" });
})();
