import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {ConfigPage} from './ConfigPage';
import {createHttpAdapter} from './http-adapter';
import './styles.css';

const adapter = createHttpAdapter();
createRoot(document.getElementById('root')!).render(<StrictMode><ConfigPage adapter={adapter}/></StrictMode>);
