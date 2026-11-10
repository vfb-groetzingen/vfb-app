// VfB Grötzingen – Bilder für Flohmarkt-Artikel
// Auswahl (bis zu 4 Bilder), Prüfung der Auflösung, Verkleinerung und Upload.
// Einbinden in index.html vor app.js:  <script src="bilder-upload.js"></script>
// Die Funktionen laufen komplett im Browser. Es werden keine externen Dienste genutzt.

(function (global) {
  'use strict';

  const MAX_BILDER = 4;                  // Maximale Anzahl pro Artikel
  const MAX_EINGABE_BYTES = 15 * 1024 * 1024; // Rohdatei max. 15 MB
  const ZIEL_MAX_SEITE = 1200;           // Längste Kante nach dem Verkleinern (px)
  const MIN_LANGE_SEITE = 800;           // Darunter: Bild wird abgelehnt (px)
  const JPEG_QUALITAET = 0.85;           // Gute Qualität bei kleiner Datei
  const BUCKET = 'flea-images';
  const ERLAUBTE_TYPEN = ['image/jpeg', 'image/png', 'image/webp'];

  // Interner Zustand der Auswahl im Formular
  let auswahl = []; // { blob, vorschau, breite, hoehe, name, originalGroesse }

  // Bild aus Datei laden. Dreht Fotos nach der EXIF-Ausrichtung, wenn der Browser es unterstützt.
  async function bildLaden(datei) {
    try {
      return await createImageBitmap(datei, { imageOrientation: 'from-image' });
    } catch (_) {
      return await new Promise((resolve, reject) => {
        const url = URL.createObjectURL(datei);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
        img.src = url;
      });
    }
  }

  // Zielgröße: nur verkleinern, nie vergrößern. Seitenverhältnis bleibt erhalten.
  function zielGroesse(w, h) {
    const faktor = Math.min(1, ZIEL_MAX_SEITE / Math.max(w, h));
    return { w: Math.round(w * faktor), h: Math.round(h * faktor) };
  }

  // Eine Datei prüfen und in ein JPEG umwandeln. Gibt { fehler } oder { blob, ... } zurück.
  async function bildVorbereiten(datei) {
    if (!ERLAUBTE_TYPEN.includes(datei.type)) {
      return { fehler: 'Dieses Format wird nicht unterstützt. Bitte als JPG, PNG oder WebP speichern.' };
    }
    if (datei.size > MAX_EINGABE_BYTES) {
      return { fehler: 'Die Datei ist größer als 15 MB. Bitte ein kleineres Foto wählen.' };
    }

    let bild;
    try {
      bild = await bildLaden(datei);
    } catch (_) {
      return { fehler: 'Die Datei konnte nicht gelesen werden.' };
    }

    const w = bild.naturalWidth || bild.width;
    const h = bild.naturalHeight || bild.height;

    if (Math.max(w, h) < MIN_LANGE_SEITE) {
      if (bild.close) bild.close();
      return {
        fehler: `Das Bild ist zu klein (${w} × ${h} px). Bitte ein Foto mit mindestens ${MIN_LANGE_SEITE} px auf der längeren Seite wählen, damit der Artikel gut erkennbar ist.`
      };
    }

    const ziel = zielGroesse(w, h);
    const canvas = document.createElement('canvas');
    canvas.width = ziel.w;
    canvas.height = ziel.h;
    const ctx = canvas.getContext('2d');
    // Transparenz (PNG, WebP) auf Weiß setzen, sonst wird der Hintergrund schwarz
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, ziel.w, ziel.h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bild, 0, 0, ziel.w, ziel.h);
    if (bild.close) bild.close();

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITAET));
    if (!blob) return { fehler: 'Das Bild konnte nicht umgewandelt werden.' };

    return {
      blob,
      breite: ziel.w,
      hoehe: ziel.h,
      originalGroesse: `${w} × ${h} px`,
      vorschau: URL.createObjectURL(blob)
    };
  }

  // Dateien aus einem Eingabefeld zur Auswahl hinzufügen. Gibt eine Liste mit Meldungen zurück.
  async function bilderHinzufuegen(dateiListe, bereitsVorhanden = 0) {
    const meldungen = [];
    const frei = MAX_BILDER - bereitsVorhanden - auswahl.length;
    const dateien = Array.from(dateiListe || []);

    if (frei <= 0) {
      return [`Maximal ${MAX_BILDER} Bilder pro Artikel. Bitte zuerst ein Bild entfernen.`];
    }
    if (dateien.length > frei) {
      meldungen.push(`Maximal ${MAX_BILDER} Bilder pro Artikel. Es werden nur ${frei} weitere übernommen.`);
    }

    for (const datei of dateien.slice(0, frei)) {
      const ergebnis = await bildVorbereiten(datei);
      if (ergebnis.fehler) {
        meldungen.push(`${datei.name}: ${ergebnis.fehler}`);
      } else {
        auswahl.push({ ...ergebnis, name: datei.name });
      }
    }
    return meldungen;
  }

  // Bild aus der Auswahl entfernen
  function bildEntfernen(index) {
    const eintrag = auswahl[index];
    if (!eintrag) return;
    URL.revokeObjectURL(eintrag.vorschau);
    auswahl.splice(index, 1);
  }

  // Auswahl leeren (z. B. nach dem Speichern oder beim Abbrechen)
  function auswahlLeeren() {
    auswahl.forEach((b) => URL.revokeObjectURL(b.vorschau));
    auswahl = [];
  }

  // Vorschau in einen Container zeichnen. Jede Vorschau hat einen Entfernen-Button.
  function vorschauZeichnen(container, onChange) {
    container.innerHTML = '';
    auswahl.forEach((b, i) => {
      const figur = document.createElement('figure');
      figur.className = 'bild-vorschau';

      const img = document.createElement('img');
      img.src = b.vorschau;
      img.alt = `Bild ${i + 1} von ${auswahl.length}`;

      const info = document.createElement('figcaption');
      info.textContent = `${b.breite} × ${b.hoehe} px`;

      const weg = document.createElement('button');
      weg.type = 'button';
      weg.textContent = 'Entfernen';
      weg.setAttribute('aria-label', `Bild ${i + 1} entfernen`);
      weg.addEventListener('click', () => {
        bildEntfernen(i);
        vorschauZeichnen(container, onChange);
        if (onChange) onChange(auswahl.length);
      });

      figur.append(img, info, weg);
      container.appendChild(figur);
    });
  }

  // Auswahl für das Speichern: Blobs mit Dateinamen
  function neueBilder() {
    return auswahl.map((b) => ({ blob: b.blob, breite: b.breite, hoehe: b.hoehe }));
  }

  // Hochladen in den Supabase-Storage. Gibt die Pfade zurück.
  // sb: Supabase-Client, userId: eingeloggte Nutzer-ID
  async function bilderHochladen(sb, userId, bilder) {
    const pfade = [];
    try {
      for (const b of bilder) {
        const pfad = `${userId}/${crypto.randomUUID()}.jpg`;
        const { error } = await sb.storage.from(BUCKET).upload(pfad, b.blob, {
          contentType: 'image/jpeg',
          upsert: false
        });
        if (error) throw new Error(error.message);
        pfade.push(pfad);
      }
      return pfade;
    } catch (err) {
      // Bereits hochgeladene Bilder wieder entfernen, damit keine Leichen im Speicher bleiben
      await bilderLoeschen(sb, pfade);
      throw err;
    }
  }

  // Dateien aus dem Storage löschen
  async function bilderLoeschen(sb, pfade) {
    if (pfade && pfade.length) {
      await sb.storage.from(BUCKET).remove(pfade);
    }
  }

  // Öffentliche Adresse eines gespeicherten Bildes
  function bildAdresse(sb, pfad) {
    return sb.storage.from(BUCKET).getPublicUrl(pfad).data.publicUrl;
  }

  global.FleaBilder = {
    MAX_BILDER,
    MIN_LANGE_SEITE,
    bilderHinzufuegen,
    bildEntfernen,
    auswahlLeeren,
    vorschauZeichnen,
    neueBilder,
    bilderHochladen,
    bilderLoeschen,
    bildAdresse
  };
})(window);
