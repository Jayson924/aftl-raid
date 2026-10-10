import './styles/recruit-standalone.scss'
import { RecruitingPage } from './pages/recruiting.jsx'
import { dataService } from './data.js'
import { setFdTable, setPowerIndexMax } from './constants.js'

async function init() {
  // Load session (for admin detection)
  await dataService.loadSession();

  // Load FD table from app_config if available
  const fdTableRaw = await dataService.getAppConfig('fd_table');
  if (fdTableRaw) {
    try {
      const parsed = typeof fdTableRaw === 'string' ? JSON.parse(fdTableRaw) : fdTableRaw;
      if (Array.isArray(parsed) && parsed.length > 0) setFdTable(parsed);
    } catch { /* use defaults */ }
  }
  const powerMax = await dataService.getAppConfig('power_index_max').catch(() => null)
  if (powerMax) setPowerIndexMax(powerMax)

  const app = document.getElementById('app');
  await RecruitingPage.render(app);
}

init();
