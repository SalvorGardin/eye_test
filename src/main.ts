import './style.css';
import { Camera } from './camera.ts';
import { Calibration, condition, LIMITS, unknown } from './video-analysis/index.ts';
import type { Observation } from './video-analysis/index.ts';
import { TestSession, DIRECTIONS, swipe } from './session.ts';
import type { Direction } from './session.ts';

type Screen = 'home' | 'api' | 'welcome' | 'calibration' | 'ready' | 'practice' | 'test' | 'results';
type Mode = 'api' | 'vision' | null;
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const mark = `<svg viewBox="0 0 44 32" fill="none" aria-hidden="true"><circle cx="12" cy="18" r="9"/><circle cx="32" cy="18" r="9"/><path d="M21 18h2M3 15l3-12h8m27 12L38 3h-8"/></svg>`;
const optotype = `<svg id="optotype" viewBox="0 0 5 5" aria-hidden="true"><path d="M0 0h5v1H1v1h4v1H1v1h4v1H0z"/></svg>`;
$('#app').innerHTML = `
  <header class="header"><a class="brand" href="./" aria-label="ГигаДок — начать заново">${mark}<span>ГигаДок<span class="brand-divider"> / </span><span class="brand-sub">Зрение</span></span></a><span class="demo-tag"><i></i> Демонстрация</span></header>
  <main class="shell">
    <button id="choose-mode" class="text-button mode-back" hidden>← Выбрать режим</button>
    <nav class="steps" aria-label="Этапы проверки"><span data-step="0"><b>01</b> Подготовка</span><span data-step="1"><b>02</b> Проверка</span><span data-step="2"><b>03</b> Результат</span></nav>
    <div class="workspace">
      <section class="stage" aria-label="Проверка зрения"><div id="content"></div></section>
      <aside class="side">
        <div class="camera-card">
          <div class="card-heading"><span>Камера</span><span id="camera-label" class="small-status">Выключена</span></div>
          <div class="video-wrap"><video id="video" autoplay playsinline muted aria-label="Зеркальное изображение с вашей камеры"></video><div id="camera-placeholder">${mark}<span>Здесь появится<br>изображение с камеры</span></div><div class="face-guide" aria-hidden="true"></div><span class="mirror-tag">Зеркальное изображение</span></div>
          <label class="zoom-control" for="camera-zoom">Увеличение <select id="camera-zoom" aria-describedby="zoom-hint"><option value="1">1×</option><option value="1.5">1,5×</option><option value="2">2×</option><option value="2.5">2,5×</option><option value="3">3×</option></select></label>
          <p id="zoom-hint" class="helper">Держите лицо и ладонь в кадре. Изменение масштаба повторит настройку.</p>
          <div class="indicators">
            <div class="indicator"><span>Взгляд на экран</span><strong id="gaze" data-state="unknown">Не определён</strong></div>
            <div class="indicator"><span>Левый глаз</span><strong id="left-eye" data-state="unknown">Не определён</strong></div>
            <div class="indicator"><span>Правый глаз</span><strong id="right-eye" data-state="unknown">Не определён</strong></div>
          </div>
          <p class="side-note">Левый и правый — с вашей стороны.<br>Прикрывайте глаз ладонью.</p>
          <button id="stop-camera" class="text-button" hidden>Выключить камеру</button>
        </div>
        <div class="privacy"><span class="privacy-icon" aria-hidden="true">⌁</span><div><strong>Видео остаётся у вас</strong><p>Обработка на устройстве.<br>Без записи и отправки видео.</p></div></div>
      </aside>
    </div>
    <footer><span>Для спокойной проверки — без спешки</span><span>Демонстрация, не медицинское измерение</span></footer>
  </main>`;

let mode: Mode = null;
let screen: Screen = 'home';
let loading = false;
let loadMessage = '';
let errorMessage = '';
let resume: 'practice' | 'test' = 'practice';
let observation: Observation = unknown(performance.now());
let session = new TestSession();
const calibration = new Calibration();
let practicePassed = false;
let practiceFeedback = '';
let renderedKey = '';
let orientationNote = '';
let pointer: { id: number; x: number; y: number; token: number; screen: Screen } | null = null;
let multiTouch = false;
const activePointers = new Set<number>();
let actionGeneration = 0;

