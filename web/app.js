const $ = selector => document.querySelector(selector);
const home = [59.9343, 30.3351];
const savedKey = 'ploshchadka-favorites-v1';
let favorites = {};
try { favorites = JSON.parse(localStorage.getItem(savedKey)) || {}; } catch {}
let areas = [];
let position;
let active = 'browse';
let type = 'all';
let pending;
let watchId;
let lastSearch;
let usingRecentPosition = false;
let resultStatus = '';
let mapCenter = home;
let catalogMode = 'all';
let nextPage;
let photos = {};
let addressPoints = {};
let landmarks = {};
const nearbyRadius = 5;
const nearbyLimit = 20;

function showMap(entries = []) {
  const [lat, lon] = mapCenter;
  const nearby = catalogMode === 'nearby' && Boolean(position) && active === 'browse';
  const points = nearby ? entries : [];
  const farthest = points.length ? distance(points[points.length - 1]) : 0;
  const zoom = nearby ? (farthest > 3 ? 12 : farthest > 1.5 ? 13 : farthest > 0.7 ? 14 : 15) : 13;
  const query = new URLSearchParams({ll:lon.toFixed(5)+','+lat.toFixed(5),z:String(zoom),l:'map'});
  if (nearby) {
    const pins = [[lon,lat,'pm2blm'],
      ...[...points].sort((a,b) => a.id.localeCompare(b.id)).map(area => [area.lon,area.lat,'pm2rdm'])];
    query.set('pt',pins.map(pin => pin.join(',')).join('~'));
  }
  $('#map-legend').hidden = !nearby;
  const url = 'https://yandex.ru/map-widget/v1/?' + query;
  const frame = $('#map');
  if (frame.getAttribute('src') !== url) frame.src = url;
}
const glyph = area => area.type === 'fitness' ? '↗' : '◈';
const label = area => area.type === 'fitness' ? 'Воркаут' : 'Игровая площадка';
const has = area => Object.prototype.hasOwnProperty.call(favorites, area.id);
const hasPoint = area => Number.isFinite(area.lat) && Number.isFinite(area.lon);

function distance(area) {
  if (!position || !hasPoint(area)) return null;
  const rad = degrees => degrees * Math.PI / 180;
  const a = Math.sin(rad(area.lat-position[0])/2)**2 +
    Math.cos(rad(position[0])) * Math.cos(rad(area.lat)) * Math.sin(rad(area.lon-position[1])/2)**2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1,a)));
}

function distanceLabel(area) {
  const km = distance(area);
  if (km === null) return '';
  const value = km < 1 ? Math.round(km * 1000) + ' м' : km.toLocaleString('ru', {maximumFractionDigits:1}) + ' км';
  return ' · ' + value + ' по прямой';
}

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

function placePhoto(area, thumbnail = false) {
  const url = photos[area.id];
  const fallback = () => element('span',thumbnail ? 'glyph' : 'photo-empty',
    thumbnail ? glyph(area) : 'Фото площадки недоступно');
  if (!url) return fallback();
  const photo = element('img',thumbnail ? 'place-thumb' : 'place-photo');
  photo.alt = thumbnail ? '' : 'Фото площадки «' + area.name + '»';
  photo.loading = thumbnail ? 'lazy' : 'eager';
  photo.decoding = 'async';
  photo.onerror = () => photo.replaceWith(fallback());
  photo.src = thumbnail ? url.replace(/\/full\.webp$/, '/thumb.webp') : url;
  return photo;
}

function markerEstimate(area, addressOnly) {
  if (area.id === 'workout-12918') return {confidence:20,radius:800,zoom:'14'};
  if (area.id === 'workout-4811' || area.id === 'workout-8565') {
    return {confidence:25,radius:400,zoom:'15'};
  }
  if (addressOnly) return {confidence:45,radius:200,zoom:'16'};
  return {confidence:75,radius:75,zoom:'17'};
}

