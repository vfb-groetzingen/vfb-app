const cfg = window.APP_CONFIG;
const sb = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
const CLUB = 'VfB Grötzingen';
const CATS = ['Schuhe', 'Bekleidung', 'Ausrüstung', 'Bälle', 'Sonstiges'];
const params = new URLSearchParams(location.search);

const state = {
  booted: false, tab: 'markt', user: null, isAdmin: false, displayName: '',
  messages: [], items: [],
  chatReady: false, msg: '', err: ''
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function val(id) { return document.getElementById(id).value.trim(); }
function fmt(iso) {
  return iso ? new Date(iso).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Termin offen';
}
function fmtDay(iso) {
  return iso ? new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
}
function price(p) { return Number(p).toFixed(2).replace('.', ',') + ' €'; }
function isOwn(name) { return !!name && name.startsWith(CLUB); }

async function setUser(u) {
  state.user = u; state.isAdmin = false; state.displayName = '';
  if (u) {
    const { data } = await sb.from('profiles').select('display_name,is_admin').eq('id', u.id).maybeSingle();
    state.displayName = data?.display_name || u.email;
    state.isAdmin = !!data?.is_admin;
  }
}

async function loadItems() {
  const { data, error } = await sb.from('items').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  state.items = await Promise.all((data || []).map(async it => {
    if (it.image_path) {
      const { data: s } = await sb.storage.from('flea-images').createSignedUrl(it.image_path, 3600);
      it.imgUrl = s?.signedUrl || '';
    }
    return it;
  }));
}

async function loadMessages() {
  const { data, error } = await sb.from('messages')
    .select('id,body,created_at,user_id,profiles(display_name)')
    .order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  state.messages = (data || []).reverse();
}

function subscribeChat() {
  if (state.chatReady) return;
  state.chatReady = true;
  sb.channel('chat-room').on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, async () => {
    if (state.tab === 'chat' && state.user) { await loadMessages(); render(); }
  }).subscribe();
}

async function load() {
  try {
    if (state.tab === 'chat' && state.user) { await loadMessages(); subscribeChat(); }
    if (state.tab === 'markt' || state.tab === 'admin') await loadItems();
  } catch (e) {
    state.err = 'Daten konnten nicht geladen werden: ' + e.message;
  }
}

async function go(tab) { state.tab = tab; await load(); render(); window.scrollTo(0, 0); }

function viewImpressum() {
  return `<h2>Impressum</h2>
  <div class="card">
    <h3>Angaben zum Verein</h3>
    <p>VfB 04 Grötzingen e.V.<br>Bruchwaldstraße 70<br>76229 Karlsruhe</p>
    <p>Vereinsregister: VR 120010 (Verein für Bewegungsspiele 1904 Grötzingen e.V.)<br>Vereinsnummer im Badischen Fußballverband (BFV): 38023</p>
    <p>E-Mail: info@vfb-groetzingen.de<br>Internet: <a href="https://www.vfb-groetzingen.de">www.vfb-groetzingen.de</a></p>
    <p>Seitenverantwortlicher: Philipp Benz</p>
  </div>
  <div class="card">
    <h3>Haftungsausschluss</h3>
    <p class="muted">Die Inhalte dieser App wurden mit größtmöglicher Sorgfalt erstellt. Für die Richtigkeit, Vollständigkeit und Aktualität der Inhalte übernimmt der Verein keine Gewähr. Für Inhalte fremder Webseiten, auf die verlinkt wird, sind ausschließlich deren Betreiber verantwortlich.</p>
    <h3>Urheberrecht</h3>
    <p class="muted">Die durch den Verein erstellten Inhalte und Werke unterliegen dem deutschen Urheberrecht. Vervielfältigung, Bearbeitung, Verbreitung und jede Art der Verwertung außerhalb der Grenzen des Urheberrechts bedürfen der schriftlichen Zustimmung des Vereins. Inhalte Dritter sind als solche gekennzeichnet.</p>
  </div>`;
}

