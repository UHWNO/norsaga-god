import './access.css';
import { authClient, accessFetch, signOut } from './client.js';
import { maintainSession } from './session.js';

const status = document.getElementById('status');
async function action(callback) {
  status.classList.remove('error');
  status.textContent = 'Please wait …';
  try {
    await callback();
  } catch (error) {
    status.textContent = error.message;
    status.classList.add('error');
    if (error.status === 401) location.replace('/login.html');
  }
}
const labels = {
  login: 'Sign-in',
  owner_recovery: 'Administrator access recovered',
  admin_bootstrapped: 'Administrator created',
  user_approved: 'User approved',
  user_disabled: 'User blocked',
  login_email_accepted: 'Mailjet accepted the login email',
  login_email_failed: 'Sign-insmelding kunne ikke bekreftes',
};
async function refresh() {
  const current = await accessFetch('/api/access/status');
  document.getElementById('identity').textContent =
    `Signed in as ${current.email}`;
  document.getElementById('admin-help').hidden = current.role !== 'admin';
  document.getElementById('admin-section').hidden = !current.adminVerified;
  document.getElementById('add-passkey').disabled =
    current.role === 'admin' && current.passkeys > 0 && !current.adminVerified;
  const passkeys = await authClient.passkey.listUserPasskeys();
  const list = document.getElementById('passkey-list');
  list.replaceChildren();
  for (const key of passkeys.data || []) {
    const row = document.createElement('li');
    row.textContent = key.name || 'My passkey';
    const button = document.createElement('button');
    button.textContent = 'Remove';
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
              'Unable to remove the passkey. Verify your sign-in first.',
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
        user.active ? 'Approved' : 'Blocked',
      ]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      const cell = document.createElement('td');
      if (user.role === 'admin') cell.textContent = 'Administrator';
      else {
        const button = document.createElement('button');
        button.textContent = user.active ? 'Block Access' : 'Grant Access';
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
              status.textContent = 'Access updated.';
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
      item.textContent = `${new Date(event.time).toLocaleString('en-US')} – ${labels[event.event] || event.event}${event.target ? `: ${event.target}` : ''}`;
      eventList.append(item);
    }
  }
  status.textContent =
    current.role === 'admin' && !current.adminVerified
      ? 'Verify with a passkey to manage users.'
      : '';
}
document.getElementById('add-passkey').addEventListener(
  'click',
  () =>
    void action(async () => {
      const result = await authClient.passkey.addPasskey({
        name: 'My passkey',
      });
      if (result.error)
        throw new Error(
          'Unable to create a passkey. Use a supported browser and verify with your PIN or biometrics.',
        );
      await refresh();
      status.textContent =
        'Passkey created. You can now verify your sign-in with it.';
    }),
);
document.getElementById('verify-passkey').addEventListener(
  'click',
  () =>
    void action(async () => {
      const result = await authClient.signIn.passkey();
      if (result.error)
        throw new Error('Verification was not completed. Please try again.');
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
    status.textContent = 'User approved. They can now request a login link.';
  });
});
maintainSession();
void action(refresh);
