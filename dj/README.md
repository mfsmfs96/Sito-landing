# AURA — DJ virtuale autonomo

Un DJ che **compone, suona e mixa musica** in base ai tuoi gusti e va avanti **per ore senza interventi**.
Tutto gira nel browser: nessun server, nessun account, nessuna chiave API. È una pagina statica come il resto
di questo repository, raggiungibile su `/dj/`.

## Che cosa fa davvero

- **Genera musica originale** con la Web Audio API: cassa, rullante, charleston, percussioni, basso, accordi,
  arpeggi, pad, lead, riser e impatti sono sintetizzati nota per nota. Nessun campione, nessun file da scaricare,
  nessun problema di diritti — e quindi nessun limite di durata: il materiale non finisce mai.
- **Mixa come un DJ**: due deck agganciati a un unico clock, quindi sempre perfettamente a tempo. Le transizioni
  sono vere automazioni di mixer — crossfade a potenza costante, scambio dei bassi a metà mix (non ci sono mai due
  casse sovrapposte), sweep di filtro, uscite in echo, stacchi netti quando il cambio di tempo è troppo ampio.
- **Suona anche la tua musica**: trascini i tuoi file audio, l'app ne stima BPM e primo battere e li incastra nel
  set insieme ai brani generati, adattando il tempo della serata al brano. I file restano sul tuo computer.
- **Impara i tuoi gusti**: gli slider dei generi sono il punto di partenza, poi ❤ e 👎 spostano i pesi delle
  caratteristiche di ciò che stava suonando (genere, tempo, luminosità, densità, scala). Tutto in `localStorage`.
- **Conduce la serata da solo**: un arco energetico decide come evolve il set — warm‑up, salita, peak time,
  discesa — e da lì derivano tempo, generi, densità e tipo di transizione. Con durata "infinito" il ciclo si
  ripete ogni 90 minuti.

## Come si usa

1. Apri `/dj/`, scegli i generi, la durata e la partenza, premi **Avvia il set** (il primo tocco serve solo a
   sbloccare l'audio del browser).
2. Da lì non devi fare più nulla. Se vuoi intervenire:

| Comando | Effetto |
|---|---|
| ❤ / `L` | "ancora così": rinforza le caratteristiche del brano in corso |
| 👎 / `D` | cambia subito registro e impara a evitarlo |
| SKIP / `→` | passa alla prossima con una transizione breve |
| `+` / `−` / `↑` `↓` | alza o abbassa l'energia (disattiva l'automatico) |
| `auto` | ridà l'energia in mano al DJ |
| Spazio | pausa e ripresa (sospende davvero l'audio, riprende dallo stesso punto) |
| ● | registra il set e lo salva come file audio |
| ☀ | tiene lo schermo acceso (Wake Lock, dove supportato) |

## Com'è fatto

```
dj/
├── index.html
├── style.css
└── js/
    ├── engine.js     grafo audio, voci sintetizzate, transport a 16esimi
    ├── composer.js   generi, armonia, pattern, strutture → "ricette" di traccia
    ├── deck.js       riproduzione: programma le voci, o suona un file allineato alla griglia
    ├── taste.js      profilo di gusto dichiarato + appreso, scelta morbida dei candidati
    ├── analysis.js   decodifica dei file, stima BPM e primo battere
    ├── director.js   regia autonoma: arco energetico, scelta, transizioni
    └── ui.js         interfaccia, visualizer, libreria, registrazione
```

Due dettagli che tengono in piedi le sessioni lunghe:

- **Clock separato dall'audio.** Il transport programma le note in anticipo (~0.45 s) sul clock dell'`AudioContext`,
  e il tick arriva da un Web Worker: i timer del thread principale vengono rallentati dai browser quando la scheda
  è in secondo piano, quello del worker molto meno. Se il sistema va in sospensione il clock si riaggancia da solo.
- **Nessun silenzio possibile.** A ogni battuta il regista controlla lo stato dei deck: se per qualsiasi motivo
  nessuno sta suonando, ne carica subito uno nuovo.

## Limiti onesti

- La musica è strumentale ed elettronica: niente voci, niente strumenti acustici campionati.
- La stima del BPM sui tuoi file funziona bene su materiale a tempo costante; su brani suonati dal vivo o con
  rubato può sbagliare (l'app segnala "tempo incerto"). Il tempo dei tuoi brani viene adattato cambiando la
  velocità di riproduzione, quindi variazioni oltre ~10% alterano l'intonazione: per questo è il set ad
  adattarsi al brano, e non viceversa.
- Servizi come Spotify o Apple Music non sono integrabili in modo autonomo: lo streaming non espone l'audio
  al mixer, quindi non permette un vero crossfade.

## Provarlo in locale

```bash
cd dj && python3 -m http.server 8899
# poi apri http://127.0.0.1:8899/
```

Testato su Chromium headless: motore audio attivo, transizioni concatenate, pausa/ripresa, libreria, senza errori
in console.