const camera = new Camera($('#video'), o => { observation = o; }, () => calibration.baseline, message => {
  session.suspend(); errorMessage = message; loading = false; go(mode === 'api' ? 'api' : 'welcome');
});

function setText(selector: string, text: string) {
  const element = $(selector); if (element && element.textContent !== text) element.textContent = text;
}

function go(next: Screen) {
  pointer = null; screen = next; renderedKey = ''; render();
  requestAnimationFrame(() => $('#content h1')?.focus({ preventScroll: true }));
}

function selectMode(next: Mode) {
  actionGeneration++;
  camera.stop(); loading = false; errorMessage = ''; loadMessage = ''; orientationNote = '';
  calibration.reset(); session = new TestSession(); resume = 'practice';
  practicePassed = false; practiceFeedback = ''; activePointers.clear(); multiTouch = false;
  mode = next;
  go(next === 'api' ? 'api' : next === 'vision' ? 'welcome' : 'home');
}

function title(eyebrow: string, heading: string, description = '') {
  return `<div class="eyebrow">${eyebrow}</div><h1 tabindex="-1">${heading}</h1>${description ? `<p class="intro">${description}</p>` : ''}`;
}

function currentReason(now: number) {
  if (document.hidden) return 'Вернитесь к проверке';
  return condition(observation, session.eye, now);
}

function tick() {
  const now = performance.now();
  if (screen === 'calibration' || (screen === 'api' && camera.running)) {
    if (!document.hidden && now - observation.at <= LIMITS.staleMs) calibration.update(observation, now);
    else { calibration.since = null; calibration.progress = 0; calibration.samples = []; }
    if (screen === 'calibration' && calibration.step === 'done') go('ready');
  }
  if (screen === 'test') {
    const reason = currentReason(now);
    session.update(reason === null, now, document.hidden || !camera.running || now - observation.at > LIMITS.staleMs);
  }
  render();
}

