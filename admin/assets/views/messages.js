/* Messages aux clients : file d'envoi, rappels programmés, échecs et relance manuelle */
(function () {
  "use strict";
  var BO = window.BO, esc = BO.esc, icon = BO.icon, fmt = BO.fmt, $ = BO.$;

  var FILTRES = [["", "Tous"], ["en_attente", "Programmés"], ["echec", "En échec"], ["envoye", "Envoyés"], ["simule", "Simulés (démo)"], ["annule", "Annulés"]];

  BO.route(/^\/messages$/, function (view, _p, q) {
    var st = { statut: q.statut || "" };

    function load() {
      BO.setQuery(st);
      return BO.api("admin/notifications", { query: st }).then(render);
    }
    function render(list) {
      var redirect = BO.ref("redirectionEmail");
      view.innerHTML =
        (redirect ? '<p class="note note--warn">' + icon("info") + "<span><strong>Mode test actif :</strong> tous les e-mails (clients et garage) partent vers <strong>" + esc(redirect) + "</strong>, avec le destinataire prévu indiqué dans l'objet." +
          (BO.can("parametres.gerer") ? ' <a href="#/parametres">Modifier</a>' : "") + "</span></p>" : "") +
        (BO.ref("smsConfigure") ? "" : '<p class="note">' + icon("info") + "<span>Envoi de SMS non configuré (aucun prestataire choisi) : les clients qui préfèrent le SMS reçoivent un e-mail s'ils l'acceptent, sinon le message est à faire par téléphone.</span></p>") +
        '<div class="filterbar"><div class="seg">' + FILTRES.map(function (f) { return '<button type="button" data-s="' + f[0] + '" aria-pressed="' + (st.statut === f[0]) + '">' + f[1] + "</button>"; }).join("") + "</div>" +
          '<span class="muted small">Les rappels partent automatiquement ; un message en échec est réessayé jusqu\'à 4 fois, puis peut être relancé ici.</span></div>' +
        (list.length ? '<div class="table-wrap"><table class="table"><thead><tr><th>Prévu le</th><th>Client</th><th>Message</th><th>Canal</th><th>Statut</th><th></th></tr></thead><tbody>' +
          list.map(function (n) {
            return '<tr><td class="nowrap">' + fmt.datetime(n.prevuLe) + (n.envoyeLe ? '<small class="block muted">envoyé ' + fmt.datetime(n.envoyeLe) + "</small>" : "") + "</td>" +
              "<td>" + (n.clientId ? '<a href="#/clients/' + n.clientId + '">' + esc(n.client) + "</a>" : esc(n.client || "Garage")) + '<small class="block muted">' + esc(n.destinataire || "") + "</small></td>" +
              "<td><strong>" + esc(n.templateLabel) + "</strong>" + (n.vehicule ? '<small class="block muted">' + esc(n.vehicule) + "</small>" : "") + "</td>" +
              "<td>" + (n.canal === "sms" ? "SMS" : "E-mail") + "</td>" +
              "<td>" + BO.pill("n", n.statut, n.statutLabel) + (n.tentatives ? '<small class="block muted">' + BO.fmt.plural(n.tentatives, "tentative") + (n.prochaineTentative && n.statut === "en_attente" ? " · nouvel essai " + fmt.time(n.prochaineTentative) : "") + "</small>" : "") +
                (n.erreur && n.statut === "echec" ? '<small class="block is-neg">' + esc(n.erreur) + "</small>" : "") + "</td>" +
              '<td class="nowrap"><button type="button" class="icon-btn" data-voir="' + n.id + '" aria-label="Voir le message">' + icon("eye") + "</button>" +
                (n.statut === "echec" ? '<button type="button" class="btn btn--primary btn--sm" data-relancer="' + n.id + '">' + icon("refresh") + "Relancer</button>" : "") +
                (n.rendezVousId ? '<button type="button" class="icon-btn" data-rdv="' + n.rendezVousId + '" aria-label="Voir le rendez-vous">' + icon("calendar") + "</button>" : "") + "</td></tr>";
          }).join("") + "</tbody></table></div>"
          : '<div class="card empty">' + icon("mail") + "<p>Aucun message dans cette catégorie.</p></div>");
      view._list = list;
    }
    view.addEventListener("click", function (e) {
      var t;
      if ((t = e.target.closest("[data-s]"))) { st.statut = t.getAttribute("data-s"); load().catch(BO.fail); }
      else if ((t = e.target.closest("[data-voir]"))) {
        var n = (view._list || []).filter(function (x) { return x.id === +t.getAttribute("data-voir"); })[0];
        if (n) BO.modal({
          title: n.templateLabel, wide: true,
          body: '<dl class="kv"><dt>Destinataire</dt><dd>' + esc(n.destinataire || "—") + "</dd><dt>Canal</dt><dd>" + (n.canal === "sms" ? "SMS" : "E-mail") + "</dd>" + (n.sujet ? "<dt>Objet</dt><dd>" + esc(n.sujet) + "</dd>" : "") + "<dt>Statut</dt><dd>" + BO.pill("n", n.statut, n.statutLabel) + "</dd></dl>" +
            (n.contenu ? '<pre class="msg-body">' + esc(n.contenu) + "</pre>" : '<p class="muted">Contenu effacé (durée de conservation dépassée).</p>'),
          actions: [{ label: "Fermer", primary: true }],
        });
      } else if ((t = e.target.closest("[data-relancer]"))) {
        t.disabled = true;
        BO.api("admin/notifications/relancer", { body: { id: +t.getAttribute("data-relancer") } }).then(function (r) {
          BO.toast(r.statut === "envoye" || r.statut === "simule" ? "Message renvoyé" : r.statut === "echec" ? "Nouvel échec : " + (r.erreur || "") : "Message remis dans la file d'envoi", r.statut === "echec");
          BO.refreshCounts();
          load();
        }).catch(function (err) { BO.fail(err); t.disabled = false; });
      } else if ((t = e.target.closest("[data-rdv]"))) BO.openRdv(+t.getAttribute("data-rdv"), load);
    });
    return load();
  }, { nav: "messages", title: "Messages", perm: "messages.envoyer" });
})();
