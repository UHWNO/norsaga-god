import './access.css';
import { authClient, accessFetch } from './client.js';

const form = document.getElementById('login-form');
const status = document.getElementById('status');
const confirm = document.getElementById('confirm-login');
const passkey = document.getElementById('passkey-login');
let token;
// The token remains in memory, never storage, query strings or analytics.
function readToken() {
  const nextToken = new URLSearchParams(location.hash.slice(1)).get('token');
  if (nextToken) {
    token = nextToken;
    history.replaceState(null, '', '/login.html');
    form.hidden = true;
    document.querySelector('h1').textContent = 'Bekreft innlogging';
    document.getElementById('login-intro').textContent =
      'Du har åpnet en personlig innloggingslenke til NorSaga God’s Eye.';
    status.textContent = 'Bekreft bare hvis du selv ba om å logge inn.';
    document.getElementById('confirm-section').hidden = false;
  }
}
readToken();
window.addEventListener('hashchange', readToken);
async function run(button, action) {
  button.disabled = true;
  status.classList.remove('error');
  status.textContent = 'Vennligst vent …';
  try {
    await action();
  } catch (error) {
    status.textContent = error.message;
    status.classList.add('error');
  } finally {
    button.disabled = false;
  }
}
form.addEventListener('submit', (event) => {
  event.preventDefault();
  void run(form.querySelector('button'), async () => {
    const data = await accessFetch('/api/auth/sign-in/magic-link', {
      email: document.getElementById('email').value,
    });
    status.textContent = data.message;
  });
});
confirm.addEventListener(
  'click',
  () =>
    void run(confirm, async () => {
      await accessFetch('/api/access/redeem', { token });
      window.location.replace('/account.html');
    }),
);
passkey.addEventListener(
  'click',
  () =>
    void run(passkey, async () => {
      const result = await authClient.signIn.passkey();
      if (result.error)
        throw new Error(
          'Passkey-innloggingen ble ikke fullført. Prøv igjen, eller bruk e-postlenken.',
        );
      window.location.replace('/account.html');
    }),
);
