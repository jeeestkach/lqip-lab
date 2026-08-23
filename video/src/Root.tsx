/**
 * Список композиций Remotion.
 *
 * Длительность берётся по более КОРОТКОЙ записи: досматривать половину,
 * где вторая уже кончилась, незачем — там будет стоп-кадр.
 */

import React from 'react';
import { Composition } from 'remotion';
import { Compare } from './Compare';

/** Кадров в секунду. Тридцати хватает: на записи нет быстрого движения. */
const FPS = 30;

/** Секунды записи — сколько реально сняли, по короткой половине. */
const SECONDS = 12.7;

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Compare"
    component={Compare}
    durationInFrames={Math.round(SECONDS * FPS)}
    fps={FPS}
    width={2560}
    height={884}
    defaultProps={{
      leftTitle: 'Клиентский рендер',
      rightTitle: 'Серверный рендер',
      leftCardsMs: 1344,
      rightCardsMs: 488,
    }}
  />
);
