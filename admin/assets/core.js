/* Back-office Livradois Automobiles — noyau du dashboard (API, routeur, composants communs) */
(function () {
  "use strict";

  var BO = (window.BO = {});
  var DEMO = /[?&]demo=1\b/.test(location.search);
  var API_BASE = ((window.LA_CONFIG || {}).adminApi || (window.LA_CONFIG || {}).api || "").replace(/\/+$/, "");
  var TOKEN_KEY = DEMO ? "la_demo_token" : "la_admin_token";

  BO.demo = DEMO;
  BO.apiBase = API_BASE;
  BO.state = { user: null, refs: null, token: "", dirty: false };
  BO.siteUrl = new URL("../", location.href).href;

  /* ---------- Utilitaires ---------- */
  BO.$ = function (s, r) { return (r || document).querySelector(s); };
  BO.$$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  BO.esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  };
  BO.icon = function (n, c) { return '<svg class="i' + (c ? " " + c : "") + '" aria-hidden="true"><use href="assets/icons.svg#' + n + '"/></svg>'; };
  var esc = BO.esc, icon = BO.icon;

  var nf = new Intl.NumberFormat("fr-FR");
  var nf2 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  BO.fmt = {
    euros: function (n) { return n == null ? "—" : nf.format(n) + " €"; },
    cents: function (c) { return c == null ? "—" : nf2.format(c / 100) + " €"; },
    centsInput: function (c) { return c == null ? "" : (c / 100).toFixed(2).replace(".", ","); },
    km: function (n) { return nf.format(n) + " km"; },
    num: function (n) { return nf.format(n); },
    date: function (s) { if (!s) return "—"; var d = BO.parseDate(s); return d.toLocaleDateString("fr-FR"); },
    dateLong: function (s) { return BO.parseDate(s).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }); },
    time: function (s) { return s ? String(s).slice(11, 16).replace(":", "h") : ""; },
    datetime: function (s) { return s ? BO.fmt.date(s) + " à " + BO.fmt.time(s) : "—"; },
    plural: function (n, s, p) { return n + " " + (n > 1 ? (p || (/[sx]$/.test(s) ? s : s + "s")) : s); },
  };
  BO.parseDate = function (s) { return s ? new Date(String(s).replace(" ", "T")) : null; };
  BO.when = function (s) {
    var d = BO.parseDate(s);
    if (!d || isNaN(d)) return "";
    var diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 0) return BO.fmt.datetime(s);
    if (diff < 60) return "à l'instant";
    if (diff < 3600) return "il y a " + Math.floor(diff / 60) + " min";
    if (diff < 86400) return "il y a " + Math.floor(diff / 3600) + " h";
    if (diff < 86400 * 7) return "il y a " + BO.fmt.plural(Math.floor(diff / 86400), "jour");
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
  };
  BO.isoDate = function (d) {
    var p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  };
  BO.addDays = function (d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; };
  BO.photoUrl = function (p, small) {
    if (!p) return "";
    if (p.url) return small && p.urlSmall ? p.urlSmall : p.url;
    if (p.fichier) return BO.siteUrl + "public/assets/vehicules/" + p.fichier + (small ? "-sm" : "") + ".webp";
    return "";
  };
  BO.thumb = function (p, cls) {
    var u = BO.photoUrl(p, true);
    return u ? '<img class="' + (cls || "") + '" src="' + esc(u) + '" alt="" loading="lazy">' : '<div class="' + (cls || "") + ' noimg">' + icon("car") + "</div>";
  };
  BO.can = function (perm) {
    var p = (BO.state.user && BO.state.user.permissions) || [];
    return p.indexOf("*") !== -1 || p.indexOf(perm) !== -1;
  };
  BO.isAdmin = function () { return BO.state.user && BO.state.user.role === "admin"; };
  BO.ref = function (k) { return (BO.state.refs || {})[k]; };
  BO.label = function (k, v) { var m = BO.ref(k) || {}; return m[v] || v; };
  BO.motifLabel = function (code) { var m = (BO.ref("motifs") || []).filter(function (x) { return x.code === code; })[0]; return m ? m.libelle : code; };
  BO.parcName = function (id) { var p = (BO.ref("parcs") || []).filter(function (x) { return x.id === id; })[0]; return p ? p.nom : "—"; };

  /* ---------- API ---------- */
  var store = {
    get: function () { try { return sessionStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; } },
    set: function (t) { try { if (t) sessionStorage.setItem(TOKEN_KEY, t); else sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* stockage indisponible */ } },
  };
  BO.state.token = store.get();
  BO.setToken = function (t) { BO.state.token = t || ""; store.set(t || ""); };

  function fetchRetry(url, init, tries) {
    return fetch(url, init).catch(function (err) {
      if (tries <= 1) throw err;
      return new Promise(function (r) { setTimeout(r, 600); }).then(function () { return fetchRetry(url, init, tries - 1); });
    });
  }

  /** Appel à l'API. Les erreurs portent .status et .data (ex. 409 + conflits). */
  BO.api = function (route, opts) {
    opts = opts || {};
    var method = opts.method || (opts.body || opts.form ? "POST" : "GET");
    var init = { method: method, credentials: "omit", cache: "no-store", headers: {} };
    if (BO.state.token) init.headers["X-LA-Token"] = BO.state.token;
    if (opts.body) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(opts.body); }
    if (opts.form) init.body = opts.form;
    var q = new URLSearchParams();
    if (DEMO) q.set("demo", "1");
    q.set("r", route);
    Object.keys(opts.query || {}).forEach(function (k) { if (opts.query[k] !== "" && opts.query[k] != null) q.set(k, opts.query[k]); });
    var url = API_BASE + "?" + q.toString();
    var safe = method === "GET" || route === "auth/login" || route === "auth/demo";
    return (safe ? fetchRetry(url, init, 4) : fetch(url, init)).catch(function () {
      throw Object.assign(new Error("Serveur injoignable, vérifiez votre connexion puis réessayez."), { status: 0 });
    }).then(function (res) {
      if (opts.raw) {
        if (!res.ok) return res.json().catch(function () { return {}; }).then(function (d) { throw Object.assign(new Error(d.error || "Erreur " + res.status), { status: res.status }); });
        return res;
      }
      return res.json().catch(function () { return null; }).then(function (data) {
        if (res.status === 401 && route !== "auth/login") {
          BO.setToken("");
          BO.state.dirty = false;
          if (BO.onLogout) BO.onLogout("Votre session a expiré, reconnectez-vous.");
          throw Object.assign(new Error("Session expirée."), { status: 401 });
        }
        if (!res.ok) throw Object.assign(new Error((data && data.error) || "Erreur " + res.status), { status: res.status, data: data || {} });
        return data;
      });
    });
  };

  /** Téléchargement authentifié (document privé, export CSV). */
  BO.download = function (route, query, fallbackName) {
    return BO.api(route, { query: query, raw: true }).then(function (res) {
      var cd = res.headers.get("Content-Disposition") || "";
      var m = cd.match(/filename\*=UTF-8''([^;]+)/) || cd.match(/filename="([^"]+)"/);
      var name = m ? decodeURIComponent(m[1]) : fallbackName || "document";
      return res.blob().then(function (blob) {
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      });
    }).catch(BO.fail);
  };

  /* ---------- Notifications à l'écran ---------- */
  var toastTimer;
  BO.toast = function (msg, error) {
    var t = BO.$("#toast");
    t.textContent = msg;
    t.classList.toggle("is-error", !!error);
    t.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("is-visible"); }, 3600);
  };
  BO.fail = function (e) { if (e && e.status !== 401) BO.toast(e.message || String(e), true); };

  /* ---------- Fenêtres (modales) ---------- */
  BO.modal = function (o) {
    var d = document.createElement("dialog");
    d.className = "modal" + (o.wide ? " modal--wide" : "");
    d.innerHTML = '<div class="modal__head"><h2>' + esc(o.title) + '</h2><button type="button" class="icon-btn" data-close aria-label="Fermer">' + icon("x") + "</button></div>" +
      '<div class="modal__body"></div><div class="modal__foot"></div>';
    var body = BO.$(".modal__body", d), foot = BO.$(".modal__foot", d);
    if (typeof o.body === "string") body.innerHTML = o.body; else if (o.body) body.appendChild(o.body);
    (o.actions || []).forEach(function (a) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "btn " + (a.primary ? "btn--primary" : a.danger ? "btn--danger" : "btn--ghost");
      b.innerHTML = (a.icon ? icon(a.icon) : "") + esc(a.label);
      b.addEventListener("click", function () {
        if (!a.onClick) { close(); return; }
        b.disabled = true;
        Promise.resolve(a.onClick(api)).then(function (keep) { if (keep !== true) close(); }).catch(BO.fail).then(function () { b.disabled = false; });
      });
      foot.appendChild(b);
    });
    if (!o.actions || !o.actions.length) foot.remove();
    function close() { d.close(); }
    d.addEventListener("close", function () { d.remove(); if (o.onClose) o.onClose(); });
    BO.$("[data-close]", d).addEventListener("click", close);
    d.addEventListener("click", function (e) { if (e.target === d) close(); });
    document.body.appendChild(d);
    d.showModal();
    var api = { el: d, body: body, close: close };
    if (o.onOpen) o.onOpen(api);
    var first = BO.$("input:not([type=hidden]), select, textarea", body);
    if (first && !o.noFocus) first.focus();
    return api;
  };

  BO.confirm = function (title, text, okLabel, danger) {
    return new Promise(function (resolve) {
      var answered = false;
      BO.modal({
        title: title, body: "<p>" + esc(text) + "</p>",
        actions: [{ label: "Annuler" }, { label: okLabel || "Confirmer", danger: danger !== false, primary: danger === false, onClick: function () { answered = true; resolve(true); } }],
        onClose: function () { if (!answered) resolve(false); },
      });
    });
  };

  BO.prompt = function (title, label, placeholder) {
    return new Promise(function (resolve) {
      var done = false;
      var m = BO.modal({
        title: title,
        body: '<label class="field">' + esc(label) + '<textarea class="textarea" rows="3" placeholder="' + esc(placeholder || "") + '"></textarea></label>',
        actions: [{ label: "Annuler" }, { label: "Valider", primary: true, onClick: function () { done = true; resolve(BO.$("textarea", m.body).value.trim()); } }],
        onClose: function () { if (!done) resolve(null); },
      });
    });
  };

  /* ---------- Formulaires ---------- */
  BO.values = function (form) {
    var out = {};
    BO.$$("input, select, textarea", form).forEach(function (el) {
      if (!el.name || el.disabled) return;
      if (el.type === "checkbox") {
        if (el.dataset.multi !== undefined) { (out[el.name] = out[el.name] || []); if (el.checked) out[el.name].push(el.value); }
        else out[el.name] = el.checked;
      } else if (el.type === "radio") { if (el.checked) out[el.name] = el.value; }
      else out[el.name] = el.value.trim();
    });
    return out;
  };
  BO.f = {
    input: function (name, label, value, attrs, hint) {
      return '<label class="field">' + label + (hint ? " <small>" + hint + "</small>" : "") + '<input class="input" name="' + name + '" value="' + esc(value == null ? "" : value) + '" ' + (attrs || "") + "></label>";
    },
    select: function (name, label, options, value, attrs) {
      var opts = Array.isArray(options) ? options.map(function (o) { return typeof o === "object" ? o : { value: o, label: o }; })
        : Object.keys(options).map(function (k) { return { value: k, label: options[k] }; });
      return '<label class="field">' + label + '<select class="select" name="' + name + '" ' + (attrs || "") + ">" +
        opts.map(function (o) { return '<option value="' + esc(o.value) + '"' + (String(o.value) === String(value == null ? "" : value) ? " selected" : "") + ">" + esc(o.label) + "</option>"; }).join("") +
        "</select></label>";
    },
    textarea: function (name, label, value, attrs, hint) {
      return '<label class="field">' + label + (hint ? " <small>" + hint + "</small>" : "") + '<textarea class="textarea" name="' + name + '" ' + (attrs || "") + ">" + esc(value || "") + "</textarea></label>";
    },
    check: function (name, label, checked, attrs) {
      return '<label class="check"><input type="checkbox" name="' + name + '"' + (checked ? " checked" : "") + " " + (attrs || "") + "> " + label + "</label>";
    },
    userOptions: function (empty) {
      return [{ value: "", label: empty || "—" }].concat((BO.ref("utilisateurs") || []).map(function (u) { return { value: u.id, label: u.nom }; }));
    },
    parcOptions: function (empty) {
      return (empty ? [{ value: "", label: empty }] : []).concat((BO.ref("parcs") || []).filter(function (p) { return p.actif !== false; }).map(function (p) { return { value: p.id, label: p.nom }; }));
    },
  };

  /* ---------- Pastilles ---------- */
  BO.pill = function (kind, value, label) { return '<span class="pill pill--' + esc(kind) + "-" + esc(value) + '">' + esc(label || value) + "</span>"; };
  BO.statutVehicule = function (v) { return BO.pill("v", v.statut, BO.label("statutsVehicule", v.statut)); };
  BO.ctBadge = function (ct) {
    var cls = { ok: "ok", bientot: "warn", echu: "danger", a_verifier: "warn", inconnu: "muted" }[ct.etat] || "muted";
    return '<span class="tag tag--' + cls + '" title="' + esc(ct.label) + '">' + icon("clipboard") + esc(ct.etat === "ok" ? "CT OK" : ct.etat === "inconnu" ? "CT ?" : ct.etat === "a_verifier" ? "CT à vérifier" : ct.label) + "</span>";
  };
  BO.progress = function (p) {
    var pct = p.total ? Math.round(p.faits / p.total * 100) : 100;
    return '<div class="progress' + (pct === 100 ? " is-done" : "") + '" title="' + esc(p.manquants.join(", ") || "Préparation complète") + '"><span style="width:' + pct + '%"></span><em>' + p.faits + "/" + p.total + "</em></div>";
  };

  /* ---------- Routeur ---------- */
  var routes = [];
  /** BO.route(/^\/x$/, fn(view, params, query), { nav, title, perm }) */
  BO.route = function (re, fn, o) { routes.push({ re: re, fn: fn, nav: o.nav, title: o.title, perm: o.perm }); };
  var lastHash = location.hash, skipNext = false;

  BO.go = function (hash) { if (location.hash === hash) BO.render(); else location.hash = hash; };

  BO.render = function () {
    if (!BO.state.user) return;
    if (skipNext) { skipNext = false; return; }
    if (BO.state.dirty && location.hash !== lastHash) {
      if (!window.confirm("Des modifications ne sont pas enregistrées. Quitter quand même ?")) { skipNext = true; location.hash = lastHash; return; }
      BO.state.dirty = false;
    }
    lastHash = location.hash;
    var full = location.hash.slice(1) || "/";
    var path = full.split("?")[0], query = Object.fromEntries(new URLSearchParams(full.split("?")[1] || ""));
    var r = routes.filter(function (x) { return x.re.test(path); })[0] || routes[0];
    if (r.perm && !BO.can(r.perm)) r = routes[0];
    var m = path.match(r.re) || [];
    BO.$$("[data-nav]").forEach(function (a) { a.classList.toggle("is-active", a.getAttribute("data-nav") === r.nav); });
    var title = typeof r.title === "function" ? r.title(m) : r.title;
    BO.$("[data-title]").textContent = title;
    document.title = title + " – Back-office Livradois Automobiles";
    BO.$("[data-actions]").innerHTML = "";
    BO.$("#side").classList.remove("is-open");
    var old = BO.$("#view"), view = old.cloneNode(false);
    old.replaceWith(view);
    view.innerHTML = '<p class="loading">Chargement…</p>';
    Promise.resolve(r.fn(view, m.slice(1), query)).catch(function (e) {
      BO.fail(e);
      view.innerHTML = '<div class="empty">' + icon("info") + "<p>" + esc(e.message) + "</p></div>";
    });
    window.scrollTo(0, 0);
  };
  window.addEventListener("hashchange", BO.render);
  window.addEventListener("beforeunload", function (e) { if (BO.state.dirty) { e.preventDefault(); e.returnValue = ""; } });

  BO.actions = function (html) { BO.$("[data-actions]").innerHTML = html; };
  BO.setQuery = function (q) {
    var path = (location.hash.slice(1) || "/").split("?")[0];
    var qs = new URLSearchParams();
    Object.keys(q).forEach(function (k) { if (q[k] !== "" && q[k] != null && q[k] !== false) qs.set(k, q[k]); });
    var h = "#" + path + (qs.toString() ? "?" + qs.toString() : "");
    // replaceState ne déclenche pas « hashchange » : rien à ignorer ensuite
    if (h !== location.hash) { history.replaceState(null, "", h); lastHash = h; }
  };

  /* ---------- Filtre de parc (mémorisé pour chaque utilisateur) ---------- */
  BO.parcFilter = function () {
    try { return localStorage.getItem("la_parc_" + (BO.state.user && BO.state.user.id) + (DEMO ? "_demo" : "")) || ""; } catch (e) { return ""; }
  };
  BO.setParcFilter = function (v) {
    try { localStorage.setItem("la_parc_" + BO.state.user.id + (DEMO ? "_demo" : ""), v || ""); } catch (e) { /* ignoré */ }
  };

  /* ---------- Recherche globale ---------- */
  BO.initSearch = function () {
    var input = BO.$("[data-search]"), box = BO.$("[data-search-results]"), timer;
    if (!input) return;
    function hide() { box.hidden = true; }
    input.addEventListener("input", function () {
      clearTimeout(timer);
      var q = input.value.trim();
      if (q.length < 2) { hide(); return; }
      timer = setTimeout(function () {
        BO.api("admin/recherche", { query: { q: q } }).then(function (r) {
          var html = "";
          if (r.vehicules.length) {
            html += '<p class="sr-title">Véhicules</p>' + r.vehicules.map(function (v) {
              return '<a class="sr-item" href="#/vehicules/' + v.id + '">' + BO.thumb(v.photo, "sr-img") + "<span><strong>" + esc(v.titre) + "</strong><small>" + esc([v.numeroStock, v.immatriculation, v.statut, v.parc].filter(Boolean).join(" · ")) + "</small></span></a>";
            }).join("");
          }
          if (r.clients.length) {
            html += '<p class="sr-title">Clients</p>' + r.clients.map(function (c) {
              return '<a class="sr-item" href="#/clients/' + c.id + '"><span class="sr-avatar">' + icon("user") + "</span><span><strong>" + esc(c.nomComplet) + "</strong><small>" + esc([c.telephone, c.email].filter(Boolean).join(" · ")) + "</small></span></a>";
            }).join("");
          }
          box.innerHTML = html || '<p class="sr-empty">Aucun résultat pour « ' + esc(q) + " »</p>";
          box.hidden = false;
        }).catch(function () {});
      }, 220);
    });
    input.addEventListener("keydown", function (e) { if (e.key === "Escape") { input.value = ""; hide(); } });
    box.addEventListener("click", function () { input.value = ""; hide(); });
    document.addEventListener("click", function (e) { if (!e.target.closest(".search-global")) hide(); });
  };

  /* ---------- Aperçu d'un message avant envoi (spécification 11 : destinataire, canal, texte final) ---------- */
  BO.proposeMessage = function (p) {
    if (!p) return Promise.resolve();
    if (!p.possible) { BO.toast("Message au client non proposé : " + p.raison); return Promise.resolve(); }
    return new Promise(function (resolve) {
      var redirect = p.redirection ? '<p class="note note--warn">' + icon("info") + "Mode test : l'e-mail partira vers <strong>" + esc(p.redirection) + "</strong> (destinataire prévu indiqué dans le message).</p>" : "";
      BO.modal({
        title: "Prévenir le client ?",
        body: '<div class="msg-preview"><p><strong>Destinataire :</strong> ' + esc(p.destinataire) + " · <strong>Canal :</strong> " + (p.canal === "sms" ? "SMS" : "e-mail") + "</p>" +
          (p.canal === "email" ? '<p><strong>Objet :</strong> ' + esc(p.sujet) + "</p>" : "") +
          '<label class="field">Message<textarea class="textarea" rows="8" data-texte>' + esc(p.texte) + "</textarea></label>" + redirect + "</div>",
        wide: true,
        actions: [
          { label: "Ne pas envoyer", onClick: function () { resolve(); } },
          {
            label: "Envoyer", primary: true, icon: "mail", onClick: function (m) {
              return BO.api("admin/notifications/envoyer", { body: { rendezVousId: p.rendezVousId, template: p.template, extra: p.extra || {}, texte: BO.$("[data-texte]", m.body).value } })
                .then(function (n) { BO.toast(n.statut === "envoye" || n.statut === "simule" ? "Message envoyé" : n.statut === "en_attente" ? "Envoi en cours (nouvel essai automatique)" : "Échec de l'envoi : " + n.erreur, n.statut === "echec"); resolve(); });
            },
          },
        ],
        onClose: function () { resolve(); },
      });
    });
  };
})();
