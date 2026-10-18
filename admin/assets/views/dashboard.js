/* Tableau de bord : rendez-vous, stock, alertes, raccourcis (spécification 4.1) */
(function () {
  "use strict";
  var BO = window.BO, esc = BO.esc, icon = BO.icon, fmt = BO.fmt;

  BO.route(/^\/?$/, function (view, _p, q) {
    var assigne = q.assigne || "";
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
          '<section class="card"><div class="card__head"><h2>Rendez-vous du jour</h2><span class="row-actions"><a class="btn btn--primary btn--sm" href="#/aujourdhui">' + icon("clock") + "Programme du jour</a>" +
            '<a class="btn btn--ghost btn--sm" href="#/planning?vue=jour">Planning</a></span></div>' +
            (t.rdv.jour.length ? '<ul class="mini-list">' + t.rdv.jour.map(rdvItem).join("") + "</ul>" : '<div class="empty">' + icon("calendar") + "<p>Aucun rendez-vous aujourd'hui.</p></div>") +
            (t.rdv.retard.length ? '<div class="card__sub"><h3>' + icon("clock") + " À clôturer (" + t.rdv.retard.length + ")</h3><ul class=\"mini-list\">" + t.rdv.retard.slice(0, 5).map(rdvItem).join("") + "</ul></div>" : "") +
          "</section>" +
          '<section class="card"><div class="card__head"><h2>Alertes</h2></div>' +
            (t.alertes.length ? '<ul class="alerts">' + t.alertes.map(function (a) {
              return '<li class="alert-item alert-item--' + a.niveau + '"><a href="' + esc(a.lien) + '">' + icon(alertIcon(a.type)) + "<span>" + esc(a.texte) + "</span>" + icon("chevron-right", "i--sm") + "</a></li>";
            }).join("") + "</ul>" : '<div class="empty">' + icon("check") + "<p>Aucune alerte : tout est à jour.</p></div>") +
          "</section>" +
        "</div>";
      var sel = BO.$("[data-assigne]", view);
      if (sel) sel.addEventListener("change", function () { BO.go("#/?assigne=" + sel.value); });
    });
  }, { nav: "dashboard", title: "Tableau de bord" });

  function alertIcon(type) {
    return { ct: "clipboard", preparation: "clock", nettoyage: "droplet", documents: "file-text", messages: "mail", vente: "key", livraison: "truck", encaissement: "euro", demandes: "inbox" }[type] || "info";
  }

  function rdvItem(r) {
    return '<li><span class="mini-time">' + fmt.time(r.debut) + "</span>" +
      '<div class="grow"><strong><a href="#/planning?vue=jour&date=' + r.debut.slice(0, 10) + "&rdv=" + r.id + '">' + esc(r.motifLabel) + " · " + esc(r.vehicule) + "</a></strong>" +
      "<span>" + esc(r.client || "Sans client") + (r.clientTelephone ? " · " + esc(r.clientTelephone) : "") + (r.parc ? " · " + esc(r.parc) : "") + "</span></div>" +
      (r.vehiculePret ? "" : '<span class="tag tag--warn" title="Véhicule pas encore marqué prêt">' + icon("clock") + "À préparer</span>") +
      BO.pill("r", r.statut, r.statutLabel) + "</li>";
  }
  BO.rdvItem = rdvItem;
})();
