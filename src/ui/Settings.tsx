import { useEffect } from 'react';
import type { Prefs } from '../prefs';
import { isIOS } from '../prefs';
import { wakeLockSupported } from '../player/platform';
import { Close } from './icons';

interface Props {
  open: boolean;
  onClose: () => void;
  prefs: Prefs;
  setPrefs: (p: Partial<Prefs>) => void;
  voices: SpeechSynthesisVoice[];
  voiceURI?: string;
  onExport: () => void;
  onReprocess: () => void;
  warnings: string[];
}

export function Settings({ open, onClose, prefs, setPrefs, voices, voiceURI, onExport, onReprocess, warnings }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const f = prefs.filters;
  const setF = (patch: Partial<Prefs['filters']>) => setPrefs({ filters: { ...f, ...patch } });

  return (
    <>
      <div className="scrim show" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label="Settings">
        <div className="drawer-head">
          <h2>Settings</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Close />
          </button>
        </div>
        <div className="sheet-body">
          <section>
            <h3>Voice</h3>
            {voices.length ? (
              <select value={voiceURI ?? ''} onChange={(e) => setPrefs({ voiceURI: e.target.value })}>
                {voices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang}){v.localService ? '' : ' · online'}
                  </option>
                ))}
              </select>
            ) : (
              <p className="muted">No voices reported by this browser yet.</p>
            )}
            {isIOS() && (
              <p className="hint">
                Better voices: iPhone Settings → Accessibility → Spoken Content → Voices → English, then download an “Enhanced” or
                “Premium” voice and reopen the app.
              </p>
            )}
          </section>

          <section>
            <h3>What to read</h3>
            <Toggle label="Footnotes and endnotes" checked={f.footnotes} onChange={(v) => setF({ footnotes: v })} />
            <Toggle label="Front matter (copyright, contents)" checked={f.frontMatter} onChange={(v) => setF({ frontMatter: v })} />
            <Toggle label="Index" checked={f.index} onChange={(v) => setF({ index: v })} />
            <label className="row-field">
              <span>Tables and images</span>
              <select value={f.figures} onChange={(e) => setF({ figures: e.target.value as 'describe' | 'skip' })}>
                <option value="describe">Mention briefly</option>
                <option value="skip">Skip</option>
              </select>
            </label>
          </section>

          <section>
            <h3>Display</h3>
            <label className="row-field">
              <span>Theme</span>
              <select value={prefs.theme} onChange={(e) => setPrefs({ theme: e.target.value as Prefs['theme'] })}>
                <option value="system">Match device</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <label className="row-field">
              <span>Text size</span>
              <input type="range" min={14} max={30} step={1} value={prefs.fontSize} onChange={(e) => setPrefs({ fontSize: Number(e.target.value) })} />
              <span className="mono">{prefs.fontSize}</span>
            </label>
          </section>

          <section>
            <h3>Playback</h3>
            <Toggle
              label="Headphone and lock-screen controls"
              checked={prefs.mediaControls}
              onChange={(v) => setPrefs({ mediaControls: v })}
              hint={
                isIOS()
                  ? 'Plays silent audio so controls attach to this app. On iPhone this can interrupt speech; turn it off if speech stops.'
                  : 'Plays silent audio so media keys and headphone buttons reach the app.'
              }
            />
            <p className="hint">
              {wakeLockSupported()
                ? 'The screen stays on while playing. '
                : 'This browser cannot keep the screen on; set Auto-Lock to Never while listening. '}
              Browsers pause speech when the screen locks or you switch apps; playback resumes from the same sentence when you
              come back.
            </p>
          </section>

          <section>
            <h3>This book</h3>
            {warnings.length > 0 && (
              <ul className="warnings">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
            <div className="btn-row">
              <button className="btn" onClick={onExport}>
                Export cleaned text (JSON)
              </button>
              <button className="btn" onClick={onReprocess}>
                Re-detect chapters
              </button>
            </div>
            <p className="hint">The export is the input for the planned audiobook script. Re-detecting undoes manual chapter fixes.</p>
          </section>
        </div>
      </div>
    </>
  );
}

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="toggle">
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
