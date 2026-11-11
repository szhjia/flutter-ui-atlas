import {useMemo} from 'react';
import {ConfigPage} from './ConfigPage';
import {createDemoAdapter} from './demo-adapter';

export function App() {
  const adapter = useMemo(createDemoAdapter, []);
  return <ConfigPage adapter={adapter}/>;
}
