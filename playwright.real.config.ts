import {defineConfig} from '@playwright/test';
import base from './playwright.config';
export default defineConfig({
 ...base,
 testMatch:['**/applications.spec.ts','**/experience-backend.spec.ts','**/training-real.spec.ts','**/agent-ui.spec.ts'],
 use:{...base.use,baseURL:'http://127.0.0.1:5174',launchOptions:{executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']}},
 webServer:[
  {command:'"backend/.venv/Scripts/python.exe" -m uvicorn backend.tests.dev_server:app --host 127.0.0.1 --port 8001 --no-access-log',url:'http://127.0.0.1:8001/api/health',env:{VISION_TEST_SERVER:'1'},reuseExistingServer:false,timeout:120000},
  {command:`"${process.execPath}" node_modules/typescript/bin/tsc -b && "${process.execPath}" node_modules/vite/bin/vite.js build && "${process.execPath}" node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5174 --strictPort`,url:'http://127.0.0.1:5174/api/health',env:{VITE_API_PROXY_TARGET:'http://127.0.0.1:8001',VITE_API_MODE:'real'},reuseExistingServer:false,timeout:120000}
 ]
});