function placeMap(area) {
  const section = element('section','place-map');
  section.append(element('h3','','Расположение'));
  const pointAtAddress = !hasPoint(area) ? addressPoints[area.id] : null;
  const coordinates = hasPoint(area) ? [area.lat,area.lon] : pointAtAddress;
  if (!coordinates) {
    section.append(element('p','','Точка площадки не подтверждена. Маршрут можно открыть по адресу.'));
    return section;
  }
  const addressOnly = pointAtAddress || area.description?.includes('Точка на карте соответствует адресу здания');
  const accuracy = element('p',addressOnly ? 'map-accuracy approximate' : 'map-accuracy',
    addressOnly ? 'Ориентир по адресу' : 'Точка площадки из каталога');
  section.append(accuracy);
  const estimate = markerEstimate(area,addressOnly);
  const metrics = element('div','marker-metrics');
  metrics.append(element('span','','Уверенность в метке · ' + estimate.confidence + '%'),
    element('span','','Радиус поиска · ≈ ' + estimate.radius + ' м'));
  section.append(metrics,element('p','marker-note',
    'Уверенность оценена по типу источника. Радиус приблизительный. Фактическая погрешность не измерена.'));
  if (addressOnly) {
    section.append(element('p','','Точные координаты площадки не подтверждены.'));
  }
  if (landmarks[area.id]?.mapNote) section.append(element('p','',landmarks[area.id].mapNote));
  const frame = element('iframe','place-map-frame');
  frame.title = 'Яндекс Карты — ' + area.name;
  frame.loading = 'lazy';
  frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-popups');
  const point = coordinates[1].toFixed(6) + ',' + coordinates[0].toFixed(6);
  frame.src = 'https://yandex.ru/map-widget/v1/?' + new URLSearchParams({
    ll:point,z:estimate.zoom,l:'map',pt:point+',pm2rdm'
  });
  section.append(frame);
  return section;
}

function toggle(area) {
  if (has(area)) delete favorites[area.id];
  else favorites[area.id] = area;
  try { localStorage.setItem(savedKey, JSON.stringify(favorites)); } catch {}
  render();
}

function render() {
  $('#browse').setAttribute('aria-pressed', active === 'browse');
  $('#saved').setAttribute('aria-pressed', active === 'saved');
  $('#count').textContent = Object.keys(favorites).length;
  const nearby = active === 'browse' && catalogMode === 'nearby';
  $('#nearby').setAttribute('aria-pressed',String(nearby));
  $('#list-title').textContent = active === 'saved' ? 'Сохранённые площадки' : nearby ? 'Ближайшие площадки' : 'Площадки на карте';
  let entries = (active === 'saved' ? Object.values(favorites) : areas)
    .filter(area => type === 'all' || area.type === type)
    .sort((a,b) => (distance(a) ?? Number.MAX_VALUE) - (distance(b) ?? Number.MAX_VALUE));
  if (nearby) entries = position
    ? entries.filter(area => hasPoint(area) && distance(area) <= nearbyRadius).slice(0,nearbyLimit)
    : [];
  $('#status').textContent = active === 'saved' ? 'Сохранено в этом браузере' :
    resultStatus || (nearby ? 'В радиусе 5 км · показано ' + entries.length +
      (usingRecentPosition ? ' · по недавней позиции' : '') : 'Найдено: ' + entries.length);
  showMap(entries);
  const list = $('#list');
  list.replaceChildren();
  for (const area of entries) {
    const card = element('article','card');
    const main = element('button','card-main');
    const info = element('span');
    info.append(element('strong','',area.name),element('small','',[label(area)+distanceLabel(area),area.address].filter(Boolean).join(' · ')));
    main.append(placePhoto(area,true),info);
    main.onclick = () => showDetails(area);
    const heart = element('button','heart',has(area) ? '♥' : '♡');
    heart.setAttribute('aria-label','Избранное: ' + area.name);
    heart.setAttribute('aria-pressed',has(area));
    heart.onclick = () => {
      toggle(area);
      (list.querySelector('[data-area="' + area.id + '"] .heart') || $('#saved')).focus();
    };
    card.dataset.area = area.id;
    card.append(main,heart);
    list.append(card);
  }
  if (!entries.length) {
    const message = active === 'saved' ? (Object.keys(favorites).length ? 'Для этого фильтра сохранённых площадок нет.' : 'Нажми на сердечко рядом с площадкой, чтобы сохранить её.') :
      resultStatus ? '' : nearby ? 'В радиусе 5 км нет площадок для этого фильтра.' :
        'В базе нет площадок для этого района или фильтра. Попробуй открыть всю базу.';
    if (message) list.append(element('p','empty',message));
  }
  if (active === 'browse' && nextPage) {
    const more = element('button','location','Показать ещё');
    more.onclick = nextPage;
    list.append(more);
  }
}

