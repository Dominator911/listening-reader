import { useEffect, useState } from 'react';
import type { Player, PlayerState } from '../player/Player';
import { fmtDuration, fmtRate } from './format';
import * as I from './icons';

interface Props {
  player: Player;
  state: PlayerState;
  chapterLeft: number;
  bookLeft: number;
  chapterFrac: number;
  onRate: (r: number) => void;
}

const SLEEP_OPTIONS: { label: string; v: number | 'chapter' | null }[] = [
  { label: 'Off', v: null },
  { label: '15 min', v: 15 },
  { label: '30 min', v: 30 },
  { label: '60 min', v: 60 },
  { label: 'End of chapter', v: 'chapter' },
];

export function PlayerBar({ player, state, chapterLeft, bookLeft, chapterFrac, onRate }: Props) {
  const [sleepOpen, setSleepOpen] = useState(false);
  const [, tick] = useState(0);
  // Refresh the sleep countdown every 15 s.
  useEffect(() => {
    if (state.sleep?.kind !== 'minutes') return;
    const t = setInterval(() => tick((n) => n + 1), 15000);
    return () => clearInterval(t);
  }, [state.sleep]);

  const sleepLabel =
    state.sleep?.kind === 'minutes'
      ? `${Math.max(1, Math.round((state.sleep.endsAt - Date.now()) / 60000))}m`
      : state.sleep?.kind === 'chapter'
        ? 'Ch.'
        : '';

  return (
    <footer className="player">
      <div className="track" aria-hidden="true">
        <span style={{ width: `${Math.round(chapterFrac * 1000) / 10}%` }} />
      </div>
      <div className="times">
        <span>{fmtDuration(chapterLeft)} left in chapter</span>
        <span>{fmtDuration(bookLeft)} left in book</span>
      </div>
      {state.error && <div className="player-error">{state.error}</div>}
      <div className="controls main">
        <button className="ctl" onClick={player.prevParagraph} aria-label="Previous paragraph" title="Previous paragraph (↑)">
          <I.ParaBack />
        </button>
        <button className="ctl" onClick={player.prevSentence} aria-label="Previous sentence" title="Previous sentence (←)">
          <I.SentenceBack />
        </button>
        <button className="ctl play" onClick={() => player.toggle()} aria-label={state.playing ? 'Pause' : 'Play'} title="Play/pause (space)">
          {state.playing ? <I.Pause /> : <I.Play />}
        </button>
        <button className="ctl" onClick={player.nextSentence} aria-label="Next sentence" title="Next sentence (→)">
          <I.SentenceFwd />
        </button>
        <button className="ctl" onClick={player.nextParagraph} aria-label="Next paragraph" title="Next paragraph (↓)">
          <I.ParaFwd />
        </button>
      </div>
      <div className="controls secondary">
        <button className="ctl small" onClick={player.prevChapter} aria-label="Previous chapter" title="Previous chapter (shift+←)">
          <I.ChapterBack />
        </button>
        <div className="rate">
          <button className="ctl small" onClick={() => onRate(state.rate - 0.25)} disabled={state.rate <= 0.75} aria-label="Slower" title="Slower ([)">
            −
          </button>
          <span className="rate-val" aria-live="polite">
            {fmtRate(state.rate)}
          </span>
          <button className="ctl small" onClick={() => onRate(state.rate + 0.25)} disabled={state.rate >= 3} aria-label="Faster" title="Faster (])">
            +
          </button>
        </div>
        <div className="sleep">
          <button className={`ctl small ${state.sleep ? 'on' : ''}`} onClick={() => setSleepOpen(!sleepOpen)} aria-label="Sleep timer" title="Sleep timer">
            <I.Moon />
            {sleepLabel && <span className="badge-sm">{sleepLabel}</span>}
          </button>
          {sleepOpen && (
            <div className="popover" role="menu">
              {SLEEP_OPTIONS.map((o) => (
                <button
                  key={o.label}
                  role="menuitem"
                  className={
                    (o.v === null && !state.sleep) ||
                    (o.v === 'chapter' && state.sleep?.kind === 'chapter') ||
                    (typeof o.v === 'number' && state.sleep?.kind === 'minutes' && state.sleep.minutes === o.v)
                      ? 'selected'
                      : ''
                  }
                  onClick={() => {
                    setSleepOpen(false);
                    if (o.v === null) player.setSleep(null);
                    else if (o.v === 'chapter') player.setSleep({ kind: 'chapter' });
                    else player.setSleep({ kind: 'minutes', minutes: o.v, endsAt: Date.now() + o.v * 60000 });
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="ctl small" onClick={player.nextChapter} aria-label="Next chapter" title="Next chapter (shift+→)">
          <I.ChapterFwd />
        </button>
      </div>
    </footer>
  );
}
