/* Véhicules : liste, fiche (annonce, identification, préparation, CT, documents, planning, vente & finance, historique) */
(function () {
  "use strict";
  var BO = window.BO, esc = BO.esc, icon = BO.icon, fmt = BO.fmt, $ = BO.$, $$ = BO.$$;

  var FILTERS = [
    ["stock", "En stock"], ["disponible", "En ligne"], ["reserve", "Réservés"], ["brouillon", "Brouillons"],
    ["vendus", "Vendus / livrés"], ["retire", "Retirés"], ["offres", "Avec offres"], ["preparation", "Préparation incomplète"], ["ct", "Alerte CT"], ["tous", "Tous"],
  ];

  /* ---------------------------------------------------------------- liste */
  BO.route(/^\/vehicules$/, function (view, _p, q) {
    var st = { f: q.f || "stock", q: q.q || "" };
    var acts = [];
    if (BO.can("vehicules.modifier")) acts.push('<a class="btn btn--primary" href="#/vehicules/nouveau">' + icon("plus") + "<span>Nouveau véhicule</span></a>");
    BO.actions(acts.join(""));
    var all = [];
    function query() {
      var base = { parc: BO.parcFilter() };
      if (st.f === "stock" || st.f === "offres") base.stock = "1";
      else if (["disponible", "reserve", "brouillon", "retire"].indexOf(st.f) !== -1) base.statut = st.f;
      else if (st.f === "preparation") { base.stock = "1"; base.preparation = "incomplete"; }
      else if (st.f === "ct") { base.stock = "1"; base.ct = "alerte"; }
      return base;
    }
    function load() {
      BO.setQuery(st);
      return BO.api("admin/vehicules", { query: query() }).then(function (vs) {
        if (st.f === "vendus") vs = vs.filter(function (v) { return v.statut === "vendu" || v.statut === "livre"; });
        if (st.f === "offres") vs = vs.filter(function (v) { return v.offresOuvertes > 0; });
        all = vs;
        render();
      });
    }
    function render() {
      var t = st.q.toLowerCase().replace(/[^a-z0-9]/g, "");
      var list = all.filter(function (v) { return !t || (v.numeroStock + v.immatriculation + v.marque + v.modele + v.version + v.ref).toLowerCase().replace(/[^a-z0-9]/g, "").indexOf(t) !== -1; });
      var demo = BO.isAdmin() && all.some(function (v) { return v.demo && ["brouillon", "disponible", "reserve"].indexOf(v.statut) !== -1; });
      $("[data-seg]", view).innerHTML = FILTERS.map(function (f) { return '<button type="button" data-f="' + f[0] + '" aria-pressed="' + (st.f === f[0]) + '">' + f[1] + "</button>"; }).join("");
      $("[data-demo]", view).hidden = !demo;
      $("[data-list]", view).innerHTML = list.length ? '<div class="table-wrap"><table class="table table--veh"><thead><tr><th></th><th>Véhicule</th><th>Parc</th><th>Prix</th><th>Statut</th><th>Préparation</th><th>CT</th><th>Demandes</th><th>RDV</th></tr></thead><tbody>' +
        list.map(row).join("") + "</tbody></table></div>"
        : '<div class="card empty">' + icon("car") + "<p>Aucun véhicule dans cette catégorie.</p></div>";
    }
    function row(v) {
      var statut = BO.statutVehicule(v);
      var transitions = (v.transitions || []).filter(function (s) { return ["vendu", "livre"].indexOf(s) === -1 ? BO.can("vehicules.statut") : BO.can("ventes.gerer") && false; });
      if (transitions.length && ["vendu", "livre"].indexOf(v.statut) === -1) {
        statut = '<select class="select status-select" data-statut="' + v.statut + '" data-id="' + v.dbId + '" aria-label="Statut">' +
          [v.statut].concat(transitions).map(function (s) { return '<option value="' + s + '"' + (s === v.statut ? " selected" : "") + ">" + esc(BO.label("statutsVehicule", s)) + "</option>"; }).join("") + "</select>";
      }
      var leads = (v.demandes ? '<a class="tag" href="#/demandes?vehicule=' + v.dbId + '">' + icon("inbox") + v.demandes + "</a>" : "") +
        (v.offresOuvertes ? '<a class="tag tag--offer" href="#/demandes?type=offre&vehicule=' + v.dbId + '">' + icon("hand-coins") + "max " + fmt.euros(v.meilleureOffre) + "</a>" : "");
      return '<tr><td><a href="#/vehicules/' + v.dbId + '">' + BO.thumb(v.photos[0], "row-img") + "</a></td>" +
        '<td><a class="strong" href="#/vehicules/' + v.dbId + '">' + esc(v.marque + " " + v.modele) + "</a>" + (v.demo ? ' <span class="tag tag--muted" title="Annonce d\'exemple importée">démo</span>' : "") +
          '<small class="block muted">' + esc([v.numeroStock, v.immatriculation].filter(Boolean).join(" · ")) + "</small></td>" +
        '<td class="nowrap">' + esc(v.parc || "—") + (v.emplacement ? '<small class="block muted">' + esc(v.emplacement) + "</small>" : "") + "</td>" +
        '<td class="nowrap">' + (v.prixBarre ? '<s class="muted">' + fmt.euros(v.prixBarre) + "</s> " : "") + "<strong>" + fmt.euros(v.prix) + "</strong></td>" +
        "<td>" + statut + "</td><td>" + BO.progress(v.preparation) + "</td><td>" + BO.ctBadge(v.ct) + "</td><td>" + (leads || '<span class="muted">—</span>') + "</td>" +
        '<td class="nowrap">' + (v.prochainRdv ? '<a href="#/planning?vue=jour&date=' + v.prochainRdv.slice(0, 10) + '">' + fmt.date(v.prochainRdv).slice(0, 5) + " " + fmt.time(v.prochainRdv) + "</a>" : '<span class="muted">—</span>') + "</td></tr>";
    }
    view.innerHTML = '<div class="filterbar"><div class="seg" data-seg></div>' +
      '<label class="search">' + icon("search") + '<input class="input" type="search" data-q value="' + esc(st.q) + '" placeholder="N° de stock, immatriculation, modèle" aria-label="Rechercher"></label></div>' +
      '<p class="note" data-demo hidden>' + icon("info") + 'Des annonces d\'exemple (marquées « démo ») sont encore en ligne. <button type="button" class="link" data-retirer-demo>Les retirer du site</button> quand vos vrais véhicules sont saisis.</p>' +
      '<div data-list><p class="loading">Chargement…</p></div>';
    view.addEventListener("click", function (e) {
      var f = e.target.closest("[data-f]");
      if (f) { st.f = f.getAttribute("data-f"); load().catch(BO.fail); }
      if (e.target.closest("[data-retirer-demo]")) {
        BO.confirm("Retirer les annonces d'exemple ?", "Elles disparaissent du site (statut « Retiré »). Vous pourrez les remettre en ligne une par une si besoin.", "Retirer").then(function (ok) {
          if (ok) BO.api("admin/vehicules/retirer-demo", { method: "POST" }).then(function (r) { BO.toast(BO.fmt.plural(r.retires, "annonce retirée", "annonces retirées")); load(); }).catch(BO.fail);
        });
      }
    });
    view.addEventListener("input", function (e) { if (e.target.matches("[data-q]")) { st.q = e.target.value; BO.setQuery(st); render(); } });
    view.addEventListener("change", function (e) {
      var sel = e.target.closest(".status-select");
      if (!sel) return;
      sel.disabled = true;
      BO.api("admin/vehicule/statut", { body: { id: +sel.getAttribute("data-id"), statut: sel.value } }).then(function (v) {
        BO.toast("Statut : " + v.statutLabel); load();
      }).catch(function (err) { BO.fail(err); load(); });
    });
    return load();
  }, { nav: "vehicules", title: "Véhicules", perm: "vehicules.voir" });

  /* ---------------------------------------------------------------- fiche */
  var TABS = [
    ["fiche", "Fiche & annonce", null], ["preparation", "Préparation & CT", null], ["documents", "Documents", null],
    ["planning", "Planning", "rdv.gerer"], ["finance", "Vente & finance", "finance.voir"], ["historique", "Historique", null],
  ];

  BO.route(/^\/vehicules\/nouveau$/, function (view) { return editor(view, null); }, { nav: "vehicules", title: "Nouveau véhicule", perm: "vehicules.modifier" });

  BO.route(/^\/vehicules\/(\d+)(?:\/([a-z]+))?$/, function (view, p) {
    var id = +p[0], tab = p[1] || "fiche";
    // Onglet non autorisé pour ce profil (ex. finances pour une secrétaire) : retour à la fiche
    if (!TABS.some(function (t) { return t[0] === tab && (!t[2] || BO.can(t[2])); })) tab = "fiche";
    return BO.api("admin/vehicule", { query: { id: id } }).then(function (v) {
      BO.$("[data-title]").textContent = v.marque + " " + v.modele;
      var online = v.statut === "disponible" || v.statut === "reserve";
      var acts = [];
      if (BO.can("rdv.gerer")) acts.push('<a class="btn btn--primary" href="#/planning/nouveau?vehicule=' + v.dbId + '">' + icon("calendar") + "<span>Rendez-vous</span></a>");
      if (online) acts.push('<a class="btn btn--ghost" href="' + esc(BO.siteUrl + "vehicule.html?id=" + encodeURIComponent(v.id)) + '" target="_blank" rel="noopener">' + icon("eye") + "<span>Sur le site</span></a>");
      BO.actions('<a class="btn btn--ghost" href="#/vehicules">' + icon("arrow-left") + "<span>Liste</span></a>" + acts.join(""));
      var statusSel = "";
      var trans = (v.transitions || []).filter(function (s) { return ["vendu", "livre"].indexOf(s) === -1 && ["vendu", "livre"].indexOf(v.statut) === -1 && BO.can("vehicules.statut"); });
      if (trans.length) {
        statusSel = '<select class="select status-select" data-statut="' + v.statut + '" data-vstatut aria-label="Statut commercial">' + [v.statut].concat(trans).map(function (s) { return '<option value="' + s + '"' + (s === v.statut ? " selected" : "") + ">" + esc(BO.label("statutsVehicule", s)) + "</option>"; }).join("") + "</select>";
      }
      view.innerHTML = '<div class="vhead card">' + BO.thumb(v.photos[0], "vhead-img") +
        '<div class="grow"><p class="vhead-title">' + esc(v.marque + " " + v.modele) + ' <span class="muted">' + esc(v.version) + "</span></p>" +
        '<p class="vhead-meta">' + [v.numeroStock && "N° " + esc(v.numeroStock), v.immatriculation && esc(v.immatriculation), v.annee, fmt.km(v.km), "<strong>" + fmt.euros(v.prix) + "</strong>"].filter(Boolean).join(" · ") + "</p>" +
        '<p class="vhead-tags">' + (statusSel || BO.statutVehicule(v)) + " " + BO.ctBadge(v.ct) + " " + BO.progress(v.preparation) + (v.pretVisite ? ' <span class="tag tag--ok">' + icon("check") + "Prêt</span>" : "") + "</p></div>" +
        '<div class="vhead-parc"><span class="muted">Parc</span><strong>' + esc(v.parc || "—") + "</strong>" + (v.emplacement ? "<small>" + esc(v.emplacement) + "</small>" : "") +
        (BO.can("vehicules.transferer") && ["vendu", "livre"].indexOf(v.statut) === -1 ? '<button type="button" class="btn btn--ghost btn--sm" data-transfert>' + icon("truck") + "Transférer</button>" : "") + "</div></div>" +
        '<nav class="tabs-nav">' + TABS.filter(function (t) { return !t[2] || BO.can(t[2]); }).map(function (t) {
          return '<a href="#/vehicules/' + v.dbId + "/" + t[0] + '"' + (t[0] === tab ? ' class="is-active" aria-current="page"' : "") + ">" + t[1] + "</a>";
        }).join("") + '</nav><div data-tab><p class="loading">Chargement…</p></div>';
      var vstat = $("[data-vstatut]", view);
      if (vstat) vstat.addEventListener("change", function () {
        BO.api("admin/vehicule/statut", { body: { id: v.dbId, statut: vstat.value } }).then(function (r) { BO.toast("Statut : " + r.statutLabel); BO.render(); }).catch(function (e) { BO.fail(e); BO.render(); });
      });
      var tr = $("[data-transfert]", view);
      if (tr) tr.addEventListener("click", function () { transfer(v); });
      var box = $("[data-tab]", view);
      var fn = { fiche: BO.can("vehicules.modifier") ? function () { return editor(box, v); } : function () { return readonly(box, v); }, preparation: prepTab, documents: docsTab, planning: planningTab, finance: financeTab, historique: historyTab }[tab] || prepTab;
      return fn(box, v);
    });
  }, { nav: "vehicules", title: "Véhicule", perm: "vehicules.voir" });

  function transfer(v) {
    var parcs = (BO.ref("parcs") || []).filter(function (p) { return p.actif !== false && p.id !== v.parcId; });
    if (!parcs.length) { BO.toast("Aucun autre parc disponible dans votre périmètre.", true); return; }
    BO.modal({
      title: "Transférer " + v.marque + " " + v.modele,
      body: '<form class="form-grid">' + BO.f.select("parcId", "Parc de destination", parcs.map(function (p) { return { value: p.id, label: p.nom }; }), parcs[0].id) +
        '<div class="span-3">' + BO.f.textarea("commentaire", "Commentaire", "", 'rows="2" maxlength="500"') + "</div></form>",
      actions: [{ label: "Annuler" }, {
        label: "Transférer", primary: true, icon: "truck", onClick: function (m) {
          var val = BO.values($("form", m.body));
          return BO.api("admin/vehicule/transfert", { body: { id: v.dbId, parcId: val.parcId, commentaire: val.commentaire } }).then(function (r) {
            BO.toast("Véhicule transféré");
            if (r.avertissements.length) {
              BO.modal({ title: "Rendez-vous à vérifier", body: "<p>Les rendez-vous existants sont conservés :</p><ul class=\"bullets\">" + r.avertissements.map(function (a) { return "<li>" + esc(a) + "</li>"; }).join("") + "</ul>", actions: [{ label: "Compris", primary: true }] });
            }
            BO.render();
          });
        },
      }],
    });
  }

  /* ---------------------------------------------------------------- fiche en lecture seule (secrétaire) */
  function readonly(box, v) {
    box.innerHTML = '<div class="grid-2"><section class="card"><div class="card__head"><h2>Identification</h2></div><div class="card__body"><dl class="kv">' +
      "<dt>N° de stock</dt><dd>" + esc(v.numeroStock || "—") + "</dd><dt>Immatriculation</dt><dd>" + esc(v.immatriculation || "—") + "</dd><dt>VIN</dt><dd>" + esc(v.vin || "—") + "</dd>" +
      "<dt>Mise en circulation</dt><dd>" + esc(v.miseEnCirculation || v.annee) + "</dd><dt>Kilométrage</dt><dd>" + fmt.km(v.km) + "</dd><dt>Énergie / boîte</dt><dd>" + esc(v.energie + " · " + v.boite) + "</dd>" +
      "<dt>Couleur</dt><dd>" + esc(v.couleur || "—") + "</dd><dt>Emplacement</dt><dd>" + esc(v.emplacement || "—") + "</dd></dl></div></section>" +
      '<section class="card"><div class="card__head"><h2>Annonce</h2></div><div class="card__body"><p class="price-big">' + fmt.euros(v.prix) + "</p><p>" + esc(v.description || "") + "</p>" +
      '<div class="photos">' + v.photos.map(function (ph) { return '<div class="photo"><img src="' + esc(BO.photoUrl(ph, true)) + '" alt=""></div>'; }).join("") + "</div></div></section></div>";
  }

  /* ---------------------------------------------------------------- éditeur (annonce + identification) */
  function editor(box, v) {
    var L = BO.state.refs;
    var isNew = !v;
    v = v || { statut: "brouillon", marque: "", modele: "", version: "", annee: new Date().getFullYear() - 3, miseEnCirculation: "", km: "", energie: "Essence", boite: "Manuelle", carrosserie: "Citadine",
      puissance: "", cv: "", portes: 5, places: 5, couleur: "", critair: "", premiereMain: false, quatreRoues: false, garantie: 12, prix: "", prixBarre: "", badge: "", photos: [], equipements: [], description: "",
      numeroStock: "", immatriculation: "", vin: "", emplacement: "", parcId: +BO.parcFilter() || "" };
    var photos = (v.photos || []).slice();
    var opt = function (list, cur) { return list.map(function (x) { return "<option" + (String(x) === String(cur) ? " selected" : "") + ">" + esc(x) + "</option>"; }).join(""); };
    var inp = BO.f.input;
    if (isNew) BO.actions('<a class="btn btn--ghost" href="#/vehicules">' + icon("arrow-left") + "<span>Véhicules</span></a>");

    box.innerHTML = '<form class="editor" data-editor novalidate><div class="editor__main">' +
      '<section class="card"><div class="card__head"><h2>Photos</h2><span class="muted small">La première photo sert de couverture</span></div><div class="card__body stack">' +
        '<div class="photos" data-photos></div>' +
        (BO.can("photos.gerer") ? '<label class="dropzone" data-drop>' + icon("upload") + '<span><strong>Ajouter des photos</strong> — cliquez ou glissez-déposez</span><span class="small">JPG, PNG ou WebP · recadrées au format 3:2</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden data-file></label><p class="upload-progress" data-progress hidden></p>' : "") +
      "</div></section>" +
      '<section class="card"><div class="card__head"><h2>Identification</h2></div><div class="card__body form-grid">' +
        inp("numeroStock", "N° de stock", v.numeroStock, 'maxlength="40" placeholder="automatique si vide"') + inp("immatriculation", "Immatriculation", v.immatriculation, 'maxlength="20" placeholder="AB-123-CD"') +
        inp("vin", "N° VIN", v.vin, 'maxlength="17"') +
        (isNew ? BO.f.select("parcId", "Parc *", BO.f.parcOptions("Choisir…"), v.parcId) : "") + inp("emplacement", "Emplacement", v.emplacement, 'maxlength="80" placeholder="ex. place 12"') +
      "</div></section>" +
      '<section class="card"><div class="card__head"><h2>Véhicule</h2></div><div class="card__body form-grid">' +
        inp("marque", "Marque *", v.marque, 'required maxlength="80"') + inp("modele", "Modèle *", v.modele, 'required maxlength="80"') +
        '<label class="field">Carrosserie<select class="select" name="carrosserie">' + opt(L.carrosseries, v.carrosserie) + "</select></label>" +
        '<div class="span-3">' + inp("version", "Version / finition", v.version, 'maxlength="160"') + "</div>" +
        inp("annee", "Année *", v.annee, 'type="number" min="1950" max="2100" required') + inp("miseEnCirculation", "Mise en circulation", v.miseEnCirculation, 'placeholder="MM/AAAA" maxlength="7"') +
        inp("km", "Kilométrage *", v.km, 'type="number" min="0" step="100" required') +
      "</div></section>" +
      '<section class="card"><div class="card__head"><h2>Motorisation & détails</h2></div><div class="card__body form-grid">' +
        '<label class="field">Énergie<select class="select" name="energie">' + opt(L.energies, v.energie) + "</select></label>" +
        '<label class="field">Boîte<select class="select" name="boite">' + opt(L.boites, v.boite) + "</select></label>" +
        inp("puissance", "Puissance (ch)", v.puissance, 'type="number" min="1"') + inp("cv", "Puissance fiscale (CV)", v.cv, 'type="number" min="1"') +
        inp("autonomie", "Autonomie (km, électrique)", v.autonomie, 'type="number" min="1"') +
        '<label class="field">Vignette Crit\'Air<select class="select" name="critair"><option value="">—</option>' + [0, 1, 2, 3, 4, 5].map(function (c) { return '<option value="' + c + '"' + (String(v.critair) === String(c) ? " selected" : "") + ">" + (c === 0 ? "0 (électrique)" : c) + "</option>"; }).join("") + "</select></label>" +
        inp("portes", "Portes", v.portes, 'type="number" min="1" max="9"') + inp("places", "Places", v.places, 'type="number" min="1" max="9"') + inp("couleur", "Couleur", v.couleur, 'maxlength="80"') +
        inp("garantie", "Garantie (mois)", v.garantie, 'type="number" min="0" max="120"') +
        BO.f.check("premiereMain", "Première main", v.premiereMain) + BO.f.check("quatreRoues", "4 roues motrices", v.quatreRoues) +
      "</div></section>" +
      '<section class="card"><div class="card__head"><h2>Description & équipements</h2></div><div class="card__body stack">' +
        BO.f.textarea("description", "Description", v.description, 'rows="5" maxlength="5000"') +
        BO.f.textarea("equipements", "Équipements", (v.equipements || []).join("\n"), 'rows="7"', "un par ligne") +
      "</div></section></div>" +
      '<aside class="editor__side"><section class="card"><div class="card__head"><h2>Publication</h2>' + (v.ref ? '<span class="muted small">Réf. ' + esc(v.ref) + "</span>" : "") + '</div><div class="card__body stack">' +
        (isNew ? '<div class="statut-choice">' + [["brouillon", "Brouillon"], ["disponible", "En ligne"]].map(function (s) { return '<label><input type="radio" name="statut" value="' + s[0] + '"' + (s[0] === v.statut ? " checked" : "") + "> " + s[1] + "</label>"; }).join("") + "</div>"
          : '<p class="muted small">Statut : ' + BO.statutVehicule(v) + " (modifiable en haut de la fiche ; « vendu » et « livré » passent par l'onglet Vente & finance).</p>") +
        inp("prix", "Prix TTC affiché (€) *", v.prix, 'type="number" min="1" step="10" required') +
        inp("prixBarre", "Ancien prix (€)", v.prixBarre, 'type="number" min="1" step="10"', "« prix en baisse »") +
        inp("badge", "Étiquette", v.badge, 'maxlength="60"', "ex. Coup de cœur") +
        '<button class="btn btn--primary btn--block" type="submit" data-save>' + icon("check") + "Enregistrer</button>" +
        '<p class="dirty-note" data-dirty hidden>Modifications non enregistrées</p>' +
        (!isNew && BO.can("vehicules.supprimer") ? '<button class="btn btn--ghost btn--block" type="button" data-delete>' + icon("trash") + "Supprimer</button>" : "") +
      "</div></section></aside></form>";

    var form = $("[data-editor]", box);
    var markDirty = function () { BO.state.dirty = true; $("[data-dirty]", box).hidden = false; };
    form.addEventListener("input", markDirty);
    form.addEventListener("change", markDirty);

    function renderPhotos() {
      $("[data-photos]", box).innerHTML = photos.map(function (p, i) {
        return '<div class="photo"><img src="' + esc(BO.photoUrl(p, true)) + '" alt="Photo ' + (i + 1) + '">' + (i === 0 ? '<span class="photo__cover">Couverture</span>' : "") +
          (BO.can("photos.gerer") ? '<div class="photo__tools"><button type="button" data-move="-1" data-i="' + i + '" aria-label="Avant"' + (i === 0 ? " disabled" : "") + ">" + icon("chevron-left") + '</button><button type="button" data-move="1" data-i="' + i + '" aria-label="Après"' + (i === photos.length - 1 ? " disabled" : "") + ">" + icon("chevron-right") + '</button><button type="button" data-rm="' + i + '" aria-label="Retirer">' + icon("trash") + "</button></div>" : "") + "</div>";
      }).join("") || '<p class="muted">Aucune photo.</p>';
    }
    renderPhotos();
    box.addEventListener("click", function (e) {
      var mv = e.target.closest("[data-move]"), rm = e.target.closest("[data-rm]");
      if (mv) { var i = +mv.getAttribute("data-i"), j = i + +mv.getAttribute("data-move"); var t = photos[i]; photos[i] = photos[j]; photos[j] = t; renderPhotos(); markDirty(); }
      else if (rm) { photos.splice(+rm.getAttribute("data-rm"), 1); renderPhotos(); markDirty(); }
    });
    function upload(files) {
      files = Array.prototype.filter.call(files, function (f) { return /^image\/(jpeg|png|webp)$/.test(f.type); });
      if (!files.length) return;
      var progress = $("[data-progress]", box), done = 0;
      progress.hidden = false;
      (function next() {
        if (done >= files.length) { progress.hidden = true; return; }
        progress.textContent = "Envoi de la photo " + (done + 1) + " sur " + files.length + "…";
        var fd = new FormData();
        fd.append("photo", files[done]);
        BO.api("admin/photo", { form: fd }).then(function (p) { photos.push(p); renderPhotos(); markDirty(); }).catch(BO.fail).then(function () { done++; next(); });
      })();
    }
    var drop = $("[data-drop]", box), fileInput = $("[data-file]", box);
    if (drop) {
      fileInput.addEventListener("change", function () { upload(fileInput.files); fileInput.value = ""; });
      ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("is-over"); }); });
      ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("is-over"); }); });
      drop.addEventListener("drop", function (e) { upload(e.dataTransfer.files); });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var b = BO.values(form);
      b.photos = photos;
      b.equipements = String(b.equipements || "").split("\n");
      if (!isNew) b.dbId = v.dbId;
      if (!b.marque || !b.modele || !b.prix || b.km === "" || !b.annee) { BO.toast("Renseignez la marque, le modèle, l'année, le kilométrage et le prix.", true); return; }
      if (isNew && !b.parcId) { BO.toast("Choisissez le parc du véhicule.", true); return; }
      if (b.statut === "disponible" && !photos.length && !window.confirm("Mettre en ligne une annonce sans photo ?")) return;
      var btn = $("[data-save]", box);
      btn.disabled = true;
      BO.api("admin/vehicule", { body: b }).then(function (saved) {
        BO.state.dirty = false;
        BO.toast(isNew ? "Véhicule créé" : "Fiche enregistrée");
        if (isNew) BO.go("#/vehicules/" + saved.dbId + "/preparation"); else BO.render();
      }).catch(function (err) { BO.fail(err); btn.disabled = false; });
    });
    var del = $("[data-delete]", box);
    if (del) del.addEventListener("click", function () {
      BO.confirm("Supprimer ce véhicule ?", "Possible seulement pour un brouillon sans historique. Sinon, choisissez le statut « Retiré ».", "Supprimer").then(function (ok) {
        if (ok) BO.api("admin/vehicule/supprimer", { body: { id: v.dbId } }).then(function () { BO.state.dirty = false; BO.toast("Véhicule supprimé"); BO.go("#/vehicules"); }).catch(BO.fail);
      });
    });
  }

  /* ---------------------------------------------------------------- préparation & contrôle technique */
  function prepTab(box, v) {
    return Promise.all([BO.api("admin/vehicule/checklist", { query: { id: v.dbId } }), BO.api("admin/vehicule/documents", { query: { id: v.dbId } })]).then(function (r) {
      var chk = r[0], docs = r[1], edit = BO.can("vehicules.preparer");
      var cats = {};
      chk.items.forEach(function (it) { (cats[it.categorie] = cats[it.categorie] || []).push(it); });
      var pret = chk.items.filter(function (i) { return i.code === "pret_visite"; })[0];
      var ctDocs = docs.filter(function (d) { return d.type === "controle_technique"; });
      var ct = v.ct;
      box.innerHTML = '<div class="prep-ready card ' + (v.pretVisite ? "is-ready" : "") + '">' + icon(v.pretVisite ? "check" : "clock") +
        '<div class="grow"><strong>' + (v.pretVisite ? "Prêt pour les rendez-vous" : "Pas encore prêt pour les rendez-vous") + "</strong><small>" +
        (v.pretVerifieLe ? "Dernière vérification " + BO.when(v.pretVerifieLe) : "Jamais vérifié") + (v.preparation.manquants.length ? " · Manque : " + esc(v.preparation.manquants.join(", ")) : "") + "</small></div>" +
        (edit && pret ? '<button type="button" class="btn ' + (v.pretVisite ? "btn--ghost" : "btn--primary") + '" data-pret="' + (v.pretVisite ? 0 : 1) + '" data-item="' + pret.itemId + '">' + (v.pretVisite ? "Marquer non prêt" : "Marquer prêt") + "</button>" : "") + "</div>" +
        '<div class="grid-2 grid-2--wide">' +
        '<div class="stack">' + Object.keys(cats).map(function (c) {
          var items = cats[c];
          return '<section class="card' + (items[0].concerne ? "" : " is-dim") + '"><div class="card__head"><h2>' + esc(chk.categories[c]) + "</h2>" + (items[0].concerne ? "" : '<span class="muted small">concerne les véhicules vendus</span>') + "</div>" +
            '<ul class="check-list">' + items.map(function (it) {
              return '<li class="chk chk--' + it.statut + '" data-itemrow="' + it.itemId + '"><div class="chk-main"><strong>' + esc(it.libelle) + (it.obligatoire ? "" : ' <span class="muted small">(facultatif)</span>') + "</strong>" +
                '<small class="muted">' + (it.majLe ? "Mis à jour " + BO.when(it.majLe) + (it.majPar ? " par " + esc(it.majPar) : "") : "Jamais renseigné") + (it.documents ? " · " + BO.fmt.plural(it.documents, "document") : "") + "</small></div>" +
                (edit ? '<div class="chk-fields"><select class="select" name="statut">' + Object.keys(chk.statuts).map(function (k) { return '<option value="' + k + '"' + (k === it.statut ? " selected" : "") + ">" + esc(chk.statuts[k]) + "</option>"; }).join("") + "</select>" +
                  '<select class="select" name="responsableId" aria-label="Responsable">' + BO.f.userOptions("Responsable").map(function (o) { return '<option value="' + o.value + '"' + (String(o.value) === String(it.responsableId || "") ? " selected" : "") + ">" + esc(o.label) + "</option>"; }).join("") + "</select>" +
                  '<input class="input" type="date" name="echeance" value="' + esc(it.echeance || "") + '" aria-label="Échéance">' +
                  '<input class="input" name="commentaire" value="' + esc(it.commentaire) + '" placeholder="Commentaire" maxlength="500"></div>'
                  : '<div class="chk-fields">' + BO.pill("c", it.statut, chk.statuts[it.statut]) + (it.commentaire ? " <span class=\"muted\">" + esc(it.commentaire) + "</span>" : "") + "</div>") + "</li>";
            }).join("") + "</ul></section>";
        }).join("") + "</div>" +
        '<section class="card"><div class="card__head"><h2>' + icon("clipboard") + 'Contrôle technique</h2>' + BO.ctBadge(ct) + '</div><form class="card__body stack" data-ct novalidate>' +
          '<div class="form-grid form-grid--2">' + BO.f.input("date", "Date du contrôle", ct.date, 'type="date"') +
          BO.f.select("resultat", "Résultat", [{ value: "", label: "—" }].concat(Object.keys(BO.ref("ctResultats")).map(function (k) { return { value: k, label: BO.ref("ctResultats")[k] }; })), ct.resultat) +
          BO.f.input("echeance", "Échéance", ct.echeance, 'type="date"', "à saisir d'après le procès-verbal") +
          BO.f.input("centre", "Centre", ct.centre, 'maxlength="120"') +
          BO.f.input("cout", "Coût (€)", fmt.centsInput(ct.coutCentimes), 'inputmode="decimal"') +
          BO.f.select("documentId", "Procès-verbal", [{ value: "", label: ctDocs.length ? "—" : "Aucun document déposé" }].concat(ctDocs.map(function (d) { return { value: d.id, label: d.nom + " (" + fmt.date(d.date) + ")" }; })), ct.documentId || "") + "</div>" +
          BO.f.check("echeanceVerifiee", "J'ai vérifié l'échéance sur le procès-verbal (un contrôle « effectué » n'est pas forcément « valide »)", ct.echeanceVerifiee) +
          (edit ? '<div class="row-actions"><label class="btn btn--ghost btn--sm">' + icon("upload") + 'Déposer le PV<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" hidden data-ctfile></label><button class="btn btn--primary btn--sm" type="submit">' + icon("check") + "Enregistrer le CT</button></div>" : "") +
        "</form></section></div>";

      if (!edit) { $$("[data-ct] input, [data-ct] select", box).forEach(function (el) { el.disabled = true; }); return; }
      var timers = {};
      box.addEventListener("change", function (e) {
        var row = e.target.closest("[data-itemrow]");
        if (row) {
          clearTimeout(timers[row.getAttribute("data-itemrow")]);
          var send = function () {
            var b = BO.values(row);
            b.vehiculeId = v.dbId; b.itemId = +row.getAttribute("data-itemrow");
            BO.api("admin/vehicule/checklist", { body: b }).then(function () { row.className = "chk chk--" + b.statut; BO.toast("Préparation mise à jour"); }).catch(BO.fail);
          };
          if (e.target.name === "commentaire") timers[row.getAttribute("data-itemrow")] = setTimeout(send, 400); else send();
        }
        if (e.target.matches("[data-ctfile]") && e.target.files[0]) {
          var fd = new FormData();
          fd.append("fichier", e.target.files[0]); fd.append("type", "controle_technique"); fd.append("vehiculeId", v.dbId);
          BO.api("admin/document", { form: fd }).then(function (d) {
            var sel = $('[data-ct] [name="documentId"]', box);
            sel.insertAdjacentHTML("beforeend", '<option value="' + d.id + '" selected>' + esc(d.nom) + "</option>");
            sel.value = d.id;
            BO.toast("Procès-verbal déposé : pensez à enregistrer le CT");
          }).catch(BO.fail);
        }
      });
      $("[data-ct]", box).addEventListener("submit", function (e) {
        e.preventDefault();
        var b = BO.values(e.target);
        b.id = v.dbId;
        BO.api("admin/vehicule/controle-technique", { body: b }).then(function () { BO.toast("Contrôle technique enregistré"); BO.render(); }).catch(BO.fail);
      });
      var pb = $("[data-pret]", box);
      if (pb) pb.addEventListener("click", function () {
        var ok = pb.getAttribute("data-pret") === "1";
        if (ok && v.preparation.manquants.filter(function (m) { return m.indexOf("prêt") === -1; }).length && !window.confirm("Des tâches restent à faire (" + v.preparation.manquants.join(", ") + "). Marquer prêt quand même ?")) return;
        BO.api("admin/vehicule/checklist", { body: { vehiculeId: v.dbId, itemId: +pb.getAttribute("data-item"), statut: ok ? "termine" : "a_faire" } }).then(function () { BO.toast(ok ? "Véhicule prêt pour les rendez-vous" : "Véhicule marqué non prêt"); BO.render(); }).catch(BO.fail);
      });
    });
  }

  /* ---------------------------------------------------------------- documents */
  function docsTab(box, v) {
    return BO.api("admin/vehicule/documents", { query: { id: v.dbId } }).then(function (docs) {
      var types = BO.ref("documents") || {};
      var allowed = Object.keys(types).filter(function (k) { return BO.can("finance.voir") || ["facture_achat", "facture_frais", "facture_vente", "bon_commande"].indexOf(k) === -1; });
      box.innerHTML = (BO.can("documents.gerer") && !BO.demo ? '<form class="card upload-bar" data-up><div class="card__body form-grid">' +
          BO.f.select("type", "Type de document", allowed.map(function (k) { return { value: k, label: types[k] }; }), "carte_grise") +
          '<label class="field">Fichier (PDF, JPG, PNG — 10 Mo max)<input class="input" type="file" name="fichier" accept="application/pdf,image/jpeg,image/png,image/webp" required></label>' +
          '<div class="field field--end"><button class="btn btn--primary" type="submit">' + icon("upload") + "Déposer</button></div></div></form>" : "") +
        (BO.demo ? '<p class="note">' + icon("info") + "L'envoi de fichiers est désactivé dans la démonstration.</p>" : "") +
        '<p class="note">' + icon("lock") + "Documents stockés hors du site public, accessibles uniquement aux personnes autorisées.</p>" +
        (docs.length ? '<div class="table-wrap"><table class="table"><thead><tr><th>Type</th><th>Fichier</th><th>Ajouté</th><th></th></tr></thead><tbody>' + docs.map(function (d) {
          return "<tr><td>" + esc(d.typeLabel) + "</td><td>" + esc(d.nom) + ' <span class="muted small">(' + Math.round(d.taille / 1024) + " Ko)</span></td><td>" + fmt.date(d.date) + (d.auteur ? " · " + esc(d.auteur) : "") + "</td>" +
            '<td class="nowrap"><button type="button" class="icon-btn" data-dl="' + d.id + '" aria-label="Télécharger">' + icon("upload", "rot180") + "</button>" +
            (BO.can("documents.gerer") ? '<button type="button" class="icon-btn icon-btn--danger" data-rm="' + d.id + '" aria-label="Retirer">' + icon("trash") + "</button>" : "") + "</td></tr>";
        }).join("") + "</tbody></table></div>" : '<div class="card empty">' + icon("file-text") + "<p>Aucun document pour ce véhicule.</p></div>");
      var up = $("[data-up]", box);
      if (up) up.addEventListener("submit", function (e) {
        e.preventDefault();
        var file = up.fichier.files[0];
        if (!file) { BO.toast("Choisissez un fichier.", true); return; }
        var fd = new FormData();
        fd.append("fichier", file); fd.append("type", up.type.value); fd.append("vehiculeId", v.dbId);
        BO.api("admin/document", { form: fd }).then(function () { BO.toast("Document déposé"); docsTab(box, v); }).catch(BO.fail);
      });
      box.addEventListener("click", function (e) {
        var dl = e.target.closest("[data-dl]"), rm = e.target.closest("[data-rm]");
        if (dl) BO.download("admin/document/telecharger", { id: dl.getAttribute("data-dl") });
        if (rm) BO.confirm("Retirer ce document ?", "Il n'apparaîtra plus dans la fiche (l'action est tracée dans le journal).", "Retirer").then(function (ok) {
          if (ok) BO.api("admin/document/retirer", { body: { id: +rm.getAttribute("data-rm") } }).then(function () { BO.toast("Document retiré"); docsTab(box, v); }).catch(BO.fail);
        });
      });
    });
  }

  /* ---------------------------------------------------------------- planning du véhicule */
  function planningTab(box, v) {
    return BO.api("admin/rendez-vous", { query: { vehicule: v.dbId, ordre: "desc" } }).then(function (list) {
      box.innerHTML = list.length ? '<section class="card"><ul class="mini-list">' + list.map(function (r) {
        return '<li class="is-click" data-rdv="' + r.id + '"><span class="mini-time">' + fmt.date(r.debut) + "<small>" + fmt.time(r.debut) + "</small></span>" +
          '<div class="grow"><strong>' + esc(r.motifLabel) + "</strong><span>" + esc(r.client || "Sans client") + (r.clientTelephone ? " · " + esc(r.clientTelephone) : "") + (r.parc ? " · " + esc(r.parc) : "") + "</span></div>" +
          BO.pill("r", r.statut, r.statutLabel) + "</li>";
      }).join("") + "</ul></section>" : '<div class="card empty">' + icon("calendar") + "<p>Aucun rendez-vous pour ce véhicule.</p></div>";
      box.addEventListener("click", function (e) { var r = e.target.closest("[data-rdv]"); if (r) BO.openRdv(+r.getAttribute("data-rdv"), function () { planningTab(box, v); }); });
    });
  }

  /* ---------------------------------------------------------------- vente & finance (propriétaire) */
  function financeTab(box, v) {
    return BO.api("admin/finance/vehicule", { query: { id: v.dbId } }).then(function (f) {
      var t = f.totaux, L = f.listes, can = BO.can("finance.gerer");
      var vente = f.ventes.filter(function (x) { return x.statut !== "annulee"; })[0];
      var card = function (label, value, small, cls) { return '<div class="kpi ' + (cls || "") + '"><span class="kpi__label">' + label + "</span><strong>" + value + "</strong><small>" + small + "</small></div>"; };
      box.innerHTML = '<div class="kpis kpis--5">' +
          card("Coût suivi", fmt.cents(t.coutSuiviCentimes), "achat " + fmt.cents(t.achatCentimes) + " + frais " + fmt.cents(t.fraisCentimes)) +
          card("Prix de vente final", fmt.cents(t.prixFinalCentimes), t.prixFinalCentimes == null ? "prix affiché " + fmt.euros(v.prix) : "") +
          card("Encaissé", fmt.cents(t.encaisseCentimes), "acomptes et paiements") +
          card("Reste à encaisser", fmt.cents(t.resteCentimes), "", t.resteCentimes > 0 ? "kpi--warn" : "") +
          card("Marge de gestion estimée", t.margeEstimeeCentimes != null ? fmt.cents(t.margeEstimeeCentimes) : fmt.cents(t.margePotentielleCentimes), t.margeEstimeeCentimes != null ? "prix final − coûts saisis" : "potentielle au prix affiché", "kpi--hot") +
        "</div><p class=\"note small\">" + icon("info") + "Suivi de gestion, pas une comptabilité : marge à valider avec le comptable (TVA, régime des véhicules d'occasion).</p>" +
        '<div class="grid-2 grid-2--wide">' +
          '<section class="card"><div class="card__head"><h2>' + (vente ? "Vente — " + esc(vente.statutLabel) : "Vente") + "</h2></div>" + venteForm(vente, L, v) + (vente ? paiements(vente, L) : "") + "</section>" +
          '<section class="card"><div class="card__head"><h2>Achat & frais</h2></div>' + ecritures(f.ecritures) + (can ? entryForm(L) : "") + "</section>" +
        "</div>" +
        (f.ventes.filter(function (x) { return x.statut === "annulee"; }).length ? '<p class="muted small">Ventes annulées : ' + f.ventes.filter(function (x) { return x.statut === "annulee"; }).map(function (x) { return esc(x.acheteur) + " (" + fmt.cents(x.prixFinalCentimes) + ")"; }).join(", ") + "</p>" : "");
      wireFinance(box, v, vente);
    });
  }

  function venteForm(vente, L, v) {
    var x = vente || { statut: "reservee", prixFinalCentimes: v.prix * 100, acheteur: "", clientId: null };
    var statuts = Object.keys(L.venteStatuts).filter(function (k) { return vente || k !== "annulee"; });
    return '<form class="card__body form-grid" data-vente novalidate>' +
      BO.f.select("statut", "Étape", statuts.map(function (k) { return { value: k, label: L.venteStatuts[k] }; }), x.statut) +
      BO.f.input("prixFinal", "Prix final TTC (€)", fmt.centsInput(x.prixFinalCentimes), 'inputmode="decimal"') +
      '<label class="field">Client<span class="client-pick"><input class="input" data-vclient-search placeholder="Rechercher un client" value="' + esc(x.clientId ? x.acheteur : "") + '"><input type="hidden" name="clientId" value="' + esc(x.clientId || "") + '"></span><span class="pick-list" data-vclients></span></label>' +
      BO.f.input("acheteur", "Ou acheteur (nom)", x.clientId ? "" : x.acheteur, 'maxlength="160"') +
      BO.f.input("dateLimiteReservation", "Réservation jusqu'au", x.dateLimiteReservation, 'type="date"') +
      BO.f.input("dateVente", "Date de vente", x.dateVente, 'type="date"') +
      BO.f.input("dateLivraison", "Date de livraison", x.dateLivraison, 'type="date"') +
      BO.f.input("reference", "Réf. facture / bon de commande", x.reference, 'maxlength="80"') +
      BO.f.input("documentsRemis", "Documents remis", x.documentsRemis, 'maxlength="500"', "à la livraison") +
      '<div class="span-3">' + BO.f.textarea("notes", "Notes", x.notes, 'rows="2" maxlength="2000"') + "</div>" +
      '<div class="span-3 row-actions"><button class="btn btn--primary btn--sm" type="submit">' + icon("check") + (vente ? "Mettre à jour la vente" : "Enregistrer la réservation / vente") + "</button></div></form>";
  }

  function paiements(vente, L) {
    return '<div class="card__sub"><h3>Paiements · encaissé ' + fmt.cents(vente.encaisseCentimes) + " · reste " + fmt.cents(vente.resteCentimes) + "</h3>" +
      (vente.paiements.length ? '<ul class="pay-list">' + vente.paiements.map(function (p) {
        return '<li class="' + (p.statut !== "valide" ? "is-cancelled" : "") + '"><span>' + fmt.date(p.date) + "</span><strong>" + (p.type === "remboursement" ? "− " : "") + fmt.cents(p.montantCentimes) + "</strong><span>" + esc(p.typeLabel) + " · " + esc(p.moyenLabel) + (p.reference ? " · " + esc(p.reference) : "") + "</span>" +
          (p.statut === "valide" ? '<button type="button" class="icon-btn icon-btn--danger" data-annuler-paiement="' + p.id + '" aria-label="Annuler ce paiement">' + icon("x") + "</button>" : '<span class="muted small">annulé</span>') + "</li>";
      }).join("") + "</ul>" : '<p class="muted small">Aucun paiement enregistré.</p>') +
      '<form class="form-grid form-grid--pay" data-paiement novalidate>' +
        BO.f.select("type", "Type", L.paiementTypes, "acompte") + BO.f.input("montant", "Montant (€)", "", 'inputmode="decimal" required') +
        BO.f.input("date", "Date", BO.isoDate(new Date()), 'type="date"') + BO.f.select("moyen", "Moyen", L.moyens, "virement") +
        BO.f.input("reference", "Référence", "", 'maxlength="80"') +
        '<div class="field field--end"><button class="btn btn--ghost btn--sm" type="submit">' + icon("plus") + "Ajouter</button></div></form></div>";
  }

  function ecritures(list) {
    if (!list.length) return '<div class="card__body"><p class="muted">Aucune écriture : saisissez le prix d\'achat et les frais (hors réparations).</p></div>';
    return '<div class="table-wrap"><table class="table table--compact"><thead><tr><th>Date</th><th>Libellé</th><th class="num">Montant</th><th></th></tr></thead><tbody>' + list.map(function (e) {
      var cancelled = !!e.annuleePar, rev = !!e.contreEcritureDe;
      return '<tr class="' + (cancelled ? "is-cancelled" : "") + (rev ? " is-reversal" : "") + '"><td>' + fmt.date(e.date) + "</td><td>" + esc(e.categorieLabel) + (e.libelle ? " — " + esc(e.libelle) : "") +
        '<small class="block muted">' + esc([e.tiers, e.reference, e.document].filter(Boolean).join(" · ")) + (cancelled ? " · annulée" : "") + "</small></td>" +
        '<td class="num">' + fmt.cents(e.montantCentimes) + "</td><td>" + (!cancelled && !rev && BO.can("finance.gerer") ? '<button type="button" class="icon-btn" data-contre="' + e.id + '" title="Corriger par contre-écriture" aria-label="Corriger">' + icon("refresh") + "</button>" : "") + "</td></tr>";
    }).join("") + "</tbody></table></div>";
  }

  function entryForm(L) {
    return '<form class="card__sub form-grid form-grid--pay" data-ecriture novalidate>' +
      BO.f.select("type", "Type", L.types, "frais") +
      BO.f.select("categorie", "Catégorie", Object.keys(L.categories).filter(function (k) { return k !== "achat"; }).map(function (k) { return { value: k, label: L.categories[k] }; }), "transport") +
      BO.f.input("libelle", "Libellé", "", 'maxlength="200"') + BO.f.input("montant", "Montant TTC (€)", "", 'inputmode="decimal" required') +
      BO.f.input("montantHt", "Montant HT (€)", "", 'inputmode="decimal"', "si pertinent") + BO.f.input("date", "Date", BO.isoDate(new Date()), 'type="date"') +
      BO.f.input("tiers", "Fournisseur / vendeur", "", 'maxlength="120"') + BO.f.input("reference", "Réf. facture", "", 'maxlength="80"') +
      BO.f.select("statutPaiement", "Paiement", { "": "—", paye: "Payé", a_payer: "À payer" }, "") +
      '<div class="field field--end"><button class="btn btn--ghost btn--sm" type="submit">' + icon("plus") + "Ajouter</button></div></form>";
  }

  function wireFinance(box, v, vente) {
    var reload = function () { financeTab(box, v); };
    var vf = $("[data-vente]", box);
    if (vf) {
      var timer;
      vf.addEventListener("input", function (e) {
        if (!e.target.matches("[data-vclient-search]")) return;
        vf.clientId.value = "";
        clearTimeout(timer);
        var q = e.target.value.trim(), out = $("[data-vclients]", vf);
        if (q.length < 2) { out.innerHTML = ""; return; }
        timer = setTimeout(function () {
          BO.api("admin/clients", { query: { q: q, limite: 6 } }).then(function (cs) {
            out.innerHTML = cs.map(function (c) { return '<button type="button" class="pick pick--sm" data-vc="' + c.id + '" data-name="' + esc(c.nomComplet) + '">' + esc(c.nomComplet) + " <small>" + esc(c.telephone) + "</small></button>"; }).join("");
          }).catch(BO.fail);
        }, 220);
      });
      vf.addEventListener("click", function (e) {
        var b = e.target.closest("[data-vc]");
        if (b) { vf.clientId.value = b.getAttribute("data-vc"); $("[data-vclient-search]", vf).value = b.getAttribute("data-name"); $("[data-vclients]", vf).innerHTML = ""; }
      });
      vf.addEventListener("submit", function (e) {
        e.preventDefault();
        var b = BO.values(vf);
        b.vehiculeId = v.dbId;
        if (vente) b.id = vente.id;
        var go = function () { BO.api("admin/vente", { body: b }).then(function () { BO.toast("Vente enregistrée"); BO.render(); }).catch(BO.fail); };
        if (b.statut === "annulee") BO.confirm("Annuler cette vente ?", "Le véhicule redevient disponible. La vente et ses paiements restent dans l'historique.", "Annuler la vente").then(function (ok) { if (ok) go(); });
        else go();
      });
    }
    var pf = $("[data-paiement]", box);
    if (pf) pf.addEventListener("submit", function (e) {
      e.preventDefault();
      var b = BO.values(pf);
      b.venteId = vente.id;
      BO.api("admin/vente/paiement", { body: b }).then(function () { BO.toast("Paiement enregistré"); reload(); }).catch(BO.fail);
    });
    var ef = $("[data-ecriture]", box);
    if (ef) {
      ef.type.addEventListener("change", function () { ef.categorie.closest(".field").hidden = ef.type.value === "achat"; });
      ef.addEventListener("submit", function (e) {
        e.preventDefault();
        var b = BO.values(ef);
        b.vehiculeId = v.dbId;
        BO.api("admin/finance/ecriture", { body: b }).then(function () { BO.toast("Écriture ajoutée"); reload(); }).catch(BO.fail);
      });
    }
    box.addEventListener("click", function (e) {
      var c = e.target.closest("[data-contre]"), ap = e.target.closest("[data-annuler-paiement]");
      if (c) BO.prompt("Corriger cette écriture", "Motif de la correction (une écriture inverse sera créée, l'originale reste visible)").then(function (m) {
        if (m) BO.api("admin/finance/contre-ecriture", { body: { id: +c.getAttribute("data-contre"), motif: m } }).then(function () { BO.toast("Contre-écriture enregistrée"); reload(); }).catch(BO.fail);
      });
      if (ap) BO.prompt("Annuler ce paiement", "Motif (le paiement reste visible, barré)").then(function (m) {
        if (m) BO.api("admin/vente/paiement/annuler", { body: { id: +ap.getAttribute("data-annuler-paiement"), motif: m } }).then(function () { BO.toast("Paiement annulé"); reload(); }).catch(BO.fail);
      });
    });
  }

  /* ---------------------------------------------------------------- historique */
  function historyTab(box, v) {
    return BO.api("admin/vehicule/historique", { query: { id: v.dbId } }).then(function (h) {
      box.innerHTML = '<div class="grid-2 grid-2--wide"><section class="card"><div class="card__head"><h2>Journal des modifications</h2></div>' +
        (h.journal.length ? '<ul class="timeline">' + h.journal.map(function (j) { return "<li><strong>" + esc(actionLabel(j.action)) + "</strong> · " + esc(j.acteur) + ' <span class="muted">' + BO.when(j.date) + "</span>" + diff(j) + "</li>"; }).join("") + "</ul>" : '<p class="card__body muted">Aucune modification enregistrée.</p>') +
        '</section><section class="card"><div class="card__head"><h2>Mouvements de parc</h2></div>' +
        (h.mouvements.length ? '<ul class="timeline">' + h.mouvements.map(function (m) { return "<li><strong>" + esc(m.de) + " → " + esc(m.vers) + "</strong> · " + esc(m.par) + ' <span class="muted">' + fmt.datetime(m.date) + "</span>" + (m.commentaire ? "<p>" + esc(m.commentaire) + "</p>" : "") + "</li>"; }).join("") + "</ul>" : '<p class="card__body muted">Aucun transfert.</p>') +
        "</section></div>";
    });
  }
  function diff(j) {
    if (!j.apres || typeof j.apres !== "object") return "";
    var keys = Object.keys(j.apres).slice(0, 6);
    return '<p class="diff">' + keys.map(function (k) { var a = j.avant && j.avant[k] !== undefined ? j.avant[k] : "—"; return "<span>" + esc(k) + " : " + esc(a) + " → " + esc(j.apres[k]) + "</span>"; }).join("") + "</p>";
  }
  function actionLabel(a) {
    return ({ "vehicule.creer": "Création", "vehicule.modifier": "Fiche modifiée", "vehicule.statut": "Statut changé", "vehicule.transferer": "Transfert de parc", "vehicule.controle_technique": "Contrôle technique", "vehicule.pret": "Prêt pour les rendez-vous",
      "document.ajouter": "Document ajouté", "document.retirer": "Document retiré", "finance.ecriture": "Écriture ajoutée", "finance.contre_ecriture": "Contre-écriture", "vente.creer": "Vente créée", "vente.modifier": "Vente modifiée", "vente.paiement": "Paiement", "vente.paiement_annule": "Paiement annulé" })[a]
      || (a.indexOf("preparation.") === 0 ? "Préparation" : a);
  }
  BO.auditLabel = actionLabel;
})();
