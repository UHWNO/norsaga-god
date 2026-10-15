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
  user_deleted: 'User deleted',
  login_email_accepted: 'Mailjet accepted the login email',
  login_email_failed: 'Login email acceptance could not be confirmed',
  approval_email_accepted: 'Mailjet accepted the approval email',
  approval_email_failed: 'Approval email acceptance could not be confirmed',
};
function showApprovalResult(notification) {
  if (notification === 'failed') {
    status.textContent =
      'User approved, but approval email acceptance could not be confirmed. Check the email configuration and access audit log.';
    status.classList.add('error');
  } else {
    status.textContent =
      notification === 'accepted'
        ? 'User approved. Mailjet accepted the approval email.'
        : 'User is already approved. They can request a sign-in link.';
  }
}
const sessionLabels = {
  active: 'Active session',
  signed_out: 'Signed out',
  expired: 'Expired',
  revoked: 'Access revoked',
  ended: 'Session ended',
};
const formatTime = (value) => new Date(value).toLocaleString('en-US');
async function refreshAccessLog() {
  const { entries } = await accessFetch('/api/access/admin/access-log');
  const table = document.getElementById('access-log');
  table.replaceChildren();
  document.getElementById('access-log-empty').hidden = entries.length > 0;
  document.getElementById('access-log-timezone').textContent =
    `Times shown in ${Intl.DateTimeFormat().resolvedOptions().timeZone}.`;
  for (const entry of entries) {
    const row = document.createElement('tr');
    for (const value of [
      formatTime(entry.signedInAt),
      `${entry.name} (${entry.email})`,
      entry.method === 'passkey' ? 'Passkey' : 'Email link',
      formatTime(entry.lastSeenAt),
      sessionLabels[entry.status] || 'Session ended',
    ]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    if (entry.endedAt)
      row.lastChild.title = `Ended ${formatTime(entry.endedAt)}`;
    table.append(row);
  }
}
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
              const result = await accessFetch('/api/access/admin/users', {
                email: user.email,
                name: user.name,
                active: !user.active,
              });
              await refresh();
              if (!user.active) showApprovalResult(result.notification);
              else status.textContent = 'Access blocked.';
            }),
        );
        const deleteButton = document.createElement('button');
        deleteButton.textContent = 'Delete User';
        deleteButton.className = 'delete-user';
        deleteButton.addEventListener('click', () => {
          if (
            !window.confirm(
              `Delete ${user.email}? This removes their account, passkeys, active sessions, and unused sign-in links. They will need approval again to regain access. Security history is retained for up to 90 days.`,
            )
          )
            return;
          button.disabled = true;
          deleteButton.disabled = true;
          void action(async () => {
            try {
              await accessFetch('/api/access/admin/users/delete', {
                userId: user.id,
              });
              await refresh();
              status.textContent = 'User deleted.';
            } finally {
              button.disabled = false;
              deleteButton.disabled = false;
            }
          });
        });
        cell.classList.add('user-actions');
        cell.append(button, deleteButton);
      }
      row.append(cell);
      table.append(row);
    }
    await refreshAccessLog();
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
    const result = await accessFetch('/api/access/admin/users', {
      name: document.getElementById('user-name').value,
      email: document.getElementById('user-email').value,
      active: true,
    });
    event.target.reset();
    await refresh();
    showApprovalResult(result.notification);
  });
});
document.getElementById('refresh-access-log').addEventListener(
  'click',
  () =>
    void action(async () => {
      await refreshAccessLog();
      status.textContent = 'Access log refreshed.';
    }),
);
maintainSession();
void action(refresh);