function showDetails(area) {
  const body = $('#detail-body');
  body.replaceChildren(placePhoto(area),element('h2','',area.name),
    element('p','',label(area)+distanceLabel(area)));
  const landmark = element('section','address-landmark');
  const landmarkAddress = landmarks[area.id]?.address || area.address;
  landmark.append(element('h3','','Ориентир по адресу'),element('p','',landmarkAddress || 'Адрес не указан'));
  const hint = landmarks[area.id]?.hint;
  if (hint) landmark.append(element('p','landmark-note',hint));
  else if (area.id.startsWith('wp-')) {
    if (!landmarks[area.id]?.address) landmark.append(element('p','landmark-note','В источнике указан ориентир без номера дома.'));
  }
  body.append(landmark);
  if (area.description) body.append(element('p','',area.description));
  const routes = element('div','routes');
  routes.id = 'route-options';
  routes.hidden = true;
  const from = position ? position.map(value => value.toFixed(5)) : [];
  const to = hasPoint(area) ? area.lat.toFixed(6) + ',' + area.lon.toFixed(6) : landmarkAddress;
  const toGis = hasPoint(area) ? area.lon.toFixed(6) + ',' + area.lat.toFixed(6) : null;
  const gisFrom = from.length ? '/from/'+[...from].reverse().join(',') : '';
  const yandexParams = new URLSearchParams({rtext:from.join(',')+'~'+to,rtt:'pd'});
  const links = [
    [hasPoint(area) ? 'Яндекс Карты ↗' : 'Яндекс Карты · поиск адреса ↗',
      'https://yandex.ru/maps/?'+(hasPoint(area) ? yandexParams : new URLSearchParams({text:to}))],
    ...(toGis ? [['2ГИС ↗','https://2gis.ru/routeSearch/rsType/pedestrian'+gisFrom+'/to/'+toGis]] : []),
    ['Google Карты ↗','https://www.google.com/maps/dir/?'+new URLSearchParams({api:'1',destination:to,travelmode:'walking',...(from.length ? {origin:from.join(',')} : {})})]
  ];
  for (const [title,url] of links) {
    const link = element('a','',title);
    link.href = url;
    link.rel = 'noopener noreferrer';
    routes.append(link);
  }
  const actions = element('div','place-actions');
  const route = element('button','route-action','↗ Маршрут');
  route.setAttribute('aria-controls',routes.id);
  route.setAttribute('aria-expanded','false');
  route.onclick = () => {
    routes.hidden = !routes.hidden;
    route.setAttribute('aria-expanded',String(!routes.hidden));
  };
  const save = element('button','save-action');
  const updateSave = () => {
    save.textContent = has(area) ? '♥ В избранном' : '♡ В избранное';
    save.setAttribute('aria-pressed',String(has(area)));
  };
  updateSave();
  save.onclick = () => { toggle(area); updateSave(); };
  actions.append(route,save);
  body.append(actions,routes,placeMap(area));
  if (!$('#details').open) $('#details').showModal();
}

async function scan(center, radius, all = false, offset = 0, mode = all ? 'all' : 'area') {
  pending?.abort();
  const request = new AbortController();
  pending = request;
  if (!offset && (mode !== 'nearby' || catalogMode !== 'nearby')) areas = [];
  catalogMode = mode;
  nextPage = undefined;
  resultStatus = 'Открываем базу площадок…';
  render();
  try {
    const query = new URLSearchParams({lat:center[0],lon:center[1],radius,all:all ? 1 : 0,offset});
    const response = await fetch('./catalog?' + query,{signal:request.signal});
    if (!response.ok) throw new Error('Catalog could not be opened');
    const data = await response.json();
    if (!Array.isArray(data.places)) throw new Error('Invalid catalog');
    if (request.signal.aborted) return;
    const valid = data.places.filter(place => typeof place.id === 'string' &&
      /^[a-zA-Z0-9_-]+$/.test(place.id) && typeof place.name === 'string' &&
      (hasPoint(place) || (typeof place.address === 'string' && place.address.length > 0)) &&
      ['fitness','court'].includes(place.type));
    areas = offset ? areas.concat(valid) : valid;
    if (data.more && mode !== 'nearby') nextPage = () => scan(center,radius,all,offset+100,mode);
    resultStatus = '';
  } catch {
    if (request.signal.aborted) return;
    resultStatus = 'Не удалось открыть каталог. Попробуй ещё раз.';
  }
  render();
}