function render() {
  const now = performance.now();
  const key = [screen, screen === 'calibration' ? calibration.step : '', screen === 'test' ? session.eye : ''].join(':');
  if (key !== renderedKey) {
    renderedKey = key;
    const content = $('#content');
    if (screen === 'home') content.innerHTML = `
      ${title('ГИГАДОК · ДВА РЕЖИМА', 'Что будем проверять?', 'Выберите сценарий. Камера включится только тогда, когда вы будете готовы.')}
      <div class="mode-grid">
        <button id="select-vision" class="mode-card"><span class="mode-art vision-art" aria-hidden="true">E</span><span class="mode-title">Проверка зрения <span aria-hidden="true">↗</span></span><span class="mode-description">Пройдите короткий тест для обоих глаз. Отвечайте свайпами и получите результат.</span><span class="mode-caption">Калибровка · 10 символов · Итоги</span></button>
        <button id="select-api" class="mode-card"><span class="mode-art api-art" aria-hidden="true">{ · }</span><span class="mode-title">Проверка API <span aria-hidden="true">↗</span></span><span class="mode-description">Посмотрите, как анализатор определяет взгляд на экран и прикрытие глаз рукой.</span><span class="mode-caption">Камера · Калибровка · Живые данные</span></button>
      </div><p class="home-privacy">Видео обрабатывается на устройстве. Без записи и отправки.</p>`;
    if (screen === 'api') content.innerHTML = `
      ${title('АНАЛИЗ ВИДЕО · API', 'Проверка API', 'Включите камеру и следуйте подсказкам. Результаты анализа появятся ниже и на панели камеры.')}
      <div id="error" class="error" role="alert" hidden></div>
      <div class="api-actions"><button id="start" class="primary">Включить камеру ↗</button><button id="recalibrate" class="secondary" disabled>Сбросить калибровку</button></div>
      <p id="load-message" class="helper" role="status"></p>
      <p id="orientation-note" class="helper" role="status"></p>
      <div class="api-calibration"><div class="api-target" aria-hidden="true"><i></i></div><div><strong id="api-step"></strong><p id="api-hint" role="status"></p></div><progress id="api-progress" max="1" value="0" aria-label="Прогресс настройки"></progress></div>
      <div class="api-output-heading"><span>Результат анализа</span><span id="api-freshness"></span></div>
      <pre id="api-result" class="api-json" aria-label="Результат API"></pre>
      <p class="helper">true — обнаружено · false — не обнаружено · null — не определено</p>
      <details class="api-details"><summary>Полный ответ и параметры калибровки</summary><pre id="api-full" class="api-json"></pre></details>`;
    if (screen === 'welcome') content.innerHTML = `
      ${title('ЗРЕНИЕ · ДЕМО', 'Посмотрите на мир<br><em>чуть внимательнее.</em>', 'Короткая проверка с камерой: прикройте один глаз и отвечайте простыми свайпами.')}
      <div class="welcome-visual" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><span class="big-e">E</span><span class="visual-caption">Один символ.<br>Четыре направления.</span><span class="visual-arrow">↗</span></div>
      <div class="setup-tips"><div><b>01</b><span>iPad на подставке<br><strong>40–70 см от лица</strong></span></div><div><b>02</b><span>Ровное освещение<br><strong>Лицо хорошо видно</strong></span></div></div>
      <div id="error" class="error" role="alert" hidden></div>
      <button id="start" class="primary">Включить камеру <span aria-hidden="true">↗</span></button><p id="load-message" class="helper" role="status">Потребуется разрешение на доступ к камере</p>`;
    if (screen === 'calibration') {
      const step = calibration.step;
      const heading = step === 'center' ? 'Посмотрите на точку' : `Прикройте ${step === 'left' ? 'левый' : 'правый'} глаз`;
      content.innerHTML = `${title('НАСТРОЙКА КАМЕРЫ · ' + (step === 'center' ? '1' : step === 'left' ? '2' : '3') + ' ИЗ 3', heading, step === 'center' ? 'Держите голову ровно. Смотрите в центр экрана, оба глаза открыты.' : 'Прикройте глаз ладонью. Другой глаз оставьте открытым и смотрите на точку.')}
      <p id="orientation-note" class="helper"></p><div class="target-space"><div class="target" aria-label="Точка для фиксации взгляда"><i></i></div></div>
      <div class="calibration-status"><p id="calibration-hint" role="status"></p><progress id="calibration-progress" max="1" value="0" aria-label="Прогресс настройки"></progress></div>
      <button id="recalibrate" class="text-button">Начать настройку заново</button>`;
    }
    if (screen === 'ready') content.innerHTML = `${title('КАМЕРА ГОТОВА', 'Всё настроено.', 'Камера различает положение руки. Можно потренироваться и перейти к проверке.')}
      <div class="ready-art" aria-hidden="true"><span>✓</span></div><div class="notice">Если распознавание потеряет лицо или руку, проверка приостановится и подскажет, что поправить.</div>
      <button id="continue" class="primary">${resume === 'test' ? 'Продолжить проверку' : 'Попробовать свайп'} <span aria-hidden="true">→</span></button><button id="recalibrate" class="text-button">Настроить ещё раз</button>`;
    if (screen === 'practice') content.innerHTML = `${title('ПЕРЕД НАЧАЛОМ', 'Ответ — одним свайпом.', 'Проведите пальцем в сторону, куда направлены ножки символа E. Сейчас — вправо. Руки можно опустить.')}
      <div id="swipe-zone" class="swipe-zone practice" tabindex="0" role="group" aria-label="Тренировка. Проведите вправо или нажмите стрелку вправо">${optotype}<div class="swipe-help" aria-hidden="true">Проведите вправо <span>⟶</span></div></div>
      <p id="practice-feedback" class="helper" role="status"></p><button id="begin-test" class="primary" disabled>Начать проверку <span aria-hidden="true">→</span></button>`;
    if (screen === 'test') content.innerHTML = `${title('ПРОВЕРКА · ' + (session.eye === 'right' ? '1' : '2') + ' ИЗ 2', session.eye === 'right' ? 'Правый глаз' : 'Левый глаз', `Прикройте ${session.eye === 'right' ? 'левый' : 'правый'} глаз ладонью. Смотрите на экран.`)}
      <div class="test-progress"><span id="trial-count"></span><div id="trial-dots" class="trial-dots" aria-hidden="true"></div></div>
      <div id="swipe-zone" class="swipe-zone" tabindex="0" role="group" aria-label="Свайп в сторону ножек символа E. Можно использовать стрелки на клавиатуре.">${optotype}<div id="pause-overlay" class="pause-overlay" role="status"><span class="pause-icon" aria-hidden="true">Ⅱ</span><strong>Небольшая пауза</strong><p id="pause-reason"></p><small>Продолжим автоматически</small></div></div>
      <p class="helper">Свайп в сторону ножек E · Время не ограничено</p><button id="skip" class="secondary">Не различаю</button><button id="recalibrate" class="text-button">Перенастроить камеру</button>`;
    if (screen === 'results') content.innerHTML = `${title('ПРОВЕРКА ЗАВЕРШЕНА', 'Готово. Спасибо!', 'Вот сколько направлений вы определили правильно.')}
      <div class="scores"><div><span>Правый глаз</span><strong>${session.answers.right.filter(Boolean).length}<small> / 5</small></strong></div><div><span>Левый глаз</span><strong>${session.answers.left.filter(Boolean).length}<small> / 5</small></strong></div></div>
      <div class="notice"><strong>Это демонстрация сценария.</strong><p>Результат не измеряет остроту зрения и не заменяет осмотр специалиста. История и видео не сохраняются.</p></div><button id="repeat" class="primary">Пройти ещё раз <span aria-hidden="true">↻</span></button><p class="helper">Камера выключена</p>`;
  }
  const stepNumber = screen === 'results' ? 2 : ['practice', 'test'].includes(screen) ? 1 : 0;
  $('#choose-mode').hidden = mode === null;
  $('.steps').hidden = mode !== 'vision';
  $('.side').hidden = mode === null;
  $('.workspace').classList.toggle('home-workspace', mode === null);
  $('.stage').setAttribute('aria-label', mode === 'api' ? 'Проверка API' : mode === 'vision' ? 'Проверка зрения' : 'Выбор проверки');
  setText('.brand-sub', mode === 'api' ? 'API' : mode === 'vision' ? 'Зрение' : 'Проверки');
  document.querySelectorAll<HTMLElement>('[data-step]').forEach(el => { el.classList.toggle('active', Number(el.dataset.step) === stepNumber); el.setAttribute('aria-current', Number(el.dataset.step) === stepNumber ? 'step' : 'false'); });
  $('#stop-camera').hidden = !camera.running && !loading;
  $('#camera-placeholder').hidden = camera.running;
  $('.face-guide').hidden = !camera.running;
  const video = $<HTMLVideoElement>('#video');
  if (video.videoWidth && video.videoHeight) $('.video-wrap').style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
  setText('#camera-label', loading ? 'Подключение' : camera.running ? 'Включена' : 'Выключена');
  const fresh = camera.running && !document.hidden && now - observation.at <= LIMITS.staleMs;
  const values = { gaze: fresh ? observation.gaze : null, 'left-eye': fresh ? observation.covered.left : null, 'right-eye': fresh ? observation.covered.right : null };
  for (const [id, value] of Object.entries(values)) {
    const element = $(`#${id}`);
    element.dataset.state = value === null ? 'unknown' : value ? 'yes' : 'no';
    setText(`#${id}`, value === null ? 'Не определён' : id === 'gaze' ? (value ? 'На экране' : 'В стороне') : (value ? 'Прикрыт рукой' : 'Не прикрыт'));
  }
  if (screen === 'welcome' || screen === 'api') {
    $('#start').toggleAttribute('disabled', loading || camera.running);
    setText('#start', loading ? 'Подключаем камеру…' : camera.running ? 'Камера включена' : errorMessage ? 'Повторить запуск ↗' : 'Включить камеру ↗');
    setText('#load-message', loading ? loadMessage : camera.running ? 'Обработка видео на устройстве' : 'Потребуется разрешение на доступ к камере');
    $('#error').hidden = !errorMessage; setText('#error', errorMessage);
  }
  if (screen === 'api') {
    setText('#orientation-note', calibration.step === 'done' ? '' : orientationNote);
    $('#recalibrate').toggleAttribute('disabled', !camera.running);
    const steps = { center: '1 из 3 · Смотрите на точку', left: '2 из 3 · Прикройте левый глаз', right: '3 из 3 · Прикройте правый глаз', done: 'Калибровка завершена' };
    setText('#api-step', camera.running ? steps[calibration.step] : 'Начните с включения камеры');
    setText('#api-hint', !camera.running ? 'Затем настройте взгляд и по очереди прикройте каждый глаз.' : !fresh ? 'Ожидаем свежие кадры камеры…' : calibration.step === 'done' ? 'Смотрите на экран или в сторону, прикрывайте глаза — наблюдайте за ответом API.' : calibration.hint);
    $<HTMLProgressElement>('#api-progress').value = camera.running ? (calibration.step === 'done' ? 1 : calibration.progress) : 0;
    const current = fresh ? observation : unknown(observation.at, camera.running ? 'Нет свежего кадра' : 'Камера выключена');
    setText('#api-freshness', fresh ? 'Обновляется' : 'Нет свежих данных');
    setText('#api-result', JSON.stringify({ valid: current.valid, gaze: current.gaze, covered: current.covered, reason: current.reason }, null, 2));
    setText('#api-full', JSON.stringify({ zoom: camera.zoom, observation: current, calibration: { step: calibration.step, progress: calibration.progress, baseline: calibration.baseline } }, null, 2));
  }
  if (screen === 'calibration') {
    setText('#orientation-note', orientationNote);
    setText('#calibration-hint', !fresh ? 'Ожидаем свежие кадры камеры…' : calibration.hint);
    $<HTMLProgressElement>('#calibration-progress').value = calibration.progress;
  }
  if (screen === 'practice') {
    $('#optotype').style.width = '96px';
    $('#begin-test').toggleAttribute('disabled', !practicePassed);
    setText('#practice-feedback', practiceFeedback || 'Потренируйтесь здесь — этот ответ не учитывается');
  }
  if (screen === 'test') {
    setText('#trial-count', `Символ ${session.index + 1} из 5`);
    const dots = $('#trial-dots'); const dotKey = String(session.index);
    if (dots.dataset.index !== dotKey) { dots.dataset.index = dotKey; dots.innerHTML = Array.from({ length: 5 }, (_, i) => `<i class="${i < session.index ? 'done' : i === session.index ? 'current' : ''}"></i>`).join(''); }
    const symbol = $('#optotype');
    symbol.style.width = `${session.size}px`;
    symbol.style.transform = `rotate(${DIRECTIONS.indexOf(session.direction) * 90}deg)`;
    symbol.style.visibility = session.canAnswer(now) ? 'visible' : 'hidden';
    $('#pause-overlay').hidden = !session.paused;
    setText('#pause-reason', currentReason(now) || 'Условия соблюдены. Держите руку на месте…');
    $('#skip').toggleAttribute('disabled', !session.canAnswer(now));
  }
}

