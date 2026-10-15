/* Back-office Livradois Automobiles — application du dashboard */
(function () {
  "use strict";

  // Adresse de l'API (OVH), partagée avec le site dans js/config.js
  var API_BASE = ((window.LA_CONFIG || {}).api || "").replace(/\/+$/, "");
  var API = API_BASE + "?r=";
  var TOKEN_KEY = "la_admin_token";
  var store = {
    get: function () { try { return sessionStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; } },
    set: function (t) { try { if (t) sessionStorage.setItem(TOKEN_KEY, t); else sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* stockage indisponible */ } },
  };
  var S = { user: null, token: store.get(), siteUrl: new URL("../", location.href).href, listes: {}, vehicules: [], dirty: false };

  var STATUTS = { disponible: "En ligne", reserve: "Réservé", brouillon: "Brouillon", vendu: "Vendu" };
  var DSTATUTS = { nouvelle: "Nouvelle", en_cours: "En cours", acceptee: "Acceptée", refusee: "Refusée", traitee: "Traitée" };

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  };
  var icon = function (n, c) { return '<svg class="i' + (c ? " " + c : "") + '" aria-hidden="true"><use href="assets/icons.svg#' + n + '"/></svg>'; };
  var nf = new Intl.NumberFormat("fr-FR");
  var price = function (n) { return n == null ? "—" : nf.format(n) + " €"; };
  var km = function (n) { return nf.format(n) + " km"; };
  var plural = function (n, s, p) { return n + " " + (n > 1 ? (p || s + "s") : s); };

  function parseDate(s) { return s ? new Date(String(s).replace(" ", "T")) : null; }
  function when(s) {
    var d = parseDate(s);
    if (!d || isNaN(d)) return "";
    var diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return "à l'instant";
    if (diff < 3600) return "il y a " + Math.floor(diff / 60) + " min";
    if (diff < 86400) return "il y a " + Math.floor(diff / 3600) + " h";
    if (diff < 86400 * 7) return "il y a " + plural(Math.floor(diff / 86400), "jour");
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
  }

  function photoUrl(p, small) {
    if (!p) return "";
    if (p.url) return small && p.urlSmall ? p.urlSmall : p.url;
    if (p.fichier) return S.siteUrl + "public/assets/vehicules/" + p.fichier + (small ? "-sm" : "") + ".webp";
    return "";
  }
  function thumb(p, cls) {
    var u = photoUrl(p, true);
    return u ? '<img class="' + cls + '" src="' + esc(u) + '" alt="" loading="lazy">' : '<div class="' + cls + '" style="display:grid;place-items:center;color:var(--sand)">' + icon("car") + "</div>";
  }
  var publicUrl = function (v) { return S.siteUrl + "vehicule.html?id=" + encodeURIComponent(v.id || v.slug); };

  /* ---------- API ---------- */
  function api(route, opts) {
    opts = opts || {};
    var method = opts.method || (opts.body || opts.form ? "POST" : "GET");
    var init = { method: method, credentials: "omit", cache: "no-store", headers: {} };
    if (S.token) init.headers["X-LA-Token"] = S.token;
    if (opts.body) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(opts.body); }
    if (opts.form) init.body = opts.form;
    var url = API + route + (opts.query ? "&" + new URLSearchParams(opts.query).toString() : "");
    return fetch(url, init).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        if (res.status === 401 && route !== "auth/login") {
          S.token = ""; store.set("");
          S.dirty = false;
          showLogin("Votre session a expiré, reconnectez-vous.");
          throw new Error("Session expirée.");
        }
        if (!res.ok) throw new Error((data && data.error) || "Erreur " + res.status);
        return data;
      });
    });
  }

  /* ---------- Interface commune ---------- */
  var toastTimer;
  function toast(msg, error) {
    var t = $("#toast");
    t.textContent = msg;
    t.classList.toggle("is-error", !!error);
    t.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("is-visible"); }, 3000);
  }
  var fail = function (e) { if (e.message !== "Session expirée.") toast(e.message, true); };

  function confirmBox(title, text, okLabel) {
    var d = $("#confirm");
    $("[data-confirm-title]", d).textContent = title;
    $("[data-confirm-text]", d).textContent = text;
    $('button[value="ok"]', d).textContent = okLabel || "Supprimer";
    d.showModal();
    return new Promise(function (resolve) {
      d.addEventListener("close", function h() { d.removeEventListener("close", h); resolve(d.returnValue === "ok"); });
    });
  }

  function setCounts(stats) {
    $("[data-count-demandes]").textContent = stats.demandesNouvelles || "";
    $("[data-count-annonces]").textContent = (stats.enLigne + stats.reserves) || "";
  }
  function refreshCounts() { api("admin/stats").then(setCounts).catch(function () {}); }

  function showLogin(msg) {
    S.user = null;
    $("#app").hidden = true;
    $("#login").hidden = false;
    var err = $("#login-error");
    err.hidden = !msg;
    err.textContent = msg || "";
    $('#login-form [name="password"]').value = "";
  }
  function showApp() {
    $("#login").hidden = true;
    $("#app").hidden = false;
    $("[data-user]").textContent = (S.user.name ? S.user.name + " · " : "") + S.user.email;
    $("[data-site-link]").href = S.siteUrl || "#";
    refreshCounts();
    router();
  }

  /* ---------- Routeur ---------- */
  var routes = [
    [/^\/?$/, viewDashboard, "dashboard", "Tableau de bord"],
    [/^\/annonces$/, viewAnnonces, "annonces", "Annonces"],
    [/^\/annonces\/nouvelle$/, viewEditor, "annonces", "Nouvelle annonce"],
    [/^\/annonces\/(\d+)$/, viewEditor, "annonces", "Modifier l'annonce"],
    [/^\/demandes$/, viewDemandes, "demandes", "Demandes & offres"],
    [/^\/compte$/, viewCompte, "compte", "Mon compte"],
  ];
  var lastHash = location.hash, skipNext = false;

  function router() {
    if (!S.user) return;
    if (skipNext) { skipNext = false; return; }
    if (S.dirty && location.hash !== lastHash) {
      if (!window.confirm("Des modifications ne sont pas enregistrées. Quitter quand même ?")) {
        skipNext = true;
        location.hash = lastHash;
        return;
      }
      S.dirty = false;
    }
    lastHash = location.hash;
    var full = location.hash.slice(1) || "/";
    var path = full.split("?")[0], query = Object.fromEntries(new URLSearchParams(full.split("?")[1] || ""));
    var r = routes.filter(function (x) { return x[0].test(path); })[0] || routes[0];
    var m = path.match(r[0]) || [];
    $$("[data-nav]").forEach(function (a) { a.classList.toggle("is-active", a.getAttribute("data-nav") === r[2]); });
    $("[data-title]").textContent = r[3];
    document.title = r[3] + " – Back-office Livradois Automobiles";
    $("[data-actions]").innerHTML = "";
    $("#side").classList.remove("is-open");
    // Conteneur neuf à chaque vue : aucun écouteur ne survit d'une page à l'autre
    var old = $("#view"), view = old.cloneNode(false);
    old.replaceWith(view);
    view.innerHTML = '<p class="loading">Chargement…</p>';
    Promise.resolve(r[1](view, m[1] ? Number(m[1]) : null, query)).catch(function (e) {
      fail(e);
      view.innerHTML = '<div class="empty">' + icon("info") + "<p>" + esc(e.message) + "</p></div>";
    });
    view.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", router);
  window.addEventListener("beforeunload", function (e) { if (S.dirty) { e.preventDefault(); e.returnValue = ""; } });

  function actions(html) { $("[data-actions]").innerHTML = html; }
  var newBtn = '<a class="btn btn--primary" href="#/annonces/nouvelle">' + icon("plus") + "<span>Nouvelle annonce</span></a>";

  /* ---------- Tableau de bord ---------- */
  function viewDashboard(view) {
    actions(newBtn);
    return Promise.all([api("admin/stats"), api("admin/vehicules"), api("admin/demandes")]).then(function (r) {
      var st = r[0], vs = r[1], ds = r[2];
      setCounts(st);
      S.vehicules = vs;
      var kpi = function (href, ic, label, value, small, hot) {
        return '<a class="kpi' + (hot ? " kpi--hot" : "") + '" href="' + href + '"><span class="kpi__label">' + icon(ic) + label + "</span><strong>" + value + "</strong><small>" + small + "</small></a>";
      };
      var withOffers = vs.filter(function (v) { return v.offresOuvertes > 0; }).sort(function (a, b) { return (b.meilleureOffre || 0) - (a.meilleureOffre || 0); });
      var popular = vs.filter(function (v) { return v.demandes > 0; }).sort(function (a, b) { return b.demandes - a.demandes; }).slice(0, 5);
      var listV = withOffers.length ? withOffers : popular;

      view.innerHTML =
        '<div class="kpis">' +
          kpi("#/demandes?statut=nouvelle", "inbox", "Nouvelles demandes", st.demandesNouvelles, plural(st.demandes30j, "demande") + " sur 30 jours", st.demandesNouvelles > 0) +
          kpi("#/demandes?type=offre", "hand-coins", "Offres en attente", st.offresOuvertes, "sur " + plural(st.annoncesAvecOffres, "annonce")) +
          kpi("#/annonces?statut=disponible", "eye", "Annonces en ligne", st.enLigne, plural(st.reserves, "réservée", "réservées")) +
          kpi("#/annonces?statut=brouillon", "edit", "Brouillons", st.brouillons, "non visibles sur le site") +
          kpi("#/annonces?statut=vendu", "check", "Vendus", st.vendus, "archivés") +
          kpi("#/annonces", "euro", "Valeur du stock", price(st.valeurStock), "annonces en ligne et réservées") +
        "</div>" +
        '<div class="grid-2">' +
          '<section class="card"><div class="card__head"><h2>Dernières demandes</h2><a class="btn btn--ghost btn--sm" href="#/demandes">Tout voir</a></div>' +
            (ds.length ? '<ul class="mini-list">' + ds.slice(0, 6).map(function (d) {
              return "<li>" + (d.vehicule ? thumb(d.vehicule.photo, "") : '<span class="vchip">' + icon("message") + "</span>") +
                '<div class="grow"><strong>' + esc(d.nom) + " · " + esc((S.listes.types || {})[d.type] || d.type) + (d.montant ? " · " + price(d.montant) : "") + "</strong>" +
                "<span>" + esc(d.vehicule ? d.vehicule.titre : d.vehiculeTitre || "Demande générale") + " · " + when(d.createdAt) + "</span></div>" +
                '<span class="pill pill--' + d.statut + '">' + DSTATUTS[d.statut] + "</span></li>";
            }).join("") + "</ul>" : '<div class="empty">' + icon("inbox") + "<p>Aucune demande pour le moment.</p></div>") +
          "</section>" +
          '<section class="card"><div class="card__head"><h2>' + (withOffers.length ? "Annonces avec offres" : "Annonces les plus demandées") + "</h2></div>" +
            (listV.length ? '<ul class="mini-list">' + listV.map(function (v) {
              return "<li>" + thumb(v.photos[0], "") + '<div class="grow"><strong><a href="#/annonces/' + v.dbId + '">' + esc(v.marque + " " + v.modele) + "</a></strong><span>" + price(v.prix) + " · " + plural(v.demandes, "demande") + "</span></div>" +
                (v.offresOuvertes ? '<a class="tag tag--offer" href="#/demandes?type=offre&vehicule=' + v.dbId + '">' + icon("hand-coins") + "max " + price(v.meilleureOffre) + "</a>" : "") + "</li>";
            }).join("") + "</ul>" : '<div class="empty">' + icon("hand-coins") + "<p>Les offres reçues sur vos annonces apparaîtront ici.</p></div>") +
          "</section>" +
        "</div>";
    });
  }

  /* ---------- Annonces ---------- */
  function viewAnnonces(view, _id, query) {
    actions(newBtn);
    var state = { f: query.statut || query.f || "tous", q: "" };
    return api("admin/vehicules").then(function (vs) {
      S.vehicules = vs;
      view.innerHTML =
        '<div class="filterbar"><div class="seg" data-seg></div>' +
        '<label class="search">' + icon("search") + '<input class="input" type="search" placeholder="Rechercher (marque, modèle, réf.)" data-q aria-label="Rechercher une annonce"></label></div>' +
        '<div class="vlist" data-list></div>';

      var filters = [["tous", "Toutes"], ["disponible", "En ligne"], ["reserve", "Réservées"], ["brouillon", "Brouillons"], ["vendu", "Vendues"], ["offres", "Avec offres"]];
      var match = function (v, f) { return f === "tous" ? v.statut !== "vendu" || state.f === "tous" : f === "offres" ? v.offresOuvertes > 0 : v.statut === f; };

      function render() {
        $("[data-seg]", view).innerHTML = filters.map(function (f) {
          var n = S.vehicules.filter(function (v) { return f[0] === "tous" ? true : match(v, f[0]); }).length;
          return '<button type="button" data-f="' + f[0] + '" aria-pressed="' + (state.f === f[0]) + '">' + f[1] + " <span>" + n + "</span></button>";
        }).join("");
        var q = state.q.toLowerCase();
        var list = S.vehicules.filter(function (v) {
          return (state.f === "tous" || match(v, state.f)) && (!q || (v.marque + " " + v.modele + " " + v.version + " " + v.ref).toLowerCase().indexOf(q) !== -1);
        });
        $("[data-list]", view).innerHTML = list.length ? list.map(row).join("") :
          '<div class="card empty">' + icon("car") + "<p>Aucune annonce dans cette catégorie.</p>" +
          '<p style="margin-top:14px"><a class="btn btn--primary" href="#/annonces/nouvelle">' + icon("plus") + "Créer une annonce</a></p></div>";
      }

      function row(v) {
        var online = v.statut === "disponible" || v.statut === "reserve";
        var leads = v.demandes
          ? '<a class="tag" href="#/demandes?vehicule=' + v.dbId + '">' + icon("inbox") + plural(v.demandes, "demande") + (v.nouvelles ? " · " + v.nouvelles + " nouv." : "") + "</a>" +
            (v.offres ? '<a class="tag tag--offer" href="#/demandes?type=offre&vehicule=' + v.dbId + '">' + icon("hand-coins") + plural(v.offres, "offre") + " · max " + price(v.meilleureOffre) + "</a>" : "")
          : '<span class="muted" style="font-size:13px">Aucune demande</span>';
        return '<article class="vrow">' +
          '<a href="#/annonces/' + v.dbId + '">' + thumb(v.photos[0], "vrow__img") + "</a>" +
          '<div style="min-width:0"><p class="vrow__title"><a href="#/annonces/' + v.dbId + '">' + esc(v.marque + " " + v.modele) + '</a></p><p class="vrow__sub">' + esc(v.version) + " · Réf. " + esc(v.ref) + "</p></div>" +
          '<div class="vrow__price">' + (v.prixBarre ? "<s>" + price(v.prixBarre) + "</s>" : "") + "<strong>" + price(v.prix) + "</strong></div>" +
          '<div class="vrow__meta"><span style="font-weight:600">' + v.annee + " · " + km(v.km) + '</span><br><small class="muted">Modifiée ' + when(v.updatedAt) + "</small></div>" +
          '<div class="vrow__leads">' + leads + "</div>" +
          '<div class="vrow__actions">' +
            '<select class="select status-select" data-statut="' + v.statut + '" data-id="' + v.dbId + '" aria-label="Statut de l\'annonce">' +
              Object.keys(STATUTS).map(function (k) { return '<option value="' + k + '"' + (k === v.statut ? " selected" : "") + ">" + STATUTS[k] + "</option>"; }).join("") +
            "</select>" +
            '<a class="icon-btn" href="#/annonces/' + v.dbId + '" title="Modifier" aria-label="Modifier">' + icon("edit") + "</a>" +
            (online ? '<a class="icon-btn" href="' + esc(publicUrl(v)) + '" target="_blank" rel="noopener" title="Voir sur le site" aria-label="Voir sur le site">' + icon("eye") + "</a>" : "") +
            '<button class="icon-btn icon-btn--danger" type="button" data-del="' + v.dbId + '" title="Supprimer" aria-label="Supprimer">' + icon("trash") + "</button>" +
          "</div></article>";
      }

      view.addEventListener("click", function (e) {
        var f = e.target.closest("[data-f]");
        if (f) { state.f = f.getAttribute("data-f"); render(); return; }
        var del = e.target.closest("[data-del]");
        if (del) {
          var id = Number(del.getAttribute("data-del"));
          var v = S.vehicules.filter(function (x) { return x.dbId === id; })[0];
          confirmBox("Supprimer l'annonce ?", v.marque + " " + v.modele + " sera définitivement supprimée, ainsi que ses photos. Les demandes reçues sont conservées.").then(function (ok) {
            if (!ok) return;
            api("admin/vehicule/supprimer", { body: { id: id } }).then(function () {
              S.vehicules = S.vehicules.filter(function (x) { return x.dbId !== id; });
              render(); refreshCounts(); toast("Annonce supprimée");
            }).catch(fail);
          });
        }
      });
      view.addEventListener("change", function (e) {
        var sel = e.target.closest(".status-select");
        if (!sel) return;
        var id = Number(sel.getAttribute("data-id"));
        sel.disabled = true;
        api("admin/vehicule/statut", { body: { id: id, statut: sel.value } }).then(function (updated) {
          S.vehicules = S.vehicules.map(function (x) { return x.dbId === id ? Object.assign(x, { statut: updated.statut, updatedAt: new Date().toISOString() }) : x; });
          render(); refreshCounts();
          toast(updated.statut === "disponible" ? "Annonce mise en ligne" : "Statut : " + STATUTS[updated.statut]);
        }).catch(function (err) { fail(err); render(); });
      });
      $("[data-q]", view).addEventListener("input", function (e) { state.q = e.target.value.trim(); render(); });
      render();
    });
  }

  /* ---------- Éditeur d'annonce ---------- */
  function viewEditor(view, id) {
    var load = id ? api("admin/vehicule", { query: { id: id } }) : Promise.resolve({
      statut: "brouillon", marque: "", modele: "", version: "", annee: new Date().getFullYear() - 3, miseEnCirculation: "", km: "",
      energie: "Essence", boite: "Manuelle", carrosserie: "Citadine", puissance: "", cv: "", portes: 5, places: 5, couleur: "",
      critair: "", premiereMain: false, quatreRoues: false, garantie: 12, prix: "", prixBarre: "", badge: "", photos: [], equipements: [], description: "",
    });
    return load.then(function (v) {
      var L = S.listes;
      var photos = (v.photos || []).slice();
      var opt = function (list, cur) { return list.map(function (x) { return '<option' + (String(x) === String(cur) ? " selected" : "") + ">" + esc(x) + "</option>"; }).join(""); };
      var inp = function (name, label, val, attrs) { return '<label class="field">' + label + '<input class="input" name="' + name + '" value="' + esc(val == null ? "" : val) + '" ' + (attrs || "") + "></label>"; };
      var online = v.statut === "disponible" || v.statut === "reserve";

      actions('<a class="btn btn--ghost" href="#/annonces">' + icon("arrow-left") + "<span>Annonces</span></a>" +
        (id && online ? '<a class="btn btn--ghost" href="' + esc(publicUrl(v)) + '" target="_blank" rel="noopener">' + icon("eye") + "<span>Voir sur le site</span></a>" : ""));

      view.innerHTML =
        '<form class="editor" data-editor novalidate>' +
          '<div class="editor__main">' +
            '<section class="card"><div class="card__head"><h2>Photos</h2><span class="muted" style="font-size:13px">La première photo sert de couverture</span></div><div class="card__body" style="display:grid;gap:14px">' +
              '<div class="photos" data-photos></div>' +
              '<label class="dropzone" data-drop>' + icon("upload") + "<span><strong>Ajouter des photos</strong> — cliquez ou glissez-déposez</span><span style=\"font-size:12.5px\">JPG, PNG ou WebP · recadrées automatiquement au format 3:2</span>" +
                '<input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden data-file></label>' +
              '<p class="upload-progress" data-progress hidden></p>' +
            "</div></section>" +

            '<section class="card"><div class="card__head"><h2>Véhicule</h2></div><div class="card__body form-grid">' +
              inp("marque", "Marque *", v.marque, 'required maxlength="80" list="dl-marques"') +
              inp("modele", "Modèle *", v.modele, 'required maxlength="80"') +
              '<label class="field">Carrosserie<select class="select" name="carrosserie">' + opt(L.carrosseries || [], v.carrosserie) + "</select></label>" +
              '<div class="span-3">' + inp("version", "Version / finition", v.version, 'maxlength="160" placeholder="ex. 1.2 PureTech 130 EAT8 GT"') + "</div>" +
              inp("annee", "Année *", v.annee, 'type="number" min="1950" max="2100" required') +
              inp("miseEnCirculation", "Mise en circulation", v.miseEnCirculation, 'placeholder="MM/AAAA" maxlength="7"') +
              inp("km", "Kilométrage *", v.km, 'type="number" min="0" step="100" required') +
            "</div></section>" +

            '<section class="card"><div class="card__head"><h2>Motorisation & détails</h2></div><div class="card__body form-grid">' +
              '<label class="field">Énergie<select class="select" name="energie">' + opt(L.energies || [], v.energie) + "</select></label>" +
              '<label class="field">Boîte de vitesses<select class="select" name="boite">' + opt(L.boites || [], v.boite) + "</select></label>" +
              inp("puissance", "Puissance (ch)", v.puissance, 'type="number" min="1"') +
              inp("cv", "Puissance fiscale (CV)", v.cv, 'type="number" min="1"') +
              inp("autonomie", "Autonomie (km, électrique)", v.autonomie, 'type="number" min="1"') +
              '<label class="field">Vignette Crit\'Air<select class="select" name="critair"><option value="">—</option>' + [0, 1, 2, 3, 4, 5].map(function (c) { return '<option value="' + c + '"' + (String(v.critair) === String(c) ? " selected" : "") + ">" + (c === 0 ? "0 (électrique)" : c) + "</option>"; }).join("") + "</select></label>" +
              inp("portes", "Portes", v.portes, 'type="number" min="1" max="9"') +
              inp("places", "Places", v.places, 'type="number" min="1" max="9"') +
              inp("couleur", "Couleur", v.couleur, 'maxlength="80"') +
              inp("garantie", "Garantie (mois)", v.garantie, 'type="number" min="0" max="120"') +
              '<label class="check" style="align-self:end;min-height:42px"><input type="checkbox" name="premiereMain"' + (v.premiereMain ? " checked" : "") + "> Première main</label>" +
              '<label class="check" style="align-self:end;min-height:42px"><input type="checkbox" name="quatreRoues"' + (v.quatreRoues ? " checked" : "") + "> 4 roues motrices</label>" +
            "</div></section>" +

            '<section class="card"><div class="card__head"><h2>Description & équipements</h2></div><div class="card__body" style="display:grid;gap:14px">' +
              '<label class="field">Description<textarea class="textarea" name="description" maxlength="5000" placeholder="État, entretien, points forts…">' + esc(v.description) + "</textarea></label>" +
              '<label class="field">Équipements <small>un par ligne</small><textarea class="textarea" name="equipements" rows="8" placeholder="Climatisation automatique&#10;Caméra de recul&#10;GPS">' + esc((v.equipements || []).join("\n")) + "</textarea></label>" +
            "</div></section>" +
          "</div>" +

          '<aside class="editor__side">' +
            '<section class="card"><div class="card__head"><h2>Publication</h2>' + (v.ref ? '<span class="muted" style="font-size:13px">Réf. ' + esc(v.ref) + "</span>" : "") + '</div><div class="card__body" style="display:grid;gap:14px">' +
              '<div class="statut-choice">' + Object.keys(STATUTS).map(function (k) {
                return '<label><input type="radio" name="statut" value="' + k + '"' + (k === v.statut ? " checked" : "") + "> " + STATUTS[k] + "</label>";
              }).join("") + "</div>" +
              '<p class="muted" style="font-size:12.5px">« En ligne » et « Réservé » sont visibles sur le site. « Brouillon » et « Vendu » sont masqués.</p>' +
              inp("prix", "Prix TTC (€) *", v.prix, 'type="number" min="1" step="10" required') +
              inp("prixBarre", "Ancien prix (€) <small>affiche « Prix en baisse »</small>", v.prixBarre, 'type="number" min="1" step="10"') +
              inp("badge", "Étiquette <small>ex. Coup de cœur</small>", v.badge, 'maxlength="60"') +
              '<div class="save-bar"><button class="btn btn--primary btn--block" type="submit" data-save>' + icon("check") + "Enregistrer</button>" +
              '<p class="dirty-note" data-dirty hidden>Modifications non enregistrées</p>' +
              (id ? '<button class="btn btn--ghost btn--block" type="button" data-delete>' + icon("trash") + "Supprimer l'annonce</button>" : "") + "</div>" +
            "</div></section>" +
          "</aside>" +
          '<datalist id="dl-marques">' + ["Audi", "BMW", "Citroën", "Dacia", "DS", "Fiat", "Ford", "Hyundai", "Kia", "Mercedes-Benz", "Mini", "Nissan", "Opel", "Peugeot", "Renault", "Seat", "Škoda", "Suzuki", "Tesla", "Toyota", "Volkswagen", "Volvo"].map(function (m) { return '<option value="' + m + '">'; }).join("") + "</datalist>" +
        "</form>";

      var form = $("[data-editor]", view);
      var markDirty = function () { S.dirty = true; $("[data-dirty]", view).hidden = false; };
      form.addEventListener("input", markDirty);
      form.addEventListener("change", markDirty);

      /* Photos */
      function renderPhotos() {
        $("[data-photos]", view).innerHTML = photos.map(function (p, i) {
          return '<div class="photo"><img src="' + esc(photoUrl(p, true)) + '" alt="Photo ' + (i + 1) + '">' +
            (i === 0 ? '<span class="photo__cover">Couverture</span>' : "") +
            '<div class="photo__tools">' +
              '<button type="button" data-move="-1" data-i="' + i + '" aria-label="Déplacer avant"' + (i === 0 ? " disabled" : "") + ">" + icon("chevron-left") + "</button>" +
              '<button type="button" data-move="1" data-i="' + i + '" aria-label="Déplacer après"' + (i === photos.length - 1 ? " disabled" : "") + ">" + icon("chevron-right") + "</button>" +
              '<button type="button" data-rm="' + i + '" aria-label="Retirer la photo">' + icon("trash") + "</button>" +
            "</div></div>";
        }).join("");
      }
      $("[data-photos]", view).addEventListener("click", function (e) {
        var mv = e.target.closest("[data-move]"), rm = e.target.closest("[data-rm]");
        if (mv) {
          var i = Number(mv.getAttribute("data-i")), j = i + Number(mv.getAttribute("data-move"));
          var t = photos[i]; photos[i] = photos[j]; photos[j] = t;
        } else if (rm) {
          photos.splice(Number(rm.getAttribute("data-rm")), 1);
        } else return;
        renderPhotos(); markDirty();
      });
      function upload(files) {
        files = Array.prototype.filter.call(files, function (f) { return /^image\/(jpeg|png|webp)$/.test(f.type); });
        if (!files.length) return;
        var progress = $("[data-progress]", view), done = 0;
        progress.hidden = false;
        var next = function () {
          if (done >= files.length) { progress.hidden = true; return; }
          progress.textContent = "Envoi de la photo " + (done + 1) + " sur " + files.length + "…";
          var fd = new FormData();
          fd.append("photo", files[done]);
          api("admin/photo", { form: fd }).then(function (p) { photos.push(p); renderPhotos(); markDirty(); })
            .catch(fail).then(function () { done++; next(); });
        };
        next();
      }
      var drop = $("[data-drop]", view), fileInput = $("[data-file]", view);
      fileInput.addEventListener("change", function () { upload(fileInput.files); fileInput.value = ""; });
      ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("is-over"); }); });
      ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("is-over"); }); });
      drop.addEventListener("drop", function (e) { upload(e.dataTransfer.files); });
      renderPhotos();

      /* Enregistrement */
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var fd = new FormData(form), body = { photos: photos };
        if (id) body.dbId = id;
        fd.forEach(function (val, key) { body[key] = typeof val === "string" ? val.trim() : val; });
        body.premiereMain = form.premiereMain.checked;
        body.quatreRoues = form.quatreRoues.checked;
        body.equipements = String(body.equipements || "").split("\n");
        if (!body.marque || !body.modele || !body.prix || body.km === "" || !body.annee) {
          toast("Renseignez au minimum la marque, le modèle, l'année, le kilométrage et le prix.", true);
          return;
        }
        if (body.statut === "disponible" && !photos.length && !window.confirm("Mettre en ligne une annonce sans photo ?")) return;
        var btn = $("[data-save]", view);
        btn.disabled = true;
        api("admin/vehicule", { body: body }).then(function (saved) {
          S.dirty = false;
          refreshCounts();
          toast(id ? "Annonce enregistrée" : "Annonce créée");
          if (!id) { skipNext = false; location.hash = "#/annonces/" + saved.dbId; }
          else { $("[data-dirty]", view).hidden = true; btn.disabled = false; }
        }).catch(function (err) { fail(err); btn.disabled = false; });
      });

      var delBtn = $("[data-delete]", view);
      if (delBtn) delBtn.addEventListener("click", function () {
        confirmBox("Supprimer l'annonce ?", "Cette action est définitive. Pour simplement la retirer du site, choisissez plutôt « Brouillon » ou « Vendu ».").then(function (ok) {
          if (!ok) return;
          api("admin/vehicule/supprimer", { body: { id: id } }).then(function () {
            S.dirty = false; toast("Annonce supprimée"); location.hash = "#/annonces";
          }).catch(fail);
        });
      });
    });
  }

  /* ---------- Demandes & offres ---------- */
  function viewDemandes(view, _id, query) {
    var state = { type: query.type || "", statut: query.statut || "", vehicule: query.vehicule || "" };
    var types = S.listes.types || {};
    view.innerHTML =
      '<div class="filterbar"><div class="seg" data-seg></div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap"><span data-vfilter></span><select class="select" style="width:auto" data-type aria-label="Type de demande"><option value="">Tous les types</option>' +
      Object.keys(types).map(function (k) { return '<option value="' + k + '"' + (state.type === k ? " selected" : "") + ">" + esc(types[k]) + "</option>"; }).join("") +
      "</select></div></div><div class=\"dlist\" data-list><p class=\"loading\">Chargement…</p></div>";

    function load() {
      var q = {};
      Object.keys(state).forEach(function (k) { if (state[k]) q[k] = state[k]; });
      $("[data-seg]", view).innerHTML = [["", "Toutes"]].concat(Object.keys(DSTATUTS).map(function (k) { return [k, DSTATUTS[k] + "s"]; })).map(function (s) {
        return '<button type="button" data-s="' + s[0] + '" aria-pressed="' + (state.statut === s[0]) + '">' + s[1] + "</button>";
      }).join("");
      var v = state.vehicule && S.vehicules.filter(function (x) { return String(x.dbId) === String(state.vehicule); })[0];
      $("[data-vfilter]", view).innerHTML = state.vehicule ? '<button type="button" class="btn btn--ghost btn--sm" data-clear-v>' + esc(v ? v.marque + " " + v.modele : "Annonce #" + state.vehicule) + icon("x", "i--sm") + "</button>" : "";
      return api("admin/demandes", { query: q }).then(function (list) {
        $("[data-list]", view).innerHTML = list.length ? list.map(card).join("") : '<div class="card empty">' + icon("inbox") + "<p>Aucune demande pour ces critères.</p></div>";
      });
    }

    function card(d) {
      var veh = d.vehicule;
      return '<article class="demande' + (d.statut === "nouvelle" ? " is-new" : "") + '">' +
        "<div>" +
          '<div class="demande__top"><span class="tag' + (d.type === "offre" ? " tag--offer" : "") + '">' + icon(d.type === "offre" ? "hand-coins" : "message") + esc(types[d.type] || d.type) + "</span>" +
            '<span class="demande__who">' + esc(d.nom) + '</span><span class="demande__date" title="' + esc(d.createdAt) + '">' + when(d.createdAt) + "</span></div>" +
          (d.montant ? '<p class="demande__offer">' + price(d.montant) + (veh && veh.prix ? " <small>pour " + price(veh.prix) + " affiché (" + Math.round((d.montant / veh.prix - 1) * 100) + " %)</small>" : "") + "</p>" : "") +
          '<p class="demande__contact"><a href="tel:' + esc(d.tel.replace(/[^\d+]/g, "")) + '">' + icon("phone", "i--sm") + esc(d.tel) + "</a>" +
            (d.email ? '<a href="mailto:' + esc(d.email) + '">' + icon("mail", "i--sm") + esc(d.email) + "</a>" : "") + "</p>" +
          (d.message ? '<p class="demande__msg">' + esc(d.message) + "</p>" : "") +
        "</div>" +
        '<div class="demande__side">' +
          '<select class="select" data-dstatut="' + d.id + '" aria-label="Statut de la demande">' + Object.keys(DSTATUTS).map(function (k) { return '<option value="' + k + '"' + (k === d.statut ? " selected" : "") + ">" + DSTATUTS[k] + "</option>"; }).join("") + "</select>" +
          (veh ? (veh.supprime ? '<div class="vchip">' + icon("car") + "<div><strong>" + esc(d.vehiculeTitre) + "</strong><span>Annonce supprimée</span></div></div>"
            : '<a class="vchip" href="#/annonces/' + veh.dbId + '">' + thumb(veh.photo, "") + "<div><strong>" + esc(veh.titre) + "</strong><span>" + price(veh.prix) + " · " + STATUTS[veh.statut] + "</span></div></a>")
            : '<div class="vchip">' + icon("message") + "<div><strong>Demande générale</strong></div></div>") +
          '<button class="btn btn--ghost btn--sm" type="button" data-ddel="' + d.id + '">' + icon("trash", "i--sm") + "Supprimer</button>" +
        "</div></article>";
    }

    view.addEventListener("click", function (e) {
      var s = e.target.closest("[data-s]");
      if (s) { state.statut = s.getAttribute("data-s"); load().catch(fail); return; }
      if (e.target.closest("[data-clear-v]")) { state.vehicule = ""; load().catch(fail); return; }
      var del = e.target.closest("[data-ddel]");
      if (del) {
        confirmBox("Supprimer la demande ?", "Les coordonnées du client seront définitivement effacées.").then(function (ok) {
          if (!ok) return;
          api("admin/demande/supprimer", { body: { id: Number(del.getAttribute("data-ddel")) } }).then(function () { toast("Demande supprimée"); refreshCounts(); return load(); }).catch(fail);
        });
      }
    });
    view.addEventListener("change", function (e) {
      if (e.target.matches("[data-type]")) { state.type = e.target.value; load().catch(fail); return; }
      var sel = e.target.closest("[data-dstatut]");
      if (!sel) return;
      api("admin/demande/statut", { body: { id: Number(sel.getAttribute("data-dstatut")), statut: sel.value } }).then(function () {
        sel.closest(".demande").classList.toggle("is-new", sel.value === "nouvelle");
        refreshCounts(); toast("Statut mis à jour");
      }).catch(fail);
    });
    var ready = S.vehicules.length ? Promise.resolve() : api("admin/vehicules").then(function (vs) { S.vehicules = vs; });
    return ready.then(load);
  }

  /* ---------- Compte ---------- */
  function viewCompte(view) {
    view.innerHTML =
      '<div class="account">' +
        '<section class="card"><div class="card__head"><h2>Session</h2></div><div class="card__body" style="display:grid;gap:6px">' +
          "<p><strong>" + esc(S.user.email) + "</strong></p>" +
          '<p class="muted" style="font-size:14px">Dernière connexion : ' + esc(S.user.last_login_at ? parseDate(S.user.last_login_at).toLocaleString("fr-FR") : "—") + "</p>" +
          '<p class="muted" style="font-size:14px">Par sécurité, la session se ferme après 2 h d\'inactivité.</p>' +
        "</div></section>" +
        '<form class="card" data-pwd novalidate><div class="card__head"><h2>Changer le mot de passe</h2></div><div class="card__body" style="display:grid;gap:14px">' +
          '<label class="field">Mot de passe actuel<input class="input" type="password" name="current" autocomplete="current-password" required></label>' +
          '<label class="field">Nouveau mot de passe <small>12 caractères minimum</small><input class="input" type="password" name="new" minlength="12" autocomplete="new-password" required></label>' +
          '<label class="field">Confirmer le nouveau mot de passe<input class="input" type="password" name="confirm" minlength="12" autocomplete="new-password" required></label>' +
          '<button class="btn btn--primary" type="submit">' + icon("lock") + "Mettre à jour</button>" +
        "</div></form>" +
      "</div>";
    var f = $("[data-pwd]", view);
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      if (f.new.value !== f.confirm.value) { toast("Les deux mots de passe ne correspondent pas.", true); return; }
      if (f.new.value.length < 12) { toast("Le nouveau mot de passe doit contenir au moins 12 caractères.", true); return; }
      api("auth/password", { body: { current: f.current.value, new: f.new.value } }).then(function (r) {
        f.reset(); toast("Mot de passe mis à jour · les autres sessions ont été fermées");
      }).catch(fail);
    });
  }

  /* ---------- Connexion / déconnexion ---------- */
  $("#login-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target, btn = $("button", f), err = $("#login-error");
    err.hidden = true;
    btn.disabled = true;
    api("auth/login", { body: { email: f.email.value, password: f.password.value } }).then(function (r) {
      S.user = r.user; S.token = r.token; store.set(r.token); f.password.value = "";
      showApp();
    }).catch(function (ex) {
      err.textContent = ex.message; err.hidden = false;
    }).then(function () { btn.disabled = false; });
  });
  $("[data-logout]").addEventListener("click", function () {
    if (S.dirty && !window.confirm("Des modifications ne sont pas enregistrées. Se déconnecter quand même ?")) return;
    S.dirty = false;
    api("auth/logout", { method: "POST" }).catch(function () {}).then(function () { S.token = ""; store.set(""); showLogin(); });
  });
  $("[data-menu]").addEventListener("click", function (e) { e.stopPropagation(); $("#side").classList.toggle("is-open"); });
  document.addEventListener("click", function (e) {
    var side = $("#side");
    if (side.classList.contains("is-open") && !side.contains(e.target)) side.classList.remove("is-open");
  });

  if (!API_BASE) {
    showLogin();
    $("#login-config").hidden = false;
    $$("#login-form input, #login-form button").forEach(function (el) { el.disabled = true; });
    return;
  }
  api("auth/me").then(function (r) {
    S.listes = r.listes || {};
    if (r.user) { S.user = r.user; showApp(); } else { S.token = ""; store.set(""); showLogin(); }
  }).catch(function () { showLogin("Serveur injoignable. Réessayez dans un instant."); });
})();
