import { meetsMinimumViewport } from './passwordGateCore.js';
import { bindUserGuidePopup } from './userGuidePopup.js';
import { accessFetch, signOut } from './auth/client.js';
import { maintainSession } from './auth/session.js';

const loadingScreen = document.getElementById('loading-screen');
const status = document.getElementById('access-gate-status');
const notice = document.getElementById('access-gate-viewport-notice');
bindUserGuidePopup();
function updateViewportNotice() {
  if (notice)
    notice.hidden = meetsMinimumViewport(window.innerWidth, window.innerHeight);
}
document.getElementById('logout-button')?.addEventListener('click', () => {
  void signOut().catch((error) => {
    if (status) status.textContent = error.message;
    alert(error.message);
  });
});
window.addEventListener('resize', updateViewportNotice, { passive: true });
updateViewportNotice();
async function start() {
  try {
    await accessFetch('/api/access/status');
    loadingScreen?.classList.remove('access-gate');
    loadingScreen?.classList.add('application-starting');
    if (status) status.textContent = 'Starting NorSaga …';
    await import('./main.js');
    maintainSession();
  } catch (error) {
    if (error.status === 401) location.replace('/login.html');
    else if (status)
      status.textContent =
        'Unable to start the app. Reload the page or contact your administrator.';
  }
}
void start();
