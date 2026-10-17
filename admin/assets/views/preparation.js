/* Préparation (non mécanique) : rendez-vous à préparer, tableau véhicules × tâches, contrôles techniques */
(function () {
  "use strict";
  var BO = window.BO, esc = BO.esc, icon = BO.icon, fmt = BO.fmt, $ = BO.$;

  var FILTRES = [
    ["", "Tous"], ["pret", "Pas prêts"], ["nettoyage", "Nettoyage"], ["documents", "Documents"], ["ct", "Contrôle technique"],
  ];
  var COURT = { a_faire: "À faire", en_cours: "En cours", termine: "Fait", non_necessaire: "Sans objet" };

  function concerne(tache, filtre) {
    if (filtre === "nettoyage") return tache.code.indexOf("nettoyage") === 0;
    if (filtre === "documents") return tache.categorie === "documents";
    if (filtre === "ct") return tache.code === "controle_technique";
    if (filtre === "pret") return tache.code === "pret_visite";
    return true;
  }
  function fait(s) { return s === "termine" || s === "non_necessaire"; }

  BO.route(/^\/preparation$/, function (view, _p, q) {
    var st = { tache: q.tache || "" }, data = null;
    BO.actions('<a class="btn btn--ghost" href="#/vehicules?f=preparation">' + icon("car") + "<span>Liste des véhicules</span></a>");

    function load() {
      return BO.api("admin/preparation", { query: { parc: BO.parcFilter() } }).then(function (d) { data = d; render(); });
    }

    function visibles() {
      var cols = data.taches.map(function (t, i) { return concerne(t, st.tache) ? i : -1; }).filter(function (i) { return i >= 0; });
      var rows = data.vehicules.filter(function (v) {
        if (!st.tache) return true;
        if (st.tache === "pret") return !v.pretVisite;
        if (st.tache === "ct") return ["echu", "bientot", "inconnu", "a_verifier"].indexOf(v.ct.etat) !== -1 || cols.some(function (i) { return !fait(v.etats[i]); });
        return cols.some(function (i) { return !fait(v.etats[i]) && data.taches[i].obligatoire; });
      });
      return { cols: st.tache ? cols : data.taches.map(function (_t, i) { return i; }), rows: rows };
    }

    function render() {
      var vis = visibles();
      var aPreparer = data.rendezVous.filter(function (r) { return !r.vehiculePret; });
      view.innerHTML =
        '<div class="grid-2 grid-2--wide">' +
          '<section class="card"><div class="card__head"><h2>' + icon("calendar") + "Rendez-vous des 7 prochains jours</h2>" +
            (aPreparer.length ? '<span class="tag tag--warn">' + BO.fmt.plural(aPreparer.length, "véhicule") + " à préparer</span>" : '<span class="tag tag--ok">' + icon("check") + "Tout est prêt</span>") + "</div>" +
            (data.rendezVous.length ? '<ul class="mini-list">' + data.rendezVous.map(function (r) {
              return '<li><span class="mini-time">' + fmt.date(r.debut).slice(0, 5) + "<small>" + fmt.time(r.debut) + "</small></span>" +
                '<div class="grow"><strong><a href="#/vehicules/' + r.vehiculeId + '/preparation">' + esc(r.vehicule) + "</a></strong><span>" + esc(r.motifLabel) + " · " + esc(r.client || "Sans client") + (r.parc ? " · " + esc(r.parc) : "") + "</span></div>" +
                (r.vehiculePret ? '<span class="tag tag--ok">' + icon("check") + "Prêt</span>" : '<span class="tag tag--warn">' + icon("clock") + "À préparer</span>") + "</li>";
            }).join("") + "</ul>" : '<div class="empty">' + icon("calendar") + "<p>Aucune visite, aucun essai ni livraison prévus.</p></div>") +
          "</section>" +
          '<section class="card"><div class="card__head"><h2>' + icon("clipboard") + "Contrôles techniques à surveiller</h2></div>" + ctList() + "</section>" +
        "</div>" +
        '<div class="filterbar"><div class="seg">' + FILTRES.map(function (f) { return '<button type="button" data-f="' + f[0] + '" aria-pressed="' + (st.tache === f[0]) + '">' + f[1] + "</button>"; }).join("") + "</div>" +
          '<span class="muted small">' + BO.fmt.plural(vis.rows.length, "véhicule") + " en stock · les changements sont enregistrés aussitôt</span></div>" +
        (vis.rows.length ? '<div class="table-wrap"><table class="table matrix"><thead><tr><th>Véhicule</th><th>Avancement</th>' +
          vis.cols.map(function (i) { var t = data.taches[i]; return '<th title="' + esc(t.libelle) + '"><span>' + esc(t.libelle) + "</span>" + (t.obligatoire ? "" : " <small>(fac.)</small>") + "</th>"; }).join("") +
          "</tr></thead><tbody>" + vis.rows.map(function (v) {
            return '<tr><td><a class="matrix-veh" href="#/vehicules/' + v.dbId + '/preparation">' + BO.thumb(v.photo, "row-img") + "<span><strong>" + esc(v.titre) + "</strong><small>" + esc([v.numeroStock, v.immatriculation, v.parc].filter(Boolean).join(" · ")) + "</small></span></a></td>" +
              "<td>" + BO.progress(v.preparation) + (v.prochainRdv ? '<small class="block muted">RDV ' + fmt.datetime(v.prochainRdv) + "</small>" : "") + "</td>" +
              vis.cols.map(function (i) {
                var t = data.taches[i], s = v.etats[i];
                var extra = t.code === "controle_technique" ? '<small class="block">' + BO.ctBadge(v.ct) + "</small>" : "";
                return '<td><select class="cell-sel cell-sel--' + s + '" data-v="' + v.dbId + '" data-t="' + t.id + '" data-i="' + i + '" aria-label="' + esc(t.libelle + " — " + v.titre) + '">' +
                  Object.keys(COURT).map(function (k) { return '<option value="' + k + '"' + (k === s ? " selected" : "") + ">" + COURT[k] + "</option>"; }).join("") + "</select>" + extra + "</td>";
              }).join("") + "</tr>";
          }).join("") + "</tbody></table></div>"
          : '<div class="card empty">' + icon("check") + "<p>Rien à faire dans cette catégorie.</p></div>");
    }

    function ctList() {
      var list = data.vehicules.filter(function (v) { return v.ct.etat !== "ok"; }).sort(function (a, b) {
        var o = { echu: 0, bientot: 1, a_verifier: 2, inconnu: 3 };
        return (o[a.ct.etat] - o[b.ct.etat]) || ((a.ct.jours || 0) - (b.ct.jours || 0));
      });
      if (!list.length) return '<div class="empty">' + icon("check") + "<p>Tous les contrôles techniques sont valables et vérifiés.</p></div>";
      return '<ul class="mini-list">' + list.slice(0, 8).map(function (v) {
        return '<li><div class="grow"><strong><a href="#/vehicules/' + v.dbId + '/preparation">' + esc(v.titre) + "</a></strong><span>" + esc([v.numeroStock, v.parc].filter(Boolean).join(" · ")) + "</span></div>" + BO.ctBadge(v.ct) + "</li>";
      }).join("") + (list.length > 8 ? '<li class="muted small">… et ' + (list.length - 8) + " autre(s)</li>" : "") + "</ul>";
    }

    view.addEventListener("click", function (e) {
      var f = e.target.closest("[data-f]");
      if (f) { st.tache = f.getAttribute("data-f"); BO.setQuery(st); render(); }
    });
    view.addEventListener("change", function (e) {
      var sel = e.target.closest(".cell-sel");
      if (!sel) return;
      var vid = +sel.getAttribute("data-v"), i = +sel.getAttribute("data-i"), statut = sel.value;
      sel.disabled = true;
      BO.api("admin/vehicule/checklist", { body: { vehiculeId: vid, itemId: +sel.getAttribute("data-t"), statut: statut } }).then(function () {
        sel.className = "cell-sel cell-sel--" + statut;
        BO.toast("Préparation mise à jour");
        return load();
      }).catch(function (err) { BO.fail(err); load(); });
      var v = data.vehicules.filter(function (x) { return x.dbId === vid; })[0];
      if (v) v.etats[i] = statut;
    });
    return load();
  }, { nav: "preparation", title: "Préparation", perm: "vehicules.preparer" });
})();
