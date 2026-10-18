/* Tableau de bord : liste « À faire » du jour, stock, alertes, raccourcis (spécification 4.1) */
(function () {
  "use strict";
  var BO = window.BO, esc = BO.esc, icon = BO.icon, fmt = BO.fmt, $ = BO.$;
  var ACTIFS = ["en_attente", "confirme"];
  var LIMITE = 4; // lignes par groupe (préparation, secrétariat, gestion) avant « Tout afficher »

  BO.route(/^\/?$/, function (view, _p, q) {
    var assigne = q.assigne || "";
    var todo = { jour: q.jour === "demain" ? "demain" : "aujourdhui", pour: q.pour !== undefined ? q.pour : assigne, tout: false, data: null };
    if (BO.can("rdv.gerer")) BO.actions('<a class="btn btn--primary" href="#/planning/nouveau">' + icon("plus") + "<span>Rendez-vous</span></a>");
    // Raccourcis secondaires dans la page (la barre du haut reste lisible)
    var raccourcis = [];
    if (BO.can("vehicules.modifier")) raccourcis.push('<a class="btn btn--ghost btn--sm" href="#/vehicules/nouveau">' + icon("car") + "Nouveau véhicule</a>");
    if (BO.can("clients.gerer")) raccourcis.push('<a class="btn btn--ghost btn--sm" href="#/clients">' + icon("users") + "Clients</a>");
    if (BO.can("finance.gerer")) raccourcis.push('<a class="btn btn--ghost btn--sm" href="#/ventes?action=depense">' + icon("euro") + "Dépense</a>", '<a class="btn btn--ghost btn--sm" href="#/ventes?action=vente">' + icon("key") + "Vente</a>");

    return BO.api("admin/tableau", { query: { parc: BO.parcFilter(), assigne: assigne } }).then(function (t) {
      var kpi = function (href, ic, label, value, small, hot) {
        return '<a class="kpi' + (hot ? " kpi--hot" : "") + '" href="' + href + '"><span class="kpi__label">' + icon(ic) + label + "</span><strong>" + value + "</strong><small>" + small + "</small></a>";
      };
      var v = t.vehicules;
      var kpis = [
        kpi("#/planning?vue=jour", "calendar", "Rendez-vous aujourd'hui", t.rdv.jour.length, fmt.plural(t.rdv.semaine, "rendez-vous") + " cette semaine", t.rdv.jour.length > 0),
        kpi("#/planning?vue=liste&retard=1", "clock", "À clôturer", t.rdv.retard.length, "rendez-vous passés non clôturés"),
        kpi("#/vehicules?f=stock", "car", "Véhicules en stock", v.stock, v.enLigne + " en ligne · " + v.brouillons + " brouillon(s)"),
        kpi("#/vehicules?f=reserve", "key", "Réservés", v.reserves, "en attente de vente"),
        kpi("#/preparation", "clipboard", "En préparation", v.enPreparation, "checklist incomplète"),
        kpi("#/demandes?statut=nouvelle", "inbox", "Demandes du site", t.demandesNouvelles, "nouvelles à traiter"),
      ];
      if (BO.can("ventes.gerer")) {
        kpis.push(kpi("#/ventes?statut=finalisee", "check", "Vendus (30 jours)", v.vendus30j, "ventes finalisées"));
        kpis.push(kpi("#/ventes?aEncaisser=1", "euro", "Reste à encaisser", fmt.cents(t.finance ? t.finance.aEncaisserCentimes : 0), "acomptes et soldes attendus"));
      }
      var users = BO.ref("utilisateurs") || [];
      view.innerHTML =
        '<div class="filterbar"><div class="row-actions row-actions--start">' + raccourcis.join("") + "</div>" +
          (BO.isAdmin() && users.length > 1 ? '<label class="inline-field">Personne assignée ' +
          '<select class="select" data-assigne>' + BO.f.userOptions("Toute l'équipe").map(function (o) { return '<option value="' + o.value + '"' + (String(o.value) === assigne ? " selected" : "") + ">" + esc(o.label) + "</option>"; }).join("") + "</select></label>" : "") + "</div>" +
        '<div class="kpis kpis--4">' + kpis.join("") + "</div>" +
        '<div class="grid-2">' +
          '<section class="card todo" data-todo>' +
            '<div class="card__head"><h2>' + icon("check") + 'À faire <span class="count-inline" data-todo-count></span></h2>' +
              '<div class="todo__tools"><div class="segmented segmented--sm" role="group" aria-label="Jour">' +
                '<button type="button" data-todo-jour="aujourdhui">Aujourd\'hui</button><button type="button" data-todo-jour="demain">Demain</button></div>' +
                (users.length > 1 ? '<select class="select select--auto todo__pour" data-todo-pour aria-label="Pour qui">' +
                  [{ id: "", nom: "Tout le monde" }].concat(users, [{ id: "aucun", nom: "Non attribué" }]).map(function (u) { return '<option value="' + esc(u.id) + '">' + esc(u.nom) + "</option>"; }).join("") + "</select>" : "") +
            "</div></div>" +
            '<div data-todo-body><p class="loading">Chargement…</p></div>' +
          "</section>" +
          '<section class="card"><div class="card__head"><h2>Alertes</h2></div>' +
            (t.alertes.length ? '<ul class="alerts">' + t.alertes.map(function (a) {
              return '<li class="alert-item alert-item--' + a.niveau + '"><a href="' + esc(a.lien) + '">' + icon(alertIcon(a.type)) + "<span>" + esc(a.texte) + "</span>" + icon("chevron-right", "i--sm") + "</a></li>";
            }).join("") + "</ul>" : '<div class="empty">' + icon("check") + "<p>Aucune alerte : tout est à jour.</p></div>") +
          "</section>" +
        "</div>";
      var sel = $("[data-assigne]", view);
      if (sel) sel.addEventListener("change", function () { BO.go("#/?assigne=" + sel.value); });
      wireTodo(view, todo);
      loadTodo(view, todo);
    });
  }, { nav: "dashboard", title: "Tableau de bord" });

  function alertIcon(type) {
    return { ct: "clipboard", preparation: "clock", nettoyage: "droplet", documents: "file-text", messages: "mail", vente: "key", livraison: "truck", encaissement: "euro", demandes: "inbox" }[type] || "info";
  }

  /* ================================================================ liste « À faire » */
  function dateOf(todo) { return BO.isoDate(BO.addDays(new Date(), todo.jour === "demain" ? 1 : 0)); }
  function hm() { var n = new Date(); return String(n.getHours()).padStart(2, "0") + ":" + String(n.getMinutes()).padStart(2, "0"); }
  function tel(t) { return t ? '<a class="td-tel" href="tel:' + esc(String(t).replace(/[^\d+]/g, "")) + '">' + icon("phone", "i--sm") + esc(t) + "</a>" : ""; }

  function loadTodo(view, todo) {
    var card = $("[data-todo]", view);
    if (!card) return;
    BO.setQuery({ assigne: (BO.$("[data-assigne]", view) || {}).value || "", jour: todo.jour === "demain" ? "demain" : "", pour: todo.pour });
    card.querySelectorAll("[data-todo-jour]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-todo-jour") === todo.jour)); });
    var p = $("[data-todo-pour]", card);
    if (p) p.value = todo.pour;
    card.classList.add("is-busy");
    BO.api("admin/journee", { query: { date: dateOf(todo), parc: BO.parcFilter() } }).then(function (j) { todo.data = j; renderTodo(view, todo); })
      .catch(function (e) { $("[data-todo-body]", card).innerHTML = '<p class="empty">' + esc(e.message) + "</p>"; })
      .then(function () { card.classList.remove("is-busy"); });
  }

  function renderTodo(view, todo) {
    var card = $("[data-todo]", view), j = todo.data;
    if (!card || !j) return;
    var users = BO.ref("utilisateurs") || [];
    var who = users.filter(function (u) { return String(u.id) === todo.pour; })[0];
    var mine = function (id) { return !todo.pour || (todo.pour === "aucun" ? id == null : String(id) === todo.pour); };
    // Secrétariat : tout le monde, ou une secrétaire ; gestion : tout le monde, ou le propriétaire
    var voitSecretariat = !todo.pour || (who && who.role !== "admin");
    var voitGestion = !todo.pour || (who && who.role === "admin");
    var today = todo.jour === "aujourdhui", now = hm();

    var rdv = j.rendezVous.filter(function (r) { return mine(r.assigneId); });
    var taches = j.preparation.taches.filter(function (t) { return mine(t.responsableId); });

    /* -- rendez-vous, avec ce qu'il reste à préparer avant -- */
    var nowShown = !today, rdvHtml = rdv.map(function (r) {
      var prep = taches.filter(function (t) { return t.vehiculeId === r.vehiculeId && t.avantRdv === r.debut.slice(11, 16); });
      var actif = ACTIFS.indexOf(r.statut) !== -1, passe = today && r.fin.slice(11, 16) <= now;
      var line = "";
      if (!nowShown && r.debut.slice(11, 16) > now) { line = '<li class="td-now"><span>Maintenant · ' + now.replace(":", "h") + "</span></li>"; nowShown = true; }
      return line + '<li class="td-row td-rdv ev--' + r.statut + (passe ? " is-past" : "") + '" data-rdv="' + r.id + '">' +
        '<span class="td-time">' + fmt.time(r.debut) + "</span>" +
        '<div class="td-body"><strong>' + esc(r.motifLabel) + " · " + esc(r.vehicule) + "</strong>" +
          "<small>" + [esc(r.client || "Sans client"), tel(r.clientTelephone), r.assigne ? icon("user", "i--xs") + " " + esc(r.assigne) : ""].filter(Boolean).join(" · ") + "</small>" +
          (prep.length && actif ? '<span class="td-prep">' + prep.map(box).join("") + "</span>" : "") + "</div>" +
        (actif && r.enRetard ? '<span class="tag tag--warn">' + icon("clock") + "À clôturer</span>" : BO.pill("r", r.statut, r.statutLabel)) + "</li>";
    }).join("");
    if (rdv.length && !nowShown) rdvHtml += '<li class="td-now"><span>Maintenant · ' + now.replace(":", "h") + "</span></li>";

    /* -- dans la journée : préparation, CT, secrétariat, gestion -- */
    var rows = [];
    taches.filter(function (t) { return !t.avantRdv; }).forEach(function (t) {
      rows.push({ g: "Préparation", html: '<li class="td-row' + (t.statut === "termine" ? " is-done" : "") + '">' + box(t, true) +
        '<div class="td-body"><strong>' + esc(t.libelle) + "</strong><small>" + esc(t.vehicule) + " · " + esc(t.numeroStock || "") +
        ' · <span class="' + (t.echeance && t.echeance < j.date ? "is-warn" : "") + '">' + esc(t.raison) + "</span>" + (t.responsable ? " · " + icon("user", "i--xs") + " " + esc(t.responsable) : "") + "</small></div>" +
        '<a class="td-go" href="#/vehicules/' + t.vehiculeId + '/preparation" aria-label="Ouvrir la préparation">' + icon("chevron-right") + "</a></li>" });
    });
    // CT à passer (non attribués) : avec la vue d'ensemble, « Non attribué » ou une secrétaire (qui prend le RDV)
    var voitCt = voitSecretariat || todo.pour === "aucun";
    if (voitCt) {
      j.preparation.ct.forEach(function (c) {
        rows.push({ g: "Préparation", html: '<li class="td-row"><span class="td-ico td-ico--warn">' + icon("clipboard") + "</span>" +
          '<div class="td-body"><strong>Contrôle technique · ' + esc(c.vehicule) + "</strong><small>" + esc(c.ct.label) + (c.rdvCt ? " · RDV le " + fmt.date(c.rdvCt).slice(0, 5) + " à " + fmt.time(c.rdvCt) : " · aucun RDV de CT") + "</small></div>" +
          (c.rdvCt || !BO.can("rdv.gerer") ? '<a class="td-go" href="#/vehicules/' + c.vehiculeId + '/preparation" aria-label="Ouvrir">' + icon("chevron-right") + "</a>"
            : '<a class="btn btn--ghost btn--sm" href="#/planning/nouveau?vehicule=' + c.vehiculeId + '&motif=controle_technique">Planifier</a>') + "</li>" });
      });
    }
    var s = j.secretariat;
    if (voitSecretariat) {
      s.demandes.forEach(function (d) {
        rows.push({ g: "Secrétariat", html: '<li class="td-row"><span class="td-ico">' + icon("phone") + "</span>" +
          '<div class="td-body"><strong>Rappeler ' + esc(d.nom) + "</strong><small>" + esc(d.typeLabel + (d.montant ? " " + fmt.euros(d.montant) : "") + " · " + (d.vehicule || "demande générale")) + " · " + BO.when(d.createdAt) + "</small></div>" +
          tel(d.tel) + "</li>" });
      });
      if (s.demandesTotal > s.demandes.length) rows.push({ g: "Secrétariat", html: '<li class="td-row td-more"><a href="#/demandes?statut=nouvelle">… et ' + (s.demandesTotal - s.demandes.length) + " autre(s) demande(s)</a></li>" });
      s.aConfirmer.forEach(function (r) {
        rows.push({ g: "Secrétariat", html: '<li class="td-row" data-rdv="' + r.id + '"><span class="td-ico">' + icon("check") + "</span>" +
          '<div class="td-body"><strong>Confirmer le RDV du ' + fmt.date(r.debut).slice(0, 5) + " à " + fmt.time(r.debut) + "</strong><small>" + esc(r.motifLabel + " · " + r.vehicule + " · " + (r.client || "")) + "</small></div>" + tel(r.clientTelephone) + "</li>" });
      });
      s.aCloturer.slice(0, 5).forEach(function (r) {
        rows.push({ g: "Secrétariat", html: '<li class="td-row" data-rdv="' + r.id + '"><span class="td-ico td-ico--warn">' + icon("clock") + "</span>" +
          '<div class="td-body"><strong>Clôturer le RDV du ' + fmt.date(r.debut).slice(0, 5) + " à " + fmt.time(r.debut) + "</strong><small>" + esc(r.motifLabel + " · " + r.vehicule + " · terminé ou client absent ?") + "</small></div>" +
          '<span class="td-go">' + icon("chevron-right") + "</span></li>" });
      });
      s.messagesEchec.forEach(function (n) {
        rows.push({ g: "Secrétariat", html: '<li class="td-row"><span class="td-ico td-ico--danger">' + icon("mail") + "</span>" +
          '<div class="td-body"><strong>Message non envoyé · ' + esc(n.client || "garage") + "</strong><small>" + esc(n.templateLabel + (n.erreur ? " · " + n.erreur : "")) + "</small></div>" +
          '<a class="td-go" href="#/messages?statut=echec" aria-label="Voir les messages">' + icon("chevron-right") + "</a></li>" });
      });
    }
    var p = j.proprietaire;
    if (p && voitGestion) {
      var venteRow = function (ic, titre, x, detail) {
        return { g: "Gestion", html: '<li class="td-row"><span class="td-ico">' + icon(ic) + "</span><div class=\"td-body\"><strong>" + titre + "</strong><small>" + esc(x.vehicule + " · " + (x.acheteur || "—")) + " · " + detail + "</small></div>" +
          '<a class="td-go" href="#/vehicules/' + x.vehiculeId + '/finance" aria-label="Ouvrir la vente">' + icon("chevron-right") + "</a></li>" };
      };
      p.livraisons.forEach(function (x) { rows.push(venteRow("truck", "Livrer le véhicule", x, "prévu le " + fmt.date(x.dateLivraison))); });
      p.reservations.forEach(function (x) { rows.push(venteRow("key", "Réservation qui expire", x, "jusqu'au " + fmt.date(x.dateLimiteReservation))); });
      p.aEncaisser.ventes.forEach(function (x) { rows.push(venteRow("euro", "Encaisser " + fmt.cents(x.resteCentimes), x, esc(x.statutLabel))); });
      p.aPayer.forEach(function (f) {
        rows.push({ g: "Gestion", html: '<li class="td-row"><span class="td-ico">' + icon("file-text") + "</span><div class=\"td-body\"><strong>Payer " + fmt.cents(f.montantCentimes) + "</strong><small>" + esc([f.libelle, f.tiers, f.vehicule].filter(Boolean).join(" · ")) + "</small></div>" +
          '<a class="td-go" href="#/vehicules/' + f.vehiculeId + '/finance" aria-label="Ouvrir">' + icon("chevron-right") + "</a></li>" });
      });
    }

    // Compteur : rendez-vous encore à venir + tâches non cochées + CT + secrétariat + gestion
    var restants = rdv.filter(function (r) { return ACTIFS.indexOf(r.statut) !== -1 && !(today && r.fin.slice(11, 16) <= now); }).length +
      taches.filter(function (t) { return t.statut !== "termine"; }).length +
      (voitCt ? j.preparation.ct.length : 0) +
      (voitSecretariat ? s.demandesTotal + s.aConfirmer.length + s.aCloturer.length + s.messagesEchec.length : 0) +
      (p && voitGestion ? p.livraisons.length + p.reservations.length + p.aEncaisser.nombre + p.aPayer.length : 0);
    $("[data-todo-count]", card).textContent = restants || "";

    // Liste repliée : quelques lignes par groupe, pour que chaque partie (préparation, secrétariat, gestion) reste visible
    var perGroup = {}, court = rows.filter(function (x) { perGroup[x.g] = (perGroup[x.g] || 0) + 1; return perGroup[x.g] <= LIMITE; });
    var caches = rows.length - court.length, shown = todo.tout ? rows : court, lastG = "";
    var list = shown.map(function (x) { var h = x.g !== lastG ? '<li class="td-group">' + x.g + "</li>" : ""; lastG = x.g; return h + x.html; }).join("");
    var ferme = !j.horaires.length;
    $("[data-todo-body]", card).innerHTML =
      (ferme ? '<p class="td-note">' + icon("info") + "Garage fermé " + (today ? "aujourd'hui" : "demain") + ".</p>" : "") +
      '<ul class="td-list">' +
        (rdv.length ? '<li class="td-group">Rendez-vous</li>' + rdvHtml : '<li class="td-row td-empty">' + icon("calendar") + "<span>Aucun rendez-vous " + (today ? "aujourd'hui" : "demain") + (todo.pour ? " pour cette personne" : "") + ".</span></li>") +
        list +
        (!rows.length ? '<li class="td-group">Dans la journée</li><li class="td-row td-empty">' + icon("check") + "<span>Rien d'autre à faire.</span></li>" : "") +
      "</ul>" +
      (caches ? '<button type="button" class="td-toggle" data-todo-tout>' + (todo.tout ? "Réduire la liste" : "Tout afficher (" + caches + " de plus)") + "</button>" : "");
  }

  function box(t, solo) {
    var done = t.statut === "termine";
    var input = '<input type="checkbox" data-task="' + t.vehiculeId + ":" + t.itemId + '"' + (done ? " checked" : "") + (BO.can("vehicules.preparer") ? "" : " disabled") + ' aria-label="' + esc(t.libelle + " — " + t.vehicule) + '">';
    if (solo) return '<label class="td-check">' + input + "</label>";
    return '<label class="td-check' + (done ? " is-done" : "") + '">' + input + " " + esc(t.libelle) + "</label>";
  }

  function wireTodo(view, todo) {
    var card = $("[data-todo]", view);
    if (!card) return;
    card.addEventListener("click", function (e) {
      var t = e.target, b;
      if ((b = t.closest("[data-todo-jour]"))) { todo.jour = b.getAttribute("data-todo-jour"); todo.tout = false; loadTodo(view, todo); return; }
      if (t.closest("[data-todo-tout]")) { todo.tout = !todo.tout; renderTodo(view, todo); return; }
      if (t.closest("a, input, label, select, button")) return;
      var r = t.closest("[data-rdv]");
      if (r) BO.openRdv(+r.getAttribute("data-rdv"), function () { loadTodo(view, todo); });
    });
    card.addEventListener("change", function (e) {
      if (e.target.matches("[data-todo-pour]")) {
        todo.pour = e.target.value;
        BO.setQuery({ assigne: (BO.$("[data-assigne]", view) || {}).value || "", jour: todo.jour === "demain" ? "demain" : "", pour: todo.pour });
        renderTodo(view, todo);
        return;
      }
      var cb = e.target.closest("[data-task]");
      if (!cb) return;
      var k = cb.getAttribute("data-task").split(":"), vid = +k[0], item = +k[1], statut = cb.checked ? "termine" : "a_faire";
      cb.disabled = true;
      BO.api("admin/vehicule/checklist", { body: { vehiculeId: vid, itemId: item, statut: statut } }).then(function () {
        var lib = "";
        todo.data.preparation.taches.forEach(function (x) { if (x.vehiculeId === vid && x.itemId === item) { x.statut = statut; lib = x.libelle + " — " + x.vehicule; } });
        BO.toast(cb.checked ? "Fait : " + lib : "Remis à faire : " + lib);
        renderTodo(view, todo);
      }).catch(function (err) { BO.fail(err); cb.checked = !cb.checked; cb.disabled = false; });
    });
  }
})();
