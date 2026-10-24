import './styles/recruit-standalone.scss'
import { RecruitingPage } from './pages/recruiting.jsx'
import { dataService } from './data.js'

async function init() {
  // Load session (for admin detection)
  await dataService.loadSession();

  const app = document.getElementById('app');
  await RecruitingPage.render(app);
}

init();
