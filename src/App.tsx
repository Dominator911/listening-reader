import { lazy, Suspense, useEffect, useState } from 'react';
import { applyTheme, loadPrefs, usePrefs } from './prefs';
import { Library } from './ui/Library';
import { Reader } from './ui/Reader';

const InspectPage = lazy(() => import('./inspect/InspectPage'));

type Route = { name: 'library' } | { name: 'reader'; id: string } | { name: 'inspect' };

function parseHash(): Route {
  const h = location.hash.slice(1);
  if (h === 'inspect') return { name: 'inspect' };
  if (h.startsWith('book/')) return { name: 'reader', id: decodeURIComponent(h.slice(5)) };
  return { name: 'library' };
}

export default function App() {
  const [route, setRoute] = useState<Route>(parseHash);
  const [prefs] = usePrefs();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void loadPrefs().then(() => setReady(true));
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => applyTheme(prefs.theme), [prefs.theme]);

  if (!ready) return null;
  if (route.name === 'inspect')
    return (
      <Suspense fallback={null}>
        <InspectPage />
      </Suspense>
    );
  if (route.name === 'reader') return <Reader bookId={route.id} onBack={() => (location.hash = '')} />;
  return <Library onOpen={(id) => (location.hash = `book/${encodeURIComponent(id)}`)} />;
}