async function start() {
  if (loading) return;
  const generation = ++actionGeneration;
  errorMessage = ''; loading = true; calibration.reset(); orientationNote = '';
  session = new TestSession(); resume = 'practice'; practicePassed = false; practiceFeedback = '';
  go(mode === 'api' ? 'api' : 'welcome');
  try {
    const started = await camera.start(message => { loadMessage = message; render(); });
    if (generation !== actionGeneration) return;
    loading = false;
    if (started) go(mode === 'api' ? 'api' : 'calibration');
  } catch (error) {
    if (generation !== actionGeneration) return;
    loading = false; errorMessage = error instanceof Error ? error.message : 'Не удалось включить камеру'; render();
  }
}

function recalibrate(note = '') {
  if (!camera.running) return;
  if (screen === 'test') resume = 'test';
  session.suspend(); calibration.reset(); observation = unknown(performance.now(), 'Ожидаем свежие кадры камеры');
  activePointers.clear(); multiTouch = false; orientationNote = note; go(mode === 'api' ? 'api' : 'calibration');
}

function respond(direction: Direction | null, token: number) {
  if (screen === 'practice') {
    practicePassed = direction === 'right';
    practiceFeedback = practicePassed ? 'Верно! Теперь вы готовы к проверке.' : 'Ножки этой E направлены вправо. Попробуйте ещё раз.';
    render(); return;
  }
  if (screen !== 'test') return;
  const now = performance.now();
  session.update(currentReason(now) === null, now, document.hidden || !camera.running || now - observation.at > LIMITS.staleMs);
  if (session.answer(direction, token, now)) {
    if (session.done) { camera.stop(); go('results'); }
    else render();
  }
}

