/* Mode démonstration du dashboard (admin/?demo=1)
   Simule l'API dans le navigateur avec le stock d'exemple et des demandes fictives.
   Rien n'est envoyé ni enregistré sur un serveur : les modifications restent dans l'onglet. */
(function () {
  "use strict";
  if (!/[?&]demo\b/.test(location.search)) return;

  var KEY = "la_demo_state";
  var LISTES = {
    energies: ["Essence", "Diesel", "Hybride", "Électrique", "GPL", "Autre"],
    boites: ["Manuelle", "Automatique"],
    carrosseries: ["Citadine", "Compacte", "Berline", "SUV", "Break", "4x4", "Monospace", "Coupé", "Cabriolet", "Utilitaire"],
    types: { reservation: "Réservation", essai: "Demande d'essai", offre: "Offre de prix", reprise: "Reprise de véhicule", financement: "Financement", alerte: "Alerte disponibilité", question: "Question" },
    statutsDemande: ["nouvelle", "en_cours", "acceptee", "refusee", "traitee"],
  };
  var USER = { id: 1, email: "demo@livradois-automobiles.fr", name: "Démo", last_login_at: null };

  function stamp(minutesAgo) {
    var d = new Date(Date.now() - minutesAgo * 60000);
    var p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":00";
  }

  function initialState() {
    var vs = (window.VEHICULES || []).map(function (v, i) {
      return Object.assign({}, v, { dbId: i + 1, createdAt: stamp(60 * 24 * (20 - i)), updatedAt: stamp(60 * (i + 2)) });
    });
    var byId = function (slug) { var v = vs.filter(function (x) { return x.id === slug; })[0]; return v ? v.dbId : null; };
    var d = [
      [byId("peugeot-3008-2020"), "offre", "Julien M.", 21000, "nouvelle", 25, "Bonjour, je peux venir le voir samedi. Seriez-vous d'accord pour 21 000 € ?"],
      [byId("suzuki-jimny-2020"), "offre", "Sophie R.", 23500, "nouvelle", 95, "Très intéressée, je propose 23 500 € avec paiement comptant."],
      [byId("peugeot-208-2021"), "reservation", "Claire D.", null, "nouvelle", 180, "Je souhaite réserver ce véhicule, merci de me rappeler."],
      [byId("volkswagen-t-roc-2022"), "essai", "Karim B.", null, "en_cours", 60 * 26, "Possible de faire un essai jeudi en fin de journée ?"],
      [byId("peugeot-3008-2020"), "offre", "Thomas L.", 19800, "refusee", 60 * 50, "Je propose 19 800 €."],
      [byId("dacia-duster-2021"), "reprise", "Nadia P.", null, "traitee", 60 * 72, "J'ai une Clio III de 2012 à faire reprendre."],
      [null, "question", "Marc V.", null, "nouvelle", 60 * 5, "Avez-vous des utilitaires en arrivage ?"],
    ].map(function (x, i) {
      return { id: i + 1, vehicule: x[0], type: x[1], nom: x[2], montant: x[3], statut: x[4], createdAt: stamp(x[5]), message: x[6],
        tel: "06 00 00 00 0" + (i + 1), email: "client" + (i + 1) + "@exemple.fr" };
    });
    return { logged: true, vehicules: vs, demandes: d, nextV: vs.length + 1, nextD: d.length + 1 };
  }

  var state;
  try { state = JSON.parse(sessionStorage.getItem(KEY)); } catch (e) { state = null; }
  if (!state || !state.vehicules) state = initialState();
  var save = function () {
    try {
      var copy = JSON.parse(JSON.stringify(state));
      copy.vehicules.forEach(function (v) { v.photos = v.photos.filter(function (p) { return !(p.url || "").startsWith("blob:"); }); });
      sessionStorage.setItem(KEY, JSON.stringify(copy));
    } catch (e) { /* stockage indisponible : la démo reste en mémoire */ }
  };

  var fail = function (msg) { throw new Error(msg); };
  var findV = function (id) { return state.vehicules.filter(function (v) { return v.dbId === Number(id); })[0]; };
  var open = function (d) { return d.statut === "nouvelle" || d.statut === "en_cours"; };

  function withCounts(v) {
    var ds = state.demandes.filter(function (d) { return d.vehicule === v.dbId; });
    var offres = ds.filter(function (d) { return d.type === "offre"; });
    return Object.assign({}, v, {
      demandes: ds.length,
      nouvelles: ds.filter(function (d) { return d.statut === "nouvelle"; }).length,
      offres: offres.length,
      offresOuvertes: offres.filter(open).length,
      meilleureOffre: offres.length ? Math.max.apply(null, offres.map(function (d) { return d.montant; })) : null,
    });
  }

  function stats() {
    var vs = state.vehicules, ds = state.demandes;
    var count = function (s) { return vs.filter(function (v) { return v.statut === s; }).length; };
    var offresOuv = ds.filter(function (d) { return d.type === "offre" && open(d); });
    return {
      enLigne: count("disponible"), reserves: count("reserve"), brouillons: count("brouillon"), vendus: count("vendu"),
      valeurStock: vs.filter(function (v) { return v.statut === "disponible" || v.statut === "reserve"; }).reduce(function (s, v) { return s + v.prix; }, 0),
      demandesNouvelles: ds.filter(function (d) { return d.statut === "nouvelle"; }).length,
      offresOuvertes: offresOuv.length,
      annoncesAvecOffres: offresOuv.map(function (d) { return d.vehicule; }).filter(function (x, i, a) { return x && a.indexOf(x) === i; }).length,
      demandes30j: ds.length,
    };
  }

  function demandeOut(d) {
    var v = d.vehicule ? findV(d.vehicule) : null;
    return {
      id: d.id, type: d.type, statut: d.statut, nom: d.nom, tel: d.tel, email: d.email, message: d.message, montant: d.montant, createdAt: d.createdAt,
      vehicule: d.vehicule ? (v ? { dbId: v.dbId, slug: v.id, titre: v.marque + " " + v.modele, prix: v.prix, photo: v.photos[0] || null, statut: v.statut, supprime: false }
        : { dbId: d.vehicule, supprime: true }) : null,
      vehiculeTitre: d.titre || "",
    };
  }

  function slugify(s) {
    return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  var routes = {
    "GET auth/me": function () { return { user: state.logged ? USER : null, listes: LISTES }; },
    "POST auth/login": function () { state.logged = true; return { user: USER, token: "demo" }; },
    "POST auth/logout": function () { state.logged = false; return { ok: true }; },
    "POST auth/password": function (b) {
      if (!b.current) fail("Mot de passe actuel incorrect.");
      if ((b.new || "").length < 12) fail("Le mot de passe doit contenir au moins 12 caractères.");
      return { ok: true };
    },
    "GET admin/stats": stats,
    "GET admin/vehicules": function () {
      return state.vehicules.slice().sort(function (a, b) { return b.updatedAt.localeCompare(a.updatedAt); }).map(withCounts);
    },
    "GET admin/vehicule": function (q) { var v = findV(q.id); if (!v) fail("Annonce introuvable."); return v; },
    "POST admin/vehicule": function (b) {
      if (!b.marque || !b.modele || !b.prix || !b.annee || b.km === "") fail("La marque, le modèle, l'année, le kilométrage et le prix sont obligatoires.");
      var num = function (x) { return x === "" || x == null ? null : Number(x); };
      var data = {
        statut: b.statut || "brouillon", marque: b.marque, modele: b.modele, version: b.version || "", annee: num(b.annee), miseEnCirculation: b.miseEnCirculation || "",
        km: num(b.km), energie: b.energie, boite: b.boite, carrosserie: b.carrosserie, puissance: num(b.puissance), cv: num(b.cv), portes: num(b.portes), places: num(b.places),
        couleur: b.couleur || "", critair: num(b.critair), premiereMain: !!b.premiereMain, quatreRoues: !!b.quatreRoues, autonomie: num(b.autonomie),
        garantie: num(b.garantie) || 12, prix: num(b.prix), prixBarre: num(b.prixBarre) > num(b.prix) ? num(b.prixBarre) : null, badge: b.badge || null,
        description: b.description || "", equipements: (b.equipements || []).map(function (e) { return String(e).trim(); }).filter(Boolean), photos: b.photos || [],
        updatedAt: stamp(0),
      };
      var v = b.dbId ? findV(b.dbId) : null;
      if (v) Object.assign(v, data);
      else {
        var id = state.nextV++;
        v = Object.assign(data, { dbId: id, id: slugify(data.marque + " " + data.modele + " " + data.annee) + "-" + id, ref: "LA-" + (2400 + id), createdAt: stamp(0), ajoutLe: new Date().toISOString().slice(0, 10) });
        state.vehicules.push(v);
      }
      return v;
    },
    "POST admin/vehicule/statut": function (b) { var v = findV(b.id); if (!v) fail("Annonce introuvable."); v.statut = b.statut; v.updatedAt = stamp(0); return v; },
    "POST admin/vehicule/supprimer": function (b) { state.vehicules = state.vehicules.filter(function (v) { return v.dbId !== Number(b.id); }); return { ok: true }; },
    "POST admin/photo": function (b, form) {
      var f = form && form.get("photo");
      if (!f || !/^image\/(jpeg|png|webp)$/.test(f.type)) fail("Format non pris en charge : utilisez JPG, PNG ou WebP.");
      var u = URL.createObjectURL(f);
      return { url: u, urlSmall: u };
    },
    "GET admin/demandes": function (q) {
      return state.demandes.filter(function (d) {
        return (!q.type || d.type === q.type) && (!q.statut || d.statut === q.statut) && (!q.vehicule || String(d.vehicule) === String(q.vehicule));
      }).sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); }).map(demandeOut);
    },
    "POST admin/demande/statut": function (b) { var d = state.demandes.filter(function (x) { return x.id === Number(b.id); })[0]; if (!d) fail("Demande introuvable."); d.statut = b.statut; return { ok: true }; },
    "POST admin/demande/supprimer": function (b) { state.demandes = state.demandes.filter(function (x) { return x.id !== Number(b.id); }); return { ok: true }; },
  };

  window.LA_DEMO_API = function (route, opts) {
    opts = opts || {};
    var method = opts.method || (opts.body || opts.form ? "POST" : "GET");
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        try {
          var fn = routes[method + " " + route];
          if (!fn) fail("Route inconnue.");
          var out = fn(opts.body || opts.query || {}, opts.form);
          save();
          resolve(JSON.parse(JSON.stringify(out)));
        } catch (e) { reject(e); }
      }, 120);
    });
  };
})();