function viewDatenschutz() {
  return `<h2>Datenschutz</h2>
  <div class="card">
    <p>Der Schutz deiner persönlichen Daten ist uns wichtig. Diese Übersicht beschreibt, welche Daten in dieser App verarbeitet werden. Die vollständige Datenschutzerklärung des Vereins findest du unter <a href="https://vfb-groetzingen.de/datenschutz/" target="_blank" rel="noopener">vfb-groetzingen.de/datenschutz</a>.</p>
    <h3>Verantwortlicher</h3>
    <p>VfB 04 Grötzingen e.V., Bruchwaldstraße 70, 76229 Karlsruhe, info@vfb-groetzingen.de</p>
    <h3>Welche Daten werden verarbeitet?</h3>
    <ul>
      <li><b>Konto:</b> Name, E-Mail-Adresse und Passwort (verschlüsselt gespeichert). Die E-Mail-Adresse muss bestätigt werden.</li>
      <li><b>Chat:</b> Von dir verfasste Nachrichten inklusive Anzeigename und Zeitpunkt.</li>
      <li><b>Flohmarkt:</b> Angaben zu deinen Artikeln (Titel, Preis, Kategorie, Beschreibung, optionales Foto).</li>
    </ul>
    <h3>Zweck und Speicherung</h3>
    <p>Die Daten werden ausschließlich für Anmeldung, Chat und Flohmarkt verwendet. Flohmarktartikel werden nach einem Monat per E-Mail zur Verlängerung angefragt und ohne Reaktion nach einer weiteren Woche gelöscht.</p>
    <h3>Dienstleister</h3>
    <p>Die Daten werden auf Servern des Anbieters Supabase in der Region Frankfurt gespeichert. Der Versand von E-Mails erfolgt über Brevo.</p>
    <h3>Deine Rechte</h3>
    <p>Du hast das Recht auf Auskunft, Berichtigung, Löschung und Einschränkung der Verarbeitung sowie auf Widerspruch. Wende dich dazu an info@vfb-groetzingen.de.</p>
  </div>`;
}

function viewChat() {
  if (!state.user) return `<h2>Vereinschat</h2><div class="notice warn">Der Chat ist nur für Mitglieder mit bestätigter E-Mail-Adresse. Bitte im Bereich Anmelden einloggen.</div>`;
  return `<h2>Vereinschat</h2>
  <div class="msgs" id="msgs" role="log" aria-live="polite">
    ${state.messages.map(m => `<div class="msg"><b>${esc(m.profiles?.display_name || 'Mitglied')}</b><span>${fmt(m.created_at)}</span>${state.isAdmin ? ` <button class="link" onclick="delMsg(${m.id})">löschen</button>` : ''}<p>${esc(m.body)}</p></div>`).join('') || '<p class="muted">Noch keine Nachrichten.</p>'}
  </div>
  <form class="row" onsubmit="sendMsg(event)">
    <div class="field"><label for="ci">Nachricht</label><input id="ci" maxlength="500" required autocomplete="off"></div>
    <button class="primary" type="submit">Senden</button>
  </form>`;
}

async function sendMsg(e) {
  e.preventDefault();
  const body = val('ci');
  if (!body) return;
  const { error } = await sb.from('messages').insert({ user_id: state.user.id, body });
  if (error) state.err = 'Nachricht konnte nicht gesendet werden: ' + error.message;
  render();
}

async function delMsg(id) {
  const { error } = await sb.from('messages').delete().eq('id', id);
  state.err = error ? error.message : '';
  await loadMessages();
  render();
}

function viewMarkt() {
  const form = state.user
    ? `<div class="card"><h3>Artikel einstellen</h3>
       <p class="muted">Artikel werden automatisch geprüft. Auffällige Angebote gehen zur Prüfung an den Vorstand. Nach einem Monat erhältst du eine E-Mail, ob der Artikel verlängert werden soll. Ohne Antwort wird er nach einer weiteren Woche entfernt.</p>
       <form class="row" onsubmit="addItem(event)">
         <div class="field"><label for="it">Titel</label><input id="it" required minlength="3" maxlength="80"></div>
         <div class="field"><label for="ip">Preis in €</label><input id="ip" type="number" required min="0" max="100000" step="0.5"></div>
         <div class="field"><label for="ic">Kategorie</label><select id="ic">${CATS.map(c => `<option>${c}</option>`).join('')}</select></div>
         <div class="field full"><label for="idesc">Beschreibung</label><textarea id="idesc" rows="2" maxlength="500"></textarea></div>
         <div class="field full"><label for="iimg">Foto (optional)</label><input id="iimg" type="file" accept="image/*"></div>
         <button class="primary" type="submit">Einstellen</button>
       </form></div>`
    : `<div class="notice">Zum Einstellen von Artikeln bitte anmelden.</div>`;
  const list = state.items.map(it => {
    const mine = state.user && it.seller_id === state.user.id;
    return `<div class="item">
      ${it.imgUrl ? `<img class="thumb" src="${esc(it.imgUrl)}" alt="Foto zu ${esc(it.title)}">` : ''}
      <div>
        <h3>${esc(it.title)}<span class="price">${price(it.price_eur)}</span></h3>
        <span class="tag">${esc(it.category)}</span>${it.status !== 'freigegeben' ? '<span class="tag warn-tag">In Prüfung</span>' : ''}
        <p>${esc(it.description || '')}</p>
        ${mine ? `<span class="muted">Dein Artikel</span> <button class="link" onclick="delItem('${it.id}')">Entfernen</button>` : ''}
      </div></div>`;
  }).join('');
  return `<h2>Flohmarkt für Sportartikel</h2>${form}<div class="card">${list || '<p class="muted">Noch keine Artikel.</p>'}</div>`;
}

