/**
 * Сравнение двух стратегий рендера — два записанных экрана рядом.
 *
 * Записи сняты по отдельности, каждая со своим чистым кешем, и здесь только
 * сводятся вместе. Снимать их одновременно было бы неправдой: две вкладки
 * делят канал, и обе замедляют друг друга.
 *
 * Общий отсчёт времени идёт от начала записи и одинаков для обеих половин —
 * иначе сравнивать нечего.
 */

import React from 'react';
import { AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';

/** Цвета взяты из самой демки, чтобы видео не выглядело чужим. */
const C = {
  bg: '#0d0f13',
  fg: '#e8eaed',
  dim: '#9aa1ad',
  line: '#262a33',
  panel: '#171a21',
  warn: '#d97706',
  good: '#34d399',
};

export interface CompareProps {
  /** Подпись левой половины. */
  leftTitle: string;
  /** Подпись правой половины. */
  rightTitle: string;
  /** Момент, когда слева стали видны карточки, миллисекунды. */
  leftCardsMs: number;
  /** Момент, когда справа стали видны карточки, миллисекунды. */
  rightCardsMs: number;
}

/** Заголовок половины: название стратегии и веха. */
const PaneHead: React.FC<{ title: string; ms: number; tone: string; elapsed: number }> = ({
  title, ms, tone, elapsed,
}) => (
  <div style={{
    display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
    padding: '14px 20px', borderBottom: `1px solid ${C.line}`,
    background: `color-mix(in oklab, ${tone} 14%, ${C.bg})`,
  }}>
    <span style={{ fontSize: 26, fontWeight: 700 }}>{title}</span>
    <span style={{ fontSize: 20, color: elapsed >= ms ? tone : C.dim, fontFamily: 'ui-monospace, Menlo, monospace' }}>
      {/* До наступления вехи показываем прочерк: цифра, стоящая с первого кадра,
          создаёт впечатление, будто всё уже случилось. */}
      товар виден: {elapsed >= ms ? `${ms} мс` : '—'}
    </span>
  </div>
);

export const Compare: React.FC<CompareProps> = ({ leftTitle, rightTitle, leftCardsMs, rightCardsMs }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const elapsed = Math.round((frame / fps) * 1000);

  const half = (width - 3) / 2;

  return (
    <AbsoluteFill style={{ background: C.bg, color: C.fg, fontFamily: 'ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif' }}>
      {/* Общая шапка с отсчётом: он один на обе половины, иначе сравнение теряет смысл. */}
      <div style={{
        height: 84, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 28px', borderBottom: `1px solid ${C.line}`, background: C.panel,
      }}>
        <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em' }}>
          Каталог из 149 товаров, первый визит, прокрутка со скоростью чтения
        </span>
        <span style={{ fontSize: 34, fontFamily: 'ui-monospace, Menlo, monospace', color: C.dim }}>
          {(elapsed / 1000).toFixed(1).replace('.', ',')} с
        </span>
      </div>

      <div style={{ flex: 1, display: 'flex', gap: 3, background: C.line }}>
        {[
          { title: leftTitle, ms: leftCardsMs, src: 'csr.mp4', tone: C.warn },
          { title: rightTitle, ms: rightCardsMs, src: 'ssr.mp4', tone: C.good },
        ].map((p) => (
          <div key={p.src} style={{ width: half, background: C.bg, display: 'flex', flexDirection: 'column' }}>
            <PaneHead title={p.title} ms={p.ms} tone={p.tone} elapsed={elapsed} />
            <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
              <OffthreadVideo src={staticFile(p.src)} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
              {/*
                Вспышка на моменте появления товара: без неё веха теряется,
                потому что на записи она длится один кадр.
              */}
              <AbsoluteFill style={{
                border: `4px solid ${p.tone}`,
                opacity: interpolate(elapsed, [p.ms - 60, p.ms, p.ms + 700], [0, 0.9, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
                pointerEvents: 'none',
              }} />
            </div>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
