/* Fiche véhicule : galerie, caractéristiques, simulateur, demande de contact / offre */
window.LA.ready.then(function (source) {
  "use strict";
  var LA = window.LA;
  var $ = LA.$, $$ = LA.$$, esc = LA.esc, icon = LA.icon, fmt = LA.fmt;

  var EMAIL = "livradois.automobiles@gmail.com";
  var TYPES = {
    reservation: "Réserver ce véhicule", essai: "Demander un essai", offre: "Faire une offre", reprise: "Faire reprendre mon véhicule",
    financement: "Étudier un financement", alerte: "Être prévenu si le véhicule se libère", question: "Autre question",
  };
  var HAS_API = !!((window.LA_CONFIG || {}).api);
  var PHONE = "04 73 95 85 46";
  var SITE = "https://livradois-automobiles.netlify.app/";

  var root = $("[data-fiche]");
  var id = new URLSearchParams(location.search).get("id");
  var v = LA.stock().filter(function (x) { return x.id === id; })[0];

  if (source === "error") {
    root.innerHTML = '<div class="container not-found">' + LA.unavailableHTML + "</div>";
    return;
  }

  if (!v) {
    document.title = "Véhicule introuvable | Livradois Automobiles";
    root.innerHTML =
      '<div class="container not-found">' + icon("car", "i--lg") +
      "<h1>Ce véhicule n'est plus disponible</h1>" +
      "<p>Il a peut-être déjà trouvé preneur. Découvrez les autres véhicules de notre stock ou contactez-nous : nous pouvons rechercher un modèle pour vous.</p>" +
      '<a class="btn btn--primary btn--lg" href="vehicules.html">' + icon("car") + "Voir tous nos véhicules</a></div>";
    return;
  }

  var name = LA.title(v);
  var reserved = v.statut === "reserve";
  document.title = name + " " + v.version + " – " + v.annee + ", " + fmt.km(v.km) + " | Livradois Automobiles";
  var metaDesc = $('meta[name="description"]');
  if (metaDesc) metaDesc.setAttribute("content", name + " " + v.version + " d'occasion (" + v.annee + ", " + fmt.km(v.km) + ", " + v.energie + ") à " + fmt.price(v.prix) + " chez Livradois Automobiles à Arlanc. Garantie " + v.garantie + " mois.");

  /* ---------- Gabarit ---------- */
  var badgesHTML = LA.badges(v).map(function (b) { return '<span class="badge ' + b.cls + '">' + esc(b.label) + "</span>"; }).join("");
  var many = v.photos.length > 1;

  var keyfacts = [
    ["calendar", "Année", v.annee + (v.miseEnCirculation ? " (" + v.miseEnCirculation + ")" : "")],
    ["gauge", "Kilométrage", fmt.km(v.km)],
    ["fuel", "Énergie", v.energie],
    ["gearbox", "Boîte", v.boite],
    ["zap", "Puissance", v.puissance + " ch" + (v.cv ? " · " + v.cv + " CV" : "")],
    ["leaf", "Crit'Air", String(v.critair)],
  ];

  var specs = [
    ["Marque", v.marque], ["Modèle", v.modele], ["Version", v.version], ["Carrosserie", v.carrosserie],
    ["Mise en circulation", v.miseEnCirculation || v.annee], ["Kilométrage", fmt.km(v.km)],
    ["Énergie", v.energie], ["Boîte de vitesses", v.boite], ["Puissance", v.puissance + " ch"],
    ["Puissance fiscale", v.cv + " CV"], ["Transmission", v.quatreRoues ? "4 roues motrices" : "2 roues motrices"],
    ["Portes / places", v.portes + " portes · " + v.places + " places"], ["Couleur", v.couleur],
    ["Vignette Crit'Air", String(v.critair)], ["Première main", v.premiereMain ? "Oui" : "Non"],
    ["Garantie", v.garantie + " mois"],
  ];
  if (v.autonomie) specs.splice(9, 0, ["Autonomie (WLTP)", fmt.km(v.autonomie)]);

  var included = [
    ["clipboard", "Contrôle de sécurité", "Freinage, direction, suspension, éclairage et pneumatiques vérifiés avant livraison."],
    ["shield", "Garantie " + v.garantie + " mois", "En plus des garanties légales de conformité et des vices cachés."],
    ["wrench", "Préparation à la route", "Contrôle des niveaux et pose des plaques d'immatriculation inclus dans le prix."],
    ["id-card", "Carte grise simplifiée", "Nous nous occupons des démarches d'immatriculation pour vous."],
  ];

  var credits = v.photos.filter(function (p) { return p.credit; });
  var creditHTML = credits.length ? '<p class="photo-credit" data-credit></p>' : "";

  var price = '<div class="price">' + (v.prixBarre ? "<s>" + fmt.price(v.prixBarre) + "</s>" : "") + "<strong>" + fmt.price(v.prix) + "</strong><small>Prix TTC · frais de préparation inclus</small></div>";

  root.innerHTML =
    '<div class="container product-top"><nav class="breadcrumb breadcrumb--dark" aria-label="Fil d\'Ariane">' +
      '<a href="./">Accueil</a>' + icon("chevron-right") + '<a href="vehicules.html">Nos véhicules</a>' + icon("chevron-right") +
      '<span aria-current="page">' + esc(name) + "</span></nav></div>" +

    '<div class="container product">' +
      '<div class="product__main">' +
        '<div class="gallery">' +
          '<div class="gallery__main">' +
            '<img data-main src="' + LA.photo(v, 0) + '" alt="' + esc(name + " " + v.version + " — photo 1") + '" width="1200" height="800">' +
            '<div class="gallery__badges">' + badgesHTML + "</div>" +
            (many ? '<button class="gallery__btn gallery__btn--prev" type="button" data-prev aria-label="Photo précédente">' + icon("chevron-left") + "</button>" +
                    '<button class="gallery__btn gallery__btn--next" type="button" data-next aria-label="Photo suivante">' + icon("chevron-right") + "</button>" : "") +
            '<span class="gallery__counter">' + icon("camera", "i--sm") + '<span data-counter>1</span> / ' + v.photos.length + "</span>" +
            '<button class="gallery__zoom" type="button" data-zoom>' + icon("expand", "i--sm") + "Plein écran</button>" +
          "</div>" +
          (many ? '<div class="gallery__thumbs">' + v.photos.map(function (p, i) {
            return '<button type="button" data-thumb="' + i + '" aria-label="Voir la photo ' + (i + 1) + '"' + (i === 0 ? ' aria-current="true"' : "") + '><img src="' + LA.photo(v, i, true) + '" alt="" loading="lazy" width="600" height="400"></button>';
          }).join("") + "</div>" : "") +
          creditHTML +
        "</div>" +

        '<section class="pblock"><h2>Les points clés</h2><div class="keyfacts">' + keyfacts.map(function (k) {
          return '<div class="keyfact">' + icon(k[0]) + "<div><span>" + k[1] + "</span><strong>" + esc(k[2]) + "</strong></div></div>";
        }).join("") + "</div></section>" +

        '<section class="pblock"><h2>Description</h2><p class="desc">' + esc(v.description) + "</p></section>" +

        '<section class="pblock"><h2>Équipements</h2><ul class="equip-list">' + v.equipements.map(function (e) {
          return "<li>" + icon("check") + esc(e) + "</li>";
        }).join("") + "</ul></section>" +

        '<section class="pblock"><h2>Caractéristiques</h2><dl class="spec-table">' + specs.map(function (s) {
          return "<div><dt>" + s[0] + "</dt><dd>" + esc(s[1]) + "</dd></div>";
        }).join("") + "</dl></section>" +

        '<section class="pblock"><h2>Inclus avec votre véhicule</h2><ul class="included">' + included.map(function (x) {
          return "<li>" + icon(x[0]) + "<div><strong>" + x[1] + "</strong><span>" + x[2] + "</span></div></li>";
        }).join("") + "</ul></section>" +

        '<section class="pblock" id="financement"><h2>' + icon("calculator") + "Estimez vos mensualités</h2>" +
          '<div class="simulator">' +
            '<div class="simulator__fields">' +
              '<div class="slider-field"><div class="slider-field__head"><label for="apport">Apport</label><output data-apport-out></output></div>' +
                '<input type="range" id="apport" min="0" max="' + Math.round(v.prix * 0.6 / 500) * 500 + '" step="500" value="' + Math.round(v.prix * 0.2 / 500) * 500 + '"></div>' +
              '<div class="slider-field"><div class="slider-field__head"><label for="duree">Durée</label><output data-duree-out></output></div>' +
                '<input type="range" id="duree" min="12" max="84" step="12" value="' + (v.prix > 15000 ? 60 : 48) + '"></div>' +
              '<div class="field"><label for="taux">Taux annuel (TAEG indicatif, %)</label><input class="input" id="taux" type="number" min="0" max="20" step="0.1" value="6.9" inputmode="decimal"></div>' +
            "</div>" +
            '<div class="simulator__result"><span>Mensualité estimée</span><strong data-mensualite></strong><small data-financed></small><small data-cost></small></div>' +
          "</div>" +
          '<p class="legal-note"><strong>Un crédit vous engage et doit être remboursé. Vérifiez vos capacités de remboursement avant de vous engager.</strong> ' +
            "Simulation indicative et non contractuelle, hors assurance facultative, sous réserve d'acceptation du dossier par l'organisme prêteur. " +
            "Contactez-nous pour étudier une solution de financement adaptée.</p>" +
        "</section>" +
      "</div>" +

      '<aside class="product__aside">' +
        '<div class="buybox" data-buybox>' +
          (badgesHTML ? '<div class="buybox__badges">' + badgesHTML + "</div>" : "") +
          "<div><h1>" + esc(name) + '</h1><p class="buybox__version">' + esc(v.version) + '</p><p class="buybox__ref">Réf. ' + esc(v.ref) + "</p></div>" +
          '<div class="buybox__specs">' +
            "<span>" + icon("calendar") + v.annee + "</span><span>" + icon("gauge") + fmt.km(v.km) + "</span>" +
            "<span>" + icon("fuel") + esc(v.energie) + "</span><span>" + icon("gearbox") + esc(v.boite) + "</span>" +
          "</div>" +
          '<div class="buybox__price">' + price + "</div>" +
          (reserved ? '<p class="status-banner">' + icon("info") + "Ce véhicule est actuellement réservé. Contactez-nous pour être prévenu s'il se libère.</p>" : "") +
          '<div class="buybox__actions">' +
            '<a class="btn btn--primary btn--lg btn--block" href="#demande" data-intent="' + (reserved ? "alerte" : "reservation") + '">' + icon("key") + (reserved ? "Être prévenu" : "Je réserve ce véhicule") + "</a>" +
            (reserved ? "" : '<a class="btn btn--ghost btn--block" href="#demande" data-intent="offre">' + icon("hand-coins") + "Faire une offre</a>") +
            '<a class="btn btn--dark btn--block" href="tel:0473958546">' + icon("phone") + "Appeler le " + PHONE + "</a>" +
            '<div class="buybox__row">' +
              '<a class="btn btn--ghost btn--sm" href="#demande" data-intent="essai">' + icon("car") + "Essai</a>" +
              '<a class="btn btn--ghost btn--sm" href="#demande" data-intent="reprise">' + icon("refresh") + "Reprise</a>" +
            "</div>" +
            '<div class="buybox__row">' +
              '<button class="btn btn--ghost btn--sm fav-toggle" type="button" data-fav="' + esc(v.id) + '" aria-pressed="' + LA.favs.has(v.id) + '">' + icon("heart") + "Favori</button>" +
              '<button class="btn btn--ghost btn--sm" type="button" data-share>' + icon("share") + "Partager</button>" +
            "</div>" +
          "</div>" +
          '<ul class="reassure">' +
            "<li>" + icon("shield") + "Garantie " + v.garantie + " mois incluse</li>" +
            "<li>" + icon("clipboard") + "Contrôle de sécurité avant livraison</li>" +
            "<li>" + icon("refresh") + "Reprise de votre ancien véhicule possible</li>" +
            "<li>" + icon("id-card") + "Carte grise prise en charge</li>" +
          "</ul>" +
          '<div class="buybox__where">' + icon("map-pin") + "<div><strong>Visible au garage à Arlanc (63)</strong><span data-open-status></span></div></div>" +
        "</div>" +
      "</aside>" +
    "</div>" +

    '<section class="section--tight section--sand" id="demande"><div class="container">' +
      '<div class="request">' +
        '<div class="request__aside">' +
          '<span class="eyebrow">Demande d\'information</span>' +
          "<h2>Intéressé par ce véhicule ?</h2>" +
          "<p>Laissez-nous vos coordonnées, nous vous recontactons rapidement pour organiser un essai, une réservation ou une reprise. Vous pouvez aussi nous appeler au <a href=\"tel:0473958546\"><strong>" + PHONE + "</strong></a>.</p>" +
          '<div class="request__vehicle"><img src="' + LA.photo(v, 0, true) + '" alt="" width="600" height="400"><div><strong>' + esc(name) + "</strong><span>" + esc(v.version) + " · " + fmt.price(v.prix) + "</span></div></div>" +
        "</div>" +
        '<form class="form-grid" data-request novalidate>' +
          '<div class="field full"><label for="objet">Votre demande</label><select class="select" id="objet" name="objet">' +
            Object.keys(TYPES).map(function (k) { return '<option value="' + k + '">' + TYPES[k] + "</option>"; }).join("") +
          "</select></div>" +
          '<div class="field full" data-offer-field hidden><label for="montant">Montant de votre offre (€) *</label><input class="input" id="montant" name="montant" type="number" min="100" step="100" inputmode="numeric" placeholder="ex. ' + fmt.num(Math.round(v.prix * 0.95 / 100) * 100) + '"></div>' +
          '<div class="field"><label for="nom">Nom et prénom *</label><input class="input" id="nom" name="nom" autocomplete="name" required></div>' +
          '<div class="field"><label for="tel">Téléphone *</label><input class="input" id="tel" name="tel" type="tel" autocomplete="tel" required></div>' +
          '<div class="field full"><label for="email">E-mail</label><input class="input" id="email" name="email" type="email" autocomplete="email"></div>' +
          '<div class="field full"><label for="message">Message</label><textarea class="textarea" id="message" name="message"></textarea></div>' +
          '<label class="check full"><input type="checkbox" name="rgpd" required> <span class="form-note">J\'accepte que mes données soient utilisées pour être recontacté au sujet de ma demande (<a href="politique-de-confidentialite.html" style="text-decoration:underline">politique de confidentialité</a>). *</span></label>' +
          '<div class="hp" aria-hidden="true"><label>Ne pas remplir<input name="website" tabindex="-1" autocomplete="off"></label></div>' +
          '<div class="full"><button class="btn btn--primary btn--lg btn--block" type="submit" data-submit>' + icon("mail") + "Envoyer ma demande</button></div>" +
          '<p class="form-note full">' + (HAS_API ? "Votre demande est transmise directement au garage, qui vous recontacte rapidement." : "Votre messagerie s'ouvrira avec votre demande pré-remplie, il vous suffira de l'envoyer.") + "</p>" +
          '<p class="field__error full" data-form-error hidden></p>' +
          '<div class="form-success full" data-success hidden>' + icon("check") + "<span data-success-text></span></div>" +
        "</form>" +
      "</div>" +
    "</div></section>" +

    '<section class="section--tight" data-similar-wrap><div class="container">' +
      '<div class="section-head"><div><span class="eyebrow">Vous aimerez aussi</span><h2 class="h-section">Véhicules similaires</h2></div>' +
      '<a class="link-arrow" href="vehicules.html">Tout le stock' + icon("arrow-right") + "</a></div>" +
      '<div class="vgrid vgrid--4" data-similar></div>' +
    "</div></section>" +

    '<div class="mobile-buy" data-mobile-buy>' + price + '<a class="btn btn--primary" href="#demande" data-intent="' + (reserved ? "alerte" : "reservation") + '">' + icon("mail") + "Contacter</a></div>" +

    '<div class="lightbox" data-lightbox role="dialog" aria-modal="true" aria-label="Photos du véhicule" hidden>' +
      '<button class="lightbox__close" type="button" data-lb-close aria-label="Fermer">' + icon("x") + "</button>" +
      (many ? '<button class="lightbox__nav lightbox__nav--prev" type="button" data-lb-prev aria-label="Photo précédente">' + icon("chevron-left") + "</button>" +
              '<button class="lightbox__nav lightbox__nav--next" type="button" data-lb-next aria-label="Photo suivante">' + icon("chevron-right") + "</button>" : "") +
      '<img data-lb-img alt=""><span class="lightbox__count" data-lb-count></span>' +
    "</div>";

  /* ---------- Galerie ---------- */
  var current = 0;
  var main = $("[data-main]"), lb = $("[data-lightbox]"), lbImg = $("[data-lb-img]");
  function show(i) {
    current = (i + v.photos.length) % v.photos.length;
    main.src = LA.photo(v, current);
    main.alt = name + " " + v.version + " — photo " + (current + 1);
    $("[data-counter]").textContent = current + 1;
    $$("[data-thumb]").forEach(function (t) { t.setAttribute("aria-current", Number(t.getAttribute("data-thumb")) === current); });
    var p = v.photos[current], cr = $("[data-credit]");
    if (cr) cr.innerHTML = p.credit ? "Photo : " + esc(p.credit) + " — " + esc(p.licence || "") + (p.source ? ' (<a href="' + esc(p.source) + '" target="_blank" rel="noopener">source</a>)' : "") + ", recadrée. Photo d'illustration." : "";
    if (!lb.hidden) { lbImg.src = main.src; lbImg.alt = main.alt; $("[data-lb-count]").textContent = (current + 1) + " / " + v.photos.length; }
  }
  if (many) {
    $("[data-prev]").addEventListener("click", function () { show(current - 1); });
    $("[data-next]").addEventListener("click", function () { show(current + 1); });
    $$("[data-thumb]").forEach(function (t) { t.addEventListener("click", function () { show(Number(t.getAttribute("data-thumb"))); }); });
    // Balayage tactile
    var x0 = null;
    main.addEventListener("touchstart", function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    main.addEventListener("touchend", function (e) {
      if (x0 === null) return;
      var dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 40) show(current + (dx < 0 ? 1 : -1));
      x0 = null;
    });
  }
  show(0);

  var lastFocus;
  function openLb() {
    lastFocus = document.activeElement;
    lb.hidden = false;
    show(current);
    requestAnimationFrame(function () { lb.classList.add("is-open"); });
    document.body.style.overflow = "hidden";
    $("[data-lb-close]").focus();
  }
  function closeLb() {
    lb.classList.remove("is-open");
    document.body.style.overflow = "";
    setTimeout(function () { lb.hidden = true; }, 250);
    if (lastFocus) lastFocus.focus();
  }
  main.addEventListener("click", openLb);
  $("[data-zoom]").addEventListener("click", openLb);
  $("[data-lb-close]").addEventListener("click", closeLb);
  lb.addEventListener("click", function (e) { if (e.target === lb) closeLb(); });
  if (many) {
    $("[data-lb-prev]").addEventListener("click", function () { show(current - 1); });
    $("[data-lb-next]").addEventListener("click", function () { show(current + 1); });
  }
  document.addEventListener("keydown", function (e) {
    if (lb.hidden) return;
    if (e.key === "Escape") closeLb();
    if (e.key === "ArrowLeft" && many) show(current - 1);
    if (e.key === "ArrowRight" && many) show(current + 1);
  });

  /* ---------- Simulateur de financement ---------- */
  var apport = $("#apport"), duree = $("#duree"), taux = $("#taux");
  function simulate() {
    var capital = Math.max(0, v.prix - Number(apport.value));
    var n = Number(duree.value);
    var r = Math.max(0, Number(String(taux.value).replace(",", ".")) || 0) / 100 / 12;
    var m = capital === 0 ? 0 : r === 0 ? capital / n : capital * r / (1 - Math.pow(1 + r, -n));
    $("[data-apport-out]").textContent = fmt.price(Number(apport.value));
    $("[data-duree-out]").textContent = n + " mois";
    $("[data-mensualite]").textContent = fmt.price(Math.round(m)) + "/mois";
    $("[data-financed]").textContent = "Montant financé : " + fmt.price(capital);
    $("[data-cost]").textContent = "Coût total du crédit : " + fmt.price(Math.max(0, Math.round(m * n - capital)));
  }
  [apport, duree, taux].forEach(function (el) { el.addEventListener("input", simulate); });
  simulate();

  /* ---------- Formulaire de demande / offre (back-office, sinon messagerie) ---------- */
  var form = $("[data-request]");
  var offerField = $("[data-offer-field]");
  var defaultMsg = function (type) {
    return "Bonjour,\n\nJe suis intéressé(e) par le véhicule " + name + " " + v.version + " (" + v.annee + ", " + fmt.km(v.km) + ") affiché à " + fmt.price(v.prix) + " — réf. " + v.ref + ".\n\nObjet : " + TYPES[type] + ".\n\nMerci de me recontacter.";
  };
  var msgTouched = false;
  function onTypeChange() {
    offerField.hidden = form.objet.value !== "offre";
    if (!msgTouched) form.message.value = defaultMsg(form.objet.value);
  }
  form.message.addEventListener("input", function () { msgTouched = true; });
  form.objet.addEventListener("change", onTypeChange);
  if (reserved) form.objet.value = "alerte";
  onTypeChange();

  $$("[data-intent]").forEach(function (a) {
    a.addEventListener("click", function () {
      form.objet.value = a.getAttribute("data-intent");
      onTypeChange();
      setTimeout(function () { (form.objet.value === "offre" ? form.montant : form.nom).focus({ preventScroll: true }); }, 500);
    });
  });

  function setError(input, msg) {
    var f = input.closest(".field") || input.closest(".check");
    var old = f.querySelector(".field__error");
    if (old) old.remove();
    f.classList.toggle("has-error", !!msg);
    if (msg) f.insertAdjacentHTML("beforeend", '<span class="field__error">' + msg + "</span>");
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var ok = true;
    setError(form.nom, form.nom.value.trim() ? "" : "Indiquez votre nom.");
    var telOk = form.tel.value.replace(/\D/g, "").length >= 10;
    setError(form.tel, telOk ? "" : "Indiquez un numéro de téléphone valide.");
    var mailOk = !form.email.value || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.value);
    setError(form.email, mailOk ? "" : "Adresse e-mail invalide.");
    setError(form.rgpd, form.rgpd.checked ? "" : "Merci d'accepter pour que nous puissions vous recontacter.");
    var isOffer = form.objet.value === "offre";
    var montant = Number(form.montant.value);
    var offerOk = !isOffer || montant >= 100;
    setError(form.montant, offerOk ? "" : "Indiquez le montant de votre offre.");
    ok = form.nom.value.trim() && telOk && mailOk && form.rgpd.checked && offerOk;
    if (!ok) { var first = form.querySelector(".has-error input, .has-error select"); if (first) first.focus(); return; }

    var errorBox = $("[data-form-error]"), success = $("[data-success]"), btn = $("[data-submit]");
    errorBox.hidden = true;
    btn.disabled = true;
    var payload = {
      vehiculeId: v.id, type: form.objet.value, nom: form.nom.value.trim(), tel: form.tel.value.trim(),
      email: form.email.value.trim(), message: form.message.value.trim(), montant: isOffer ? montant : null, website: form.website.value,
    };
    var done = function (text) {
      $("[data-success-text]").textContent = text;
      success.hidden = false;
      success.scrollIntoView({ behavior: "smooth", block: "center" });
    };

    LA.sendRequest(payload).then(function () {
      done(isOffer
        ? "Merci ! Votre offre de " + fmt.price(montant) + " a bien été transmise. Nous vous recontactons très vite."
        : "Merci ! Votre demande a bien été envoyée. Nous vous recontactons très vite.");
      form.reset();
      msgTouched = false;
      onTypeChange();
    }).catch(function (err) {
      if (err.status === 422 || err.status === 429) {
        errorBox.textContent = err.message;
        errorBox.hidden = false;
        return;
      }
      // Back-office non configuré ou injoignable : on passe par la messagerie du visiteur
      var subject = TYPES[payload.type] + (isOffer ? " (" + fmt.price(montant) + ")" : "") + " – " + name + " (réf. " + v.ref + ")";
      var body = payload.message + (isOffer ? "\n\nMon offre : " + fmt.price(montant) : "") + "\n\n— \nNom : " + payload.nom + "\nTéléphone : " + payload.tel +
        (payload.email ? "\nE-mail : " + payload.email : "") + "\nAnnonce : " + SITE + "vehicule.html?id=" + v.id;
      window.location.href = "mailto:" + EMAIL + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
      done("Votre messagerie va s'ouvrir avec la demande pré-remplie. Si rien ne se passe, écrivez-nous à " + EMAIL + " ou appelez le " + PHONE + ".");
    }).then(function () { btn.disabled = false; });
  });

  /* ---------- Partage ---------- */
  $("[data-share]").addEventListener("click", function () {
    var data = { title: name + " – Livradois Automobiles", text: name + " " + v.version + " à " + fmt.price(v.prix), url: location.href };
    if (navigator.share) { navigator.share(data).catch(function () {}); return; }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(location.href).then(function () { LA.toast("Lien copié dans le presse-papiers"); });
    }
  });

  /* ---------- Véhicules similaires ---------- */
  var similar = LA.stock().filter(function (x) { return x.id !== v.id; }).map(function (x) {
    var score = Math.abs(x.prix - v.prix) / v.prix + (x.carrosserie === v.carrosserie ? 0 : 0.6) + (x.energie === v.energie ? 0 : 0.2) + (x.statut === "disponible" ? 0 : 1);
    return { x: x, s: score };
  }).sort(function (a, b) { return a.s - b.s; }).slice(0, 4).map(function (o) { return o.x; });
  $("[data-similar]").innerHTML = similar.map(LA.card).join("");

  /* ---------- Barre d'achat mobile ---------- */
  var mobileBuy = $("[data-mobile-buy]"), buybox = $("[data-buybox]"), demande = $("#demande");
  if ("IntersectionObserver" in window) {
    var visible = { buybox: true, demande: false };
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { visible[en.target === buybox ? "buybox" : "demande"] = en.isIntersecting; });
      mobileBuy.classList.toggle("is-visible", !visible.buybox && !visible.demande);
    });
    io.observe(buybox);
    io.observe(demande);
  }

  /* ---------- Données structurées (SEO) ---------- */
  var ld = document.createElement("script");
  ld.type = "application/ld+json";
  ld.textContent = JSON.stringify({
    "@context": "https://schema.org", "@type": "Car",
    name: name + " " + v.version, brand: { "@type": "Brand", name: v.marque }, model: v.modele,
    vehicleModelDate: String(v.annee), mileageFromOdometer: { "@type": "QuantitativeValue", value: v.km, unitCode: "KMT" },
    fuelType: v.energie, vehicleTransmission: v.boite, bodyType: v.carrosserie, color: v.couleur,
    numberOfDoors: v.portes, seatingCapacity: v.places, itemCondition: "https://schema.org/UsedCondition",
    image: v.photos.map(function (p, i) { return SITE + LA.photo(v, i); }),
    offers: {
      "@type": "Offer", price: v.prix, priceCurrency: "EUR", url: SITE + "vehicule.html?id=" + v.id,
      availability: reserved ? "https://schema.org/LimitedAvailability" : "https://schema.org/InStock",
      seller: { "@type": "AutoDealer", name: "Livradois Automobiles", telephone: "+33473958546" },
    },
  });
  document.head.appendChild(ld);
});
