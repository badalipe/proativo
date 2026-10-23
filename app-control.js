/*
 * app-control.js — controle remoto do RM Gestor via versao.json
 *
 * Carregar DEPOIS do script principal do index.html, antes do </body>:
 *   <script src="app-control.js"></script>
 *
 * Substitui a verificarAtualizacao() antiga mantendo o mesmo formato do
 * versao.json (bloquear, minima, titulo, mensagem, botao_texto, botao_link)
 * e acrescentando: versao, novidades e aviso.
 */
(function () {
  'use strict';

  // APP_VERSION é a constante do index.html. Sem ela, não faz nada.
  var MY = (typeof APP_VERSION === 'number') ? APP_VERSION : null;
  if (MY === null) return;

  var CHECK_EVERY_MS = 5 * 60 * 1000;
  var K = {
    block: 'ac_block',      // último bloqueio recebido (vale offline)
    notice: 'ac_notice_seen',
    version: 'ac_version_seen',
    reload: 'ac_reload_for', // sessão: evita loop de recarga
    later: 'ac_later'        // sessão: "Depois" na atualização opcional
  };

  function store(area) {
    return function (k, v) {
      try {
        if (v === undefined) return window[area].getItem(k);
        if (v === null) window[area].removeItem(k);
        else window[area].setItem(k, v);
      } catch (e) {}
      return null;
    };
  }
  var ls = store('localStorage');
  var ss = store('sessionStorage');

  /* ---------- interface (mesmo visual do bloqueio antigo) ---------- */

  var current = null; // forced | optional | info

  function hide() {
    var old = document.getElementById('ac-layer');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    current = null;
  }

  function el(tag, css, text) {
    var n = document.createElement(tag);
    if (css) n.style.cssText = css;
    if (text) n.textContent = text;
    return n;
  }

  function show(kind, o) {
    hide();
    current = kind;

    var layer = el('div',
      'position:fixed;top:0;left:0;right:0;bottom:0;z-index:999999;display:flex;' +
      'align-items:center;justify-content:center;padding:20px;box-sizing:border-box;' +
      'background:' + (o.solid ? '#090d16' : 'rgba(9,13,22,0.85)') + ';');
    layer.id = 'ac-layer';
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-modal', 'true');

    var card = el('div',
      'background:#fff;max-width:360px;width:100%;max-height:90%;overflow:auto;box-sizing:border-box;' +
      'padding:28px 22px;border-radius:20px;text-align:center;' +
      'box-shadow:0 20px 40px rgba(0,0,0,0.5);' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;');

    card.appendChild(el('h2', 'margin:0 0 10px;font-size:19px;color:#0f172a;', o.title));

    if (o.message) {
      card.appendChild(el('p', 'margin:0 0 16px;font-size:13px;color:#64748b;line-height:1.5;', o.message));
    }

    if (o.items && o.items.length) {
      var ul = el('ul', 'margin:0 0 18px;padding-left:20px;text-align:left;font-size:13px;color:#334155;line-height:1.5;');
      o.items.forEach(function (t) { ul.appendChild(el('li', 'margin-bottom:4px;', String(t))); });
      card.appendChild(ul);
    }

    var msg = el('div', 'margin-top:10px;font-size:12px;color:#d97706;min-height:14px;');
    function say(t) { msg.textContent = t || ''; }

    (o.buttons || []).forEach(function (b) {
      var btn = el('button', 'display:block;width:100%;margin-top:8px;padding:13px;border:0;border-radius:12px;' +
        'font-weight:700;font-size:14px;cursor:pointer;' +
        (b.ghost ? 'background:#f0f7ff;color:#0066b2;' : 'background:#0066b2;color:#fff;'), b.label);
      btn.type = 'button';
      btn.addEventListener('click', function () { b.onClick(say); });
      card.appendChild(btn);
    });

    card.appendChild(msg);
    layer.appendChild(card);
    document.body.appendChild(layer);
  }

  /* ---------- ações ---------- */

  function safeLink(url) {
    return (typeof url === 'string' && /^https:\/\//i.test(url)) ? url : '';
  }

  function doReload(target, say) {
    if (!navigator.onLine) { say('Conecte-se à internet para atualizar.'); return; }
    ss(K.reload, String(target));
    // URL diferente = busca o HTML novo, sem depender de cache
    location.replace(location.pathname + '?v=' + encodeURIComponent(target));
  }

  function recheck(say) {
    if (!navigator.onLine) { say('Sem conexão com a internet.'); return; }
    say('Verificando…');
    check().then(function () { if (current === 'forced') say('Ainda indisponível.'); });
  }

  function showForced(cfg, isVersionBlock) {
    var link = safeLink(cfg.botao_link);
    var minima = Number(cfg.minima || 0);
    var label = cfg.botao_texto || (isVersionBlock || link ? 'Atualizar agora' : 'Tentar novamente');

    show('forced', {
      solid: true,
      title: cfg.titulo || (isVersionBlock ? 'Atualização necessária' : 'Acesso suspenso'),
      message: cfg.mensagem || (isVersionBlock
        ? 'Uma nova versão está disponível. Atualize para continuar usando.'
        : 'O sistema está temporariamente indisponível. Tente novamente mais tarde.'),
      items: isVersionBlock ? cfg.novidades : null,
      buttons: [{
        label: label,
        onClick: function (say) {
          if (link) { window.location.href = link; return; }
          if (isVersionBlock) doReload(minima, say); else recheck(say);
        }
      }]
    });
  }

  function showOptional(cfg, latest) {
    var temLista = cfg.novidades && cfg.novidades.length;
    show('optional', {
      title: 'Nova versão disponível',
      message: temLista ? 'Atualize para receber as melhorias abaixo.' : 'Atualize para usar a versão mais recente.',
      items: cfg.novidades,
      buttons: [
        { label: 'Atualizar agora', onClick: function (say) { doReload(latest, say); } },
        { label: 'Depois', ghost: true, onClick: function () { ss(K.later, String(latest)); hide(); } }
      ]
    });
  }

  function showInfo(cfg, latest) {
    var steps = [];

    if (latest === MY && cfg.novidades && cfg.novidades.length) {
      var seen = ls(K.version);
      if (seen === null) {
        ls(K.version, String(MY)); // primeira execução: só registra
      } else if (seen !== String(MY)) {
        steps.push(function (next) {
          show('info', {
            title: 'Novidades desta versão',
            items: cfg.novidades,
            buttons: [{ label: 'Entendi', onClick: function () { ls(K.version, String(MY)); next(); } }]
          });
        });
      }
    }

    var a = cfg.aviso;
    if (a && a.id && a.mensagem && ls(K.notice) !== String(a.id)) {
      steps.push(function (next) {
        show('info', {
          title: a.titulo || 'Aviso',
          message: a.mensagem,
          buttons: [{ label: 'Entendi', onClick: function () { ls(K.notice, String(a.id)); next(); } }]
        });
      });
    }

    (function run() {
      var step = steps.shift();
      if (step) step(run); else if (current === 'info') hide();
    })();
  }

  /* ---------- decisão ---------- */

  // Se já recarregou para a versão exigida e o app continua defasado (esqueceram
  // de subir APP_VERSION no index.html), não prende o usuário.
  function pulaTravaDeVersao(cfg) {
    return cfg.bloquear !== true && !safeLink(cfg.botao_link) &&
      ss(K.reload) === String(Number(cfg.minima || 0));
  }

  function apply(cfg) {
    cfg = cfg || {};
    var minima = Number(cfg.minima || 0);
    var latest = Number(cfg.versao || 0);
    var forced = cfg.bloquear === true || MY < minima;

    if (forced) {
      if (pulaTravaDeVersao(cfg)) { ls(K.block, null); if (current === 'forced') hide(); return; }
      ls(K.block, JSON.stringify(cfg));
      showForced(cfg, cfg.bloquear !== true);
      return;
    }

    ls(K.block, null);
    if (current === 'forced') hide();

    if (latest > MY) {
      if (current === null && ss(K.later) !== String(latest) && ss(K.reload) !== String(latest)) {
        showOptional(cfg, latest);
      }
      return;
    }

    if (current === 'optional') hide();
    if (current === null) showInfo(cfg, latest);
  }

  var inflight = null;
  function check() {
    if (inflight) return inflight;
    if (!navigator.onLine) return Promise.resolve();
    inflight = fetch('versao.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) {
        if (r.status === 404) return {};            // sem arquivo = sem restrições
        if (!r.ok) throw new Error('versao.json ' + r.status);
        return r.json();
      })
      .then(apply)
      .catch(function () { /* sem rede ou JSON inválido: mantém o estado atual */ })
      .then(function () { inflight = null; });
    return inflight;
  }

  function atualizarServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.getRegistration().then(function (r) { if (r) r.update(); }).catch(function () {});
  }

  // Baixa (uma vez) as fotos dos produtos que o app já conhece, para o service
  // worker guardá-las e elas aparecerem também offline.
  var FOTOS_CACHE = 'rm-gestor-fotos-v1';
  var baixandoFotos = false;

  function guardarFotos() {
    if (baixandoFotos || !navigator.onLine || !window.caches) return;

    var urls = {};
    function add(u) { if (typeof u === 'string' && /^https?:\/\//i.test(u)) urls[u] = 1; }
    try {
      if (typeof catalogoLocal === 'object' && catalogoLocal) {
        Object.keys(catalogoLocal).forEach(function (k) {
          var v = catalogoLocal[k];
          if (v && typeof v === 'object') add(v.img);
        });
      }
    } catch (e) {}
    try {
      [typeof itensProAtivo !== 'undefined' ? itensProAtivo : [],
       typeof itensTrocas !== 'undefined' ? itensTrocas : []].forEach(function (lista) {
        (lista || []).forEach(function (i) { add(i && i.imagem); });
      });
    } catch (e) {}

    var fila = Object.keys(urls).slice(0, 200);
    if (!fila.length) return;

    baixandoFotos = true;
    var ativos = 3;

    function fim() { if (--ativos === 0) baixandoFotos = false; }

    function proximo() {
      var u = fila.shift();
      if (!u) { fim(); return; }
      caches.match(u, { cacheName: FOTOS_CACHE }).then(function (jaTem) {
        if (jaTem) { proximo(); return; }
        var seguiu = false;
        function seguir() { if (!seguiu) { seguiu = true; proximo(); } }
        var img = new Image();   // o service worker intercepta e guarda
        img.onload = img.onerror = seguir;
        setTimeout(seguir, 15000);
        img.src = u;
      }).catch(proximo);
    }

    for (var n = 0; n < 3; n++) proximo();
  }

  function verificarTudo() {
    atualizarServiceWorker();
    guardarFotos();
    return check();
  }

  // Troca a função antiga (chamada no DOMContentLoaded do index.html).
  window.verificarAtualizacao = check;

  /* ---------- início ---------- */

  // Bloqueio já recebido antes continua valendo mesmo sem internet.
  var guardado = ls(K.block);
  if (guardado) {
    try {
      var c = JSON.parse(guardado);
      var aindaForcado = c.bloquear === true || MY < Number(c.minima || 0);
      if (aindaForcado && !pulaTravaDeVersao(c)) showForced(c, c.bloquear !== true);
      else ls(K.block, null);
    } catch (e) { ls(K.block, null); }
  }

  check();
  setTimeout(guardarFotos, 4000); // depois que a tela principal carregou
  window.addEventListener('online', verificarTudo);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) verificarTudo(); });
  setInterval(verificarTudo, CHECK_EVERY_MS);
})();
