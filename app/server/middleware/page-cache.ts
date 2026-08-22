/**
 * Отдаёт готовую страницу, не доходя до отрисовки.
 *
 * Промежуточный слой стоит ДО обработчиков маршрутов — в этом весь смысл.
 * Хук `render:response` для такого не годится: он срабатывает уже после того,
 * как страница собрана, то есть экономить там нечего.
 *
 * Что здесь пропадает при попадании в кеш: сборка дерева Vue, внутренний ход
 * к API, подсчёт версии документа и сжатие. По замеру это 3,14 + 0,23 + 2,11 мс
 * локально и 22,71 мс на сервере при первом обращении.
 *
 * Заодно отсюда же отвечает 304. До кеша это было невозможно: чтобы узнать
 * версию, приходилось изготовить страницу целиком и выбросить. Теперь версия
 * лежит рядом с разметкой, и обновление страницы обходится без отрисовки вовсе.
 */

import { getPage, pageCacheKey } from '../utils/pageCache';

/** Какую кодировку просит клиент. `null` — отдаём как есть. */
function negotiate(accept: string | undefined): 'br' | 'gzip' | null {
  if (!accept) return null;
  if (accept.includes('br')) return 'br';
  if (accept.includes('gzip')) return 'gzip';
  return null;
}

/** Прислал ли клиент ту же версию, что у нас на руках. */
function matchesEtag(header: string | undefined, tag: string): boolean {
  if (!header) return false;
  if (header.trim() === '*') return true;
  return header.split(',').some((candidate) => candidate.trim() === tag);
}

export default defineEventHandler(async (event) => {
  if (event.method !== 'GET') return;

  const key = pageCacheKey(event.path.split('?')[0]!, getQuery(event));
  if (!key) return;

  const page = getPage(key);
  if (!page) return;

  setResponseHeader(event, 'etag', page.etag);
  setResponseHeader(event, 'cache-control', 'public, max-age=60, stale-while-revalidate=300');
  setResponseHeader(event, 'vary', 'accept-encoding');
  // Ноль долей миллисекунды у отрисовки — это и есть весь смысл слоя.
  setResponseHeader(event, 'server-timing', 'cache;desc="page-cache-hit";dur=0');

  if (matchesEtag(getRequestHeader(event, 'if-none-match'), page.etag)) {
    setResponseStatus(event, 304);
    return '';
  }

  setResponseHeader(event, 'content-type', 'text/html;charset=utf-8');

  const encoding = negotiate(getRequestHeader(event, 'accept-encoding'));
  const body = encoding ? page.encoded.get(encoding) : undefined;

  if (body) {
    setResponseHeader(event, 'content-encoding', encoding!);
    setResponseHeader(event, 'content-length', String(body.length));
    return send(event, body);
  }

  // Клиент без сжатия либо кодировка, которую мы не готовили заранее.
  return send(event, page.html);
});
