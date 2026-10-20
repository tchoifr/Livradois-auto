/* Diffusion multicanale : site, Leboncoin, La Centrale… — vue d'ensemble, comptes de diffusion, historique, onglet du véhicule.
   Rien n'est affiché comme publié tant que la plateforme (ou l'utilisateur, en publication assistée) ne l'a pas confirmé. */
(function () {
  "use strict";
  var BO = window.BO, esc = BO.esc, icon = BO.icon, fmt = BO.fmt, $ = BO.$, $$ = BO.$$;

  var A_TRAITER = ["a_retirer", "erreur", "a_mettre_a_jour", "expire", "en_attente", "refuse"];
  var ACTIONS = {
    publication_demandee: "Publication demandée", publier: "Publication", modifier: "Mise à jour", retirer: "Retrait",
    manuel_publie: "Publiée (assistée)", manuel_mis_a_jour: "Mise à jour (assistée)", manuel_renouvele: "Renouvelée", manuel_suspendu: "Suspendue",
    manuel_reactive: "Réactivée", manuel_refuse: "Refusée", manuel_retire: "Retirée (assistée)", adaptation: "Annonce adaptée",
    a_mettre_a_jour: "À mettre à jour", maj_demandee: "Mise à jour demandée", a_retirer: "À retirer", retrait_demande: "Retrait demandé", retrait_annule: "Retrait annulé",
    site_publie: "En ligne sur le site", site_suspendu: "Retirée du site", site_non_publie: "Repassée en brouillon", site_vendu: "Vendu : retirée du site",
    compte_modifie: "Compte modifié", compte_test: "Test de connexion", compte_deconnecte: "Déconnexion", compte_jeton: "Renouvellement d'accès", canal: "Plateforme enregistrée",
  };
  var RESULTATS = { succes: ["ok", "Réussi"], echec: ["danger", "Échec"], info: ["muted", "Info"] };

  function pill(statut, label) { return BO.pill("p", statut, label); }
  function modeTag(c) {
    if (c.mode === "site") return '<span class="tag tag--muted">' + icon("eye") + "Direct</span>";
    if (c.mode === "auto") return '<span class="tag tag--ok">' + icon("zap") + "Automatique</span>";
    return '<span class="tag">' + icon("clipboard") + "Assistée</span>";
  }
  function resultat(r) { var x = RESULTATS[r] || ["muted", r]; return '<span class="tag tag--' + x[0] + '">' + esc(x[1]) + "</span>"; }
  function when(s) { return s ? BO.when(s) : "—"; }
  function day(s) { return s ? fmt.date(s) : "—"; }

  function copier(texte) {
    var done = function () { BO.toast("Copié dans le presse-papiers"); };
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(texte).then(done).catch(function () { fallback(); });
    fallback();
    function fallback() {
      var t = document.createElement("textarea");
      t.value = texte; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0";
      document.body.appendChild(t); t.select();
      try { document.execCommand("copy"); done(); } catch (e) { BO.toast("Copie impossible : sélectionnez le texte manuellement.", true); }
      t.remove();
    }
  }

  function caracteristiques(d) {
    return [
      ["Marque", d.marque], ["Modèle", d.modele], ["Version", d.version], ["Année", d.annee], ["Mise en circulation", d.miseEnCirculation],
      ["Kilométrage", fmt.km(d.km)], ["Énergie", d.energie], ["Boîte", d.boite], ["Carrosserie", d.carrosserie],
      ["Puissance", d.puissance ? d.puissance + " ch" : ""], ["Couleur", d.couleur], ["Prix", fmt.euros(d.prix)],
    ].filter(function (x) { return x[1] !== "" && x[1] != null; });
  }

  function manquantsHtml(list) {
    if (!list || !list.length) return "";
    var b = list.filter(function (m) { return m.bloquant; }), c = list.filter(function (m) { return !m.bloquant; });
    return (b.length ? '<p class="pub-miss pub-miss--block">' + icon("alert", "i--sm") + "À compléter avant publication : " + esc(b.map(function (m) { return m.message; }).join(", ")) + "</p>" : "") +
      (c.length ? '<p class="pub-miss">' + icon("info", "i--sm") + "Conseillé : " + esc(c.map(function (m) { return m.message.replace(/ \(conseillé\)$/, ""); }).join(", ")) + "</p>" : "");
  }

  /* ================================================================ page « Diffusion » */
  var ONGLETS = [["", "Vue d'ensemble"], ["comptes", "Comptes de diffusion"], ["historique", "Historique"]];

  BO.route(/^\/diffusion$/, function (view, _p, q) {
    var onglet = ["comptes", "historique"].indexOf(q.onglet) !== -1 ? q.onglet : "";
    view.innerHTML = '<div class="filterbar"><div class="seg" role="tablist">' + ONGLETS.map(function (o) {
      return '<button type="button" data-onglet="' + o[0] + '" aria-pressed="' + (o[0] === onglet) + '">' + o[1] + "</button>";
    }).join("") + '</div></div><div data-dif-body><p class="loading">Chargement…</p></div>';
    view.addEventListener("click", function (e) {
      var b = e.target.closest("[data-onglet]");
      if (b) BO.go("#/diffusion" + (b.getAttribute("data-onglet") ? "?onglet=" + b.getAttribute("data-onglet") : ""));
    });
    var body = $("[data-dif-body]", view);
    if (onglet === "comptes") return comptesPage(body);
    if (onglet === "historique") return historiquePage(body, q);
    return overviewPage(body, q);
  }, { nav: "diffusion", title: "Diffusion des annonces", perm: "diffusion.voir" });

  /* ---------------------------------------------------------------- vue d'ensemble */
  function overviewPage(body, q) {
    var st = { filtre: ["traiter", "nondiffuse"].indexOf(q.filtre) !== -1 ? q.filtre : "", q: q.q || "" };
    return BO.api("admin/diffusion", { query: { parc: BO.parcFilter() } }).then(function (o) {
      var k = o.compteurs, externes = o.canaux.filter(function (c) { return c.type !== "site"; });
      var kpi = function (filtre, ic, label, value, small, cls) {
        return '<button type="button" class="kpi' + (cls ? " " + cls : "") + '" data-filtre="' + filtre + '"><span class="kpi__label">' + icon(ic) + label + "</span><strong>" + value + "</strong><small>" + small + "</small></button>";
      };
      var parCanal = externes.map(function (c) { return esc(c.nom) + " " + (k.parCanal[c.canalId] || 0); }).join(" · ");
      body.innerHTML =
        '<div class="kpis kpis--4 dif-kpis">' +
          kpi("", "eye", "Annonces en ligne", k.actives, "sur le site · " + (parCanal || "aucune plateforme")) +
          kpi("traiter", "alert", "À retirer", k.aRetirer, "véhicules vendus ou retirés", k.aRetirer ? "kpi--hot" : "") +
          kpi("traiter", "refresh", "À mettre à jour", k.aMettreAJour, "prix, texte ou photos modifiés", k.aMettreAJour ? "kpi--warn" : "") +
          kpi("traiter", "clock", "À renouveler · erreurs", k.aRenouveler + " · " + k.erreurs, (k.enAttente ? k.enAttente + " en attente de confirmation" : "expirées ou refusées"), k.erreurs ? "kpi--warn" : "") +
        "</div>" +
        '<p class="dif-modes">' + o.canaux.map(function (c) { return "<span><strong>" + esc(c.nom) + "</strong> " + modeTag(c) + "</span>"; }).join("") +
          (BO.can("diffusion.comptes") ? '<a class="link" href="#/diffusion?onglet=comptes">' + icon("key", "i--sm") + "Comptes de diffusion</a>" : "") + "</p>" +
        '<div class="filterbar"><div class="seg" data-seg>' +
          [["", "Tous les véhicules"], ["traiter", "À traiter"], ["nondiffuse", "Pas encore sur les plateformes"]].map(function (f) {
            return '<button type="button" data-f="' + f[0] + '" aria-pressed="' + (st.filtre === f[0]) + '">' + f[1] + "</button>";
          }).join("") + "</div>" +
          '<label class="search search-inline">' + icon("search") + '<input class="input" type="search" data-q placeholder="Modèle ou n° de stock" value="' + esc(st.q) + '" aria-label="Rechercher un véhicule"></label></div>' +
        '<div data-rows></div>';
      function rows() {
        BO.setQuery({ filtre: st.filtre, q: st.q });
        var needle = st.q.toLowerCase();
        var list = o.lignes.filter(function (l) {
          if (needle && (l.vehicule + " " + l.numeroStock).toLowerCase().indexOf(needle) === -1) return false;
          if (st.filtre === "traiter") return l.canaux.some(function (c) { return A_TRAITER.indexOf(c.statut) !== -1; });
          if (st.filtre === "nondiffuse") return ["disponible", "reserve"].indexOf(l.statutVehicule) !== -1 && l.canaux.some(function (c, i) { return o.canaux[i].type !== "site" && ["non_publie", "retire", "refuse"].indexOf(c.statut) !== -1; });
          return true;
        });
        $("[data-rows]", body).innerHTML = list.length ? '<div class="table-wrap"><table class="table dif-table"><thead><tr><th>Véhicule</th><th class="num">Prix</th>' +
          o.canaux.map(function (c) { return "<th>" + esc(c.nom) + "</th>"; }).join("") + "</tr></thead><tbody>" +
          list.map(function (l) {
            return '<tr data-go="' + l.vehiculeId + '"><td><a class="matrix-veh" href="#/vehicules/' + l.vehiculeId + '/diffusion">' + BO.thumb(l.photo, "row-img") +
              "<span><strong>" + esc(l.vehicule) + "</strong><small>" + esc(l.numeroStock || "") + " · " + esc(l.statutVehiculeLabel) + "</small></span></a></td>" +
              '<td class="num">' + fmt.euros(l.prix) + "</td>" + l.canaux.map(function (c) { return "<td>" + pill(c.statut, c.statutLabel) + "</td>"; }).join("") + "</tr>";
          }).join("") + "</tbody></table></div>"
          : '<div class="card empty">' + icon("check") + "<p>" + (st.filtre === "traiter" ? "Aucune annonce à traiter : tout est à jour." : "Aucun véhicule dans cette sélection.") + "</p></div>";
      }
      body.addEventListener("click", function (e) {
        var b = e.target.closest("[data-f], [data-filtre]");
        if (b) {
          st.filtre = b.hasAttribute("data-f") ? b.getAttribute("data-f") : b.getAttribute("data-filtre");
          $$("[data-f]", body).forEach(function (x) { x.setAttribute("aria-pressed", String(x.getAttribute("data-f") === st.filtre)); });
          rows();
          return;
        }
        var tr = e.target.closest("[data-go]");
        if (tr && !e.target.closest("a")) BO.go("#/vehicules/" + tr.getAttribute("data-go") + "/diffusion");
      });
      $("[data-q]", body).addEventListener("input", function (e) { st.q = e.target.value.trim(); rows(); });
      rows();
    });
  }

  /* ---------------------------------------------------------------- comptes de diffusion */
  function comptesPage(body) {
    return BO.api("admin/diffusion/comptes").then(function (r) {
      var gerer = BO.can("diffusion.comptes");
      body.innerHTML =
        '<div class="note">' + icon("lock") + "<div><strong>Connexion officielle uniquement.</strong> Leboncoin et La Centrale réservent la diffusion automatique aux professionnels abonnés : " +
          "leurs accès API (identifiant et secret client, ou clé d'API) sont remis avec l'abonnement. Ne saisissez jamais le mot de passe de vos comptes : il n'est ni demandé ni stocké. " +
          "Les accès sont chiffrés sur le serveur et ne sont jamais réaffichés.</div></div>" +
        '<div class="acc-grid">' + r.plateformes.map(function (c) { return compteCard(c, gerer); }).join("") + "</div>" +
        autresCard(r.autres, gerer);
      r.plateformes.forEach(function (c) { if (gerer) wireCompte($('[data-compte="' + c.canalId + '"]', body), c, function () { comptesPage(body); }); });
      wireAutres(body, function () { comptesPage(body); });
    });
  }

  function compteCard(c, gerer) {
    var st = BO.pill("k", c.statut, c.statutLabel);
    var auto = c.publicationAuto
      ? '<p class="note">' + icon("zap") + "<span>Publication automatique disponible pour " + esc(c.nom) + " une fois le compte connecté.</span></p>"
      : '<p class="note note--warn">' + icon("info") + "<span><strong>Publication automatique pas encore disponible pour " + esc(c.nom) + ".</strong> " + esc(c.nom) +
        " ne publie pas d'API ouverte : l'intégration sera développée à partir de la documentation officielle remise avec votre abonnement. " +
        "La connexion ci-dessous vérifie vos accès dès maintenant ; en attendant, les annonces se publient en mode assisté (rien n'est envoyé automatiquement).</span></p>";
    var head = '<div class="card__head"><h2>' + icon("share") + esc(c.nom) + "</h2>" + st + "</div>";
    var infos = '<p class="acc-cond">' + esc(c.conditions) + ' <a class="link" href="' + esc(c.aide) + '" target="_blank" rel="noopener">' + icon("external", "i--sm") + "Offres et conditions " + esc(c.nom) + "</a></p>" +
      '<p class="acc-state small muted">' + (c.dernierTestLe ? "Dernier test : " + when(c.dernierTestLe) + " — " : "") + esc(c.dernierMessage || (c.statut === "non_connecte" ? "Aucun accès vérifié." : "")) +
        (c.connecteLe && c.statut === "connecte" ? " · connecté " + when(c.connecteLe) : "") + "</p>";
    if (!gerer) return '<section class="card">' + head + '<div class="card__body stack">' + infos + auto + "</div></section>";
    var dom = c.domaines.join(" ou ");
    var methodes = [{ value: "", label: "— selon la documentation de " + c.nom + " —" }, { value: "oauth2_client", label: "OAuth 2.0 — identifiant et secret client" }, { value: "cle_api", label: "Clé d'API" }];
    return '<section class="card" data-compte="' + c.canalId + '">' + head + '<div class="card__body stack">' + infos +
      '<form class="form-grid form-grid--2" data-form autocomplete="off">' +
        '<fieldset class="span-2 acc-sub"><legend>Abonnement</legend>' +
          BO.f.check("abonnementActif", "Abonnement pro actif chez " + esc(c.nom), c.abonnementActif) +
          '<div class="form-grid form-grid--2">' + BO.f.input("abonnementOffre", "Offre souscrite", c.abonnementOffre, 'maxlength="120" placeholder="ex. pack Business"') +
          BO.f.input("abonnementFin", "Fin d'abonnement (si connue)", c.abonnementFin || "", 'type="date"') + "</div>" +
          (c.abonnementActif && !c.abonnementValide ? '<p class="pub-miss pub-miss--block">' + icon("alert", "i--sm") + "Abonnement terminé : la connexion est suspendue.</p>" : "") +
        "</fieldset>" +
        '<fieldset class="span-2 acc-sub"><legend>Accès API remis par ' + esc(c.nom) + "</legend>" + '<p class="small muted">Adresses officielles uniquement (https, ' + esc(dom) + "), indiquées dans la documentation remise avec l'abonnement.</p>" +
          '<div class="form-grid form-grid--2"><div class="span-2">' + BO.f.select("methode", "Méthode de connexion", methodes, c.methode) + "</div>" +
          '<div data-m="oauth2_client">' + BO.f.input("urlJeton", "Adresse d'authentification", c.urlJeton, 'type="url" placeholder="https://….' + esc(c.domaines[0]) + '/…" title="Adresse https du domaine ' + esc(dom) + '"') + "</div>" +
          '<div data-m="oauth2_client">' + BO.f.input("identifiant", "Identifiant client", c.identifiant, 'maxlength="190" spellcheck="false" data-orig="' + esc(c.identifiant) + '"') + "</div>" +
          '<div data-m="cle_api">' + BO.f.input("urlTest", "Adresse de vérification", c.urlTest, 'type="url" placeholder="https://….' + esc(c.domaines[0]) + '/…" title="Adresse https du domaine ' + esc(dom) + '"') + "</div>" +
          '<div data-m="cle_api">' + BO.f.select("enteteCle", "Envoi de la clé", [{ value: "authorization", label: "En-tête Authorization: Bearer" }, { value: "x-api-key", label: "En-tête X-API-Key" }], c.enteteCle || "authorization") + "</div>" +
          '<div data-m="oauth2_client cle_api" class="span-2">' + BO.f.input("secret", "Secret client ou clé d'API", "", 'type="password" autocomplete="new-password" spellcheck="false" placeholder="' + (c.secretEnregistre ? "•••••••• enregistré — laisser vide pour le conserver" : "Collez l'accès fourni par " + esc(c.nom)) + '"', "jamais le mot de passe du compte") + "</div>" +
          "</div></fieldset>" +
      "</form>" + auto +
      '<div class="form-actions">' +
        (c.secretEnregistre ? '<button type="button" class="btn btn--ghost" data-deco>' + icon("logout") + "Déconnecter</button>" : "") +
        '<button type="button" class="btn btn--ghost" data-test' + (c.abonnementValide && c.secretEnregistre && c.methode ? "" : ' disabled title="Abonnement actif et accès enregistrés requis"') + ">" + icon("refresh") + "Tester la connexion</button>" +
        '<button type="button" class="btn btn--primary" data-save>' + icon("check") + "Enregistrer</button></div>" +
      "</div></section>";
  }

  function wireCompte(card, c, reload) {
    if (!card) return;
    var form = $("[data-form]", card), sel = $('[name="methode"]', form);
    function toggle() { $$("[data-m]", form).forEach(function (el) { el.hidden = el.getAttribute("data-m").split(" ").indexOf(sel.value) === -1; }); }
    sel.addEventListener("change", toggle);
    toggle();
    function body() {
      var v = BO.values(form), out = { canalId: c.canalId, abonnementActif: v.abonnementActif, abonnementOffre: v.abonnementOffre, abonnementFin: v.abonnementFin, methode: v.methode,
        urlJeton: v.urlJeton, urlTest: v.urlTest, enteteCle: v.methode === "cle_api" ? v.enteteCle : "" };
      var ident = $('[name="identifiant"]', form);
      if (ident.value.trim() !== ident.getAttribute("data-orig")) out.identifiant = ident.value.trim();
      if (v.secret) out.secret = v.secret;
      return out;
    }
    $("[data-save]", card).addEventListener("click", function (e) {
      var b = e.currentTarget; b.disabled = true;
      BO.api("admin/diffusion/compte", { body: body() }).then(function (r) { BO.toast("Compte " + r.nom + " enregistré" + (r.statut === "non_connecte" && r.secretEnregistre ? " : testez la connexion" : "")); reload(); })
        .catch(BO.fail).then(function () { b.disabled = false; });
    });
    $("[data-test]", card).addEventListener("click", function (e) {
      var b = e.currentTarget; b.disabled = true; b.classList.add("is-loading");
      BO.api("admin/diffusion/compte/tester", { body: { canalId: c.canalId } }).then(function (r) {
        BO.toast(r.statut === "connecte" ? r.nom + " : connexion vérifiée" : r.nom + " : " + r.dernierMessage, r.statut !== "connecte");
        reload();
      }).catch(BO.fail).then(function () { b.disabled = false; b.classList.remove("is-loading"); });
    });
    var deco = $("[data-deco]", card);
    if (deco) deco.addEventListener("click", function () {
      BO.confirm("Déconnecter " + c.nom + " ?", "Les accès API enregistrés seront effacés du serveur. La publication automatique (si disponible) s'arrête ; les annonces déjà en ligne sur " + c.nom + " ne sont pas supprimées.", "Déconnecter")
        .then(function (ok) { if (ok) return BO.api("admin/diffusion/compte/deconnecter", { body: { canalId: c.canalId } }).then(function () { BO.toast(c.nom + " déconnecté : accès effacés"); reload(); }); })
        .catch(BO.fail);
    });
  }

  function autresCard(list, gerer) {
    return '<section class="card" data-autres><div class="card__head"><h2>' + icon("link") + "Autres plateformes (publication assistée)</h2></div>" +
      '<div class="card__body stack"><p class="muted small">Ajoutez d\'autres sites d\'annonces : le dashboard prépare l\'annonce (texte, photos), vous la publiez sur le site puis vous enregistrez le lien. Aucune connexion automatique.</p>' +
      (list.length ? '<ul class="acc-list">' + list.map(function (c) {
        return '<li><span class="grow"><strong>' + esc(c.nom) + "</strong>" + (c.urlDepot ? ' <a class="link small" href="' + esc(c.urlDepot) + '" target="_blank" rel="noopener">' + icon("external", "i--sm") + esc(c.urlDepot.replace(/^https:\/\//, "")) + "</a>" : "") + "</span>" +
          (c.actif ? '<span class="tag tag--ok">Active</span>' : '<span class="tag tag--muted">Désactivée</span>') +
          (gerer ? ' <button type="button" class="btn btn--ghost btn--sm" data-toggle-canal="' + c.canalId + '" data-nom="' + esc(c.nom) + '" data-url="' + esc(c.urlDepot) + '" data-actif="' + (c.actif ? 1 : 0) + '">' + (c.actif ? "Désactiver" : "Réactiver") + "</button>" : "") + "</li>";
      }).join("") + "</ul>" : "") +
      (gerer ? '<form class="form-grid form-grid--2 acc-add" data-add-canal>' + BO.f.input("nom", "Nom de la plateforme", "", 'maxlength="80" required placeholder="ex. ParuVendu"') +
        BO.f.input("urlDepot", "Adresse de dépôt d'annonce", "", 'type="url" placeholder="https://…"') +
        '<div class="span-2 form-actions"><button type="submit" class="btn btn--ghost">' + icon("plus") + "Ajouter la plateforme</button></div></form>" : "") +
      "</div></section>";
  }

  function wireAutres(body, reload) {
    var form = $("[data-add-canal]", body);
    if (form) form.addEventListener("submit", function (e) {
      e.preventDefault();
      var v = BO.values(form);
      BO.api("admin/diffusion/canal", { body: v }).then(function () { BO.toast("Plateforme « " + v.nom + " » ajoutée"); reload(); }).catch(BO.fail);
    });
    $$("[data-toggle-canal]", body).forEach(function (b) {
      b.addEventListener("click", function () {
        BO.api("admin/diffusion/canal", { body: { id: +b.getAttribute("data-toggle-canal"), nom: b.getAttribute("data-nom"), urlDepot: b.getAttribute("data-url"), actif: b.getAttribute("data-actif") !== "1" } })
          .then(reload).catch(BO.fail);
      });
    });
  }

  /* ---------------------------------------------------------------- historique */
  function historiquePage(body, q) {
    var st = { canal: q.canal || "", resultat: q.resultat || "", du: q.du || "", au: q.au || "" };
    return BO.api("admin/diffusion", { query: { parc: BO.parcFilter() } }).then(function (o) {
      body.innerHTML = '<div class="filterbar filterbar--start">' +
        '<select class="select select--auto" data-h="canal" aria-label="Plateforme"><option value="">Toutes les plateformes</option>' + o.canaux.map(function (c) { return '<option value="' + c.canalId + '"' + (String(c.canalId) === st.canal ? " selected" : "") + ">" + esc(c.nom) + "</option>"; }).join("") + "</select>" +
        '<select class="select select--auto" data-h="resultat" aria-label="Résultat"><option value="">Tous les résultats</option>' + Object.keys(RESULTATS).map(function (k) { return '<option value="' + k + '"' + (k === st.resultat ? " selected" : "") + ">" + RESULTATS[k][1] + "</option>"; }).join("") + "</select>" +
        '<label class="inline-field">Du <input class="input" type="date" data-h="du" value="' + esc(st.du) + '"></label><label class="inline-field">au <input class="input" type="date" data-h="au" value="' + esc(st.au) + '"></label></div>' +
        '<div data-hist><p class="loading">Chargement…</p></div>';
      function load() {
        BO.setQuery({ onglet: "historique", canal: st.canal, resultat: st.resultat, du: st.du, au: st.au });
        return BO.api("admin/diffusion/historique", { query: st }).then(function (list) {
          $("[data-hist]", body).innerHTML = list.length ? '<div class="table-wrap"><table class="table table--compact"><thead><tr><th>Date</th><th>Véhicule</th><th>Plateforme</th><th>Opération</th><th>Résultat</th><th>Détail</th><th>Par</th></tr></thead><tbody>' +
            list.map(function (h) {
              return '<tr><td class="nowrap">' + fmt.date(h.date) + " " + fmt.time(h.date) + "</td><td>" + (h.vehiculeId ? '<a href="#/vehicules/' + h.vehiculeId + '/diffusion">' + esc(h.vehicule || "—") + "</a>" : '<span class="muted">Compte</span>') + "</td>" +
                "<td>" + esc(h.canal || "—") + "</td><td>" + esc(ACTIONS[h.action] || h.action) + "</td><td>" + resultat(h.resultat) + '</td><td class="dif-msg">' + esc(h.message) + '</td><td class="nowrap">' + esc(h.acteur) + "</td></tr>";
            }).join("") + "</tbody></table></div>"
            : '<div class="card empty">' + icon("file-text") + "<p>Aucune opération pour ces critères.</p></div>";
        }).catch(BO.fail);
      }
      $$("[data-h]", body).forEach(function (el) { el.addEventListener("change", function () { st[el.getAttribute("data-h")] = el.value; load(); }); });
      return load();
    });
  }

  /* ================================================================ onglet « Diffusion » de la fiche véhicule */
  BO.diffusionTab = function (box, v) {
    var peut = BO.can("diffusion.publier"), last = {};
    function load() { return BO.api("admin/diffusion/vehicule", { query: { id: v.dbId } }).then(render); }
    function render(d) {
      last = {};
      d.canaux.forEach(function (c) { last[c.canalId] = c; });
      var enVente = ["brouillon", "disponible", "reserve"].indexOf(d.statutVehicule) !== -1;
      var aPublier = d.canaux.filter(function (c) { return enVente && ["non_publie", "retire", "refuse", "suspendu"].indexOf(c.statut) !== -1; });
      box.innerHTML =
        '<div class="filterbar"><p class="muted small grow dif-intro">La fiche du véhicule reste la référence : chaque plateforme reçoit une copie, adaptable sans modifier la fiche.</p>' +
          (peut && aPublier.length ? '<button type="button" class="btn btn--primary" data-publier>' + icon("share") + "Publier sur les plateformes</button>" : "") + "</div>" +
        '<div class="pub-grid">' + d.canaux.map(function (c) { return canalCard(c, d, peut); }).join("") + "</div>" +
        '<section class="card"><div class="card__head"><h2>' + icon("file-text") + 'Historique de diffusion</h2><a class="link small" href="#/diffusion?onglet=historique">Tout l\'historique</a></div>' +
          (d.historique.length ? '<ul class="dif-hist">' + d.historique.map(function (h) {
            return '<li><span class="dif-hist__date">' + fmt.date(h.date).slice(0, 5) + " " + fmt.time(h.date) + "</span>" + resultat(h.resultat) +
              '<span class="grow"><strong>' + esc((h.canal ? h.canal + " · " : "") + (ACTIONS[h.action] || h.action)) + "</strong><small>" + esc(h.message) + " — " + esc(h.acteur) + "</small></span></li>";
          }).join("") + "</ul>" : '<div class="empty">' + icon("file-text") + "<p>Aucune opération pour l'instant.</p></div>") + "</section>";
      wire(d);
    }

    function canalCard(c, d, peut) {
      var lignes = [];
      if (c.url) lignes.push('<a class="link" href="' + esc(c.url) + '" target="_blank" rel="noopener">' + icon("external", "i--sm") + (c.mode === "site" ? "Voir sur le site" : "Ouvrir l'annonce") + "</a>");
      if (c.reference) lignes.push("Réf. " + esc(c.reference));
      if (c.publieLe && c.statut !== "non_publie") lignes.push("Publiée le " + day(c.publieLe));
      if (c.expireLe && ["publie", "a_mettre_a_jour", "expire"].indexOf(c.statut) !== -1) lignes.push((c.statut === "expire" ? '<span class="is-warn">Expirée le ' : "Jusqu'au ") + day(c.expireLe) + (c.statut === "expire" ? "</span>" : ""));
      if (c.mode !== "site" && c.derniereSynchro) lignes.push("Synchro " + when(c.derniereSynchro));
      var prix = c.mode !== "site" && c.prixPublie != null && c.donnees && c.prixPublie !== c.donnees.prix && ["publie", "a_mettre_a_jour", "expire", "a_retirer"].indexOf(c.statut) !== -1
        ? '<p class="pub-miss">' + icon("euro", "i--sm") + "Prix publié " + fmt.euros(c.prixPublie) + " → fiche " + fmt.euros(c.donnees.prix) + "</p>" : "";
      var adapt = c.donnees && (c.donnees.titrePerso || c.donnees.descriptionPerso || c.donnees.photosPerso) ? '<span class="tag tag--offer">' + icon("edit") + "Adaptée</span>" : "";
      var actions = peut ? boutons(c, d) : [];
      return '<article class="card pub-card pub-card--' + esc(c.statut) + '" data-canal="' + c.canalId + '">' +
        '<div class="pub-card__head"><strong>' + esc(c.nom) + "</strong>" + modeTag(c) + "</div>" +
        '<div class="pub-card__state">' + pill(c.statut, c.statutLabel) + adapt + (c.tachesEnCours ? '<span class="tag tag--muted">' + icon("clock") + "Envoi en cours</span>" : "") + "</div>" +
        (lignes.length ? '<p class="pub-card__meta">' + lignes.join(" · ") + "</p>" : "") +
        (c.erreur && ["erreur", "refuse", "en_attente", "a_mettre_a_jour"].indexOf(c.statut) !== -1 ? '<p class="pub-miss pub-miss--block">' + icon("alert", "i--sm") + esc(c.erreur) + "</p>" : "") + prix +
        (c.statut === "a_retirer" && c.mode !== "auto" ? '<p class="pub-miss pub-miss--block">' + icon("alert", "i--sm") + "Véhicule vendu ou retiré : supprimez l'annonce sur " + esc(c.nom) + " puis confirmez ici.</p>" : "") +
        (c.raisonManuel && ["non_publie", "retire", "refuse"].indexOf(c.statut) !== -1 ? '<p class="pub-card__why">' + esc(c.raisonManuel) + "</p>" : "") +
        (["non_publie", "retire", "refuse"].indexOf(c.statut) !== -1 || c.statut === "a_mettre_a_jour" ? manquantsHtml(c.manquants) : "") +
        (actions.length ? '<div class="pub-card__actions">' + actions.join("") + "</div>" : "") + "</article>";
    }

    function btn(act, label, ic, primary) { return '<button type="button" class="btn ' + (primary ? "btn--primary" : "btn--ghost") + ' btn--sm" data-act="' + act + '">' + (ic ? icon(ic) : "") + label + "</button>"; }

    function boutons(c, d) {
      var enVente = ["brouillon", "disponible", "reserve"].indexOf(d.statutVehicule) !== -1, s = c.statut, out = [];
      if (c.mode === "site") {
        if (enVente && (s === "non_publie" || s === "suspendu")) out.push(btn("site-publier", "Mettre en ligne", "eye", true));
        if (s === "publie") out.push(btn("site-retirer", "Retirer du site", "x"));
        return out;
      }
      if (c.mode === "auto") {
        if (enVente && ["non_publie", "retire", "refuse"].indexOf(s) !== -1) out.push(btn("auto-publier", "Publier", "share", true));
        if (s === "erreur") out.push(btn("sync", "Réessayer", "refresh", true));
        else if (s === "a_retirer") out.push(btn("sync", "Retirer maintenant", "x", true));
        else if (["publie", "a_mettre_a_jour", "expire", "en_attente"].indexOf(s) !== -1) out.push(btn("sync", "Synchroniser", "refresh", s === "a_mettre_a_jour"));
        if (["publie", "a_mettre_a_jour", "expire"].indexOf(s) !== -1) out.push(btn("auto-retirer", "Retirer", "x"));
        if (enVente) out.push(btn("adapter", "Adapter l'annonce", "edit"));
        return out;
      }
      // Publication assistée
      if (s === "a_retirer") { out.push(btn("m-retire", "J'ai retiré l'annonce", "check", true)); return out; }
      if (!enVente) { if (["publie", "a_mettre_a_jour", "expire", "suspendu"].indexOf(s) !== -1) out.push(btn("m-retire", "Annonce retirée", "check")); return out; }
      if (["non_publie", "retire", "refuse", "en_attente"].indexOf(s) !== -1) out.push(btn("kit-publier", "Préparer et publier", "share", true));
      if (s === "a_mettre_a_jour") out.push(btn("kit-maj", "Mettre à jour l'annonce", "refresh", true));
      if (s === "expire") out.push(btn("m-renouvele", "Annonce renouvelée", "refresh", true));
      if (s === "suspendu") out.push(btn("m-reactive", "Annonce réactivée", "check", true));
      if (s === "publie") out.push(btn("kit-voir", "Kit de l'annonce", "copy"));
      out.push(btn("adapter", "Adapter l'annonce", "edit"));
      if (["publie", "a_mettre_a_jour", "expire"].indexOf(s) !== -1) out.push('<details class="pub-more"><summary class="btn btn--ghost btn--sm">Autre…</summary><div>' +
        btn("m-suspendu", "Suspendue", "") + btn("m-refuse", "Refusée par " + esc(c.nom), "") + btn("m-retire", "Retirée", "") + "</div></details>");
      return out;
    }

    function wire(d) {
      var byId = {};
      d.canaux.forEach(function (c) { byId[c.canalId] = c; });
      var pb = $("[data-publier]", box);
      if (pb) pb.addEventListener("click", function () { publierModal(d); });
      $$("[data-act]", box).forEach(function (b) {
        b.addEventListener("click", function () {
          var c = byId[+b.closest("[data-canal]").getAttribute("data-canal")], a = b.getAttribute("data-act");
          var post = function (route, body, msg) {
            b.disabled = true;
            return BO.api(route, { body: body }).then(function (r) { if (msg) BO.toast(msg); render(r.diffusion || r); }).catch(function (e) { BO.fail(e); b.disabled = false; });
          };
          if (a === "site-publier") post("admin/diffusion/publier", { vehiculeId: v.dbId, canaux: [c.canalId] }).then(function () { BO.render(); });
          else if (a === "site-retirer") BO.confirm("Retirer l'annonce du site ?", "Le véhicule passe au statut « Retiré » et n'apparaît plus sur le site. Les annonces des autres plateformes sont à retirer aussi.", "Retirer du site")
            .then(function (ok) { if (ok) post("admin/diffusion/retirer", { vehiculeId: v.dbId, canalId: c.canalId }, "Annonce retirée du site").then(function () { BO.render(); }); });
          else if (a === "auto-publier") publierAuto(c, b);
          else if (a === "sync") post("admin/diffusion/synchroniser", { vehiculeId: v.dbId, canalId: c.canalId }).then(function () { resultatToast(c.canalId); });
          else if (a === "auto-retirer") BO.confirm("Retirer l'annonce de " + c.nom + " ?", "La demande de retrait est envoyée à " + c.nom + ". L'annonce est indiquée « retirée » seulement après confirmation de la plateforme.", "Retirer")
            .then(function (ok) { if (ok) post("admin/diffusion/retirer", { vehiculeId: v.dbId, canalId: c.canalId }).then(function () { resultatToast(c.canalId); }); });
          else if (a === "adapter") adaptation(c);
          else if (a === "kit-publier" || a === "kit-maj" || a === "kit-voir") kit(c, a === "kit-maj" ? "maj" : a === "kit-voir" ? "voir" : "publier");
          else if (a === "m-retire") BO.confirm("Annonce retirée de " + c.nom + " ?", "Confirmez seulement si l'annonce a bien été supprimée sur " + c.nom + ".", "Oui, elle est retirée", false)
            .then(function (ok) { if (ok) post("admin/diffusion/manuel", { vehiculeId: v.dbId, canalId: c.canalId, action: "retire" }, "Retrait enregistré"); });
          else if (a === "m-renouvele") dateModal("Annonce renouvelée sur " + c.nom, "Nouvelle date d'expiration", function (date) { return post("admin/diffusion/manuel", { vehiculeId: v.dbId, canalId: c.canalId, action: "renouvele", expireLe: date }, "Renouvellement enregistré"); });
          else if (a === "m-reactive") post("admin/diffusion/manuel", { vehiculeId: v.dbId, canalId: c.canalId, action: "reactive" }, "Annonce réactivée");
          else if (a === "m-suspendu") BO.prompt("Annonce suspendue sur " + c.nom, "Motif (facultatif)", "").then(function (m) { if (m !== null) post("admin/diffusion/manuel", { vehiculeId: v.dbId, canalId: c.canalId, action: "suspendu", motif: m }, "Suspension enregistrée"); });
          else if (a === "m-refuse") BO.prompt("Annonce refusée par " + c.nom, "Motif indiqué par la plateforme", "ex. photo non conforme").then(function (m) {
            if (m === null) return;
            if (!m) { BO.toast("Indiquez le motif du refus.", true); return; }
            post("admin/diffusion/manuel", { vehiculeId: v.dbId, canalId: c.canalId, action: "refuse", motif: m }, "Refus enregistré");
          });
        });
      });
      function resultatToast(id) {
        var c = last[id];
        if (c) BO.toast(c.nom + " : " + c.statutLabel, c.statut === "erreur");
      }
    }

    function publierAuto(c, b) {
      b.disabled = true;
      BO.api("admin/diffusion/publier", { body: { vehiculeId: v.dbId, canaux: [c.canalId] } }).then(function (r) {
        var x = r.resultats[0];
        BO.toast(c.nom + " : " + x.message, !x.ok);
        render(r.diffusion);
      }).catch(function (e) { BO.fail(e); b.disabled = false; });
    }

    function publierModal(d) {
      var enVente = ["brouillon", "disponible", "reserve"].indexOf(d.statutVehicule) !== -1;
      var choix = d.canaux.filter(function (c) { return enVente && ["non_publie", "retire", "refuse", "suspendu"].indexOf(c.statut) !== -1; });
      BO.modal({
        title: "Publier sur les plateformes",
        body: '<p class="muted small">Le site et les plateformes connectées sont publiés tout de suite (confirmation de la plateforme attendue). Pour les plateformes en publication assistée, le kit de l\'annonce s\'ouvre ensuite.</p>' +
          '<div class="pub-choice">' + choix.map(function (c) {
            var bloq = (c.manquants || []).filter(function (m) { return m.bloquant; });
            return '<label class="pub-choice__row"><input type="checkbox" value="' + c.canalId + '"' + (bloq.length ? "" : " checked") + '><span class="grow"><strong>' + esc(c.nom) + "</strong> " + modeTag(c) +
              (bloq.length ? '<small class="is-warn">À compléter : ' + esc(bloq.map(function (m) { return m.message; }).join(", ")) + "</small>" : c.mode === "manuel" ? "<small>Vous publiez sur " + esc(c.nom) + " avec le kit préparé, puis vous enregistrez le lien.</small>" : "<small>" + (c.mode === "site" ? "Mise en ligne immédiate sur le site." : "Envoi automatique à " + esc(c.nom) + ".") + "</small>") +
              "</span>" + pill(c.statut, c.statutLabel) + "</label>";
          }).join("") + "</div>",
        actions: [{ label: "Annuler" }, {
          label: "Publier", primary: true, icon: "share", onClick: function (m) {
            var ids = $$("input:checked", m.body).map(function (i) { return +i.value; });
            if (!ids.length) { BO.toast("Choisissez au moins une plateforme.", true); return true; }
            var direct = ids.filter(function (id) { var c = choix.filter(function (x) { return x.canalId === id; })[0]; return c.mode !== "manuel"; });
            var manuels = choix.filter(function (c) { return ids.indexOf(c.canalId) !== -1 && c.mode === "manuel"; });
            var p = direct.length ? BO.api("admin/diffusion/publier", { body: { vehiculeId: v.dbId, canaux: direct } }) : Promise.resolve(null);
            return p.then(function (r) {
              if (r) render(r.diffusion);
              resultatsModal(r ? r.resultats : [], manuels, r ? r.diffusion : d);
              if (direct.some(function (id) { return choix.filter(function (x) { return x.canalId === id; })[0].mode === "site"; })) BO.refreshCounts();
            });
          },
        }],
      });
    }

    function resultatsModal(resultats, manuels, d) {
      var nom = function (id) { return (d.canaux.filter(function (c) { return c.canalId === id; })[0] || {}).nom || ""; };
      BO.modal({
        title: "Résultat de la publication",
        body: '<ul class="pub-results">' + resultats.map(function (r) {
          return '<li class="' + (r.ok ? "is-ok" : "is-ko") + '">' + icon(r.ok ? "check" : "alert") + "<span><strong>" + esc(nom(r.canalId)) + "</strong> " + esc(r.message) + "</span></li>";
        }).join("") + manuels.map(function (c) {
          return '<li class="is-todo">' + icon("clipboard") + "<span><strong>" + esc(c.nom) + "</strong> publication assistée : préparez l'annonce puis publiez-la sur " + esc(c.nom) + '.</span><button type="button" class="btn btn--primary btn--sm" data-kit="' + c.canalId + '">Ouvrir le kit</button></li>';
        }).join("") + "</ul>",
        actions: [{ label: "Fermer", primary: !manuels.length }],
        onOpen: function (m) {
          $$("[data-kit]", m.body).forEach(function (b) {
            b.addEventListener("click", function () {
              var c = d.canaux.filter(function (x) { return x.canalId === +b.getAttribute("data-kit"); })[0];
              m.close();
              if (c) kit(c, "publier");
            });
          });
        },
      });
    }

    /* ------- kit de publication assistée : copier, ouvrir la plateforme, confirmer ------- */
    function kit(c, mode) {
      var dn = c.donnees, carac = caracteristiques(dn), dom = { leboncoin: "leboncoin.fr", lacentrale: "lacentrale.fr" }[c.code] || "";
      var caracTxt = carac.map(function (x) { return x[0] + " : " + x[1]; }).join("\n");
      var step = function (n, titre, html) { return '<section class="kit-step"><h3><span class="kit-num">' + n + "</span>" + titre + "</h3>" + html + "</section>"; };
      var copyRow = function (label, value, key, multi) {
        return '<div class="kit-copy"><div class="kit-copy__head"><span>' + label + '</span><button type="button" class="btn btn--ghost btn--sm" data-copy="' + key + '">' + icon("copy") + "Copier</button></div>" +
          (multi ? '<pre class="kit-copy__text">' + esc(value) + "</pre>" : '<p class="kit-copy__text">' + esc(value) + "</p>") + "</div>";
      };
      var confirmer = mode === "maj"
        ? '<p class="muted small">Après avoir modifié l\'annonce sur ' + esc(c.nom) + " (prix " + fmt.euros(dn.prix) + ", texte, photos), confirmez :</p>"
        : mode === "voir" ? '<p class="muted small">Annonce déjà publiée' + (c.url ? ' : <a class="link" href="' + esc(c.url) + '" target="_blank" rel="noopener">ouvrir</a>' : "") + ".</p>"
          : '<form class="form-grid form-grid--2" data-kit-form>' + '<div class="span-2">' + BO.f.input("url", "Lien de l'annonce publiée", c.url, 'type="url" placeholder="https://www.' + esc(dom || "…") + '/…"', dom ? "adresse " + dom : "") + "</div>" +
            BO.f.input("reference", "Référence de l'annonce", c.reference, 'maxlength="120"', "si pas de lien") + BO.f.input("expireLe", "Date d'expiration", c.expireLe || "", 'type="date"', "si indiquée") + "</form>";
      BO.modal({
        title: (mode === "maj" ? "Mettre à jour l'annonce " : "Publier sur ") + c.nom, wide: true, noFocus: true,
        body: manquantsHtml(c.manquants) +
          step(1, "Copiez les éléments de l'annonce", copyRow("Titre", dn.titre, "titre") + copyRow("Prix", String(dn.prix), "prix") + copyRow("Description", dn.description, "description", true) + copyRow("Caractéristiques", caracTxt, "carac", true) +
            '<div class="kit-copy"><div class="kit-copy__head"><span>Photos (' + dn.photos.length + ", dans l'ordre)</span></div>" +
            (dn.photos.length ? '<div class="kit-photos">' + dn.photos.map(function (p, i) {
              var u = BO.photoUrl(p);
              return '<a href="' + esc(u) + '" target="_blank" rel="noopener" download title="Photo ' + (i + 1) + ' — ouvrir ou enregistrer"><img src="' + esc(BO.photoUrl(p, true)) + '" alt="Photo ' + (i + 1) + '" loading="lazy"><span>' + (i + 1) + "</span></a>";
            }).join("") + "</div>" : '<p class="pub-miss pub-miss--block">' + icon("alert", "i--sm") + "Aucune photo : ajoutez-en dans la fiche.</p>") + "</div>") +
          step(2, "Publiez sur " + esc(c.nom), '<p class="muted small">Connectez-vous à votre espace professionnel ' + esc(c.nom) + " et " + (mode === "maj" ? "modifiez l'annonce existante" : "créez l'annonce") + " avec ces éléments.</p>" +
            (c.urlDepot || c.url ? '<p><a class="btn btn--ghost" href="' + esc(mode === "maj" && c.url ? c.url : c.urlDepot || c.url) + '" target="_blank" rel="noopener">' + icon("external") + "Ouvrir " + esc(c.nom) + "</a></p>" : "")) +
          step(3, mode === "voir" ? "Annonce" : "Confirmez quand c'est fait", confirmer),
        actions: mode === "voir" ? [{ label: "Fermer" }] : [{ label: "Plus tard" }, {
          label: mode === "maj" ? "J'ai mis à jour l'annonce" : "J'ai publié l'annonce", primary: true, icon: "check", onClick: function (m) {
            var body = { vehiculeId: v.dbId, canalId: c.canalId, action: mode === "maj" ? "mis_a_jour" : "publie" };
            if (mode !== "maj") { var f = BO.values($("[data-kit-form]", m.body)); body.url = f.url; body.reference = f.reference; body.expireLe = f.expireLe; }
            return BO.api("admin/diffusion/manuel", { body: body }).then(function (r) { BO.toast(mode === "maj" ? "Mise à jour enregistrée" : "Publication sur " + c.nom + " enregistrée"); render(r); });
          },
        }],
        onOpen: function (m) {
          var vals = { titre: dn.titre, prix: String(dn.prix), description: dn.description, carac: caracTxt };
          m.body.addEventListener("click", function (e) { var b = e.target.closest("[data-copy]"); if (b) copier(vals[b.getAttribute("data-copy")]); });
        },
      });
    }

    /* ------- adaptation propre à une plateforme (titre, description, photos) avec aperçu ------- */
    function adaptation(c) {
      var dn = c.donnees, choix = dn.photos.map(function (p) { return p.fichier || p.url; });
      var all = dn.toutesPhotos;
      BO.modal({
        title: "Adapter l'annonce pour " + c.nom, wide: true,
        body: '<p class="muted small">Ces changements ne concernent que ' + esc(c.nom) + " : la fiche du véhicule et les autres plateformes ne sont pas modifiées.</p>" +
          '<div class="adapt"><form class="stack" data-adapt>' +
            BO.f.input("titre", "Titre", dn.titre, 'maxlength="100"', '<span data-len="titre"></span>/100') +
            BO.f.textarea("description", "Description", dn.description, 'rows="10" maxlength="8000"', '<span data-len="description"></span> caractères') +
            '<div class="row-actions row-actions--start"><button type="button" class="link" data-reset>' + icon("refresh", "i--sm") + "Revenir au texte de la fiche</button></div>" +
            '<fieldset><legend>Photos envoyées (' + all.length + ")</legend><div class=\"adapt-photos\">" + all.map(function (p, i) {
              var k = p.fichier || p.url;
              return '<label class="adapt-photo"><input type="checkbox" value="' + esc(k) + '"' + (choix.indexOf(k) !== -1 ? " checked" : "") + '><img src="' + esc(BO.photoUrl(p, true)) + '" alt="Photo ' + (i + 1) + '"><span>' + (i + 1) + "</span></label>";
            }).join("") + "</div></fieldset></form>" +
            '<aside class="adapt-preview" aria-label="Aperçu"><p class="small muted">Aperçu</p><div class="adapt-card"><div data-pv-img></div><p class="adapt-card__title" data-pv-titre></p><p class="adapt-card__price">' + fmt.euros(dn.prix) + "</p>" +
              '<p class="adapt-card__meta">' + esc([dn.annee, fmt.km(dn.km), dn.energie, dn.boite].join(" · ")) + '</p><p class="adapt-card__desc" data-pv-desc></p></div></aside></div>',
        actions: [{ label: "Annuler" }, {
          label: "Enregistrer l'adaptation", primary: true, icon: "check", onClick: function (m) {
            var f = $("[data-adapt]", m.body), val = BO.values(f);
            var photos = $$(".adapt-photo input", f).filter(function (i) { return i.checked; }).map(function (i) { return i.value; });
            if (!photos.length && all.length) { BO.toast("Gardez au moins une photo.", true); return true; }
            return BO.api("admin/diffusion/adaptation", { body: { vehiculeId: v.dbId, canalId: c.canalId, titre: val.titre, description: $("textarea", f).value, photos: photos } })
              .then(function (r) { BO.toast("Annonce adaptée pour " + c.nom); render(r); });
          },
        }],
        onOpen: function (m) {
          var f = $("[data-adapt]", m.body), t = $('[name="titre"]', f), dsc = $("textarea", f);
          function preview() {
            $('[data-len="titre"]', m.body).textContent = t.value.length;
            $('[data-len="description"]', m.body).textContent = dsc.value.length;
            $("[data-pv-titre]", m.body).textContent = t.value || dn.titreDefaut;
            $("[data-pv-desc]", m.body).textContent = (dsc.value || dn.descriptionDefaut).slice(0, 320) + ((dsc.value || dn.descriptionDefaut).length > 320 ? "…" : "");
            var first = $$(".adapt-photo input", f).filter(function (i) { return i.checked; })[0];
            $("[data-pv-img]", m.body).innerHTML = first ? '<img src="' + esc(first.nextElementSibling.getAttribute("src")) + '" alt="">' : '<div class="noimg">' + icon("camera") + "</div>";
          }
          f.addEventListener("input", preview);
          f.addEventListener("change", preview);
          $("[data-reset]", m.body).addEventListener("click", function () {
            t.value = dn.titreDefaut; dsc.value = dn.descriptionDefaut;
            $$(".adapt-photo input", f).forEach(function (i) { i.checked = true; });
            preview();
          });
          preview();
        },
      });
    }

    function dateModal(title, label, done) {
      var def = BO.isoDate(BO.addDays(new Date(), 30));
      BO.modal({
        title: title, body: '<form class="form-grid">' + BO.f.input("date", label, def, 'type="date"', "facultatif") + "</form>",
        actions: [{ label: "Annuler" }, { label: "Enregistrer", primary: true, onClick: function (m) { return done(BO.values($("form", m.body)).date); } }],
      });
    }

    return load();
  };
})();
