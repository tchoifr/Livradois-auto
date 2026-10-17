/* Clients : recherche, fiche, historique de contact, préférences de messages, RGPD */
(function () {
  "use strict";
  var BO = window.BO, esc = BO.esc, icon = BO.icon, fmt = BO.fmt, $ = BO.$;

  var TYPES_SAISIE = { appel_entrant: "Appel entrant", appel_sortant: "Appel sortant", retour: "Réponse / retour du client", note: "Note" };
  var HIST_ICON = { appel_entrant: "phone", appel_sortant: "phone", note: "file-text", retour: "inbox", email: "mail", sms: "mail", demande_site: "inbox", vente: "key", livraison: "truck" };

  /** Fenêtre de création / modification d'un client (doublons signalés, jamais fusionnés automatiquement). */
  BO.clientModal = function (c, onSaved) {
    var isNew = !c;
    c = c || { nom: "", prenom: "", telephone: "", email: "", preference: "telephone", serviceEmail: true, serviceSms: false, marketing: false, notes: "" };
    var prefs = BO.ref("preferences") || {};
    BO.modal({
      title: isNew ? "Nouveau client" : "Modifier " + c.nomComplet,
      wide: true,
      body: '<form class="form-grid" data-cform novalidate>' +
        BO.f.input("prenom", "Prénom", c.prenom, 'maxlength="80" autocomplete="off"') + BO.f.input("nom", "Nom *", c.nom, 'maxlength="120" required autocomplete="off"') +
        BO.f.select("preference", "Contact préféré", prefs, c.preference) +
        BO.f.input("telephone", "Téléphone", c.telephone, 'type="tel" maxlength="40"') + BO.f.input("email", "E-mail", c.email, 'type="email" maxlength="190"') + "<span></span>" +
        '<fieldset class="span-3 checks"><legend>Messages acceptés</legend>' +
          BO.f.check("serviceEmail", "Rendez-vous par e-mail (confirmation, rappel)", c.serviceEmail) +
          BO.f.check("serviceSms", "Rendez-vous par SMS", c.serviceSms) +
          BO.f.check("marketing", "Offres commerciales (consentement séparé)", c.marketing) + "</fieldset>" +
        '<div class="span-3">' + BO.f.textarea("notes", "Notes internes", c.notes, 'rows="3" maxlength="2000"') + "</div>" +
        '<div class="span-3" data-dups></div></form>',
      actions: [{ label: "Annuler" }, {
        label: "Enregistrer", primary: true, icon: "check", onClick: function (m) {
          var form = $("[data-cform]", m.body), b = BO.values(form);
          if (!isNew) b.id = c.id;
          if (form.dataset.confirm) b.confirmerDoublon = true;
          return BO.api("admin/client", { body: b }).then(function (saved) {
            BO.toast(isNew ? "Client créé" : "Fiche client enregistrée");
            if (onSaved) onSaved(saved);
          }).catch(function (err) {
            if (err.status !== 409 || !err.data.doublons) throw err;
            form.dataset.confirm = "1";
            $("[data-dups]", form).innerHTML = '<div class="note note--warn">' + icon("users") + "<div><strong>Client déjà connu ?</strong> Même téléphone ou e-mail que :" +
              '<ul class="bullets">' + err.data.doublons.map(function (d) { return '<li><a href="#/clients/' + d.id + '">' + esc(d.nomComplet) + "</a> — " + esc([d.telephone, d.email].filter(Boolean).join(" · ")) + "</li>"; }).join("") + "</ul>" +
              "Ouvrez la fiche existante, ou cliquez à nouveau sur « Enregistrer » pour créer quand même une fiche distincte.</div></div>";
            return true;
          });
        },
      }],
    });
  };

  /* ---------------------------------------------------------------- liste */
  BO.route(/^\/clients$/, function (view, _p, q) {
    var st = { q: q.q || "" }, timer;
    BO.actions('<button type="button" class="btn btn--primary" data-new>' + icon("plus") + "<span>Nouveau client</span></button>");
    $("[data-new]").addEventListener("click", function () { BO.clientModal(null, function (c) { BO.go("#/clients/" + c.id); }); });
    view.innerHTML = '<div class="filterbar"><label class="search search--wide">' + icon("search") + '<input class="input" type="search" data-q value="' + esc(st.q) + '" placeholder="Nom, téléphone ou e-mail" aria-label="Rechercher un client"></label></div><div data-list><p class="loading">Chargement…</p></div>';
    function load() {
      BO.setQuery(st);
      return BO.api("admin/clients", { query: { q: st.q, limite: 100 } }).then(function (list) {
        var prefs = BO.ref("preferences") || {};
        $("[data-list]", view).innerHTML = list.length ? '<div class="table-wrap"><table class="table"><thead><tr><th>Client</th><th>Téléphone</th><th>E-mail</th><th>Contact préféré</th><th>Messages</th><th>Fiche créée</th></tr></thead><tbody>' +
          list.map(function (c) {
            return '<tr class="is-click" data-id="' + c.id + '"><td><a class="strong" href="#/clients/' + c.id + '">' + esc(c.nomComplet) + "</a></td><td class=\"nowrap\">" + esc(c.telephone || "—") + "</td><td>" + esc(c.email || "—") + "</td>" +
              "<td>" + esc(prefs[c.preference] || c.preference) + "</td><td>" + [c.serviceEmail && "e-mail", c.serviceSms && "SMS"].filter(Boolean).join(", ") + (c.marketing ? ' <span class="tag tag--muted">offres</span>' : "") + "</td><td>" + fmt.date(c.createdAt) + "</td></tr>";
          }).join("") + "</tbody></table></div>"
          : '<div class="card empty">' + icon("users") + "<p>" + (st.q ? "Aucun client ne correspond à « " + esc(st.q) + " »." : "Aucun client enregistré.") + "</p></div>";
      });
    }
    view.addEventListener("input", function (e) {
      if (!e.target.matches("[data-q]")) return;
      st.q = e.target.value.trim();
      clearTimeout(timer);
      timer = setTimeout(function () { load().catch(BO.fail); }, 250);
    });
    view.addEventListener("click", function (e) {
      var tr = e.target.closest("tr[data-id]");
      if (tr && !e.target.closest("a")) BO.go("#/clients/" + tr.getAttribute("data-id"));
    });
    return load();
  }, { nav: "clients", title: "Clients", perm: "clients.gerer" });

  /* ---------------------------------------------------------------- fiche */
  BO.route(/^\/clients\/(\d+)$/, function (view, p) {
    var id = +p[0];
    function load() {
      return BO.api("admin/client", { query: { id: id } }).then(function (c) { render(c); });
    }
    function render(c) {
      BO.$("[data-title]").textContent = c.nomComplet;
      var prefs = BO.ref("preferences") || {}, types = BO.ref("typesDemande") || {};
      var acts = ['<a class="btn btn--ghost" href="#/clients">' + icon("arrow-left") + "<span>Clients</span></a>"];
      if (c.actif && BO.can("rdv.gerer")) acts.push('<a class="btn btn--primary" href="#/planning/nouveau?client=' + c.id + '">' + icon("calendar") + "<span>Rendez-vous</span></a>");
      BO.actions(acts.join(""));
      var futurs = c.rendezVous.filter(function (r) { return ["en_attente", "confirme"].indexOf(r.statut) !== -1 && !r.enRetard; });
      view.innerHTML = '<div class="client-head card"><span class="avatar">' + icon("user") + '</span><div class="grow"><p class="vhead-title">' + esc(c.nomComplet) + (c.actif ? "" : ' <span class="tag tag--muted">anonymisé</span>') + "</p>" +
          '<p class="vhead-meta">' + [c.telephone && '<a href="tel:' + esc(c.telephone.replace(/\s/g, "")) + '">' + icon("phone", "i--sm") + esc(c.telephone) + "</a>", c.email && '<span>' + icon("mail", "i--sm") + esc(c.email) + "</span>"].filter(Boolean).join(" · ") + "</p>" +
          '<p class="vhead-tags"><span class="tag">Préfère : ' + esc(prefs[c.preference] || c.preference) + "</span>" +
            (c.serviceEmail ? '<span class="tag tag--ok">Rendez-vous par e-mail</span>' : "") + (c.serviceSms ? '<span class="tag tag--ok">Rendez-vous par SMS</span>' : "") +
            (!c.serviceEmail && !c.serviceSms ? '<span class="tag tag--warn">Aucun message automatique</span>' : "") + (c.marketing ? '<span class="tag">Offres acceptées</span>' : "") + "</p>" +
          (c.notes ? '<p class="client-notes">' + esc(c.notes) + "</p>" : "") + "</div>" +
          '<div class="row-actions">' + (c.actif ? '<button type="button" class="btn btn--ghost btn--sm" data-edit>' + icon("edit") + "Modifier</button>" : "") +
            (BO.can("clients.exporter") ? '<button type="button" class="btn btn--ghost btn--sm" data-export>' + icon("upload", "rot180") + "Exporter</button>" + (c.actif ? '<button type="button" class="btn btn--ghost btn--sm" data-anon>' + icon("trash") + "Anonymiser</button>" : "") : "") +
          "</div></div>" +
        '<div class="grid-2 grid-2--wide"><section class="card"><div class="card__head"><h2>Historique de contact</h2></div>' +
          (c.actif ? '<form class="card__sub form-grid form-grid--log" data-log novalidate>' + BO.f.select("type", "Type", TYPES_SAISIE, "appel_entrant") +
            '<div class="span-2">' + BO.f.input("resume", "Résumé de l'échange *", "", 'maxlength="500" required placeholder="ex. rappeler jeudi, intéressé par l\'essai"') + "</div>" +
            '<div class="field field--end"><button class="btn btn--primary btn--sm" type="submit">' + icon("plus") + "Noter</button></div></form>" : "") +
          (c.historique.length ? '<ul class="timeline">' + c.historique.map(function (h) {
            return '<li class="tl tl--' + esc(h.type) + '">' + icon(HIST_ICON[h.type] || (h.type.indexOf("rdv") === 0 ? "calendar" : "info")) + "<div><strong>" + esc(h.typeLabel) + '</strong> <span class="muted">' + fmt.datetime(h.date) + (h.acteur ? " · " + esc(h.acteur) : "") + "</span>" +
              "<p>" + esc(h.resume) + "</p>" + (h.vehicule ? '<a class="small" href="#/vehicules/' + h.vehiculeId + '">' + esc(h.vehicule) + "</a>" : "") + "</div></li>";
          }).join("") + "</ul>" : '<div class="empty">' + icon("phone") + "<p>Aucun échange enregistré.</p></div>") +
        "</section>" +
        '<div class="stack"><section class="card"><div class="card__head"><h2>Rendez-vous</h2>' + (futurs.length ? '<span class="tag tag--ok">' + futurs.length + " à venir" + "</span>" : "") + "</div>" +
          (c.rendezVous.length ? '<ul class="mini-list">' + c.rendezVous.map(function (r) {
            return '<li class="is-click" data-rdv="' + r.id + '"><span class="mini-time">' + fmt.date(r.debut) + "<small>" + fmt.time(r.debut) + "</small></span>" +
              '<div class="grow"><strong>' + esc(r.motifLabel) + "</strong><span>" + esc(r.vehicule) + (r.parc ? " · " + esc(r.parc) : "") + "</span></div>" + BO.pill("r", r.statut, r.statutLabel) + "</li>";
          }).join("") + "</ul>" : '<div class="empty"><p>Aucun rendez-vous.</p></div>') + "</section>" +
          '<section class="card"><div class="card__head"><h2>Demandes du site</h2></div>' +
          (c.demandes.length ? '<ul class="mini-list">' + c.demandes.map(function (d) {
            return '<li><div class="grow"><strong><a href="#/demandes?client=' + c.id + '">' + esc(types[d.type] || d.type) + "</a></strong><span>" + esc(d.vehicule || "—") + (d.montant ? " · offre " + fmt.euros(d.montant) : "") + " · " + fmt.date(d.date) + "</span></div>" + BO.pill("d", d.statut, statutDemande(d.statut)) + "</li>";
          }).join("") + "</ul>" : '<div class="empty"><p>Aucune demande.</p></div>') + "</section></div></div>";

      var log = $("[data-log]", view);
      if (log) log.addEventListener("submit", function (e) {
        e.preventDefault();
        var b = BO.values(log);
        b.clientId = c.id;
        if (!b.resume) { BO.toast("Résumez l'échange en quelques mots.", true); return; }
        BO.api("admin/client/contact", { body: b }).then(function (nc) { BO.toast("Échange noté"); render(nc); }).catch(BO.fail);
      });
      var ed = $("[data-edit]", view);
      if (ed) ed.addEventListener("click", function () { BO.clientModal(c, function () { load(); }); });
      var ex = $("[data-export]", view);
      if (ex) ex.addEventListener("click", function () {
        BO.api("admin/client/export", { query: { id: c.id } }).then(function (data) {
          var a = document.createElement("a");
          a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
          a.download = "client-" + c.id + "-donnees.json";
          document.body.appendChild(a); a.click();
          setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
          BO.toast("Données exportées (export tracé dans le journal)");
        }).catch(BO.fail);
      });
      var an = $("[data-anon]", view);
      if (an) an.addEventListener("click", function () {
        BO.confirm("Anonymiser " + c.nomComplet + " ?", "Nom, téléphone, e-mail, notes et contenus des messages seront effacés définitivement. Les ventes et écritures restent, sans données personnelles.", "Anonymiser").then(function (ok) {
          if (ok) BO.api("admin/client/anonymiser", { body: { id: c.id } }).then(function () { BO.toast("Client anonymisé"); load(); }).catch(BO.fail);
        });
      });
      view.onclick = function (e) {
        var r = e.target.closest("[data-rdv]");
        if (r) BO.openRdv(+r.getAttribute("data-rdv"), load);
      };
    }
    return load();
  }, { nav: "clients", title: "Client", perm: "clients.gerer" });

  function statutDemande(s) { return { nouvelle: "Nouvelle", en_cours: "En cours", acceptee: "Acceptée", refusee: "Refusée", traitee: "Traitée" }[s] || s; }
  BO.statutDemande = statutDemande;
})();
