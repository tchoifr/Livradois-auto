/* Demandes et offres reçues sur le site : traitement, rattachement aux fiches clients, rendez-vous */
(function () {
  "use strict";
  var BO = window.BO, esc = BO.esc, icon = BO.icon, fmt = BO.fmt, $ = BO.$;

  var STATUTS = [["nouvelle", "Nouvelles"], ["en_cours", "En cours"], ["acceptee", "Acceptées"], ["refusee", "Refusées"], ["traitee", "Traitées"], ["", "Toutes"]];

  BO.route(/^\/demandes$/, function (view, _p, q) {
    var st = { statut: q.statut !== undefined ? q.statut : "nouvelle", type: q.type || "", vehicule: q.vehicule || "", client: q.client || "" };
    if (st.vehicule || st.client) st.statut = q.statut || "";
    var types = BO.ref("typesDemande") || {};

    function load() {
      BO.setQuery(st);
      return BO.api("admin/demandes", { query: st }).then(render);
    }

    function render(list) {
      view.innerHTML = '<div class="filterbar"><div class="seg">' + STATUTS.map(function (s) { return '<button type="button" data-s="' + s[0] + '" aria-pressed="' + (st.statut === s[0]) + '">' + s[1] + "</button>"; }).join("") + "</div>" +
        '<select class="select select--auto" data-type aria-label="Type de demande"><option value="">Tous les types</option>' + Object.keys(types).map(function (k) { return '<option value="' + k + '"' + (k === st.type ? " selected" : "") + ">" + esc(types[k]) + "</option>"; }).join("") + "</select>" +
        (st.vehicule || st.client ? '<button type="button" class="tag tag--filter" data-clear>' + (st.vehicule ? "Un véhicule" : "Un client") + " " + icon("x", "i--sm") + "</button>" : "") + "</div>" +
        (list.length ? '<div class="leads">' + list.map(card).join("") + "</div>"
          : '<div class="card empty">' + icon("inbox") + "<p>Aucune demande dans cette catégorie.</p></div>");
    }

    function card(d) {
      var v = d.vehicule, offre = d.type === "offre" && d.montant;
      var client = d.client ? '<a class="tag tag--ok" href="#/clients/' + d.client.id + '">' + icon("user") + esc(d.client.nom) + "</a>"
        : (d.clientSuggere ? '<span class="note note--inline">' + icon("users") + "Client existant probable : <strong>" + esc(d.clientSuggere.nom) + "</strong> (" + esc(d.clientSuggere.telephone) + ")" +
            ' <button type="button" class="btn btn--primary btn--sm" data-assoc="' + d.id + '" data-client="' + d.clientSuggere.id + '">Rattacher</button> <button type="button" class="link" data-new-client="' + d.id + '">Non, nouvelle fiche</button></span>'
          : (BO.can("clients.gerer") ? '<button type="button" class="btn btn--ghost btn--sm" data-new-client="' + d.id + '">' + icon("plus") + 'Créer la fiche client</button> <button type="button" class="btn btn--ghost btn--sm" data-find="' + d.id + '">' + icon("search") + "Client existant</button>" : ""));
      var rdvLink = BO.can("rdv.gerer") && v && !v.supprime ? '<a class="btn btn--ghost btn--sm" href="#/planning/nouveau?vehicule=' + v.dbId + (d.client ? "&client=" + d.client.id : "") + "&motif=" + (d.type === "essai" ? "essai" : "visite") + '">' + icon("calendar") + "Rendez-vous</a>" : "";
      return '<article class="lead card' + (d.statut === "nouvelle" ? " is-new" : "") + '">' +
        '<div class="lead__veh">' + (v ? BO.thumb(v.photo, "lead__img") : '<div class="lead__img noimg">' + icon("inbox") + "</div>") +
          "<div>" + (v ? (v.supprime ? "<strong>" + esc(v.titre || d.vehiculeTitre) + '</strong><small class="muted">annonce supprimée</small>' : '<a class="strong" href="#/vehicules/' + v.dbId + '">' + esc(v.titre) + "</a><small>" + esc([v.numeroStock, v.prix ? fmt.euros(v.prix) : ""].filter(Boolean).join(" · ")) + "</small>") : "<strong>Demande générale</strong>") + "</div></div>" +
        '<div class="lead__body"><p class="lead__top"><span class="tag' + (offre ? " tag--offer" : "") + '">' + esc(types[d.type] || d.type) + (offre ? " · " + fmt.euros(d.montant) : "") + "</span>" +
          '<span class="muted small">' + BO.when(d.createdAt) + "</span></p>" +
          '<p class="lead__who"><strong>' + esc(d.nom) + "</strong>" + (d.tel ? ' · <a href="tel:' + esc(d.tel.replace(/\s/g, "")) + '">' + esc(d.tel) + "</a>" : "") + (d.email ? " · " + esc(d.email) : "") + "</p>" +
          (d.message ? '<p class="lead__msg">' + esc(d.message) + "</p>" : "") +
          '<div class="lead__client">' + client + "</div></div>" +
        '<div class="lead__actions"><select class="select" data-statut="' + d.id + '" aria-label="Statut de la demande">' + ["nouvelle", "en_cours", "acceptee", "refusee", "traitee"].map(function (s) { return '<option value="' + s + '"' + (s === d.statut ? " selected" : "") + ">" + BO.statutDemande(s) + "</option>"; }).join("") + "</select>" +
          rdvLink + (BO.can("demandes.supprimer") ? '<button type="button" class="icon-btn icon-btn--danger" data-del="' + d.id + '" aria-label="Supprimer la demande">' + icon("trash") + "</button>" : "") + "</div></article>";
    }

    function associer(id, clientId, confirm) {
      var body = { id: id };
      if (clientId) body.clientId = clientId;
      if (confirm) body.confirmerDoublon = true;
      return BO.api("admin/demande/associer", { body: body }).then(function () { BO.toast("Demande rattachée à la fiche client"); load(); }).catch(function (err) {
        if (err.status === 409 && err.data.doublons) {
          BO.modal({
            title: "Client déjà connu ?",
            body: "<p>Même téléphone ou e-mail que :</p>" + '<div class="pick-list">' + err.data.doublons.map(function (c) { return '<button type="button" class="pick" data-pick="' + c.id + '"><span><strong>' + esc(c.nomComplet) + "</strong><small>" + esc([c.telephone, c.email].filter(Boolean).join(" · ")) + "</small></span>" + icon("chevron-right") + "</button>"; }).join("") + "</div>",
            actions: [{ label: "Annuler" }, { label: "Créer quand même une nouvelle fiche", onClick: function () { return associer(id, null, true); } }],
            onOpen: function (m) {
              m.body.addEventListener("click", function (e) { var b = e.target.closest("[data-pick]"); if (b) { m.close(); associer(id, +b.getAttribute("data-pick")); } });
            },
          });
          return;
        }
        BO.fail(err);
      });
    }

    function findClient(id) {
      var m = BO.modal({
        title: "Rattacher à un client existant",
        body: '<label class="field">Rechercher<input class="input" data-cq placeholder="Nom, téléphone ou e-mail" autocomplete="off"></label><div class="pick-list" data-cres></div>',
        actions: [{ label: "Fermer" }],
      });
      var timer;
      $("[data-cq]", m.body).addEventListener("input", function (e) {
        clearTimeout(timer);
        var q = e.target.value.trim();
        timer = setTimeout(function () {
          if (q.length < 2) { $("[data-cres]", m.body).innerHTML = ""; return; }
          BO.api("admin/clients", { query: { q: q, limite: 8 } }).then(function (cs) {
            $("[data-cres]", m.body).innerHTML = cs.map(function (c) { return '<button type="button" class="pick" data-pick="' + c.id + '"><span><strong>' + esc(c.nomComplet) + "</strong><small>" + esc([c.telephone, c.email].filter(Boolean).join(" · ")) + "</small></span>" + icon("chevron-right") + "</button>"; }).join("") || '<p class="muted">Aucun client trouvé.</p>';
          }).catch(BO.fail);
        }, 220);
      });
      m.body.addEventListener("click", function (e) { var b = e.target.closest("[data-pick]"); if (b) { m.close(); associer(id, +b.getAttribute("data-pick")); } });
    }

    view.addEventListener("click", function (e) {
      var t;
      if ((t = e.target.closest("[data-s]"))) { st.statut = t.getAttribute("data-s"); load().catch(BO.fail); }
      else if (e.target.closest("[data-clear]")) { st.vehicule = ""; st.client = ""; load().catch(BO.fail); }
      else if ((t = e.target.closest("[data-assoc]"))) associer(+t.getAttribute("data-assoc"), +t.getAttribute("data-client"));
      else if ((t = e.target.closest("[data-new-client]"))) associer(+t.getAttribute("data-new-client"), null);
      else if ((t = e.target.closest("[data-find]"))) findClient(+t.getAttribute("data-find"));
      else if ((t = e.target.closest("[data-del]"))) {
        var id = +t.getAttribute("data-del");
        BO.confirm("Supprimer cette demande ?", "Elle sera définitivement effacée (préférez le statut « Traitée » pour la garder).", "Supprimer").then(function (ok) {
          if (ok) BO.api("admin/demande/supprimer", { body: { id: id } }).then(function () { BO.toast("Demande supprimée"); BO.refreshCounts(); load(); }).catch(BO.fail);
        });
      }
    });
    view.addEventListener("change", function (e) {
      var t = e.target;
      if (t.matches("[data-type]")) { st.type = t.value; load().catch(BO.fail); }
      else if (t.matches("[data-statut]")) {
        BO.api("admin/demande/statut", { body: { id: +t.getAttribute("data-statut"), statut: t.value } }).then(function () { BO.toast("Demande : " + BO.statutDemande(t.value)); BO.refreshCounts(); }).catch(BO.fail);
      }
    });
    return load();
  }, { nav: "demandes", title: "Demandes & offres", perm: "demandes.gerer" });
})();
