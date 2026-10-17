/* Ventes & finances (propriétaire) : ventes en cours, encaissements, rapports de gestion, export comptable */
(function () {
  "use strict";
  var BO = window.BO, esc = BO.esc, icon = BO.icon, fmt = BO.fmt, $ = BO.$;

  var STATUTS = [["", "Toutes"], ["reservee", "Réservations"], ["en_cours", "En cours"], ["finalisee", "Finalisées"], ["livree", "Livrées"], ["annulee", "Annulées"]];

  function tabs(cur) {
    return '<nav class="tabs-nav"><a href="#/ventes"' + (cur === "ventes" ? ' class="is-active"' : "") + ">Ventes</a>" +
      (BO.can("finance.voir") ? '<a href="#/ventes/rapports"' + (cur === "rapports" ? ' class="is-active"' : "") + ">Rapports & export</a>" : "") + "</nav>";
  }

  /** Choix du véhicule avant une dépense ou une vente (raccourcis du tableau de bord). */
  function pickVehicle(action) {
    var m = BO.modal({
      title: action === "vente" ? "Enregistrer une vente" : "Ajouter une dépense",
      body: '<p class="muted">Choisissez le véhicule concerné.</p><label class="field">Rechercher<input class="input" data-vq placeholder="N° de stock, immatriculation, modèle" autocomplete="off"></label><div class="pick-list" data-vres><p class="loading">Chargement…</p></div>',
      actions: [{ label: "Fermer" }],
    });
    BO.api("admin/vehicules", { query: { stock: "1", parc: BO.parcFilter() } }).then(function (all) {
      function show(t) {
        t = t.toLowerCase().replace(/[^a-z0-9]/g, "");
        var list = all.filter(function (v) { return !t || (v.numeroStock + v.immatriculation + v.marque + v.modele).toLowerCase().replace(/[^a-z0-9]/g, "").indexOf(t) !== -1; }).slice(0, 12);
        $("[data-vres]", m.body).innerHTML = list.map(function (v) {
          return '<button type="button" class="pick" data-v="' + v.dbId + '">' + BO.thumb(v.photos[0], "pick-img") + "<span><strong>" + esc(v.marque + " " + v.modele) + "</strong><small>" + esc([v.numeroStock, v.immatriculation, fmt.euros(v.prix)].filter(Boolean).join(" · ")) + "</small></span>" + BO.statutVehicule(v) + "</button>";
        }).join("") || '<p class="muted">Aucun véhicule en stock trouvé.</p>';
      }
      show("");
      $("[data-vq]", m.body).addEventListener("input", function (e) { show(e.target.value); });
    }).catch(BO.fail);
    m.body.addEventListener("click", function (e) {
      var b = e.target.closest("[data-v]");
      if (b) { m.close(); BO.go("#/vehicules/" + b.getAttribute("data-v") + "/finance"); }
    });
  }

  /* ---------------------------------------------------------------- ventes */
  BO.route(/^\/ventes$/, function (view, _p, q) {
    var st = { statut: q.statut || "", aEncaisser: q.aEncaisser || "" };
    var acts = [];
    if (BO.can("finance.gerer")) acts.push('<button type="button" class="btn btn--ghost" data-act="depense">' + icon("euro") + "<span>Dépense</span></button>");
    acts.push('<button type="button" class="btn btn--primary" data-act="vente">' + icon("key") + "<span>Vente</span></button>");
    BO.actions(acts.join(""));
    BO.$$("[data-act]").forEach(function (b) { b.addEventListener("click", function () { pickVehicle(b.getAttribute("data-act")); }); });
    if (q.action) { pickVehicle(q.action); }

    function load() {
      BO.setQuery(st);
      return BO.api("admin/ventes", { query: st }).then(render);
    }
    function render(list) {
      var actives = list.filter(function (x) { return x.statut !== "annulee"; });
      var tot = function (k) { return actives.reduce(function (s, x) { return s + (x[k] || 0); }, 0); };
      view.innerHTML = tabs("ventes") +
        '<div class="filterbar"><div class="seg">' + STATUTS.map(function (s) { return '<button type="button" data-s="' + s[0] + '" aria-pressed="' + (st.statut === s[0] && !st.aEncaisser) + '">' + s[1] + "</button>"; }).join("") +
          '<button type="button" data-enc aria-pressed="' + (st.aEncaisser === "1") + '">Reste à encaisser</button></div>' +
          '<span class="muted small">' + BO.fmt.plural(list.length, "vente") + " · reste à encaisser " + fmt.cents(tot("resteCentimes")) + "</span></div>" +
        (list.length ? '<div class="table-wrap"><table class="table"><thead><tr><th></th><th>Véhicule</th><th>Acheteur</th><th>Étape</th><th class="num">Prix final</th><th class="num">Encaissé</th><th class="num">Reste</th><th class="num">Marge estimée</th><th>Dates</th></tr></thead><tbody>' +
          list.map(function (x) {
            return '<tr class="is-click' + (x.statut === "annulee" ? " is-cancelled" : "") + '" data-v="' + x.vehiculeId + '"><td>' + BO.thumb(x.photo, "row-img") + "</td>" +
              '<td><a class="strong" href="#/vehicules/' + x.vehiculeId + '/finance">' + esc(x.vehicule) + '</a><small class="block muted">' + esc(x.numeroStock || "") + "</small></td>" +
              "<td>" + (x.clientId ? '<a href="#/clients/' + x.clientId + '">' + esc(x.acheteur) + "</a>" : esc(x.acheteur || "—")) + "</td>" +
              "<td>" + BO.pill("s", x.statut, x.statutLabel) + "</td>" +
              '<td class="num">' + fmt.cents(x.prixFinalCentimes) + '</td><td class="num">' + fmt.cents(x.encaisseCentimes) + "</td>" +
              '<td class="num' + (x.resteCentimes > 0 && x.statut !== "annulee" ? " is-warn" : "") + '">' + fmt.cents(x.resteCentimes) + "</td>" +
              '<td class="num">' + fmt.cents(x.margeEstimeeCentimes) + "</td>" +
              '<td class="small">' + [x.dateReservation && "Réservé " + fmt.date(x.dateReservation), x.dateVente && "Vendu " + fmt.date(x.dateVente), x.dateLivraison && "Livré " + fmt.date(x.dateLivraison)].filter(Boolean).join("<br>") + "</td></tr>";
          }).join("") + "</tbody></table></div>"
          : '<div class="card empty">' + icon("key") + "<p>Aucune vente dans cette catégorie. Une vente s'enregistre depuis l'onglet « Vente & finance » du véhicule.</p></div>");
    }
    view.addEventListener("click", function (e) {
      var s = e.target.closest("[data-s]"), enc = e.target.closest("[data-enc]"), tr = e.target.closest("tr[data-v]");
      if (s) { st.statut = s.getAttribute("data-s"); st.aEncaisser = ""; load().catch(BO.fail); }
      else if (enc) { st.statut = ""; st.aEncaisser = "1"; load().catch(BO.fail); }
      else if (tr && !e.target.closest("a")) BO.go("#/vehicules/" + tr.getAttribute("data-v") + "/finance");
    });
    return load();
  }, { nav: "ventes", title: "Ventes & finances", perm: "ventes.gerer" });

  /* ---------------------------------------------------------------- rapports */
  BO.route(/^\/ventes\/rapports$/, function (view, _p, q) {
    var today = new Date();
    var st = { du: q.du || BO.isoDate(new Date(today.getFullYear(), today.getMonth() - 11, 1)), au: q.au || BO.isoDate(today) };
    BO.actions('<button type="button" class="btn btn--primary" data-csv>' + icon("upload", "rot180") + "<span>Export CSV (comptable)</span></button>");
    $("[data-csv]").addEventListener("click", function () { BO.download("admin/finance/export", { du: st.du, au: st.au }, "livradois-finance.csv"); });

    function load() {
      BO.setQuery(st);
      return BO.api("admin/rapports", { query: st }).then(render);
    }
    function render(r) {
      var sum = function (k) { return r.parMois.reduce(function (s, m) { return s + m[k]; }, 0); };
      var maxCa = Math.max.apply(null, r.parMois.map(function (m) { return m.chiffreAffairesCentimes; }).concat([1]));
      var moisLabel = function (m) { var d = new Date(m + "-01T12:00:00"); return d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }); };
      var kpi = function (label, value, small, cls) { return '<div class="kpi ' + (cls || "") + '"><span class="kpi__label">' + label + "</span><strong>" + value + "</strong><small>" + small + "</small></div>"; };
      view.innerHTML = tabs("rapports") +
        '<form class="filterbar filterbar--start" data-period><label class="inline-field">Du <input class="input" type="date" name="du" value="' + st.du + '"></label><label class="inline-field">au <input class="input" type="date" name="au" value="' + st.au + '"></label><button class="btn btn--ghost btn--sm" type="submit">' + icon("refresh") + "Actualiser</button></form>" +
        '<div class="kpis kpis--4">' +
          kpi("Véhicules vendus", sum("ventes"), "sur la période") +
          kpi("Chiffre d'affaires", fmt.cents(sum("chiffreAffairesCentimes")), "prix de vente finaux") +
          kpi("Encaissements", fmt.cents(sum("encaissementsCentimes")), "paiements reçus (remboursements déduits)") +
          kpi("Marge de gestion estimée", fmt.cents(sum("margeEstimeeCentimes")), "ventes de la période", "kpi--hot") +
          kpi("Stock", r.stock.nombre + " véhicule(s)", "coût suivi " + fmt.cents(r.stock.coutSuiviCentimes)) +
          kpi("Valeur affichée du stock", fmt.cents(r.stock.prixAfficheCentimes), "prix TTC des annonces") +
          kpi("Reste à encaisser", fmt.cents(r.aEncaisser.totalCentimes), BO.fmt.plural(r.aEncaisser.ventes.length, "vente"), r.aEncaisser.totalCentimes > 0 ? "kpi--warn" : "") +
        "</div>" +
        '<p class="note small">' + icon("info") + esc(r.avertissement) + "</p>" +
        '<div class="grid-2 grid-2--wide"><section class="card"><div class="card__head"><h2>Par mois</h2></div><div class="table-wrap"><table class="table table--compact"><thead><tr><th>Mois</th><th class="num">Ventes</th><th>Chiffre d\'affaires</th><th class="num">Encaissé</th><th class="num">Marge est.</th></tr></thead><tbody>' +
          r.parMois.map(function (m) {
            return "<tr><td>" + moisLabel(m.mois) + '</td><td class="num">' + m.ventes + '</td><td><div class="bar"><span style="width:' + Math.round(m.chiffreAffairesCentimes / maxCa * 100) + '%"></span><em>' + fmt.cents(m.chiffreAffairesCentimes) + "</em></div></td>" +
              '<td class="num">' + fmt.cents(m.encaissementsCentimes) + '</td><td class="num">' + fmt.cents(m.margeEstimeeCentimes) + "</td></tr>";
          }).join("") + "</tbody></table></div></section>" +
          '<section class="card"><div class="card__head"><h2>Dépenses par catégorie</h2></div>' + (r.depensesParCategorie.length ? '<ul class="mini-list">' + r.depensesParCategorie.map(function (d) { return '<li><div class="grow"><strong>' + esc(d.label) + '</strong></div><span class="num strong">' + fmt.cents(d.totalCentimes) + "</span></li>"; }).join("") + "</ul>" : '<div class="empty"><p>Aucune dépense sur la période.</p></div>') + "</section></div>" +
        '<section class="card"><div class="card__head"><h2>Marge par véhicule vendu</h2></div>' + (r.marges.length ? '<div class="table-wrap"><table class="table table--compact"><thead><tr><th>Véhicule</th><th>Vendu le</th><th class="num">Prix final</th><th class="num">Coût suivi</th><th class="num">Marge estimée</th></tr></thead><tbody>' +
          r.marges.map(function (m) { return '<tr><td><a href="#/vehicules/' + m.vehiculeId + '/finance">' + esc(m.vehicule) + '</a> <span class="muted small">' + esc(m.numeroStock || "") + "</span></td><td>" + fmt.date(m.dateVente) + '</td><td class="num">' + fmt.cents(m.prixFinalCentimes) + '</td><td class="num">' + fmt.cents(m.coutSuiviCentimes) + '</td><td class="num strong' + (m.margeEstimeeCentimes < 0 ? " is-neg" : "") + '">' + fmt.cents(m.margeEstimeeCentimes) + "</td></tr>"; }).join("") +
          "</tbody></table></div>" : '<div class="empty"><p>Aucune vente finalisée sur la période.</p></div>') + "</section>" +
        '<section class="card"><div class="card__head"><h2>Stock : durée et coûts engagés</h2></div>' + (r.stock.vehicules.length ? '<div class="table-wrap"><table class="table table--compact"><thead><tr><th>Véhicule</th><th class="num">En stock depuis</th><th class="num">Coût suivi</th><th class="num">Prix affiché</th></tr></thead><tbody>' +
          r.stock.vehicules.slice().sort(function (a, b) { return b.jours - a.jours; }).map(function (v) { return '<tr><td><a href="#/vehicules/' + v.vehiculeId + '/finance">' + esc(v.vehicule) + '</a> <span class="muted small">' + esc(v.numeroStock || "") + '</span></td><td class="num' + (v.jours > 90 ? " is-warn" : "") + '">' + BO.fmt.plural(v.jours, "jour") + '</td><td class="num">' + fmt.cents(v.coutSuiviCentimes) + '</td><td class="num">' + fmt.cents(v.prixAfficheCentimes) + "</td></tr>"; }).join("") +
          "</tbody></table></div>" : '<div class="empty"><p>Aucun véhicule en stock.</p></div>') + "</section>";
      $("[data-period]", view).addEventListener("submit", function (e) {
        e.preventDefault();
        var b = BO.values(e.target);
        if (!b.du || !b.au || b.du > b.au) { BO.toast("Période invalide.", true); return; }
        st.du = b.du; st.au = b.au;
        load().catch(BO.fail);
      });
    }
    return load();
  }, { nav: "ventes", title: "Rapports de gestion", perm: "finance.voir" });
})();
