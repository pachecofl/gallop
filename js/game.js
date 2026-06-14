/* ============================================================
   GALLOP! — game logic (vanilla JS, no build step)
   ============================================================ */
(function () {
  'use strict';

  /* ---------------- Constants / config ---------------- */
  const START_BANKROLL = 500;
  const MIN_BET = 1;
  const FIELD_SIZE = 10;
  const RACE_MS = 16000;            // slowest finisher reaches the line here
  const SPEED_SPREAD = 0.17;        // how much score compresses finish time
  const LS_KEY = 'gallop_high_v1';

  const WEATHERS = {
    sunny: { name: 'Sunny',  icon: '☀️', note: 'Fast going. Sun-lovers thrive.' },
    rainy: { name: 'Rainy',  icon: '🌧️', note: 'Heavy ground. Mudlarks step up.' },
    windy: { name: 'Windy',  icon: '🌬️', note: 'Gusty straight. Wind-runners shine.' },
  };
  const WEATHER_KEYS = Object.keys(WEATHERS);

  /* Coat palette: [coat, mane, label] */
  const COATS = [
    ['#6e4a2e', '#3a2614', 'Bay'],
    ['#a85c2d', '#6e3a18', 'Chestnut'],
    ['#2f2f38', '#16161c', 'Black'],
    ['#9aa0a8', '#6c727a', 'Grey'],
    ['#d9b364', '#f0e2bf', 'Palomino'],
    ['#e6e2d8', '#c2bcae', 'White'],
    ['#8a7068', '#4a3a35', 'Roan'],
    ['#8b8f99', '#5a5e66', 'Dapple'],
    ['#c79a5b', '#3a2c18', 'Buckskin'],
    ['#b56a5a', '#6e352b', 'Strawberry'],
    ['#5b6b7a', '#333d47', 'Steel'],
    ['#7d5a86', '#3f2c45', 'Plum'],
  ];

  const NAME_POOL = [
    'Sir Gallops-a-Lot', 'Thunderbiscuit', 'Hay Fever', 'Sir Neighsalot',
    'Macaroni Pony', 'Usain Colt', 'Mr. Wigglesnort', 'Sugarcube Sally',
    'Disco Hooves', 'Lord Trotsworth', 'Hoof Hearted', 'Neighsayer',
    'Oat Vader', 'Buckaroo Banzai', 'Maple Stirrup', 'Pony Soprano',
    'Caffeine Dream', 'Whinny the Pooh', 'Bridle Shower', 'Mango Unchained',
    'Furious George', 'Gallop Poll', 'Trotsky', 'Sir Loin',
    'Hoofie Hefner', 'Cantaloupe', 'Glue Chance', 'Stable Genius',
    'Fast & Curious', 'Marewalker', 'Colt 45', 'Bit O\'Honey',
  ];

  /* ---------------- State ---------------- */
  const S = {
    balance: START_BANKROLL,
    peak: START_BANKROLL,
    gains: 0,
    lost: 0,
    streak: 0,
    races: 0,
    stable: [],          // persistent 10 horses
    weather: 'sunny',
    phase: 'betting',    // betting | racing | result | gameover
    sel: { horseId: null, type: 'win', stake: 10 },
    muted: false,
    audioReady: false,
  };

  /* ---------------- Utils ---------------- */
  const $ = (id) => document.getElementById(id);
  const rint = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
  const rfloat = (a, b) => Math.random() * (b - a) + a;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const money = (n) => '$' + Math.round(n).toLocaleString('en-US');

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* ---------------- Scoring model ---------------- */
  function ageModifier(age) {
    // peaks around 5yo, tails off for very young / veteran
    return 2 - Math.abs(age - 5) * 0.45;
  }
  function weatherBonus(horse, weather) {
    return horse.weatherPref === weather ? 2 : 0;
  }
  // visible expected score (no hidden condition) — drives the odds
  function rawScore(h, weather) {
    return h.speed * 2 + h.stamina * 1.5 + ageModifier(h.age) + weatherBonus(h, weather);
  }
  // true score for THIS race, including the hidden "day" factor
  function finalScore(h, weather) {
    return rawScore(h, weather) * (1 + h.condition);
  }

  function computeOdds(stable, weather) {
    const strengths = stable.map((h) => Math.pow(Math.max(rawScore(h, weather), 0.5), 1.5));
    const total = strengths.reduce((s, v) => s + v, 0);
    stable.forEach((h, i) => {
      const prob = strengths[i] / total;
      const fair = 1 / prob - 1;                 // profit-to-stake
      h.odds = clamp(Math.round(fair), 1, 33);
    });
  }

  /* ---------------- Horse generation ---------------- */
  function buildStable() {
    const names = shuffle(NAME_POOL).slice(0, FIELD_SIZE);
    const coats = shuffle(COATS).slice(0, FIELD_SIZE);
    S.stable = names.map((name, i) => ({
      id: i + 1,
      name,
      coat: coats[i][0],
      mane: coats[i][1],
      coatName: coats[i][2],
      speed: rint(1, 5),                 // fixed for the stable's life
      age: rint(2, 12),                  // fixed
      weatherPref: pick(WEATHER_KEYS),   // fixed
      stamina: rint(1, 5),               // re-rolled each race
      condition: 0,                      // hidden, re-rolled each race
      odds: 5,
      lastFinish: null,
    }));
  }

  function newRace() {
    S.weather = pick(WEATHER_KEYS);
    S.stable.forEach((h) => {
      h.stamina = rint(1, 5);
      h.condition = rfloat(-0.15, 0.15);
    });
    computeOdds(S.stable, S.weather);
  }

  /* ---------------- SVG horse ---------------- */
  function horseSVG(coat, mane) {
    return `
    <svg class="horse-svg" viewBox="0 0 100 60" xmlns="http://www.w3.org/2000/svg">
      <g class="legs">
        <rect class="leg leg-b" x="30" y="36" width="4.5" height="18" rx="2.2" fill="${mane}"/>
        <rect class="leg leg-a" x="58" y="36" width="4.5" height="18" rx="2.2" fill="${mane}"/>
        <rect class="leg leg-a" x="36" y="36" width="4.5" height="18" rx="2.2" fill="${coat}"/>
        <rect class="leg leg-b" x="64" y="36" width="4.5" height="18" rx="2.2" fill="${coat}"/>
      </g>
      <path class="tail" d="M20,30 Q8,30 6,48 Q12,40 18,40 Q14,46 18,50 Q24,40 24,32 Z" fill="${mane}"/>
      <ellipse class="body" cx="46" cy="32" rx="26" ry="12.5" fill="${coat}"/>
      <polygon class="neck" points="60,24 66,30 84,12 78,6 66,16" fill="${coat}"/>
      <path class="mane" d="M66,16 Q72,9 80,6 Q74,12 72,20 Z" fill="${mane}"/>
      <polygon class="head" points="78,6 92,4 95,12 86,17 76,14" fill="${coat}"/>
      <polygon class="ear" points="78,6 80,-1 84,7" fill="${coat}"/>
      <circle class="eye" cx="86" cy="9" r="1.4" fill="#10131a"/>
      <rect x="92" y="11" width="4" height="2.4" rx="1.2" fill="${mane}"/>
    </svg>`;
  }

  function coatDot(coat) {
    return `<span class="bc-dot" style="background:${coat}"></span>`;
  }

  /* ---------------- Rendering: horse rail ---------------- */
  function renderHorses() {
    const list = $('horsesList');
    list.innerHTML = S.stable.map((h) => {
      const sel = S.sel.horseId === h.id ? ' selected' : '';
      const form = h.lastFinish ? `Last: ${ordinal(h.lastFinish)}` : 'First run';
      return `
      <div class="horse-card${sel}" data-id="${h.id}">
        <div class="hc-num" style="background:${h.coat};color:${pickText(h.coat)}">${h.id}</div>
        <div class="hc-main">
          <div class="hc-name">${h.name}</div>
          <div class="hc-stats">
            <div class="stat-row"><span class="stat-key">SPD</span><div class="bar speed"><span style="width:${h.speed/5*100}%"></span></div></div>
            <div class="stat-row"><span class="stat-key">STA</span><div class="bar stamina"><span style="width:${h.stamina/5*100}%"></span></div></div>
          </div>
          <div class="hc-meta">
            <span>${h.age}yo</span>
            <span class="pref">${WEATHERS[h.weatherPref].icon} ${WEATHERS[h.weatherPref].name}</span>
            <span>${h.coatName}</span>
          </div>
        </div>
        <div class="hc-right">
          <div class="hc-odds">${h.odds}/1</div>
          <div class="hc-form">${form}</div>
        </div>
      </div>`;
    }).join('');
  }

  function pickText(hex) {
    // choose dark/light number text for contrast
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return (r * 0.299 + g * 0.587 + b * 0.114) > 150 ? '#10131a' : '#fff';
  }

  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  /* ---------------- Rendering: betting grid ---------------- */
  function renderBetGrid() {
    const grid = $('betGrid');
    grid.innerHTML = S.stable.map((h) => {
      const sel = S.sel.horseId === h.id ? ' selected' : '';
      return `
      <button class="bet-cell${sel}" data-id="${h.id}">
        <div class="bc-main">
          <div class="bc-name">${h.name}</div>
          <div class="bc-top">${coatDot(h.coat)}<span class="bc-num">#${h.id}</span></div>
        </div>
        <div class="bc-odds">${h.odds}/1</div>
      </button>`;
    }).join('');
  }

  /* ---------------- Rendering: wallet + weather ---------------- */
  function renderWallet(flash) {
    const bal = $('balance');
    bal.textContent = money(S.balance);
    if (flash) {
      bal.classList.remove('flash-up', 'flash-down');
      void bal.offsetWidth;
      bal.classList.add(flash === 'up' ? 'flash-up' : 'flash-down');
    }
    $('gains').textContent = money(S.gains);
    $('lost').textContent = money(S.lost);
    $('streak').textContent = S.streak + ' 🔥';
    $('races').textContent = S.races;
    $('highScore').textContent = money(S.peak);
  }

  function renderWeather() {
    const w = WEATHERS[S.weather];
    $('weatherIcon').textContent = w.icon;
    $('weatherName').textContent = w.name;
    $('weatherNote').textContent = w.note;
  }

  /* ---------------- Bet selection / summary ---------------- */
  function selectedHorse() {
    return S.stable.find((h) => h.id === S.sel.horseId) || null;
  }

  function payoutMultiplier(odds, type) {
    if (type === 'win') return odds;
    if (type === 'place') return odds / 4;
    return odds / 5; // show
  }

  function updateSummary() {
    const h = selectedHorse();
    const stake = clamp(Math.floor(S.sel.stake || 0), 0, S.balance);
    const typeLabel = { win: 'Win', place: 'Place', show: 'Show' }[S.sel.type];

    $('sumSelection').textContent = h ? `${h.name} · ${typeLabel}` : '—';

    let ret = 0;
    if (h && stake >= MIN_BET) ret = stake + stake * payoutMultiplier(h.odds, S.sel.type);
    $('sumReturn').textContent = money(ret);

    const valid = !!h && stake >= MIN_BET && stake <= S.balance && S.phase === 'betting';
    const btn = $('betBtn');
    btn.disabled = !valid;
    btn.textContent = h && stake ? `Bet ${money(stake)}` : 'Place bet';

    // reflect bet-type selection
    document.querySelectorAll('.bet-type').forEach((el) =>
      el.classList.toggle('selected', el.dataset.type === S.sel.type));
  }

  function setHorse(id) {
    if (S.phase !== 'betting') return;
    S.sel.horseId = id;
    renderHorses();
    renderBetGrid();
    updateSummary();
    blip(520, 0.05);
  }

  /* ---------------- Track build ---------------- */
  function buildLanes() {
    const lanes = $('lanes');
    lanes.innerHTML = S.stable.map((h, i) => `
      <div class="lane">
        <span class="lane-num">${h.id}</span>
        <div class="runner" id="runner-${h.id}">${horseSVG(h.coat, h.mane)}</div>
      </div>`).join('');
    // reset positions
    S.stable.forEach((h) => {
      const el = $('runner-' + h.id);
      if (el) el.style.transform = 'translateX(0px)';
    });
  }

  function buildCrowd() {
    const crowd = $('crowd');
    const cols = ['#c75b5b', '#d9a441', '#5b8fc7', '#6abf7b', '#b07bc7', '#cfc6b0', '#7a8aa3', '#d98c5b', '#8a7bd9'];
    let html = '';
    for (let i = 0; i < 70; i++) {
      const c = pick(cols);
      const size = rint(9, 16);
      const jump = Math.random() < 0.5;        // half the crowd is on their feet cheering
      const dur = rfloat(0.5, 1.1).toFixed(2);
      const delay = rfloat(0, 1.2).toFixed(2);
      const anim = jump ? `animation:crowdJump ${dur}s ease-in-out -${delay}s infinite;` : '';
      html += `<span class="person" style="width:${size}px;height:${size}px;background:${c};${anim}"></span>`;
    }
    crowd.innerHTML = html;
  }

  function applyWeatherFx() {
    const track = $('track');
    track.classList.remove('w-sunny', 'w-rainy', 'w-windy');
    track.classList.add('w-' + S.weather);
    const fx = $('weatherFx');
    fx.innerHTML = '';
    if (S.weather === 'rainy') {
      let html = '';
      for (let i = 0; i < 70; i++) {
        const left = rfloat(0, 100), dur = rfloat(0.5, 0.9), delay = rfloat(0, 1);
        html += `<span class="rain-drop" style="left:${left}%;animation-duration:${dur}s;animation-delay:-${delay}s"></span>`;
      }
      fx.innerHTML = html;
    } else if (S.weather === 'windy') {
      let html = '';
      for (let i = 0; i < 14; i++) {
        const top = rfloat(18, 95), w = rfloat(40, 120), dur = rfloat(1.2, 2.4), delay = rfloat(0, 2);
        html += `<span class="wind-streak" style="top:${top}%;width:${w}px;animation-duration:${dur}s;animation-delay:-${delay}s"></span>`;
      }
      fx.innerHTML = html;
    }
    // sunny: clear sky, no overlay (weather is shown in the Weather panel)
  }

  /* ---------------- Overlays ---------------- */
  function showOverlay(html) {
    $('overlayInner').innerHTML = html;
    $('trackOverlay').classList.remove('hidden');
  }
  function hideOverlay() { $('trackOverlay').classList.add('hidden'); }

  function idleOverlay() {
    showOverlay(`
      <div class="ov-emoji">🏇</div>
      <div class="ov-title">Ready to ride</div>
      <div class="ov-sub">Pick a horse and a bet, then send them off.</div>
    `);
  }

  /* ---------------- Race flow ---------------- */
  let raf = null;

  function placeBet() {
    const h = selectedHorse();
    const stake = clamp(Math.floor(S.sel.stake), MIN_BET, S.balance);
    if (!h || stake < MIN_BET || stake > S.balance) return;

    S.phase = 'racing';
    S.bet = { horseId: h.id, type: S.sel.type, stake, odds: h.odds };
    S.balance -= stake;                 // lock the stake
    renderWallet('down');

    $('betBtn').disabled = true;
    $('bettingSub').textContent = 'Bet locked — they\'re under orders…';
    $('trackSub').textContent = 'And they\'re off!';
    document.querySelector('.betting-panel').classList.add('collapsed');
    lockControls(true);
    hideOverlay();
    ensureAudio();
    startCrowdLoop();
    runRace(h);
  }

  function runRace(myHorse) {
    // Determine the true finishing order for this race
    const scored = S.stable.map((h) => ({ h, score: finalScore(h, S.weather) }));
    scored.sort((a, b) => b.score - a.score);
    const order = scored.map((s) => s.h);     // index 0 = winner
    order.forEach((h, i) => { h._finishRank = i + 1; });

    // Map score -> finish time so the winner crosses first
    const scores = scored.map((s) => s.score);
    const minS = Math.min(...scores), maxS = Math.max(...scores);
    const span = (maxS - minS) || 1;
    S.stable.forEach((h) => {
      const t = (finalScore(h, S.weather) - minS) / span;   // 0..1
      h._finishMs = RACE_MS * (1 - SPEED_SPREAD * t);
      h._phase = rfloat(0, Math.PI * 2);
      h._lane = $('runner-' + h.id);
      h._lane.classList.add('running');
    });

    const trackW = $('track').clientWidth;
    const travel = trackW - 46;            // leave room before finish pole
    const start = performance.now();
    let winnerShown = false;

    function frame(now) {
      const elapsed = now - start;
      let allDone = true;

      S.stable.forEach((h) => {
        let p = elapsed / h._finishMs;
        // mid-race wobble that tapers to 0 at the line (keeps final order honest)
        const base = clamp(p, 0, 1);
        const wob = Math.sin(elapsed / 620 + h._phase) * 0.035 * (1 - base);
        const pos = clamp(base + wob, 0, 1);
        if (p < 1) allDone = false;
        h._lane.style.transform = `translateX(${pos * travel}px)`;
      });

      // victory effect when the winner crosses
      const winner = order[0];
      if (!winnerShown && elapsed >= winner._finishMs) {
        winnerShown = true;
        winner._lane.classList.add('win-flash');
        $('finishPole').animate(
          [{ filter: 'brightness(2.2)' }, { filter: 'brightness(1)' }],
          { duration: 600 }
        );
        fanfare();
        $('trackSub').textContent = `${winner.name} takes it!`;
      }

      if (allDone || elapsed > RACE_MS + 600) {
        finishRace(order, myHorse);
        return;
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
  }

  function finishRace(order, myHorse) {
    if (raf) cancelAnimationFrame(raf);
    S.stable.forEach((h) => h._lane && h._lane.classList.remove('running'));
    stopCrowdLoop();
    S.races += 1;

    // record form for the persistent stable
    order.forEach((h, i) => { h.lastFinish = i + 1; });

    const bet = S.bet;
    const myRank = myHorse._finishRank;
    const won =
      (bet.type === 'win' && myRank === 1) ||
      (bet.type === 'place' && myRank <= 2) ||
      (bet.type === 'show' && myRank <= 3);

    let delta = 0;
    if (won) {
      const profit = Math.round(bet.stake * payoutMultiplier(bet.odds, bet.type));
      delta = profit;
      S.balance += bet.stake + profit;   // return stake + profit
      S.gains += profit;
      S.streak += 1;
      if (S.streak > (S._bestStreak || 0)) S._bestStreak = S.streak;
    } else {
      delta = -bet.stake;
      S.lost += bet.stake;               // stake already deducted
      S.streak = 0;
    }

    const newPeak = S.balance > S.peak;
    if (S.balance > S.peak) { S.peak = S.balance; saveHigh(); }

    renderWallet(won ? 'up' : 'down');
    S.phase = 'result';
    showResult(order, myHorse, myRank, won, delta, newPeak);
  }

  function showResult(order, myHorse, myRank, won, delta, newPeak) {
    const rows = order.map((h, i) => {
      const isMine = h.id === myHorse.id;
      return `<li class="${isMine ? 'mine-row' : ''}">
        <span class="rk">${ordinal(i + 1)}</span>
        <span class="dot" style="background:${h.coat}"></span>
        <span class="hn ${isMine ? 'mine' : ''}">${h.name}${isMine ? ' <em>· your bet</em>' : ''}</span>
        <span class="od">${h.odds}/1</span>
      </li>`;
    }).join('');

    const betLabel = { win: 'Win', place: 'Place', show: 'Show' }[S.bet.type];
    const headEmoji = won ? '🎉' : '💸';
    const headTitle = won ? 'Winner!' : 'No luck';
    const headClass = won ? 'win' : 'loss';
    const amount = (won ? '+' : '−') + money(Math.abs(delta));
    const peakTag = newPeak ? '<div class="ov-detail">🏆 New best run!</div>' : '';

    showOverlay(`
      <div class="ov-emoji">${headEmoji}</div>
      <div class="ov-title ${headClass}">${headTitle}</div>
      <div class="ov-amount ${headClass}">${amount}</div>
      <div class="ov-sub">Your ${betLabel} bet on <b>${myHorse.name}</b> finished ${ordinal(myRank)}.</div>
      ${peakTag}
      <ul class="ov-results">
        <li class="res-head"><span class="rk">#</span><span></span><span class="hn">Horse</span><span class="od">Odds</span></li>
        ${rows}
      </ul>
      <div><button class="ov-btn" id="continueBtn">Continue →</button></div>
    `);
    $('continueBtn').addEventListener('click', nextRace);
    $('bettingSub').textContent = won ? 'Winner — press Continue' : 'Press Continue for the next race';

    if (S.balance < MIN_BET) setTimeout(() => gameOver(), 50);
  }

  function nextRace() {
    if (S.phase === 'gameover') return;
    newRace();
    S.sel.horseId = null;
    S.phase = 'betting';
    document.querySelector('.betting-panel').classList.remove('collapsed');
    lockControls(false);
    buildLanes();
    applyWeatherFx();
    idleOverlay();
    renderHorses();
    renderBetGrid();
    renderWeather();
    clampStake();
    updateSummary();
    $('bettingSub').textContent = 'Pick a horse, pick a bet';
    $('trackSub').textContent = 'Awaiting the off…';
  }

  function gameOver() {
    S.phase = 'gameover';
    lockControls(true);
    showOverlay(`
      <div class="ov-emoji">🐴</div>
      <div class="ov-title loss">Out of cash</div>
      <div class="ov-sub">You ran ${S.races} race${S.races === 1 ? '' : 's'} before the wallet ran dry.</div>
      <div class="ov-detail">Longest streak ${bestStreakNote()}</div>
      <div><button class="ov-btn gold" id="restartBtn">Play again</button></div>
    `);
    $('restartBtn').addEventListener('click', restart);
  }
  function bestStreakNote() { return S._bestStreak ? S._bestStreak + ' 🔥' : '0'; }

  function restart() {
    S.balance = START_BANKROLL;
    S.gains = 0; S.lost = 0; S.streak = 0; S.races = 0; S._bestStreak = 0;
    S.peak = Math.max(S.peak, START_BANKROLL); // keep all-time high in header? peak is per-run high
    S.phase = 'betting';
    buildStable();
    newRace();
    S.sel = { horseId: null, type: 'win', stake: 10 };
    boot(false);
  }

  /* ---------------- Controls lock ---------------- */
  function lockControls(locked) {
    document.querySelectorAll('.bet-cell, .horse-card, .bet-type, .chip, #stakeInput')
      .forEach((el) => { el.style.pointerEvents = locked ? 'none' : ''; el.style.opacity = locked ? '.55' : ''; });
    $('betBtn').disabled = locked;
  }

  /* ---------------- Stake helpers ---------------- */
  function clampStake() {
    let v = Math.floor(S.sel.stake);
    if (!Number.isFinite(v) || v < 0) v = 0;
    v = Math.min(v, S.balance);
    S.sel.stake = v;
    $('stakeInput').value = v;
  }

  /* ---------------- Persistence ---------------- */
  function saveHigh() {
    try { localStorage.setItem(LS_KEY, String(S.peak)); } catch (e) {}
  }
  function loadHigh() {
    try {
      const v = parseInt(localStorage.getItem(LS_KEY), 10);
      if (Number.isFinite(v)) S.peak = Math.max(v, START_BANKROLL);
    } catch (e) {}
  }

  /* ============================================================
     AUDIO — synthesized via Web Audio (no files)
     ============================================================ */
  let actx = null, master = null, crowdNode = null, crowdGain = null;

  function ensureAudio() {
    if (S.audioReady) { if (actx.state === 'suspended') actx.resume(); return; }
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      master = actx.createGain();
      master.gain.value = S.muted ? 0 : 0.9;
      master.connect(actx.destination);
      S.audioReady = true;
    } catch (e) { S.audioReady = false; }
  }

  function startCrowdLoop() {
    if (!S.audioReady || S.muted) return;
    stopCrowdLoop();
    // brown-ish noise → bandpass = murmuring crowd
    const bufferSize = actx.sampleRate * 2;
    const buf = actx.createBuffer(1, bufferSize, actx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    crowdNode = actx.createBufferSource();
    crowdNode.buffer = buf; crowdNode.loop = true;
    const bp = actx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.6;
    crowdGain = actx.createGain();
    crowdGain.gain.value = 0.0001;
    crowdNode.connect(bp); bp.connect(crowdGain); crowdGain.connect(master);
    crowdNode.start();
    crowdGain.gain.exponentialRampToValueAtTime(0.18, actx.currentTime + 1.2);
  }
  function stopCrowdLoop() {
    if (crowdGain && actx) {
      try {
        crowdGain.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.4);
        const n = crowdNode;
        setTimeout(() => { try { n.stop(); } catch (e) {} }, 500);
      } catch (e) {}
    }
    crowdNode = null;
  }

  function blip(freq, dur) {
    if (!S.audioReady || S.muted) return;
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'triangle'; o.frequency.value = freq;
    g.gain.value = 0.0001;
    o.connect(g); g.connect(master);
    const t = actx.currentTime;
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.08));
    o.start(t); o.stop(t + (dur || 0.08) + 0.02);
  }

  function fanfare() {
    if (!S.audioReady || S.muted) return;
    const notes = [523, 659, 784, 1046];
    notes.forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'square'; o.frequency.value = f;
      g.gain.value = 0.0001;
      o.connect(g); g.connect(master);
      const t = actx.currentTime + i * 0.1;
      g.gain.exponentialRampToValueAtTime(0.14, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.start(t); o.stop(t + 0.25);
    });
  }

  function toggleMute() {
    S.muted = !S.muted;
    $('soundIcon').textContent = S.muted ? '🔇' : '🔊';
    if (S.audioReady && master) master.gain.value = S.muted ? 0 : 0.9;
  }

  /* ============================================================
     EVENTS
     ============================================================ */
  function bindEvents() {
    $('horsesList').addEventListener('click', (e) => {
      const card = e.target.closest('.horse-card');
      if (card) setHorse(parseInt(card.dataset.id, 10));
    });
    $('betGrid').addEventListener('click', (e) => {
      const cell = e.target.closest('.bet-cell');
      if (cell) setHorse(parseInt(cell.dataset.id, 10));
    });
    $('betTypes').addEventListener('click', (e) => {
      const t = e.target.closest('.bet-type');
      if (t && S.phase === 'betting') { S.sel.type = t.dataset.type; updateSummary(); blip(620, 0.05); }
    });
    $('chips').addEventListener('click', (e) => {
      const c = e.target.closest('.chip');
      if (!c || S.phase !== 'betting') return;
      if (c.dataset.amt === 'max') S.sel.stake = S.balance;
      else S.sel.stake = clamp((parseInt($('stakeInput').value, 10) || 0) + parseInt(c.dataset.amt, 10), 0, S.balance);
      clampStake(); updateSummary(); blip(700, 0.04);
    });
    $('stakeInput').addEventListener('input', (e) => {
      S.sel.stake = parseInt(e.target.value, 10) || 0;
      if (S.sel.stake > S.balance) { S.sel.stake = S.balance; e.target.value = S.balance; }
      updateSummary();
    });
    $('betBtn').addEventListener('click', () => { ensureAudio(); placeBet(); });

    $('soundToggle').addEventListener('click', () => { ensureAudio(); toggleMute(); });
    $('helpToggle').addEventListener('click', () => $('helpModal').hidden = false);
    $('helpClose').addEventListener('click', () => $('helpModal').hidden = true);
    $('helpModal').addEventListener('click', (e) => { if (e.target === $('helpModal')) $('helpModal').hidden = true; });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && S.phase === 'betting' && !$('betBtn').disabled) { ensureAudio(); placeBet(); }
      if (e.key === 'Enter' && S.phase === 'result') { const b = $('continueBtn'); if (b) b.click(); }
    });
  }

  /* ---------------- Boot ---------------- */
  function boot(firstTime) {
    document.querySelector('.betting-panel').classList.remove('collapsed');
    buildLanes();
    buildCrowd();
    applyWeatherFx();
    renderHorses();
    renderBetGrid();
    renderWeather();
    renderWallet();
    clampStake();
    updateSummary();
    idleOverlay();
    $('bettingSub').textContent = 'Pick a horse, pick a bet';
    $('trackSub').textContent = 'Awaiting the off…';
  }

  function init() {
    loadHigh();
    buildStable();
    newRace();
    bindEvents();
    boot(true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
