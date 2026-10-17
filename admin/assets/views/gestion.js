/* Administration : parcs, équipe & accès, paramètres, journal d'audit, compte personnel */
(function () {
  "use strict";
  var BO = window.BO, esc = BO.esc, icon = BO.icon, fmt = BO.fmt, $ = BO.$, $$ = BO.$$;

  function refreshRefs() { return BO.api("admin/references").then(function (r) { BO.state.refs = r; }); }

  /* ---------------------------------------------------------------- parcs */
  BO.route(/^\/parcs$/, function (view) {
    BO.actions('<button type="button" class="btn btn--primary" data-new>' + icon("plus") + "<span>Nouveau parc</span></button>");
    $("[data-new]").addEventListener("click", function () { edit(null); });
    function load() {
      return BO.api("admin/parcs", { query: { tous: 1 } }).then(function (list) {
        view.innerHTML = '<div class="parcs">' + list.map(function (p) {
          return '<section class="card parc' + (p.actif ? "" : " is-dim") + '"><div class="card__head"><h2>' + icon("map-pin") + esc(p.nom) + ' <span class="muted small">' + esc(p.code) + "</span></h2>" +
            (p.actif ? "" : '<span class="tag tag--muted">désactivé</span>') + '<button type="button" class="icon-btn" data-edit="' + p.id + '" aria-label="Modifier">' + icon("edit") + "</button></div>" +
            '<div class="card__body"><dl class="kv"><dt>Adresse</dt><dd>' + esc(p.adresse || "—") + "</dd><dt>Téléphone</dt><dd>" + esc(p.telephone || "—") + "</dd>" +
            '<dt>Véhicules en stock</dt><dd><a href="#/vehicules?f=stock" data-parc="' + p.id + '">' + p.vehicules + "</a></dd>" +
            "<dt>Équipe</dt><dd>" + (p.equipe.length ? p.equipe.map(function (u) { return esc(u.nom); }).join(", ") : '<span class="muted">personne d\'affecté (le propriétaire voit tous les parcs)</span>') + "</dd></dl>" +
            (p.notes ? '<p class="muted small">' + esc(p.notes) + "</p>" : "") + "</div></section>";
        }).join("") + "</div>";
        view._list = list;
      });
    }
    function edit(p) {
      var isNew = !p;
      p = p || { code: "", nom: "", adresse: "", telephone: "", notes: "", actif: true };
      BO.modal({
        title: isNew ? "Nouveau parc" : "Modifier " + p.nom,
        body: '<form class="form-grid form-grid--2">' + BO.f.input("code", "Code *", p.code, 'maxlength="20" required placeholder="ex. AMB"', "préfixe des n° de stock") + BO.f.input("nom", "Nom *", p.nom, 'maxlength="120" required') +
          '<div class="span-2">' + BO.f.input("adresse", "Adresse", p.adresse, 'maxlength="255"') + "</div>" + BO.f.input("telephone", "Téléphone", p.telephone, 'maxlength="40"') +
          (isNew ? "<span></span>" : BO.f.check("actif", "Parc actif", p.actif)) + '<div class="span-2">' + BO.f.textarea("notes", "Notes", p.notes, 'rows="2" maxlength="2000"') + "</div></form>",
        actions: [{ label: "Annuler" }, {
          label: "Enregistrer", primary: true, icon: "check", onClick: function (m) {
            var b = BO.values($("form", m.body));
            if (!isNew) b.id = p.id;
            return BO.api("admin/parc", { body: b }).then(function () { BO.toast("Parc enregistré"); return refreshRefs().then(load); });
          },
        }],
      });
    }
    view.addEventListener("click", function (e) {
      var t = e.target.closest("[data-edit]"), pk = e.target.closest("[data-parc]");
      if (t) edit((view._list || []).filter(function (p) { return p.id === +t.getAttribute("data-edit"); })[0]);
      if (pk) BO.setParcFilter(pk.getAttribute("data-parc"));
    });
    return load();
  }, { nav: "parcs", title: "Parcs", perm: "parcs.gerer" });

  /* ---------------------------------------------------------------- équipe & accès */
  BO.route(/^\/equipe$/, function (view) {
    BO.actions('<button type="button" class="btn btn--primary" data-new>' + icon("plus") + "<span>Nouveau compte</span></button>");
    $("[data-new]").addEventListener("click", function () { edit(null); });
    var parcs = [];
    function load() {
      return Promise.all([BO.api("admin/utilisateurs"), BO.api("admin/parcs", { query: { tous: 1 } })]).then(function (r) {
        var users = r[0];
        parcs = r[1];
        view._list = users;
        view.innerHTML = '<p class="note">' + icon("shield") + "<span>Un compte nominatif par personne : chaque action est tracée au nom de son auteur. Les secrétaires ne voient que les parcs qui leur sont affectés ; les finances restent réservées au propriétaire.</span></p>" +
          '<div class="table-wrap"><table class="table"><thead><tr><th>Personne</th><th>Rôle</th><th>Parcs</th><th>Dernière connexion</th><th>État</th><th></th></tr></thead><tbody>' +
          users.map(function (u) {
            return '<tr class="' + (u.actif ? "" : "is-cancelled") + '"><td><strong>' + esc(u.name || "—") + '</strong><small class="block muted">' + esc(u.email) + (u.telephone ? " · " + esc(u.telephone) : "") + "</small></td>" +
              "<td>" + BO.pill("role", u.role, u.roleLabel) + "</td><td>" + (u.role === "admin" ? '<span class="muted">tous</span>' : u.parcs.length ? u.parcs.map(function (p) { return esc(p.nom); }).join(", ") : '<span class="is-neg">aucun parc</span>') + "</td>" +
              "<td>" + (u.lastLogin ? BO.when(u.lastLogin) : '<span class="muted">jamais</span>') + "</td><td>" + (u.actif ? '<span class="tag tag--ok">actif</span>' : '<span class="tag tag--muted">désactivé</span>') + "</td>" +
              '<td class="nowrap"><button type="button" class="icon-btn" data-edit="' + u.id + '" aria-label="Modifier">' + icon("edit") + '</button><button type="button" class="icon-btn" data-pwd="' + u.id + '" aria-label="Nouveau mot de passe">' + icon("key") + "</button></td></tr>";
          }).join("") + "</tbody></table></div>" + matrice();
      });
    }
    function matrice() {
      var rows = [
        ["Planning, rendez-vous, clients, messages", 1, 1, 1], ["Préparation, contrôle technique, documents", 1, 1, 1], ["Demandes du site", 1, 1, 1],
        ["Modifier les annonces, photos, statut", 1, 1, 0], ["Transférer un véhicule entre parcs", 1, 1, 0],
        ["Ventes, paiements, finances, rapports", 1, 0, 0], ["Parcs, comptes, paramètres, journal", 1, 0, 0], ["Supprimer, exporter / anonymiser un client", 1, 0, 0],
      ];
      var ok = function (x) { return x ? '<span class="tag tag--ok">' + icon("check") + "</span>" : '<span class="muted">—</span>'; };
      return '<section class="card"><div class="card__head"><h2>Droits par rôle</h2><span class="muted small">vérifiés par le serveur à chaque action</span></div><div class="table-wrap"><table class="table table--compact"><thead><tr><th></th><th>Propriétaire</th><th>Secrétaire référente</th><th>Secrétaire</th></tr></thead><tbody>' +
        rows.map(function (r) { return "<tr><td>" + r[0] + "</td><td>" + ok(r[1]) + "</td><td>" + ok(r[2]) + "</td><td>" + ok(r[3]) + "</td></tr>"; }).join("") + "</tbody></table></div></section>";
    }
    function parcChecks(sel) {
      return '<fieldset class="span-2 checks" data-parcs><legend>Parcs affectés</legend>' + parcs.filter(function (p) { return p.actif; }).map(function (p) {
        return '<label class="check"><input type="checkbox" name="parcs" value="' + p.id + '" data-multi' + (sel.indexOf(p.id) !== -1 ? " checked" : "") + "> " + esc(p.nom) + "</label>";
      }).join("") + "</fieldset>";
    }
    function edit(u) {
      var isNew = !u;
      u = u || { email: "", name: "", telephone: "", role: "secretaire", actif: true, parcs: [] };
      var roles = BO.ref("roles") || {};
      BO.modal({
        title: isNew ? "Nouveau compte" : "Modifier " + (u.name || u.email),
        body: '<form class="form-grid form-grid--2">' +
          (isNew ? BO.f.input("email", "E-mail de connexion *", "", 'type="email" required autocomplete="off"') : '<p class="span-2 muted">' + esc(u.email) + "</p>") +
          BO.f.input("name", "Nom affiché", u.name, 'maxlength="120"') + BO.f.input("telephone", "Téléphone", u.telephone, 'maxlength="40"') + BO.f.select("role", "Rôle", roles, u.role) +
          (isNew ? BO.f.input("password", "Mot de passe provisoire *", "", 'type="text" minlength="12" required autocomplete="new-password"', "12 caractères min., à changer par la personne") : BO.f.check("actif", "Compte actif", u.actif)) +
          parcChecks(u.parcs.map(function (p) { return p.id; })) + "</form>",
        actions: [{ label: "Annuler" }, {
          label: "Enregistrer", primary: true, icon: "check", onClick: function (m) {
            var b = BO.values($("form", m.body));
            b.parcs = (b.parcs || []).map(Number);
            if (!isNew) b.id = u.id;
            if (b.role !== "admin" && !b.parcs.length && !window.confirm("Aucun parc affecté : cette personne ne verra aucun véhicule. Continuer ?")) return true;
            return BO.api("admin/utilisateur", { body: b }).then(function () { BO.toast("Compte enregistré"); return refreshRefs().then(load); });
          },
        }],
      });
    }
    function pwd(u) {
      BO.modal({
        title: "Nouveau mot de passe pour " + (u.name || u.email),
        body: '<form class="stack">' + BO.f.input("password", "Mot de passe provisoire", "", 'type="text" minlength="12" autocomplete="new-password"', "12 caractères minimum") + '<p class="muted small">Les sessions ouvertes de ce compte seront fermées.</p></form>',
        actions: [{ label: "Annuler" }, {
          label: "Définir", primary: true, icon: "key", onClick: function (m) {
            return BO.api("admin/utilisateur/mot-de-passe", { body: { id: u.id, password: $("[name=password]", m.body).value } }).then(function () { BO.toast("Mot de passe modifié"); });
          },
        }],
      });
    }
    view.addEventListener("click", function (e) {
      var t;
      var find = function (id) { return (view._list || []).filter(function (u) { return u.id === id; })[0]; };
      if ((t = e.target.closest("[data-edit]"))) edit(find(+t.getAttribute("data-edit")));
      else if ((t = e.target.closest("[data-pwd]"))) pwd(find(+t.getAttribute("data-pwd")));
    });
    return load();
  }, { nav: "equipe", title: "Équipe & accès", perm: "users.gerer" });

  /* ---------------------------------------------------------------- paramètres */
  var JOURS = [["1", "Lundi"], ["2", "Mardi"], ["3", "Mercredi"], ["4", "Jeudi"], ["5", "Vendredi"], ["6", "Samedi"], ["0", "Dimanche"]];
  var VARIABLES = "{prenom}, {nom}, {vehicule}, {date}, {heure}, {parc}, {telephone}, {ancienne_date}";

  BO.route(/^\/parametres$/, function (view) {
    function load() { return BO.api("admin/parametres").then(render); }
    function section(id, title, body, help) {
      return '<section class="card"><div class="card__head"><h2>' + title + "</h2>" + (help ? '<span class="muted small">' + help + "</span>" : "") + '</div><form class="card__body stack" data-section="' + id + '" novalidate>' + body +
        '<div class="row-actions"><button class="btn btn--primary btn--sm" type="submit">' + icon("check") + "Enregistrer</button></div></form></section>";
    }
    function render(s) {
      var cats = { preparation: "Préparation", documents: "Documents", administratif: "Administratif", visite: "Avant visite", livraison: "Avant livraison" };
      view.innerHTML = '<div class="grid-2 grid-2--top">' +
        section("contact", "E-mails et contact",
          BO.f.input("mail_redirect", "Mode test : envoyer tous les e-mails à", s.mail_redirect, 'type="email" placeholder="vide = envoi réel aux clients"', "") +
          '<p class="muted small">' + (s.mail_redirect ? "Mode test actif : aucun client ne reçoit de message, tout part vers cette adresse." : "Envoi réel : les clients reçoivent leurs messages.") + "</p>" +
          BO.f.input("notify_email", "Adresse qui reçoit les demandes du site", s.notify_email, 'type="email"') +
          BO.f.input("telephone", "Téléphone indiqué dans les messages", s.telephone, 'maxlength="40"')) +
        section("rappels", "Rappels automatiques",
          BO.f.check("actifs", "Envoyer des rappels avant les rendez-vous", s.rappels.actifs) + BO.f.check("h24", "Rappel la veille (24 h avant)", s.rappels.h24) + BO.f.check("h2", "Rappel 2 h avant", s.rappels.h2) +
          '<p class="muted small">Seulement aux clients qui acceptent les messages de rendez-vous. Un rendez-vous annulé ou déplacé annule ses anciens rappels.</p>') +
        section("motifs", "Motifs et durées des rendez-vous",
          '<div class="rows" data-motifs>' + s.motifs.map(motifRow).join("") + '</div><button type="button" class="btn btn--ghost btn--sm" data-add-motif>' + icon("plus") + "Ajouter un motif</button>") +
        section("horaires", "Horaires d'ouverture",
          JOURS.map(function (j) {
            var v = (s.horaires[j[0]] || []).map(function (c) { return c[0] + "-" + c[1]; }).join(", ");
            return '<label class="inline-field inline-field--row"><span>' + j[1] + '</span><input class="input" name="h' + j[0] + '" value="' + esc(v) + '" placeholder="fermé"></label>';
          }).join("") + '<p class="muted small">Format : 08:00-12:00, 14:00-18:00 · vide = fermé. Sert à proposer les créneaux libres.</p>') +
        section("alertes", "Alertes",
          BO.f.input("preparation_jours", "Signaler un véhicule non prêt (jours avant le rendez-vous)", s.alertes.preparation_jours, 'type="number" min="0" max="30"') +
          BO.f.input("ct_jours", "Alerte d'échéance du contrôle technique (jours)", (s.alertes.ct_jours || []).join(", "), 'placeholder="30, 7"')) +
        "</div>" +
        section("modeles", "Modèles de messages",
          Object.keys(s.modeles).map(function (k) {
            var m = s.modeles[k];
            return '<fieldset class="tpl" data-tpl="' + k + '"><legend>' + esc(m.libelle) + "</legend>" + BO.f.input("sujet", "Objet", m.sujet, 'maxlength="200"') + BO.f.textarea("texte", "Texte", m.texte, 'rows="5" maxlength="4000"') + "</fieldset>";
          }).join(""), "variables : " + VARIABLES) +
        '<section class="card"><div class="card__head"><h2>Tâches de préparation</h2><span class="muted small">non mécanique : nettoyage, documents, vérifications</span></div><div class="card__body"><div class="table-wrap"><table class="table table--compact"><thead><tr><th>Tâche</th><th>Catégorie</th><th>Obligatoire</th><th>Active</th><th></th></tr></thead><tbody data-taches>' +
          s.checklist.map(function (t) { return tacheRow(t, cats); }).join("") + tacheRow({ id: "", libelle: "", categorie: "preparation", obligatoire: true, actif: true }, cats) + "</tbody></table></div></div></section>";

      $("[data-add-motif]", view).addEventListener("click", function () { $("[data-motifs]", view).insertAdjacentHTML("beforeend", motifRow({ code: "", libelle: "", duree: 30 })); });
      view.addEventListener("click", function (e) { var rm = e.target.closest("[data-rm-motif]"); if (rm) rm.closest(".motif-row").remove(); });
      $$("[data-section]", view).forEach(function (f) { f.addEventListener("submit", function (e) { e.preventDefault(); save(f); }); });
      $$("[data-tache]", view).forEach(function (row) {
        $("[data-save-tache]", row).addEventListener("click", function () {
          var b = BO.values(row);
          if (row.getAttribute("data-tache")) b.id = +row.getAttribute("data-tache");
          BO.api("admin/checklist/tache", { body: b }).then(function () { BO.toast("Tâche enregistrée"); load(); }).catch(BO.fail);
        });
      });
    }
    function motifRow(m) {
      return '<div class="motif-row">' + '<input class="input" name="libelle" value="' + esc(m.libelle) + '" placeholder="Libellé" maxlength="60" aria-label="Libellé">' +
        '<input class="input input--code" name="code" value="' + esc(m.code) + '" placeholder="code" maxlength="30" aria-label="Code"' + (m.code ? " readonly" : "") + ">" +
        '<label class="inline-field"><input class="input input--num" type="number" name="duree" value="' + m.duree + '" min="5" max="600" step="5" aria-label="Durée"> min</label>' +
        '<button type="button" class="icon-btn icon-btn--danger" data-rm-motif aria-label="Retirer">' + icon("trash") + "</button></div>";
    }
    function tacheRow(t, cats) {
      return '<tr data-tache="' + t.id + '"><td><input class="input" name="libelle" value="' + esc(t.libelle) + '" placeholder="' + (t.id ? "" : "Nouvelle tâche…") + '" maxlength="120" aria-label="Libellé"></td>' +
        '<td><select class="select" name="categorie" aria-label="Catégorie">' + Object.keys(cats).map(function (k) { return '<option value="' + k + '"' + (k === t.categorie ? " selected" : "") + ">" + cats[k] + "</option>"; }).join("") + "</select></td>" +
        '<td><input type="checkbox" name="obligatoire"' + (t.obligatoire ? " checked" : "") + ' aria-label="Obligatoire"></td><td><input type="checkbox" name="actif"' + (t.actif ? " checked" : "") + ' aria-label="Active"></td>' +
        '<td><button type="button" class="btn btn--ghost btn--sm" data-save-tache>' + (t.id ? "Enregistrer" : icon("plus") + "Ajouter") + "</button></td></tr>";
    }
    function save(f) {
      var id = f.getAttribute("data-section"), b = {}, v = BO.values(f);
      if (id === "contact") b = { mail_redirect: v.mail_redirect, notify_email: v.notify_email, telephone: v.telephone };
      else if (id === "rappels") b = { rappels: { actifs: v.actifs, h24: v.h24, h2: v.h2 } };
      else if (id === "alertes") b = { alertes: { preparation_jours: +v.preparation_jours, ct_jours: String(v.ct_jours).split(/[\s,;]+/).filter(Boolean).map(Number) } };
      else if (id === "motifs") {
        b.motifs = $$(".motif-row", f).map(function (r) {
          var lib = $("[name=libelle]", r).value.trim(), code = $("[name=code]", r).value.trim();
          if (!code) code = lib.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "");
          return { code: code, libelle: lib, duree: +$("[name=duree]", r).value };
        });
      } else if (id === "horaires") {
        b.horaires = {};
        try {
          JOURS.forEach(function (j) {
            b.horaires[j[0]] = String(v["h" + j[0]] || "").split(/[,;]+/).map(function (x) { return x.trim(); }).filter(Boolean).map(function (x) {
              var m = x.match(/^(\d{1,2})[:h](\d{2})\s*-\s*(\d{1,2})[:h](\d{2})$/);
              if (!m) throw new Error("Horaire illisible pour " + j[1] + " : « " + x + " » (format 08:00-12:00)");
              var p = function (n) { return String(n).padStart(2, "0"); };
              return [p(m[1]) + ":" + m[2], p(m[3]) + ":" + m[4]];
            });
          });
        } catch (e) { BO.toast(e.message, true); return; }
      } else if (id === "modeles") {
        b.modeles = {};
        $$("[data-tpl]", f).forEach(function (fs) { b.modeles[fs.getAttribute("data-tpl")] = { sujet: $("[name=sujet]", fs).value, texte: $("[name=texte]", fs).value }; });
      }
      BO.api("admin/parametres", { body: b }).then(function () { BO.toast("Paramètres enregistrés"); return refreshRefs().then(load); }).catch(BO.fail);
    }
    return load();
  }, { nav: "parametres", title: "Paramètres", perm: "parametres.gerer" });

  /* ---------------------------------------------------------------- journal d'audit */
  var ENTITES = { "": "Tout", vehicule: "Véhicules", rendez_vous: "Rendez-vous", client: "Clients", demande: "Demandes", utilisateur: "Comptes", parc: "Parcs", checklist: "Tâches de préparation", parametres: "Paramètres", message: "Messages", finance: "Finances" };

  BO.route(/^\/journal$/, function (view, _p, q) {
    var st = { entity_type: q.entity_type || "", actor_id: q.actor_id || "" };
    function load() {
      BO.setQuery(st);
      return BO.api("admin/audit", { query: { entity_type: st.entity_type, actor_id: st.actor_id, limit: 300 } }).then(function (list) {
        view.innerHTML = '<div class="filterbar"><select class="select select--auto" data-ent aria-label="Type">' + Object.keys(ENTITES).map(function (k) { return '<option value="' + k + '"' + (k === st.entity_type ? " selected" : "") + ">" + ENTITES[k] + "</option>"; }).join("") + "</select>" +
          '<select class="select select--auto" data-act aria-label="Auteur">' + BO.f.userOptions("Toute l'équipe").map(function (o) { return '<option value="' + o.value + '"' + (String(o.value) === st.actor_id ? " selected" : "") + ">" + esc(o.label) + "</option>"; }).join("") + "</select>" +
          '<span class="muted small">300 dernières actions · le journal ne peut pas être modifié</span></div>' +
          (list.length ? '<div class="table-wrap"><table class="table table--compact"><thead><tr><th>Date</th><th>Auteur</th><th>Action</th><th>Élément</th><th>Détail</th></tr></thead><tbody>' + list.map(function (a) {
            var lien = a.entityType === "vehicule" && a.entityId ? '<a href="#/vehicules/' + a.entityId + '/historique">véhicule #' + a.entityId + "</a>" : a.entityType === "client" && a.entityId ? '<a href="#/clients/' + a.entityId + '">client #' + a.entityId + "</a>" : esc(a.entityType + (a.entityId ? " #" + a.entityId : ""));
            return '<tr><td class="nowrap">' + fmt.datetime(a.date) + "</td><td>" + esc(a.acteur) + "</td><td>" + esc(BO.auditLabel ? BO.auditLabel(a.action) : a.action) + '<small class="block muted">' + esc(a.action) + "</small></td><td>" + lien + '</td><td class="small">' + detail(a) + "</td></tr>";
          }).join("") + "</tbody></table></div>" : '<div class="card empty">' + icon("file-text") + "<p>Aucune action enregistrée.</p></div>");
      });
    }
    function detail(a) {
      var o = a.apres && typeof a.apres === "object" ? a.apres : null;
      if (!o) return "";
      return Object.keys(o).slice(0, 5).map(function (k) {
        var av = a.avant && typeof a.avant === "object" && a.avant[k] !== undefined ? a.avant[k] : null;
        var val = function (x) { return typeof x === "object" && x !== null ? JSON.stringify(x).slice(0, 60) : String(x); };
        return esc(k) + " : " + (av !== null ? esc(val(av)) + " → " : "") + esc(val(o[k]));
      }).join("<br>");
    }
    view.addEventListener("change", function (e) {
      if (e.target.matches("[data-ent]")) st.entity_type = e.target.value;
      if (e.target.matches("[data-act]")) st.actor_id = e.target.value;
      load().catch(BO.fail);
    });
    return load();
  }, { nav: "journal", title: "Journal d'audit", perm: "audit.voir" });

  /* ---------------------------------------------------------------- compte */
  BO.route(/^\/compte$/, function (view) {
    var u = BO.state.user;
    var parcs = u.parcs === null ? "Tous les parcs" : (BO.ref("parcs") || []).filter(function (p) { return u.parcs.indexOf(p.id) !== -1; }).map(function (p) { return p.nom; }).join(", ") || "Aucun parc affecté";
    view.innerHTML = '<div class="grid-2 grid-2--top"><section class="card"><div class="card__head"><h2>Mon compte</h2></div><div class="card__body"><dl class="kv">' +
      "<dt>Nom</dt><dd>" + esc(u.name || "—") + "</dd><dt>E-mail</dt><dd>" + esc(u.email) + "</dd><dt>Rôle</dt><dd>" + esc(u.roleLabel) + "</dd><dt>Parcs</dt><dd>" + esc(parcs) + "</dd></dl></div></section>" +
      '<section class="card"><div class="card__head"><h2>Changer de mot de passe</h2></div><form class="card__body stack" data-pwd novalidate>' +
        (BO.demo ? '<p class="note">' + icon("info") + "Désactivé dans la démonstration.</p>" : "") +
        BO.f.input("current", "Mot de passe actuel", "", 'type="password" autocomplete="current-password" required') +
        BO.f.input("new", "Nouveau mot de passe", "", 'type="password" autocomplete="new-password" minlength="12" required', "12 caractères minimum") +
        BO.f.input("confirm", "Confirmer", "", 'type="password" autocomplete="new-password" required') +
        '<div class="row-actions"><button class="btn btn--primary btn--sm" type="submit"' + (BO.demo ? " disabled" : "") + ">" + icon("lock") + "Modifier</button></div>" +
        '<p class="muted small">Vos autres sessions ouvertes seront fermées.</p></form></section></div>';
    $("[data-pwd]", view).addEventListener("submit", function (e) {
      e.preventDefault();
      var b = BO.values(e.target);
      if (b.new !== b.confirm) { BO.toast("Les deux mots de passe ne correspondent pas.", true); return; }
      BO.api("auth/password", { body: { current: b.current, new: b.new } }).then(function () { e.target.reset(); BO.toast("Mot de passe modifié"); }).catch(BO.fail);
    });
  }, { nav: "compte", title: "Mon compte" });
})();
