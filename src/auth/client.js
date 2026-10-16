import { createAuthClient } from 'better-auth/client';
import { passkeyClient } from '@better-auth/passkey/client';

export const authClient = createAuthClient({ plugins: [passkeyClient()] });
export async function accessFetch(path, body) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...(body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(data.error || 'Unable to complete the request.'),
      { status: response.status },
    );
  return data;
}
export async function signOut() {
  const result = await authClient.signOut();
  if (result.error)
    throw new Error('Unable to confirm sign-out. Please try again.');
  window.location.replace('/login.html');
}
