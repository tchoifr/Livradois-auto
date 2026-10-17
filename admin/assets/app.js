/* Démarrage du dashboard : connexion, démonstration, menu selon les droits, compteurs */
(function () {
  "use strict";
  var BO = window.BO, $ = BO.$, $$ = BO.$$;
  var poll = null, lastNew = null;

  function showOnly(id) {
    ["login", "demo-pick", "app"].forEach(function (x) { $("#" + x).hidden = x !== id; });
  }

  function showLogin(msg) {
    BO.state.user = null;
    if (BO.demo) { showOnly("demo-pick"); return; }
    showOnly("login");
    var err = $("#login-error");
    err.hidden = !msg;
    err.textContent = msg || "";
    $('#login-form [name="password"]').value = "";
  }
  BO.onLogout = showLogin;

  function setCounts(s) {
    $$("[data-count]").forEach(function (el) { var n = s[el.getAttribute("data-count")]; el.textContent = n ? n : ""; });
    var n = s.demandesNouvelles || 0;
    if (lastNew !== null && n > lastNew) BO.toast(n - lastNew > 1 ? n - lastNew + " nouvelles demandes reçues" : "Nouvelle demande reçue sur le site");
    lastNew = n;
  }
  BO.refreshCounts = function () { if (BO.state.user) BO.api("admin/stats").then(setCounts).catch(function () {}); };

  function loadRefs() {
    return BO.api("admin/references").then(function (r) { BO.state.refs = r; });
  }

  function fillParcFilter() {
    var sel = $("[data-parc-filter]"), parcs = (BO.ref("parcs") || []).filter(function (p) { return p.actif !== false; });
    sel.hidden = parcs.length < 2;
    var cur = BO.parcFilter();
    if (cur && !parcs.some(function (p) { return String(p.id) === cur; })) { cur = ""; BO.setParcFilter(""); }
    sel.innerHTML = '<option value="">' + (BO.isAdmin() ? "Tous les parcs" : "Tous mes parcs") + "</option>" +
      parcs.map(function (p) { return '<option value="' + p.id + '"' + (String(p.id) === cur ? " selected" : "") + ">" + BO.esc(p.nom) + "</option>"; }).join("");
  }

  function showApp() {
    showOnly("app");
    var u = BO.state.user;
    $("[data-user]").innerHTML = BO.esc(u.name || u.email) + "<br><span>" + BO.esc(u.roleLabel) + "</span>";
    $("[data-demo-banner]").hidden = !BO.demo;
    $$("[data-perm]").forEach(function (el) { el.hidden = !BO.can(el.getAttribute("data-perm")); });
    fillParcFilter();
    BO.refreshCounts();
    if (!poll) {
      poll = setInterval(BO.refreshCounts, 30000);
      document.addEventListener("visibilitychange", function () { if (!document.hidden) BO.refreshCounts(); });
    }
    BO.render();
  }

  function start(user, token) {
    if (token) BO.setToken(token);
    BO.state.user = user;
    return loadRefs().then(showApp);
  }

  $("[data-parc-filter]").addEventListener("change", function (e) { BO.setParcFilter(e.target.value); BO.render(); });

  $("#login-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target, btn = $("button[type=submit]", f), err = $("#login-error");
    err.hidden = true;
    btn.disabled = true;
    BO.api("auth/login", { body: { email: f.email.value, password: f.password.value } }).then(function (r) {
      f.password.value = "";
      return start(r.user, r.token);
    }).catch(function (ex) { err.textContent = ex.message; err.hidden = false; }).then(function () { btn.disabled = false; });
  });

  $$("[data-role]").forEach(function (b) {
    b.addEventListener("click", function () {
      $$("[data-role]").forEach(function (x) { x.disabled = true; });
      $("#demo-error").hidden = true;
      b.classList.add("is-loading");
      BO.api("auth/demo", { body: { role: b.getAttribute("data-role") } }).then(function (r) {
        return start(r.user, r.token);
      }).catch(function (ex) { $("#demo-error").textContent = ex.message; $("#demo-error").hidden = false; })
        .then(function () { $$("[data-role]").forEach(function (x) { x.disabled = false; }); b.classList.remove("is-loading"); });
    });
  });

  $("[data-logout]").addEventListener("click", function () {
    if (BO.state.dirty && !window.confirm("Des modifications ne sont pas enregistrées. Se déconnecter quand même ?")) return;
    BO.state.dirty = false;
    BO.api("auth/logout", { method: "POST" }).catch(function () {}).then(function () { BO.setToken(""); showLogin(); });
  });
  $("[data-menu]").addEventListener("click", function (e) { e.stopPropagation(); $("#side").classList.toggle("is-open"); });
  document.addEventListener("click", function (e) {
    var side = $("#side");
    if (side.classList.contains("is-open") && !side.contains(e.target)) side.classList.remove("is-open");
  });
  BO.initSearch();

  if (!BO.apiBase) {
    showOnly("login");
    $("#login-config").hidden = false;
    $$("#login-form input, #login-form button").forEach(function (el) { el.disabled = true; });
    return;
  }
  if (!BO.state.token) { showLogin(); return; }
  BO.api("auth/me").then(function (r) {
    if (r.user) return start(r.user);
    BO.setToken("");
    showLogin();
  }).catch(function (e) { if (e.status !== 401) showLogin("Serveur injoignable. Réessayez dans un instant."); });
})();
