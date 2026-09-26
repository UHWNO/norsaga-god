import { isPasswordAccepted } from './passwordGateCore.js';

const loadingScreen = document.getElementById('loading-screen');
const form = document.getElementById('access-gate-form');
const passwordInput = document.getElementById('access-gate-password');
const status = document.getElementById('access-gate-status');
const submitButton = form?.querySelector('button[type="submit"]');

if (!loadingScreen || !form || !passwordInput || !status || !submitButton) {
  throw new Error('NorSaga access gate markup is incomplete');
}

function showRejectedState() {
  loadingScreen.classList.remove('access-gate-rejected');
  // Restart the short rejection animation even after consecutive attempts.
  void loadingScreen.offsetWidth;
  loadingScreen.classList.add('access-gate-rejected');
  passwordInput.value = '';
  passwordInput.setAttribute('aria-invalid', 'true');
  status.textContent = 'Incorrect password. Try again.';
  passwordInput.focus();
}

async function startApplication() {
  form.hidden = true;
  submitButton.disabled = true;
  passwordInput.disabled = true;
  passwordInput.removeAttribute('aria-invalid');
  loadingScreen.classList.remove('access-gate', 'access-gate-rejected');
  loadingScreen.classList.add('application-starting');
  status.textContent = 'Initializing maritime intelligence...';

  try {
    await import('./main.js');
  } catch (error) {
    console.error('Unable to load NorSaga:', error);
    loadingScreen.classList.add('access-gate');
    loadingScreen.classList.remove('application-starting');
    form.hidden = false;
    submitButton.disabled = false;
    passwordInput.disabled = false;
    status.textContent = 'Unable to start the application. Please try again.';
    passwordInput.focus();
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!isPasswordAccepted(passwordInput.value)) {
    showRejectedState();
    return;
  }
  void startApplication();
});

passwordInput.addEventListener('input', () => {
  passwordInput.removeAttribute('aria-invalid');
  loadingScreen.classList.remove('access-gate-rejected');
  status.textContent = 'Enter your password to continue';
});

passwordInput.focus();
