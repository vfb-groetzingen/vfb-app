const cfg = window.APP_CONFIG;
const sb = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
const CATS = ['Schuhe', 'Bekleidung', 'Ausrüstung', 'Bälle', 'Sonstiges'];
const params = new URLSearchParams(location.search);

const state = {
  booted: false, tab: 'markt', user: null, isAdmin: false, displayName: '',
  messages: [], items: [], reports: [],
  chatReady: false, msg: '', err: '', editItem: null, inquiryId: null,
  recovery: false, pendingEmail: '',
  filter: { q: '', cat: '', sort: 'neu', nurFrei: false }
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function val(id) { return document.getElementById(id).value.trim(); }
function fmt(iso) {
  return iso ? new Date(iso).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Termin offen';
}
function price(p) { return Number(p).toFixed(2).replace('.', ',') + ' €'; }

// Liest eine Fehlermeldung aus einer Edge-Function-Antwort (Text des Servers statt generischer Meldung)
async function fnErrorText(data, error) {
  if (data?.error) return data.error;
  if (error?.context) {
    const txt = await error.context.text().catch(() => '');
    try { const p = JSON.parse(txt); if (p.error) return p.error; } catch (_) {}
    return `HTTP ${error.context.status}${txt ? ': ' + txt.slice(0, 200) : ''}`;
  }
  return error?.message || 'unbekannter Fehler';
}

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

async function loadReports() {
  const { data, error } = await sb.from('reports')
    .select('id,reason,created_at,item_id,message_id,items(id,title),messages(id,body),reporter:profiles(display_name)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  state.reports = data || [];
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
    if (state.isAdmin) await loadReports();
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
      <li><b>Flohmarkt:</b> Angaben zu deinen Artikeln (Titel, Preis, Kategorie, Beschreibung, optionales Foto, Status „verkauft“).</li>
      <li><b>Anfragen:</b> Wenn du einen Verkäufer anfragst, werden dein Anzeigename und deine Nachricht per E-Mail an den Verkäufer weitergegeben. Deine E-Mail-Adresse wird dabei als Antwortadresse genutzt. Die Adresse des Verkäufers erfährst du dadurch nicht. Zur Begrenzung von Spam wird gespeichert, wann du Anfragen gesendet hast; dieses Protokoll wird nach zwei Tagen gelöscht.</li>
      <li><b>Meldungen:</b> Meldest du einen Artikel oder eine Chat-Nachricht, werden deine Begründung und dein Anzeigename dem Vorstand angezeigt.</li>
    </ul>
    <h3>Zweck und Speicherung</h3>
    <p>Die Daten werden ausschließlich für Anmeldung, Chat und Flohmarkt verwendet. Flohmarktartikel werden nach einem Monat per E-Mail zur Verlängerung angefragt und ohne Reaktion nach einer weiteren Woche gelöscht.</p>
    <h3>Dienstleister</h3>
    <p>Die Daten werden auf Servern des Anbieters Supabase in der Region Frankfurt gespeichert. Der Versand von E-Mails erfolgt über Brevo.</p>
    <h3>Löschung</h3>
    <p>Du kannst dein Konto jederzeit im Bereich „Konto“ löschen. Dabei werden deine Daten, deine Artikel, Fotos, Chat-Nachrichten und Meldungen entfernt.</p>
    <h3>Deine Rechte</h3>
    <p>Du hast das Recht auf Auskunft, Berichtigung, Löschung und Einschränkung der Verarbeitung sowie auf Widerspruch. Wende dich dazu an info@vfb-groetzingen.de.</p>
  </div>`;
}

function viewChat() {
  if (!state.user) return `<h2>Vereinschat</h2><div class="notice warn">Der Chat ist nur für Mitglieder mit bestätigter E-Mail-Adresse. Bitte im Bereich Konto anmelden.</div>`;
  return `<h2>Vereinschat</h2>
  <div class="msgs" id="msgs" role="log" aria-live="polite">
    ${state.messages.map(m => `<div class="msg"><b>${esc(m.profiles?.display_name || 'Mitglied')}</b><span>${fmt(m.created_at)}</span>${m.user_id !== state.user.id ? ` <button class="link" onclick="reportMsg(${m.id})">melden</button>` : ''}${state.isAdmin ? ` <button class="link" onclick="delMsg(${m.id})">löschen</button>` : ''}<p>${esc(m.body)}</p></div>`).join('') || '<p class="muted">Noch keine Nachrichten.</p>'}
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
  state.err = error ? 'Nachricht konnte nicht gesendet werden: ' + error.message : '';
  if (!error) await loadMessages();
  render();
}

async function delMsg(id) {
  if (!confirm('Nachricht wirklich löschen?')) return;
  const { error } = await sb.from('messages').delete().eq('id', id);
  state.err = error ? error.message : '';
  await loadMessages();
  render();
}

async function askReason(was) {
  const r = (window.prompt(`Was stört dich an diesem ${was}? (3 bis 300 Zeichen)`) || '').trim();
  if (!r) return null;
  if (r.length < 3 || r.length > 300) {
    state.err = 'Die Begründung muss zwischen 3 und 300 Zeichen lang sein.';
    render();
    return null;
  }
  return r;
}

async function reportMsg(id) {
  const reason = await askReason('Chat-Nachricht');
  if (!reason) return;
  const { error } = await sb.from('reports').insert({ reporter_id: state.user.id, message_id: id, reason });
  state.msg = error ? '' : 'Danke. Der Vorstand prüft die Meldung.';
  state.err = error ? 'Meldung fehlgeschlagen: ' + error.message : '';
  render();
}

async function reportItem(id) {
  const reason = await askReason('Artikel');
  if (!reason) return;
  const { error } = await sb.from('reports').insert({ reporter_id: state.user.id, item_id: id, reason });
  state.msg = error ? '' : 'Danke. Der Vorstand prüft die Meldung.';
  state.err = error ? 'Meldung fehlgeschlagen: ' + error.message : '';
  render();
}

function itemForm() {
  const e = state.editItem;
  const v = k => esc(e ? (e[k] ?? '') : '');
  return `<div class="card"><h3>${e ? 'Artikel bearbeiten' : 'Artikel einstellen'}</h3>
       <p class="muted">Artikel werden automatisch geprüft. Auffällige Angebote gehen zur Prüfung an den Vorstand. Nach einem Monat erhältst du eine E-Mail, ob der Artikel verlängert werden soll. Ohne Antwort wird er nach einer weiteren Woche entfernt.${e ? ' Bei Änderungen an Titel, Preis, Kategorie oder Beschreibung wird der Artikel erneut geprüft.' : ''}</p>
       <form class="row" onsubmit="saveItem(event)">
         <div class="field"><label for="it">Titel</label><input id="it" required minlength="3" maxlength="80" value="${v('title')}"></div>
         <div class="field"><label for="ip">Preis in €</label><input id="ip" type="number" required min="0" max="100000" step="0.5" value="${e ? Number(e.price_eur) : ''}"></div>
         <div class="field"><label for="ic">Kategorie</label><select id="ic">${CATS.map(c => `<option ${e && e.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
         <div class="field full"><label for="idesc">Beschreibung</label><textarea id="idesc" rows="2" maxlength="500">${v('description')}</textarea></div>
         <div class="field full"><label for="iimg">${e ? 'Neues Foto (optional, ersetzt das bisherige)' : 'Foto (optional)'}</label><input id="iimg" type="file" accept="image/*"></div>
         <button class="primary" type="submit">${e ? 'Speichern' : 'Einstellen'}</button>
         ${e ? '<button class="secondary" type="button" onclick="cancelEdit()">Abbrechen</button>' : ''}
       </form></div>`;
}

function filterBar() {
  const f = state.filter;
  return `<div class="card filter" role="search">
    <div class="row">
      <div class="field"><label for="fq">Suche</label><input id="fq" type="search" placeholder="Titel oder Beschreibung" value="${esc(f.q)}" oninput="setFilter()"></div>
      <div class="field"><label for="fc">Kategorie</label><select id="fc" onchange="setFilter()"><option value="">Alle</option>${CATS.map(c => `<option ${f.cat === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      <div class="field"><label for="fs">Sortierung</label><select id="fs" onchange="setFilter()">
        <option value="neu" ${f.sort === 'neu' ? 'selected' : ''}>Neueste zuerst</option>
        <option value="preis-auf" ${f.sort === 'preis-auf' ? 'selected' : ''}>Preis aufsteigend</option>
        <option value="preis-ab" ${f.sort === 'preis-ab' ? 'selected' : ''}>Preis absteigend</option>
      </select></div>
      <div class="field check"><label><input type="checkbox" id="fv" onchange="setFilter()" ${f.nurFrei ? 'checked' : ''}> nur verfügbare Artikel</label></div>
    </div>
  </div>`;
}

function setFilter() {
  state.filter = {
    q: document.getElementById('fq').value.trim().toLowerCase(),
    cat: document.getElementById('fc').value,
    sort: document.getElementById('fs').value,
    nurFrei: document.getElementById('fv').checked
  };
  renderList();
}

function filteredItems() {
  const f = state.filter;
  const list = state.items.filter(it => {
    if (f.cat && it.category !== f.cat) return false;
    if (f.nurFrei && it.sold_at) return false;
    if (f.q && !`${it.title} ${it.description || ''}`.toLowerCase().includes(f.q)) return false;
    return true;
  });
  if (f.sort === 'preis-auf') list.sort((a, b) => Number(a.price_eur) - Number(b.price_eur));
  if (f.sort === 'preis-ab') list.sort((a, b) => Number(b.price_eur) - Number(a.price_eur));
  return list;
}

function inquiryForm(id) {
  return `<form class="row" onsubmit="sendInquiry(event,'${id}')"><div class="field full"><label for="iq-${id}">Deine Nachricht an den Verkäufer</label><textarea id="iq-${id}" rows="2" required minlength="5" maxlength="500"></textarea></div><button class="primary" type="submit">Senden</button> <button class="secondary" type="button" onclick="closeInquiry()">Abbrechen</button></form>`;
}

function itemCard(it) {
  const mine = !!state.user && it.seller_id === state.user.id;
  const sold = !!it.sold_at;
  let action = '';
  if (!state.user) action = '<p class="muted">Zum Anfragen bitte anmelden.</p>';
  else if (!mine && sold) action = '<p class="muted">Dieser Artikel ist bereits verkauft.</p>';
  else if (!mine) action = state.inquiryId === it.id
    ? inquiryForm(it.id)
    : `<button class="secondary" onclick="openInquiry('${it.id}')">Anfrage senden</button>`;
  return `<div class="item">
    ${it.imgUrl ? `<img class="thumb" src="${esc(it.imgUrl)}" alt="Foto zu ${esc(it.title)}" loading="lazy">` : ''}
    <div>
      <h3>${esc(it.title)}<span class="price">${price(it.price_eur)}</span></h3>
      <span class="tag">${esc(it.category)}</span>${sold ? '<span class="tag sold-tag">Verkauft</span>' : ''}${it.status !== 'freigegeben' ? '<span class="tag warn-tag">In Prüfung</span>' : ''}
      <p>${esc(it.description || '')}</p>
      ${mine ? `<p><span class="muted">Dein Artikel</span> <button class="link" onclick="editItem('${it.id}')">Bearbeiten</button> <button class="link" onclick="toggleSold('${it.id}', ${!sold})">${sold ? 'Wieder verfügbar machen' : 'Als verkauft markieren'}</button> <button class="link" onclick="delItem('${it.id}')">Entfernen</button></p>` : ''}
      ${action}
      ${state.user && !mine ? `<p><button class="link" onclick="reportItem('${it.id}')">Artikel melden</button></p>` : ''}
    </div></div>`;
}

function renderList() {
  const el = document.getElementById('itemlist');
  if (!el) return;
  const list = filteredItems();
  el.innerHTML = list.map(itemCard).join('')
    || `<p class="muted">${state.items.length ? 'Keine Artikel für diese Auswahl.' : 'Noch keine Artikel.'}</p>`;
}

function viewMarkt() {
  const form = state.user
    ? itemForm()
    : `<div class="notice">Zum Einstellen und Anfragen von Artikeln bitte im Bereich Konto anmelden. Angebote kannst du auch ohne Anmeldung ansehen.</div>`;
  return `<h2>Flohmarkt für Sportartikel</h2>${form}${filterBar()}<div class="card" id="itemlist"></div>`;
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

function editItem(id) {
  const it = state.items.find(x => x.id === id);
  if (!it) return;
  state.editItem = it; state.msg = ''; state.err = '';
  render();
  window.scrollTo(0, 0);
}

function openInquiry(id) { state.inquiryId = id; state.msg = ''; state.err = ''; render(); }
function closeInquiry() { state.inquiryId = null; render(); }

async function sendInquiry(e, id) {
  e.preventDefault();
  const message = document.getElementById('iq-' + id).value.trim();
  const { data, error } = await sb.functions.invoke('flea-anfrage', { body: { item_id: id, message } });
  if (error || data?.error) {
    state.err = 'Anfrage fehlgeschlagen: ' + await fnErrorText(data, error);
  } else {
    state.msg = 'Deine Anfrage wurde an den Verkäufer gesendet. Du erhältst eine Bestätigung per E-Mail.';
    state.inquiryId = null;
  }
  render();
}

function cancelEdit() { state.editItem = null; state.err = ''; render(); }

async function saveItem(e) {
  e.preventDefault();
  const file = document.getElementById('iimg').files[0];
  const editing = state.editItem;
  let newPath = null;
  try {
    const fields = { title: val('it'), price_eur: Number(val('ip')), category: val('ic'), description: val('idesc') || null };
    if (file) {
      const blob = await shrinkImage(file);
      newPath = `${state.user.id}/${crypto.randomUUID()}.jpg`;
      const { error: upErr } = await sb.storage.from('flea-images').upload(newPath, blob, { contentType: 'image/jpeg' });
      if (upErr) throw upErr;
    }
    if (editing) {
      if (newPath) fields.image_path = newPath;
      const { data, error } = await sb.from('items').update(fields).eq('id', editing.id).select('status');
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('Keine Berechtigung zum Ändern. Bitte prüfe, ob die SQL-Datei update-artikel-bearbeiten.sql in Supabase ausgeführt wurde.');
      }
      if (newPath && editing.image_path) await sb.storage.from('flea-images').remove([editing.image_path]);
      state.msg = data[0].status === 'freigegeben'
        ? 'Änderungen gespeichert.'
        : 'Änderungen gespeichert. Der Artikel wird erneut vom Vorstand geprüft.';
      state.editItem = null;
    } else {
      fields.seller_id = state.user.id;
      fields.image_path = newPath;
      const { data, error } = await sb.from('items').insert(fields).select('status').single();
      if (error) throw error;
      state.msg = data.status === 'freigegeben'
        ? 'Dein Artikel ist veröffentlicht. Er bleibt einen Monat online.'
        : 'Dein Artikel wird vom Vorstand geprüft, bevor er erscheint.';
    }
    state.err = '';
  } catch (err) {
    state.err = (editing ? 'Speichern fehlgeschlagen: ' : 'Einstellen fehlgeschlagen: ') + err.message;
  }
  try { await loadItems(); } catch (e2) { state.err = state.err || 'Artikel konnten nicht neu geladen werden: ' + e2.message; }
  render();
}

async function toggleSold(id, sold) {
  const { data, error } = await sb.from('items')
    .update({ sold_at: sold ? new Date().toISOString() : null }).eq('id', id).select('id');
  const failed = error || !data || data.length === 0;
  state.err = failed ? 'Status konnte nicht geändert werden' + (error ? ': ' + error.message : '.') : '';
  state.msg = failed ? '' : (sold ? 'Artikel als verkauft markiert. Anfragen sind nicht mehr möglich.' : 'Artikel ist wieder verfügbar.');
  try { await loadItems(); } catch (_) {}
  render();
}

async function delItem(id) {
  if (!confirm('Artikel wirklich entfernen?')) return;
  const it = state.items.find(x => x.id === id);
  if (it?.image_path) await sb.storage.from('flea-images').remove([it.image_path]);
  const { error } = await sb.from('items').delete().eq('id', id);
  state.err = error ? error.message : '';
  state.msg = error ? '' : 'Artikel entfernt.';
  await loadItems();
  render();
}

function viewSpenden() {
  const cfg = window.APP_CONFIG || {};
  const link = (cfg.SPENDEN_PAYPAL_URL || '').trim();
  const qr = (cfg.SPENDEN_QR_BILD || 'spenden-qr.png').trim();
  return `<h2>Unterstützen</h2>
  <div class="card">
    <h3>Warum eine Spende?</h3>
    <p class="lead">Diese App ist für alle Mitglieder und Besucher des VfB Grötzingen kostenlos. Sie wird ehrenamtlich entwickelt und betrieben. Wenn dir die App gefällt, kannst du den Verein auf diesem Weg unterstützen.</p>
    <h3>Wofür?</h3>
    <p>Spenden gehen an die Vereinskasse des VfB 04 Grötzingen e.V. Damit finanziert der Verein seinen Sportbetrieb, also Training und Spielbetrieb der Jugend- und Seniorenmannschaften, und die Arbeit, die dahintersteckt.</p>
    <p>Jede Spende hilft, egal wie groß sie ist.</p>
    <div class="spenden-grid">
      <div class="spenden-box">
        <h3>Per PayPal</h3>
        ${link
          ? `<a class="btn-paypal" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Jetzt per PayPal spenden</a>`
          : '<p class="muted">Der PayPal-Link wird demnächst eingetragen.</p>'}
      </div>
      <div class="spenden-box">
        <h3>Per QR-Code</h3>
        <img class="qr" src="${esc(qr)}" alt="QR-Code zur Spende an den VfB Grötzingen" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
        <p class="muted" style="display:none">Der QR-Code wird demnächst eingetragen.</p>
      </div>
    </div>
    <p class="muted">Du möchtest eine Zuwendungsbestätigung (Spendenquittung)? Dann schreib bitte mit Name und Anschrift an info@vfb-groetzingen.de.</p>
  </div>`;
}

function viewKonto() {
  if (state.recovery) {
    return `<h2>Neues Passwort</h2>
    <div class="card"><p class="muted">Bitte lege jetzt ein neues Passwort fest (mindestens 8 Zeichen).</p>
      <form class="row" onsubmit="setNewPassword(event)">
        <div class="field"><label for="np">Neues Passwort</label><input id="np" type="password" minlength="8" required autocomplete="new-password"></div>
        <button class="primary" type="submit">Speichern</button>
        <button class="secondary" type="button" onclick="cancelRecovery()">Abbrechen</button>
      </form></div>`;
  }
  if (state.user) {
    return `<h2>Konto</h2>
    <div class="card"><p>Angemeldet als <b>${esc(state.displayName)}</b> (${esc(state.user.email)}).</p>
      <button class="secondary" onclick="signOut()">Abmelden</button></div>
    <div class="card"><h3>Anzeigename</h3>
      <p class="muted">Dieser Name erscheint im Chat und bei Anfragen an Verkäufer.</p>
      <form class="row" onsubmit="changeName(event)">
        <div class="field"><label for="dn">Anzeigename</label><input id="dn" required minlength="2" maxlength="60" value="${esc(state.displayName)}" autocomplete="name"></div>
        <button class="secondary" type="submit">Speichern</button>
      </form></div>
    <div class="card"><h3>Passwort ändern</h3>
      <form class="row" onsubmit="changePassword(event)">
        <div class="field"><label for="np">Neues Passwort (mind. 8 Zeichen)</label><input id="np" type="password" minlength="8" required autocomplete="new-password"></div>
        <button class="secondary" type="submit">Passwort ändern</button>
      </form></div>
    <div class="card"><h3>Konto löschen</h3>
      <p class="muted">Dein Konto, deine Artikel und Fotos, deine Chat-Nachrichten und Meldungen werden endgültig gelöscht. Das lässt sich nicht rückgängig machen.</p>
      <button class="secondary" onclick="deleteAccount()">Konto löschen</button></div>`;
  }
  const resendCard = state.pendingEmail
    ? `<div class="card"><h3>Keine Bestätigungsmail erhalten?</h3>
       <p class="muted">Prüfe den Spam-Ordner und warte ein paar Minuten. Danach kannst du die Mail erneut anfordern.</p>
       <button class="secondary" onclick="resendConfirm()">Bestätigungsmail erneut senden</button></div>`
    : '';
  return `<h2>Konto</h2>${resendCard}
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
      <button class="link" type="button" onclick="forgotPassword()">Passwort vergessen?</button>
    </form></div>`;
}

async function signUp(e) {
  e.preventDefault();
  const email = val('re');
  const { data, error } = await sb.auth.signUp({
    email,
    password: val('rp'),
    options: { data: { name: val('rn') }, emailRedirectTo: location.origin + location.pathname }
  });
  if (error) {
    state.err = error.message;
    state.msg = '';
    render();
    return;
  }
  // Supabase liefert bei bereits registrierten Adressen keinen Fehler, sondern ein Nutzerobjekt ohne Identitäten.
  if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    state.err = 'Für diese E-Mail-Adresse gibt es bereits ein Konto. Bitte melde dich an oder nutze „Passwort vergessen?“.';
    state.msg = '';
    render();
    return;
  }
  state.pendingEmail = email;
  state.err = '';
  state.msg = 'Fast geschafft: Bitte bestätige deine E-Mail-Adresse über den Link in der Mail. Bitte auch den Spam-Ordner prüfen.';
  render();
}

async function resendConfirm() {
  const { error } = await sb.auth.resend({
    type: 'signup',
    email: state.pendingEmail,
    options: { emailRedirectTo: location.origin + location.pathname }
  });
  state.err = error ? 'Mail konnte nicht erneut gesendet werden: ' + error.message : '';
  state.msg = error ? '' : 'Die Bestätigungsmail wurde erneut gesendet. Bitte auch den Spam-Ordner prüfen.';
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

async function forgotPassword() {
  const email = (document.getElementById('le')?.value || '').trim();
  if (!email) {
    state.err = 'Bitte trage oben bei „E-Mail“ deine Adresse ein und klicke dann erneut auf „Passwort vergessen?“.';
    render();
    return;
  }
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  state.err = error ? 'Die E-Mail konnte nicht gesendet werden: ' + error.message : '';
  state.msg = error ? '' : 'Falls ein Konto mit dieser Adresse existiert, wurde eine E-Mail mit einem Link zum Zurücksetzen gesendet.';
  render();
}

async function setNewPassword(e) {
  e.preventDefault();
  const { error } = await sb.auth.updateUser({ password: val('np') });
  if (error) {
    state.err = 'Passwort konnte nicht gespeichert werden: ' + error.message;
    render();
    return;
  }
  state.recovery = false;
  state.msg = 'Dein neues Passwort ist gespeichert.';
  history.replaceState({}, '', location.pathname);
  render();
}

function cancelRecovery() {
  state.recovery = false;
  history.replaceState({}, '', location.pathname);
  render();
}

async function changeName(e) {
  e.preventDefault();
  const { error } = await sb.rpc('update_display_name', { p_name: val('dn') });
  if (!error) await setUser(state.user);
  state.err = error ? 'Name konnte nicht gespeichert werden: ' + error.message : '';
  state.msg = error ? '' : 'Dein Anzeigename wurde geändert.';
  render();
}

async function changePassword(e) {
  e.preventDefault();
  const { error } = await sb.auth.updateUser({ password: val('np') });
  state.err = error ? 'Passwort konnte nicht geändert werden: ' + error.message : '';
  state.msg = error ? '' : 'Dein Passwort wurde geändert.';
  render();
}

async function deleteAccount() {
  if (!confirm('Dein Konto und alle deine Daten werden endgültig gelöscht. Fortfahren?')) return;
  const { data, error } = await sb.functions.invoke('konto-loeschen', { body: {} });
  if (error || data?.error) {
    state.err = 'Konto konnte nicht gelöscht werden: ' + await fnErrorText(data, error);
    render();
    return;
  }
  await sb.auth.signOut();
  state.tab = 'markt';
  state.msg = 'Dein Konto wurde gelöscht.';
  render();
}

async function signOut() {
  await sb.auth.signOut();
  state.msg = 'Du bist abgemeldet.';
}

function reportCard(r) {
  const isItem = !!r.item_id;
  const exists = isItem ? !!r.items : !!r.messages;
  const target = isItem
    ? (r.items ? `Artikel: <b>${esc(r.items.title)}</b>` : 'Artikel bereits gelöscht')
    : (r.messages ? `Chat-Nachricht: „${esc(r.messages.body)}“` : 'Nachricht bereits gelöscht');
  const targetId = isItem ? `'${r.item_id}'` : r.message_id;
  return `<div class="item"><div>
    <p>${target}</p>
    <p class="muted">Begründung: ${esc(r.reason)}<br>Gemeldet von ${esc(r.reporter?.display_name || 'Mitglied')} am ${fmt(r.created_at)}</p>
    ${exists ? `<button class="primary" onclick="removeReported(${r.id}, ${isItem}, ${targetId})">${isItem ? 'Artikel entfernen' : 'Nachricht entfernen'}</button> ` : ''}
    <button class="secondary" onclick="dismissReport(${r.id})">Meldung verwerfen</button>
  </div></div>`;
}

function viewAdmin() {
  if (!state.isAdmin) return '<p class="muted">Kein Zugriff.</p>';
  const pending = state.items.filter(i => i.status === 'pruefung');
  return `<h2>Prüfung</h2>
  <h3>Gemeldete Inhalte (${state.reports.length})</h3>
  ${state.reports.length ? state.reports.map(reportCard).join('') : '<p class="muted">Keine Meldungen.</p>'}
  <h3 style="margin-top:20px">Artikel in Prüfung (${pending.length})</h3>
  ${pending.length ? pending.map(it => `<div class="item"><div>
        <h3>${esc(it.title)}<span class="price">${price(it.price_eur)}</span></h3>
        <span class="tag">${esc(it.category)}</span><span class="tag warn-tag">${esc(it.check_result)}</span>
        <p>${esc(it.description || '')}</p>
        <button class="primary" onclick="setStatus('${it.id}','freigegeben')">Freigeben</button>
        <button class="secondary" onclick="setStatus('${it.id}','abgelehnt')">Ablehnen</button>
      </div></div>`).join('')
    : '<p class="muted">Keine Artikel zur Prüfung.</p>'}`;
}

async function removeReported(reportId, isItem, targetId) {
  if (!confirm(isItem ? 'Artikel wirklich entfernen?' : 'Nachricht wirklich entfernen?')) return;
  let error = null;
  if (isItem) {
    const { data: it } = await sb.from('items').select('image_path').eq('id', targetId).maybeSingle();
    if (it?.image_path) await sb.storage.from('flea-images').remove([it.image_path]);
    ({ error } = await sb.from('items').delete().eq('id', targetId));
  } else {
    ({ error } = await sb.from('messages').delete().eq('id', targetId));
  }
  state.err = error ? 'Entfernen fehlgeschlagen: ' + error.message : '';
  state.msg = error ? '' : 'Inhalt entfernt. Die Meldung wurde mit entfernt.';
  await loadReports();
  await loadItems();
  render();
}

async function dismissReport(id) {
  const { error } = await sb.from('reports').delete().eq('id', id);
  state.err = error ? 'Meldung konnte nicht verworfen werden: ' + error.message : '';
  state.msg = error ? '' : 'Meldung verworfen.';
  await loadReports();
  render();
}

async function setStatus(id, status) {
  const { error } = await sb.from('items').update({ status }).eq('id', id);
  state.err = error ? error.message : '';
  state.msg = error ? '' : 'Status aktualisiert.';
  await loadItems();
  render();
}

function render() {
  const tabs = [['markt', 'Flohmarkt'], ['chat', 'Chat'], ['spenden', 'Unterstützen'], ['konto', state.user ? 'Konto' : 'Anmelden']];
  if (state.isAdmin) tabs.push(['admin', `Prüfung${state.reports.length ? ` (${state.reports.length})` : ''}`]);
  document.getElementById('tabs').innerHTML = tabs.map(([k, l]) =>
    `<button role="tab" aria-selected="${state.tab === k}" onclick="go('${k}')">${l}</button>`).join('');
  if (!state.booted) {
    document.getElementById('main').innerHTML = '<p class="muted" role="status">Lade …</p>';
    document.getElementById('who').textContent = '';
    return;
  }
  const views = { chat: viewChat, markt: viewMarkt, spenden: viewSpenden, konto: viewKonto, admin: viewAdmin, impressum: viewImpressum, datenschutz: viewDatenschutz };
  const notices = (state.msg ? `<div class="notice" role="status">${esc(state.msg)}</div>` : '')
    + (state.err ? `<div class="notice warn" role="alert">${esc(state.err)}</div>` : '');
  document.getElementById('main').innerHTML = notices + (views[state.tab] || viewMarkt)();
  document.getElementById('who').textContent = state.user ? `Angemeldet: ${state.displayName}` : '';
  const m = document.getElementById('msgs');
  if (m) m.scrollTop = m.scrollHeight;
  if (state.tab === 'markt' || state.tab === 'admin') renderList();
  state.msg = ''; state.err = '';
}

async function handleAuth(session, event) {
  try {
    await setUser(session?.user || null);
    if (event === 'PASSWORD_RECOVERY') { state.recovery = true; state.tab = 'konto'; }
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
    if (!state.isAdmin) state.reports = [];
    await load();
  } catch (e) {
    state.err = 'Fehler beim Laden: ' + e.message;
  }
  render();
}

// Der Callback kehrt sofort zurück; die eigentliche Arbeit läuft danach,
// damit sich Datenbankabfragen nicht gegenseitig blockieren.
// TOKEN_REFRESHED wird ignoriert, damit offene Formulare nicht neu geladen werden.
sb.auth.onAuthStateChange((event, session) => {
  if (event === 'TOKEN_REFRESHED') return;
  setTimeout(() => handleAuth(session, event), 0);
});
// Besucherzähler: Ein Besuch wird pro Browser-Sitzung einmal gezählt, Neuladen zählt nicht erneut.
async function countVisit() {
  const el = document.getElementById('visits');
  if (!el) return;
  try {
    const schon = sessionStorage.getItem('vfb-gezaehlt') === '1';
    const { data, error } = await sb.rpc(schon ? 'besucher_stand' : 'besucher_zaehlen');
    if (error) throw error;
    if (!schon) sessionStorage.setItem('vfb-gezaehlt', '1');
    el.textContent = Number(data).toLocaleString('de-DE');
  } catch (_) {
    el.textContent = '–';
  }
}
countVisit();
render();