function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, 800 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(b => { URL.revokeObjectURL(url); b ? resolve(b) : reject(new Error('Bild konnte nicht verarbeitet werden.')); }, 'image/jpeg', 0.8);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Die Datei ist kein lesbares Bild.')); };
    img.src = url;
  });
}

async function addItem(e) {
  e.preventDefault();
  const file = document.getElementById('iimg').files[0];
  let path = null;
  try {
    if (file) {
      const blob = await shrinkImage(file);
      path = `${state.user.id}/${crypto.randomUUID()}.jpg`;
      const { error: upErr } = await sb.storage.from('flea-images').upload(path, blob, { contentType: 'image/jpeg' });
      if (upErr) throw upErr;
    }
    const { data, error } = await sb.from('items').insert({
      seller_id: state.user.id,
      title: val('it'),
      price_eur: Number(val('ip')),
      category: val('ic'),
      description: val('idesc') || null,
      image_path: path
    }).select('status').single();
    if (error) throw error;
    state.msg = data.status === 'freigegeben'
      ? 'Dein Artikel ist veröffentlicht. Er bleibt einen Monat online.'
      : 'Dein Artikel wird vom Vorstand geprüft, bevor er erscheint.';
    state.err = '';
  } catch (err) {
    state.err = 'Einstellen fehlgeschlagen: ' + err.message;
  }
  try { await loadItems(); } catch (e) { state.err = state.err || 'Artikel konnten nicht neu geladen werden: ' + e.message; }
  render();
}

async function delItem(id) {
  const it = state.items.find(x => x.id === id);
  if (it?.image_path) await sb.storage.from('flea-images').remove([it.image_path]);
  const { error } = await sb.from('items').delete().eq('id', id);
  state.err = error ? error.message : '';
  state.msg = error ? '' : 'Artikel entfernt.';
  await loadItems();
  render();
}

function viewKonto() {
  if (state.user) {
    return `<h2>Konto</h2><div class="card"><p>Angemeldet als <b>${esc(state.displayName)}</b> (${esc(state.user.email)}).</p>
      <button class="secondary" onclick="signOut()">Abmelden</button></div>`;
  }
  return `<h2>Konto</h2>
  <div class="card"><h3>Registrieren</h3>
    <p class="muted">Nach der Registrierung erhältst du eine E-Mail mit einem Bestätigungslink. Erst danach ist die Anmeldung möglich.</p>
    <form class="row" onsubmit="signUp(event)">
      <div class="field"><label for="rn">Vor- und Nachname</label><input id="rn" required maxlength="60" autocomplete="name"></div>
      <div class="field"><label for="re">E-Mail</label><input id="re" type="email" required autocomplete="email"></div>
      <div class="field"><label for="rp">Passwort (mind. 8 Zeichen)</label><input id="rp" type="password" minlength="8" required autocomplete="new-password"></div>
      <button class="primary" type="submit">Registrieren</button>
    </form></div>
  <div class="card"><h3>Anmelden</h3>
    <form class="row" onsubmit="signIn(event)">
      <div class="field"><label for="le">E-Mail</label><input id="le" type="email" required autocomplete="email"></div>
      <div class="field"><label for="lp">Passwort</label><input id="lp" type="password" required autocomplete="current-password"></div>
      <button class="secondary" type="submit">Anmelden</button>
    </form></div>`;
}

