import './access.css';
import { authClient, accessFetch, signOut } from './client.js';
import { maintainSession } from './session.js';

const status = document.getElementById('status');
async function action(callback) {
  status.classList.remove('error');
  status.textContent = 'Vennligst vent …';
  try {
    await callback();
  } catch (error) {
    status.textContent = error.message;
    status.classList.add('error');
    if (error.status === 401) location.replace('/login.html');
  }
}
const labels = {
  login: 'Innlogging',
  admin_bootstrapped: 'Administrator opprettet',
  user_approved: 'Bruker godkjent',
  user_disabled: 'Bruker sperret',
  login_email_accepted: 'Mailjet godtok innloggingsmelding',
  login_email_failed: 'Innloggingsmelding kunne ikke bekreftes',
};
async function refresh() {
  const current = await accessFetch('/api/access/status');
  document.getElementById('identity').textContent =
    `Innlogget som ${current.email}`;
  document.getElementById('admin-help').hidden = current.role !== 'admin';
  document.getElementById('admin-section').hidden = !current.adminVerified;
  document.getElementById('add-passkey').disabled =
    current.role === 'admin' && current.passkeys > 0 && !current.adminVerified;
  const passkeys = await authClient.passkey.listUserPasskeys();
  const list = document.getElementById('passkey-list');
  list.replaceChildren();
  for (const key of passkeys.data || []) {
    const row = document.createElement('li');
    row.textContent = key.name || 'Min passkey';
    const button = document.createElement('button');
    button.textContent = 'Fjern';
    button.disabled =
      current.role === 'admin' &&
      (!current.adminVerified || current.passkeys <= 1);
    button.addEventListener(
      'click',
      () =>
        void action(async () => {
          const result = await authClient.passkey.deletePasskey({ id: key.id });
          if (result.error)
            throw new Error(
              'Passkeyen kunne ikke fjernes. Bekreft innloggingen først.',
            );
          await refresh();
        }),
    );
    row.append(button);
    list.append(row);
  }
  if (current.adminVerified) {
    const { users } = await accessFetch('/api/access/admin/users');
    const table = document.getElementById('users');
    table.replaceChildren();
    for (const user of users) {
      const row = document.createElement('tr');
      for (const value of [
        user.name,
        user.email,
        user.active ? 'Godkjent' : 'Sperret',
      ]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      const cell = document.createElement('td');
      if (user.role === 'admin') cell.textContent = 'Administrator';
      else {
        const button = document.createElement('button');
        button.textContent = user.active ? 'Sperr tilgang' : 'Gi tilgang';
        button.addEventListener(
          'click',
          () =>
            void action(async () => {
              await accessFetch('/api/access/admin/users', {
                email: user.email,
                name: user.name,
                active: !user.active,
              });
              await refresh();
              status.textContent = 'Tilgangen er oppdatert.';
            }),
        );
        cell.append(button);
      }
      row.append(cell);
      table.append(row);
    }
    const { events } = await accessFetch('/api/access/admin/events');
    const eventList = document.getElementById('audit-list');
    eventList.replaceChildren();
    for (const event of events) {
      const item = document.createElement('li');
      item.textContent = `${new Date(event.time).toLocaleString('nb-NO')} – ${labels[event.event] || event.event}${event.target ? `: ${event.target}` : ''}`;
      eventList.append(item);
    }
  }
  status.textContent =
    current.role === 'admin' && !current.adminVerified
      ? 'Bekreft med passkey for å administrere brukere.'
      : '';
}
document.getElementById('add-passkey').addEventListener(
  'click',
  () =>
    void action(async () => {
      const result = await authClient.passkey.addPasskey({
        name: 'Min passkey',
      });
      if (result.error)
        throw new Error(
          'Passkeyen kunne ikke opprettes. Bruk en støttet nettleser og bekreft med PIN eller biometri.',
        );
      await refresh();
      status.textContent =
        'Passkey opprettet. Du kan nå bekrefte innloggingen med den.';
    }),
);
document.getElementById('verify-passkey').addEventListener(
  'click',
  () =>
    void action(async () => {
      const result = await authClient.signIn.passkey();
      if (result.error)
        throw new Error('Bekreftelsen ble ikke fullført. Prøv igjen.');
      await refresh();
    }),
);
document
  .getElementById('sign-out')
  .addEventListener('click', () => void action(signOut));
document.getElementById('user-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void action(async () => {
    await accessFetch('/api/access/admin/users', {
      name: document.getElementById('user-name').value,
      email: document.getElementById('user-email').value,
      active: true,
    });
    event.target.reset();
    await refresh();
    status.textContent =
      'Brukeren er godkjent. Vedkommende kan nå be om en innloggingslenke.';
  });
});
maintainSession();
void action(refresh);
