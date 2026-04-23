import { configure } from 'mobx';
import ReactDOM from 'react-dom/client';
import { AuthWrapper } from './app/AuthWrapper';
// Removed AnalyticsInitializer import - analytics dependency removed
// See migrate-docs/ANALYTICS_IMPLEMENTATION_GUIDE.md for re-implementation
import { performVersionCheck } from './utils/version-check';
import './styles/index.scss';

// Configure MobX to handle multiple instances in production builds
configure({ isolateGlobalState: true });

// Perform version check FIRST - before any other operations
performVersionCheck();

// Check for debug flag in URL
if (window.location.search.includes('debug_api=1')) {
    (window as any).DERIV_API_LOGGING = true;
    console.log('%c[DEBUG] API Logging enabled via URL parameter', 'font-weight: bold; color: #ff9800;');
}

// Removed AnalyticsInitializer() call - analytics dependency removed

ReactDOM.createRoot(document.getElementById('root')!).render(<AuthWrapper />);