function updateNearbyPosition(next) {
  position = next;
  if (catalogMode !== 'nearby') return;
  if (!lastSearch || distance({lat:lastSearch[0],lon:lastSearch[1]}) >= 0.12) {
    mapCenter = position;
    lastSearch = position;
    scan(position,nearbyRadius * 1000,false,0,'nearby');
  } else render();
}

async function loadRecentPosition() {
  if (position || catalogMode !== 'nearby') return;
  try {
    const response = await fetch('./recent-location',{cache:'no-store'});
    if (!response.ok) return;
    const cached = await response.json();
    if (position || catalogMode !== 'nearby' || !Array.isArray(cached) ||
        cached.length !== 2 || !cached.every(Number.isFinite)) return;
    usingRecentPosition = true;
    updateNearbyPosition(cached);
  } catch {}
}

function showNearby() {
  active = 'browse';
  if (position) {
    mapCenter = position;
    lastSearch = position;
    scan(position,nearbyRadius * 1000,false,0,'nearby');
  } else {
    pending?.abort();
    catalogMode = 'nearby';
    areas = [];
    nextPage = undefined;
    resultStatus = 'Определяем местоположение…';
    render();
  }
  if (watchId !== undefined) return;
  if (!navigator.geolocation || !window.isSecureContext) {
    resultStatus = 'Геолокация недоступна.';
    render();
    return;
  }
  loadRecentPosition();
  watchId = navigator.geolocation.watchPosition(({coords}) => {
    const next = [coords.latitude,coords.longitude];
    if (!next.every(Number.isFinite)) return;
    const wasRecent = usingRecentPosition;
    usingRecentPosition = false;
    if (wasRecent) lastSearch = undefined;
    if (catalogMode === 'nearby') resultStatus = '';
    updateNearbyPosition(next);
  }, error => {
    navigator.geolocation.clearWatch(watchId);
    watchId = undefined;
    lastSearch = undefined;
    if (catalogMode !== 'nearby') return;
    resultStatus = position ? 'Показано по последней позиции. Нажми «Рядом со мной», чтобы обновить.' :
      error.code === 1 ? 'Разреши доступ к геолокации, чтобы увидеть ближайшие площадки.' :
      'Не удалось определить местоположение. Нажми «Рядом со мной» ещё раз.';
    render();
  },{timeout:12000,maximumAge:0,enableHighAccuracy:false});
}

window.addEventListener('location-granted',loadRecentPosition);
$('#locate').onclick = showNearby;
$('#nearby').onclick = showNearby;

$('#scan').onclick = () => {
  active = 'browse';
  scan(mapCenter,5000);
};
$('#all-places').onclick = () => {
  active = 'browse';
  scan(position || mapCenter,5000,true);
};
const shifts = {west:[0,-0.075],north:[0.045,0],south:[-0.045,0],east:[0,0.075]};
document.querySelectorAll('[data-pan]').forEach(button => button.onclick = () => {
  const [dy,dx] = shifts[button.dataset.pan];
  mapCenter = [Math.max(-85,Math.min(85,mapCenter[0]+dy)),(mapCenter[1]+dx+540)%360-180];
  showMap();
  $('#scan').click();
});
$('#browse').onclick = () => { active = 'browse'; render(); };
$('#saved').onclick = () => { active = 'saved'; render(); };
document.querySelectorAll('[data-type]').forEach(button => button.onclick = () => {
  type = button.dataset.type;
  document.querySelectorAll('[data-type]').forEach(item => item.setAttribute('aria-pressed',item === button));
  render();
});
$('#close').onclick = () => $('#details').close();
showMap();
scan(home,5000,true);
fetch('./photos.json').then(response => response.ok ? response.json() : {}).then(metadata => {
  photos = metadata.photos || {};
  addressPoints = metadata.addressPoints || {};
  landmarks = metadata.landmarks || {};
  render();
}).catch(() => {});
