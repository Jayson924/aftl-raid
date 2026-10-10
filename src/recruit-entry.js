import './styles/recruit-standalone.scss'
import { RecruitingPage } from './pages/recruiting.jsx'
import { dataService } from './data.js'
import { setPowerIndexMax } from './constants.js'

async function init() {
  // Load session (for admin detection)
  await dataService.loadSession();

  const powerMax = await dataService.getAppConfig('power_index_max').catch(() => null)
  if (powerMax) setPowerIndexMax(powerMax)

  const app = document.getElementById('app');
  await RecruitingPage.render(app);
}

init();