$('#camera-zoom').addEventListener('change', event => {
  camera.setZoom(Number((event.target as HTMLSelectElement).value));
  recalibrate('Масштаб изменился. Повторим настройку; принятые ответы сохранены.');
});

$('#app').addEventListener('click', event => {
  const id = (event.target as HTMLElement).closest('button')?.id;
  if (id === 'choose-mode') selectMode(null);
  if (id === 'select-api') selectMode('api');
  if (id === 'select-vision') selectMode('vision');
  if (id === 'start' || id === 'repeat') void start();
  if (id === 'stop-camera') selectMode(mode);
  if (id === 'recalibrate') recalibrate();
  if (id === 'continue') go(resume);
  if (id === 'begin-test' && practicePassed) { session = new TestSession(); resume = 'test'; go('test'); }
  if (id === 'skip') respond(null, session.token);
});

$('#content').addEventListener('pointerdown', event => {
  if (!(event.target as HTMLElement).closest('#swipe-zone')) return;
  activePointers.add(event.pointerId);
  if (activePointers.size > 1) { multiTouch = true; pointer = null; return; }
  if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
  if (screen === 'test' && !session.canAnswer(performance.now())) return;
  pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, token: session.token, screen };
  $('#swipe-zone').setPointerCapture(event.pointerId);
});
window.addEventListener('pointerup', event => {
  const start = pointer; activePointers.delete(event.pointerId);
  if (multiTouch) { if (!activePointers.size) multiTouch = false; pointer = null; return; }
  if (!start || start.id !== event.pointerId || start.screen !== screen) return;
  pointer = null;
  const direction = swipe(event.clientX - start.x, event.clientY - start.y);
  if (direction) respond(direction, start.token);
});
window.addEventListener('pointercancel', event => { activePointers.delete(event.pointerId); pointer = null; if (!activePointers.size) multiTouch = false; });
window.addEventListener('keydown', event => {
  const directions: Record<string, Direction> = { ArrowRight: 'right', ArrowDown: 'down', ArrowLeft: 'left', ArrowUp: 'up' };
  if (directions[event.key] && !event.repeat && (screen === 'practice' || screen === 'test')) {
    event.preventDefault(); respond(directions[event.key], session.token);
  }
});
document.addEventListener('visibilitychange', () => {
  session.suspend(); pointer = null; calibration.since = null; calibration.samples = []; calibration.progress = 0;
  observation = unknown(performance.now(), 'Ожидаем свежие кадры камеры'); render();
});
let orientation = matchMedia('(orientation: portrait)').matches;
function onOrientation() {
  const next = matchMedia('(orientation: portrait)').matches;
  if (next === orientation) return;
  orientation = next;
  recalibrate('Положение iPad изменилось. Повторим настройку; принятые ответы сохранены.');
}
window.addEventListener('resize', onOrientation);
window.addEventListener('orientationchange', () => setTimeout(onOrientation, 250));
window.addEventListener('pagehide', () => { actionGeneration++; camera.stop(); session.suspend(); loading = false; screen = mode === 'api' ? 'api' : mode === 'vision' ? 'welcome' : 'home'; renderedKey = ''; });
setInterval(tick, 100);
render();