async function signUp(e) {
  e.preventDefault();
  const { error } = await sb.auth.signUp({
    email: val('re'),
    password: val('rp'),
    options: { data: { name: val('rn') }, emailRedirectTo: cfg.SITE_URL }
  });
  state.err = error ? error.message : '';
  state.msg = error ? '' : 'Fast geschafft: Bitte bestätige deine E-Mail-Adresse über den Link in der Mail.';
  render();
}

async function signIn(e) {
  e.preventDefault();
  const { error } = await sb.auth.signInWithPassword({ email: val('le'), password: val('lp') });
  if (error) {
    state.err = /confirm/i.test(error.message)
      ? 'Bitte bestätige zuerst deine E-Mail-Adresse über den Link in der Mail.'
      : 'E-Mail oder Passwort ist falsch.';
    render();
  }
}

async function signOut() {
  await sb.auth.signOut();
  state.msg = 'Du bist abgemeldet.';
}

function viewAdmin() {
  if (!state.isAdmin) return '<p class="muted">Kein Zugriff.</p>';
  const list = state.items.filter(i => i.status === 'pruefung');
  return `<h2>Prüfung Flohmarkt</h2>` + (list.length
    ? list.map(it => `<div class="item"><div>
        <h3>${esc(it.title)}<span class="price">${price(it.price_eur)}</span></h3>
        <span class="tag">${esc(it.category)}</span><span class="tag warn-tag">${esc(it.check_result)}</span>
        <p>${esc(it.description || '')}</p>
        <button class="primary" onclick="setStatus('${it.id}','freigegeben')">Freigeben</button>
        <button class="secondary" onclick="setStatus('${it.id}','abgelehnt')">Ablehnen</button>
      </div></div>`).join('')
    : '<p class="muted">Keine Artikel zur Prüfung.</p>');
}

async function setStatus(id, status) {
  const { error } = await sb.from('items').update({ status }).eq('id', id);
  state.err = error ? error.message : '';
  state.msg = error ? '' : 'Status aktualisiert.';
  await loadItems();
  render();
}

function render() {
  const tabs = [['markt', 'Flohmarkt'], ['chat', 'Chat'], ['konto', state.user ? 'Konto' : 'Anmelden']];
  if (state.isAdmin) tabs.push(['admin', 'Prüfung']);
  document.getElementById('tabs').innerHTML = tabs.map(([k, l]) =>
    `<button role="tab" aria-selected="${state.tab === k}" onclick="go('${k}')">${l}</button>`).join('');
  const views = { chat: viewChat, markt: viewMarkt, konto: viewKonto, admin: viewAdmin, impressum: viewImpressum, datenschutz: viewDatenschutz };
  const notices = (state.msg ? `<div class="notice" role="status">${esc(state.msg)}</div>` : '')
    + (state.err ? `<div class="notice warn" role="alert">${esc(state.err)}</div>` : '');
  document.getElementById('main').innerHTML = notices + (views[state.tab] || viewMarkt)();
  document.getElementById('who').textContent = state.user ? `Angemeldet: ${state.displayName}` : '';
  const m = document.getElementById('msgs');
  if (m) m.scrollTop = m.scrollHeight;
  state.msg = ''; state.err = '';
}

async function handleAuth(session) {
  try {
    await setUser(session?.user || null);
    if (!state.booted) {
      state.booted = true;
      const token = params.get('renew');
      if (token) {
        const { data, error } = await sb.rpc('renew_item', { p_token: token });
        state.msg = error ? 'Verlängerung fehlgeschlagen.'
          : data === 'verlängert' ? 'Dein Artikel wurde um einen Monat verlängert.'
          : 'Dieser Link ist nicht mehr gültig.';
        state.tab = 'markt';
        history.replaceState({}, '', location.pathname);
      }
    }
    if (!state.user && state.tab === 'admin') state.tab = 'konto';
    await load();
  } catch (e) {
    state.err = 'Fehler beim Laden: ' + e.message;
  }
  render();
}

// Der Callback kehrt sofort zurück; die eigentliche Arbeit läuft danach,
// damit sich Datenbankabfragen nicht gegenseitig blockieren.
sb.auth.onAuthStateChange((_event, session) => {
  setTimeout(() => handleAuth(session), 0);
});
render();
