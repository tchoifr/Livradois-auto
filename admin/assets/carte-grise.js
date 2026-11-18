/* Lecture de la carte grise, dans le navigateur uniquement (Tesseract.js hébergé dans vendor/tesseract/).
   Rien ne quitte l'appareil : ni la photo ni le texte lu ne sont envoyés, conservés ou écrits dans la console.
   La lecture propose des valeurs ; la secrétaire garde la main sur chaque champ (voir views/vehicules.js).

   window.CarteGrise :
     lire(file, onProgress)  → Promise<{ champs, aVerifier }>   photo → texte → champs
     extraire(texte, mots)   → { champs, aVerifier }            fonction pure, sans DOM
     critair(codeEnergie, dateB, euro) → 0 à 5 ou null          fonction pure
     liberer()               arrête le moteur de lecture (à appeler en quittant la fiche) */
(function () {
  "use strict";

  /* Dossier des fichiers Tesseract : déterminé maintenant (document.currentScript n'existe que pendant le chargement du script). */
  var DOSSIER_MOTEUR = typeof document !== "undefined" && document.currentScript && document.currentScript.src
    ? new URL("vendor/tesseract/", document.currentScript.src).href : "";

  var COTE_MAX = 2000;       // plus grand côté de l'image envoyée au moteur (px)
  var CONFIANCE_MIN = 70;    // en dessous, le mot lu est signalé « à vérifier »

  /* ------------------------------------------------------------------ tables (rubriques P.3 et J.2) */
  var ENERGIES = { ES: "Essence", GO: "Diesel", EL: "Électrique", EE: "Hybride", EH: "Hybride", GL: "Hybride", GH: "Hybride", FL: "Hybride", FH: "Hybride", GP: "GPL", EG: "GPL" };
  var CARROSSERIES = { AA: "Berline", AB: "Compacte", AC: "Break", AD: "Coupé", AE: "Cabriolet", AF: "Monospace" };
  var CARROSSERIES_APPROX = { AB: true, AF: true };   // citadine ou SUV possibles : à vérifier
  var SIGLES_MARQUE = ["BMW", "DS", "MG", "BYD", "GMC", "KTM", "JAC", "GWM", "VW", "LDV", "RAM"];
  var SIGLES_MODELE = ["GTI", "GTD", "TDI", "TSI", "SUV", "SW", "RS", "GT", "ST", "EV", "HDI", "DCI", "TCE", "CDI"];
  var MARQUES_ACCENTS = { CITROEN: "Citroën", SKODA: "Škoda" };   // même écriture que le catalogue du site

  /* ------------------------------------------------------------------ outils */
  function anneeMax() { return new Date().getFullYear() + 1; }   // « l'an prochain », comme le serveur
  function deuxChiffres(n) { return (n < 10 ? "0" : "") + n; }
  function norm(s) { return String(s).toUpperCase().replace(/[^A-Z0-9]/g, ""); }

  /** Premier résultat valide parmi les valeurs d'une rubrique. */
  function chercher(valeurs, lecteur) {
    for (var i = 0; valeurs && i < valeurs.length; i++) {
      var r = lecteur(valeurs[i]);
      if (r) return r;
    }
    return null;
  }

  /* ------------------------------------------------------------------ découpage en rubriques */
  /* Lettre de code + chiffres admis (C.1, D.3, P.6…) : sert à couper une valeur là où la rubrique suivante commence. */
  var CHIFFRES_CODE = { C: "12345", D: "123", F: "123", J: "123", N: "12", P: "1234567", S: "12", U: "12", V: "789", X: "1", Y: "123456", Z: "1234" };
  var CONFUS = { O: "0", I: "1", l: "1", "|": "1" };   // erreurs de lecture courantes dans un code

  /** Vrai si la position est un début de zone : début de ligne, ou précédée d'un grand blanc (colonnes). */
  function debutDeZone(ligne, pos) {
    var avant = ligne.slice(0, pos);
    return /^[\s|]*$/.test(avant) || /\s{2,}$/.test(avant) || /\t$/.test(avant);
  }

  /* Codes écrits sans point (D1, P6…) acceptés partout dans la ligne ; les autres (S1, C1…) seulement en début de zone,
     car « S1 » ou « C3 » peuvent être un nom de modèle. */
  var SANS_AMBIGUITE = { "D.1": 1, "D.3": 1, "J.1": 1, "J.2": 1, "P.2": 1, "P.3": 1, "P.6": 1, "V.9": 1 };
  /* Rubriques lues : Tesseract recolle souvent le code à sa valeur (J2AC, P.66, S.15). Sans point, c'est accepté
     seulement pour ces codes et en début de zone. */
  var CODES_LUS = { "D.1": 1, "D.3": 1, "J.1": 1, "J.2": 1, "P.2": 1, "P.3": 1, "P.6": 1, "S.1": 1, "V.9": 1 };
  /* A, B et E au milieu d'une ligne : acceptés seulement si ce qui suit a la forme attendue (plaque, date, VIN). */
  var DEBUT_VALEUR = { A: /^[A-Z0]{2}[\s\-.]?[0-9OIl|]{3}/i, B: /^[0-9OIl]{2}\s?[\/.\-]\s?[0-9OIl]{2}/, E: /^[A-Z0-9]{8,}/i };

  /** Repère les codes d'une ligne : D.1, D. 1, D1, S.l, puis A, B et E. */
  function marqueurs(ligne) {
    var trouves = [], m, re, pointe, chiffre, lettre, colle, pos, code;
    re = /(^|[^A-Za-z0-9])([CDFJNPSUVXYZcdfjnpsuvxyz])(\s*[.,:]\s*|\s*)([0-9OIl|])/g;   // la lettre peut être lue en minuscule (s.15)
    while ((m = re.exec(ligne))) {
      pointe = /[.,:]/.test(m[3]);
      if (!pointe && !/[0-9]/.test(m[4])) continue;                    // sans point : vrais chiffres seulement
      chiffre = pointe ? (CONFUS[m[4]] || m[4]) : m[4];
      lettre = m[2].toUpperCase();
      if (CHIFFRES_CODE[lettre].indexOf(chiffre) === -1) continue;
      pos = m.index + m[1].length;
      code = lettre + "." + chiffre;
      if (!pointe) {
        colle = /[A-Za-z0-9]/.test(ligne.charAt(re.lastIndex));        // valeur collée au code : P66, J2AC
        if (colle ? !(CODES_LUS[code] && debutDeZone(ligne, pos)) : !(SANS_AMBIGUITE[code] || debutDeZone(ligne, pos))) continue;
      }
      trouves.push({ code: code, debut: pos, valeur: re.lastIndex });
    }
    re = /(^|[^A-Za-z0-9])([ABEabe])(\s*[.:]\s*|\s+)(?=\S)/g;
    while ((m = re.exec(ligne))) {
      pos = m.index + m[1].length;
      lettre = m[2].toUpperCase();
      var forme = DEBUT_VALEUR[lettre].test(ligne.slice(re.lastIndex));
      // majuscule : début de zone ou valeur de la bonne forme ; minuscule (« a » est un mot courant) : valeur de la bonne forme seulement
      if (m[2] === lettre ? debutDeZone(ligne, pos) || forme : forme) trouves.push({ code: lettre, debut: pos, valeur: re.lastIndex });
    }
    return trouves.sort(function (a, b) { return a.debut - b.debut; });
  }

  /** Texte → { rub : valeurs par code, corps : texte sans les rubriques du titulaire }.
      Les rubriques C.1, C.3, C.4… (nom et adresse) ne sont jamais conservées : ni lues, ni gardées dans « corps ». */
  function decouper(texte) {
    var rub = {}, corps = [];
    texte.split(/\r\n|\r|\n/).forEach(function (ligne) {
      var ms = marqueurs(ligne), gardee = "", curseur = 0;
      ms.forEach(function (m, i) {
        var fin = Math.max(i + 1 < ms.length ? ms[i + 1].debut : ligne.length, m.valeur);
        if (/^C\./.test(m.code)) {
          gardee += ligne.slice(curseur, m.valeur);
          curseur = fin;
        } else {
          (rub[m.code] = rub[m.code] || []).push(ligne.slice(m.valeur, fin));
        }
      });
      corps.push(gardee + ligne.slice(curseur));
    });
    return { rub: rub, corps: corps.join("\n") };
  }

  /* ------------------------------------------------------------------ lecteurs de valeurs */
  /** Plaque AB-123-CD. O→0 dans les chiffres, 0→O dans les lettres (la correction rend la valeur douteuse). */
  function lirePlaque(s) {
    var m = /(^|[^A-Z0-9])([A-Z0]{2})[\s\-.–—_]?([0-9OIL|]{3})[\s\-.–—_]?([A-Z0]{2})(?![A-Z0-9])/.exec(String(s).toUpperCase());
    if (!m || !/[0-9]/.test(m[3])) return null;
    var corrige = false;
    function lettres(x) { return x.replace(/0/g, function () { corrige = true; return "O"; }); }
    var chiffres = m[3].replace(/[OIL|]/g, function (c) { corrige = true; return c === "O" ? "0" : "1"; });
    return { valeur: lettres(m[2]) + "-" + chiffres + "-" + lettres(m[4]), corrige: corrige, brut: m[0] };
  }

  /** Toutes les dates JJ/MM/AAAA valides d'un texte (année de 1950 à l'an prochain). */
  function dates(s) {
    var re = /(^|[^0-9A-Za-z])([0-9OIl]{2})\s?[\/.\-]\s?([0-9OIl]{2})\s?[\/.\-]\s?([0-9OIl]{4})(?![0-9A-Za-z])/g, m, out = [];
    while ((m = re.exec(String(s)))) {
      var corrige = /[OIl]/.test(m[2] + m[3] + m[4]);
      var chiffres = function (x) { return +x.replace(/[OIl]/g, function (c) { return c === "O" ? "0" : "1"; }); };
      var j = chiffres(m[2]), mo = chiffres(m[3]), a = chiffres(m[4]);
      var d = new Date(a, mo - 1, j);
      if (a < 1950 || a > anneeMax() || mo < 1 || mo > 12 || d.getMonth() !== mo - 1 || d.getDate() !== j) continue;
      out.push({ jour: j, mois: mo, annee: a, corrige: corrige, brut: m[2] + m[3] + m[4] });
    }
    return out;
  }
  function lireDate(s) { return dates(s)[0] || null; }
  function plusAncienne(s) {
    return dates(s).sort(function (a, b) { return (a.annee - b.annee) || (a.mois - b.mois) || (a.jour - b.jour); })[0] || null;
  }

  /** VIN de 17 caractères. O et Q → 0, I → 1 avant de tester. En recherche de secours : un seul mot, et assez de chiffres/lettres. */
  function lireVin(s, secours) {
    var lignes = String(s).toUpperCase().split(/\r\n|\r|\n/);
    for (var l = 0; l < lignes.length; l++) {
      var jetons = lignes[l].split(/[\s|]+/).map(function (t) { return t.replace(/[^A-Z0-9]/g, ""); }).filter(Boolean);
      for (var i = 0; i < jetons.length; i++) {
        var acc = "";
        for (var j = i; j < jetons.length; j++) {
          acc += jetons[j];                                           // le VIN peut avoir été coupé par des espaces
          if (acc.length >= 17 || secours) break;
        }
        if (acc.length !== 17) continue;
        var corrige = false;
        var vin = acc.replace(/[OQI]/g, function (c) { corrige = true; return c === "I" ? "1" : "0"; });
        if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) continue;
        if (secours && (vin.replace(/[^0-9]/g, "").length < 5 || vin.replace(/[^A-Z]/g, "").length < 3)) continue;
        return { valeur: vin, corrige: corrige, brut: acc };
      }
    }
    return null;
  }

  /** Texte libre (marque, modèle) : retire les parasites de lecture, coupe à la longueur du champ. */
  function nettoyer(s) {
    var t = String(s).replace(/[^A-Za-zÀ-ÿ0-9 '.\-\/+&]/g, " ").replace(/\s+/g, " ");
    return t.replace(/^[\s.\-\/'+&]+|[\s.\-\/'+&]+$/g, "").slice(0, 80);
  }
  function majuscule(mot, modele) {
    var haut = mot.toUpperCase();
    if (SIGLES_MARQUE.indexOf(haut) !== -1 && !modele) return haut;
    if (modele && (SIGLES_MODELE.indexOf(haut) !== -1 || /[0-9]/.test(mot) || /^[A-Z]{1,2}$/.test(haut) || /^(?:I{1,3}|IV|VI{0,3}|IX|X)$/.test(haut))) return haut;
    return haut.charAt(0) + mot.slice(1).toLowerCase();
  }
  /** PEUGEOT → Peugeot, MERCEDES-BENZ → Mercedes-Benz, BMW reste BMW, 3008 et C3 restent tels quels. */
  function casse(texte, modele) {
    return texte.split(" ").map(function (mot) {
      return mot.split("-").map(function (p) { return p ? majuscule(p, modele) : p; }).join("-");
    }).join(" ");
  }
  function lireMarque(s) {
    var t = nettoyer(s);
    if (!/[A-Za-zÀ-ÿ]{2}/.test(t)) return null;
    return { valeur: MARQUES_ACCENTS[t.toUpperCase()] || casse(t, false), brut: t };
  }
  function lireModele(s) {
    var t = nettoyer(s);
    if (!/[A-Za-zÀ-ÿ0-9]/.test(t)) return null;
    return { valeur: casse(t, true), brut: t };
  }

  /** J.1 : CTTE = camionnette → carrosserie « Utilitaire », prioritaire sur J.2. */
  function lireGenre(s) {
    return /(^|[^A-Z0-9])CTTE(?![A-Z0-9])/.test(String(s).toUpperCase()) ? { brut: "CTTE" } : null;
  }
  function lireJ2(s) {
    var m = /(^|[^A-Z0-9])(A[A-F])(?![A-Z0-9])/.exec(String(s).toUpperCase());
    return m ? { valeur: CARROSSERIES[m[2]], approx: !!CARROSSERIES_APPROX[m[2]], brut: m[2] } : null;
  }

  /** P.2 : puissance en kW → chevaux (kW × 1,36, arrondi). Bornes du serveur : 1 à 2 000 ch. */
  function lireKw(s) {
    var m = /(^|[^A-Za-z0-9])(\d{1,4})(?:[.,](\d{1,2}))?(?![A-Za-z0-9])/.exec(String(s));
    if (!m) return null;
    var ch = Math.round(parseFloat(m[2] + "." + (m[3] || "0")) * 1.36);
    return ch >= 1 && ch <= 2000 ? { valeur: ch, brut: m[0] } : null;
  }

  /** P.3 : code énergie sur 2 lettres. Un 0 lu à la place du O est corrigé (valeur douteuse). */
  function lireEnergie(s) {
    var m = /(^|[^A-Z0-9])([A-Z0]{2})(?![A-Z0-9])/.exec(String(s).toUpperCase());
    if (!m || !/[A-Z]/.test(m[2])) return null;
    var code = m[2].replace(/0/g, "O");
    return { code: code, valeur: ENERGIES[code] || "Autre", corrige: code !== m[2], brut: m[2] };
  }

  /** P.6 (1 à 99 CV) et S.1 (1 à 9 places) : entier de 1 ou 2 chiffres. Un O, I ou l lu à la place d'un chiffre est corrigé. */
  function lireEntier(s, chiffres, min, max) {
    var m = new RegExp("(^|[^A-Za-z0-9])([0-9OIl|]{1," + chiffres + "})(?![A-Za-z0-9])").exec(String(s));
    if (!m) return null;
    var corrige = /[OIl|]/.test(m[2]);
    var n = +m[2].replace(/[OIl|]/g, function (c) { return c === "O" ? "0" : "1"; });
    return n >= min && n <= max ? { valeur: n, corrige: corrige, brut: m[2] } : null;
  }

  /** V.9 : norme Euro. */
  function lireEuro(s) {
    var m = /EURO\s*([1-6])/i.exec(String(s));
    return m ? { valeur: +m[1], brut: m[0] } : null;
  }

  /** Vrai si un mot lu avec une confiance basse correspond à la valeur (confiance Tesseract disponible seulement via lire()). */
  function confianceBasse(brut, mots) {
    var b = norm(brut || "");
    if (!b || !mots || !mots.length) return false;
    var jetons = String(brut).split(/\s+/).map(norm).filter(function (t) { return t.length >= 2; });   // « 6 » seul n'identifie rien
    for (var i = 0; i < mots.length; i++) {
      var w = mots[i];
      if (!w || typeof w.confiance !== "number" || w.confiance >= CONFIANCE_MIN) continue;
      var n = norm(w.texte || "");
      if (!n) continue;
      var nu = n.replace(/^[CDFJNPSUVXYZ][0-9](?=[A-Z0-9])/, "");     // code collé à sa valeur : P.3GO, S.15 → GO, 5
      if (n === b || nu === b || jetons.indexOf(n) !== -1 || jetons.indexOf(nu) !== -1 ||
          (n.length >= 3 && b.indexOf(n) !== -1) || (b.length >= 3 && n.indexOf(b) !== -1)) return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ Crit'Air (voitures particulières) */
  function normeEuro(euro) {
    if (euro === null || euro === undefined || euro === "") return null;
    var m = /[0-6]/.exec(String(euro));
    return m ? +m[0] : null;
  }
  function anneeDe(d) {
    if (d instanceof Date) return isNaN(d) ? null : d.getFullYear();
    if (typeof d === "number") return isFinite(d) ? Math.floor(d) : null;
    var m = /(\d{4})/.exec(String(d == null ? "" : d));
    return m ? +m[1] : null;
  }

  /** Vignette Crit'Air 0 à 5, ou null (non classé, énergie sans règle, ou données manquantes).
      codeEnergie : code P.3 (ES, GO, EL…) ; dateB : année, « MM/AAAA » ou « JJ/MM/AAAA » ; euro : 5, « Euro 5 »…
      La norme Euro lue en V.9 prime sur la date de 1re immatriculation. */
  function critair(codeEnergie, dateB, euro) {
    var e = String(codeEnergie || "").toUpperCase();
    if (e === "EL" || e === "H2") return 0;
    if (e === "EE" || e === "GL" || e === "GP" || e === "EG" || e === "GN") return 1;
    var essence = e === "ES" || e === "EH", gazole = e === "GO" || e === "GH";
    if (!essence && !gazole) return null;

    var n = normeEuro(euro), a = anneeDe(dateB), tranche;
    if (n !== null) tranche = n >= 5 ? "recent" : n === 4 ? "euro4" : n === 3 ? "euro3" : n === 2 ? "euro2" : "ancien";
    else if (a !== null) tranche = a >= 2011 ? "recent" : a >= 2006 ? "euro4" : a >= 2001 ? "euro3" : a >= 1997 ? "euro2" : "ancien";
    else return null;

    if (essence) return { recent: 1, euro4: 2, euro3: 3, euro2: 3, ancien: null }[tranche];
    // Gazole : Euro 3 et Euro 2 ne concernent que le gazole pur (GO), pas l'hybride non rechargeable (GH)
    return { recent: 2, euro4: 3, euro3: e === "GO" ? 4 : null, euro2: e === "GO" ? 5 : null, ancien: null }[tranche];
  }

  /* ------------------------------------------------------------------ extraction */
  var ORDRE = ["immatriculation", "vin", "marque", "modele", "carrosserie", "miseEnCirculation", "annee", "energie", "puissance", "cv", "places", "critair"];

  /** Texte lu → { champs : valeurs prêtes pour le formulaire, aVerifier : noms des champs douteux }.
      mots (facultatif) : [{ texte, confiance }] fournis par Tesseract. Texte vide ou illisible : rien, sans erreur. */
  function extraire(texte, mots) {
    var champs = {}, douteux = {}, sources = {}, v;
    function poser(nom, valeur, brut, doute) {
      champs[nom] = valeur;
      sources[nom] = brut;
      if (doute) douteux[nom] = true;
    }
    if (typeof texte !== "string" || !/\S/.test(texte)) return { champs: {}, aVerifier: [] };
    var d = decouper(texte), rub = d.rub, corps = d.corps;

    // A — immatriculation (cherchée partout si le code A est illisible)
    v = chercher(rub.A, lirePlaque);
    if (v) poser("immatriculation", v.valeur, v.brut, v.corrige);
    else if ((v = lirePlaque(corps))) poser("immatriculation", v.valeur, v.brut, true);

    // E — VIN
    v = chercher(rub.E, function (s) { return lireVin(s, false); });
    if (v) poser("vin", v.valeur, v.brut, v.corrige);
    else if ((v = lireVin(corps, true))) poser("vin", v.valeur, v.brut, true);

    // D.1 — marque ; D.3 — nom commercial
    if ((v = chercher(rub["D.1"], lireMarque))) poser("marque", v.valeur, v.brut, false);
    if ((v = chercher(rub["D.3"], lireModele))) poser("modele", v.valeur, v.brut, false);

    // J.1 / J.2 — carrosserie (CTTE prioritaire)
    var genre = chercher(rub["J.1"], lireGenre), j2 = chercher(rub["J.2"], lireJ2);
    if (genre) poser("carrosserie", "Utilitaire", genre.brut, false);
    else if (j2) poser("carrosserie", j2.valeur, j2.brut, j2.approx);

    // B — date de 1re immatriculation (à défaut, la plus ancienne date du document)
    var date = chercher(rub.B, lireDate), dateSecours = false;
    if (!date && (date = plusAncienne(corps))) dateSecours = true;
    if (date) {
      poser("miseEnCirculation", deuxChiffres(date.mois) + "/" + date.annee, date.brut, date.corrige || dateSecours);
      poser("annee", date.annee, date.brut, date.corrige || dateSecours);
    }

    // P.3 — énergie ; P.2 — puissance ; P.6 — CV ; S.1 — places
    var energie = chercher(rub["P.3"], lireEnergie);
    if (energie) poser("energie", energie.valeur, energie.brut, energie.corrige);
    if ((v = chercher(rub["P.2"], lireKw))) poser("puissance", v.valeur, v.brut, false);
    if ((v = chercher(rub["P.6"], function (s) { return lireEntier(s, 2, 1, 99); }))) poser("cv", v.valeur, v.brut, v.corrige);
    if ((v = chercher(rub["S.1"], function (s) { return lireEntier(s, 1, 1, 9); }))) poser("places", v.valeur, v.brut, v.corrige);

    // Confiance Tesseract : un mot lu sous le seuil rend la valeur douteuse
    Object.keys(sources).forEach(function (nom) { if (confianceBasse(sources[nom], mots)) douteux[nom] = true; });

    // V.9 puis Crit'Air : la norme Euro prime ; utilitaire (CTTE) : seulement avec la norme Euro, sinon vide et « à vérifier »
    var euro = chercher(rub["V.9"], lireEuro), euroSecours = false;
    if (!euro && (euro = lireEuro(corps))) euroSecours = true;
    if (energie) {
      var norme = euro ? euro.valeur : null, c;
      c = genre ? (norme !== null ? critair(energie.code, null, norme) : null) : critair(energie.code, date ? date.annee : null, norme);
      if (c !== null) {
        var base = euro ? euroSecours || confianceBasse(euro.brut, mots) : !!douteux.annee;
        poser("critair", c, "", !!douteux.energie || base);
      } else if (genre && norme === null) {
        douteux.critair = true;
      }
    }

    return { champs: champs, aVerifier: ORDRE.filter(function (nom) { return douteux[nom]; }) };
  }

  /* ------------------------------------------------------------------ lecture de la photo (navigateur) */
  var worker = null, creation = null, generation = 0, progression = null, scriptMoteur = null;

  function erreur(message, cause) {
    var e = new Error(message);
    e.cg = true;
    if (cause) e.cause = cause;
    return e;
  }

  function dossierMoteur() { return DOSSIER_MOTEUR || new URL("assets/vendor/tesseract/", location.href).href; }

  /** Charge tesseract.min.js au premier besoin (pas au démarrage du tableau de bord). */
  function chargerScript() {
    if (window.Tesseract) return Promise.resolve();
    if (!scriptMoteur) {
      scriptMoteur = new Promise(function (ok, ko) {
        var s = document.createElement("script");
        s.src = dossierMoteur() + "tesseract.min.js";
        s.onload = function () { ok(); };
        s.onerror = function () { scriptMoteur = null; s.remove(); ko(erreur("Le lecteur de carte grise n'a pas pu être chargé. Vérifiez votre connexion puis réessayez.")); };
        document.head.appendChild(s);
      });
    }
    return scriptMoteur;
  }

  /** Crée le moteur une seule fois ; chemins absolus (le worker résout les chemins par rapport à son propre fichier). */
  function moteur() {
    if (worker) return Promise.resolve(worker);
    if (!creation) {
      var g = generation, base = dossierMoteur();
      creation = chargerScript().then(function () {
        return window.Tesseract.createWorker("fra", 1, {          // 1 = moteur LSTM seul
          workerPath: base + "worker.min.js",
          corePath: base + "core",                                // un dossier, jamais un fichier .js précis
          langPath: base + "lang",
          workerBlobURL: false,                                   // pas de worker en blob: (compatible avec la CSP)
          logger: function (m) { if (m && m.status === "recognizing text" && progression) progression(m.progress); },
        });
      }).then(function (w) {
        if (g !== generation) { w.terminate(); throw erreur("Lecture annulée."); }
        worker = w;
        return w;
      }, function (err) { creation = null; throw err; });
    }
    return creation;
  }

  /** Arrête le moteur (libère plusieurs centaines de Mo). Il sera recréé à la prochaine lecture. */
  function liberer() {
    generation++;
    progression = null;
    var w = worker;
    worker = null;
    creation = null;
    if (w) w.terminate();
  }

  /** Image → bitmap (orientation EXIF respectée). Repli sur <img> si createImageBitmap est limité (anciens Safari). */
  function ouvrirImage(file) {
    function viaImg() {
      return new Promise(function (ok, ko) {
        var url = URL.createObjectURL(file), img = new Image();
        function fin() { URL.revokeObjectURL(url); }
        img.onload = function () { ok({ source: img, largeur: img.naturalWidth, hauteur: img.naturalHeight, fermer: function () { img.src = ""; } }); fin(); };
        img.onerror = function () { fin(); ko(erreur("Image illisible : choisissez une photo (JPG, PNG, WebP…).")); };
        img.src = url;
      });
    }
    if (typeof createImageBitmap !== "function") return viaImg();
    function bitmap(b) { return { source: b, largeur: b.width, hauteur: b.height, fermer: function () { if (b.close) b.close(); } }; }
    return createImageBitmap(file, { imageOrientation: "from-image" }).catch(function () { return createImageBitmap(file); }).then(bitmap, viaImg);
  }

  /** Photo → canvas : réduite à 2 000 px, niveaux de gris, contraste étiré (1 % et 99 % de l'histogramme). */
  function preparer(file) {
    return ouvrirImage(file).then(function (img) {
      var echelle = Math.min(1, COTE_MAX / Math.max(img.largeur, img.hauteur));
      var canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.largeur * echelle));
      canvas.height = Math.max(1, Math.round(img.hauteur * echelle));
      var ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img.source, 0, 0, canvas.width, canvas.height);
      img.fermer();

      var pixels = ctx.getImageData(0, 0, canvas.width, canvas.height), d = pixels.data, total = d.length / 4;
      var histo = new Uint32Array(256), i, g;
      for (i = 0; i < d.length; i += 4) {
        g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0;
        d[i] = d[i + 1] = d[i + 2] = g;
        histo[g]++;
      }
      var bas = 0, haut = 255, cumul = 0;
      for (i = 0; i < 256; i++) { cumul += histo[i]; if (cumul >= total * 0.01) { bas = i; break; } }
      cumul = 0;
      for (i = 255; i >= 0; i--) { cumul += histo[i]; if (cumul >= total * 0.01) { haut = i; break; } }
      if (haut - bas >= 16) {
        var table = new Uint8Array(256);
        for (i = 0; i < 256; i++) table[i] = Math.max(0, Math.min(255, Math.round((i - bas) * 255 / (haut - bas))));
        for (i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = table[d[i]];
      }
      ctx.putImageData(pixels, 0, 0);
      return canvas;
    });
  }

  function motsDe(blocs) {
    var out = [];
    (blocs || []).forEach(function (b) { (b.paragraphs || []).forEach(function (p) { (p.lines || []).forEach(function (l) { (l.words || []).forEach(function (w) {
      if (w && typeof w.text === "string" && typeof w.confidence === "number") out.push({ texte: w.text, confiance: w.confidence });
    }); }); }); });
    return out;
  }

  /** Photo de la carte grise → { champs, aVerifier }. Ni la photo ni le texte ne sont gardés (canvas vidé, aucune variable conservée). */
  function lire(file, onProgress) {
    var canvas = null;
    progression = typeof onProgress === "function" ? onProgress : null;
    function vider() { if (canvas) { canvas.width = canvas.height = 0; canvas = null; } progression = null; }
    return preparer(file).then(function (c) {
      canvas = c;
      return moteur();
    }).then(function (w) {
      return w.recognize(canvas, {}, { text: true, blocks: true });   // « blocks » : confiance mot par mot
    }).then(function (r) {
      vider();
      return extraire(r && r.data ? r.data.text : "", motsDe(r && r.data ? r.data.blocks : null));
    }, function (err) {
      vider();
      throw err && err.cg ? err : erreur("La lecture a échoué. Reprenez la photo, ou saisissez les champs à la main.", err);
    });
  }

  var CarteGrise = { lire: lire, extraire: extraire, critair: critair, liberer: liberer };
  if (typeof window !== "undefined") window.CarteGrise = CarteGrise;
  if (typeof module !== "undefined") module.exports = { extraire: extraire, critair: critair };
})();
