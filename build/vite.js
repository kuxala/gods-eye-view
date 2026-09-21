import { applicationHtmlPlugin } from './application-html.js';
import cesium from 'vite-plugin-cesium';

/** Build browser assets with explicit inputs; never load environment or providers. */
export function createBrowserViteConfig({
  plugins = [],
  publicDir,
  googleApiKey,
  cesiumToken,
  host = 'localhost',
  port = 4173,
  allowedHosts = [],
} = {}) {
  const resolvedHost = host || 'localhost';
  const resolvedPort = parseInt(port, 10) || 4173;
  const resolvedAllowedHosts =
    resolvedHost === '0.0.0.0' || resolvedHost === '::'
      ? true
      : ['localhost', '127.0.0.1', '.local', ...allowedHosts];
  // MilitarySpend fork: the app is embedded by militaryspend.org/globe and
  // nowhere else. localhost:5173 is the militaryspend.org dev server, allowed
  // so the /globe page can be tested locally. Only CSP is sent —
  // X-Frame-Options cannot express an allow-list and would override
  // frame-ancestors in older engines.
  const headers = {
    'Content-Security-Policy':
      'frame-ancestors https://militaryspend.org http://localhost:5173',
  };
  const listen = {
    host: resolvedHost,
    port: resolvedPort,
    allowedHosts: resolvedAllowedHosts,
    headers,
  };
  return {
    plugins: [cesium(), applicationHtmlPlugin(), ...plugins],
    ...(publicDir === undefined ? {} : { publicDir }),
    server: {
      ...listen,
      fs: {
        deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/ENVIRONMENT'],
      },
    },
    // Production runs `vite preview` under pm2; keep it identical to serve.
    preview: { ...listen },
    define: {
      'import.meta.env.GOOGLE_MAPS_API_KEY': JSON.stringify(googleApiKey),
      'import.meta.env.CESIUM_ION_TOKEN': JSON.stringify(cesiumToken),
    },
    build: { chunkSizeWarningLimit: 1500 },
  };
}
