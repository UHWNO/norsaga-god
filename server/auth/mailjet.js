export function createMailjetSender(config, fetcher = fetch) {
  return async ({ email, token, name, kind }) => {
    const approval = kind === 'approval';
    // The fragment keeps the token out of proxy logs and link preview requests.
    const link = approval
      ? `${config.origin}/`
      : `${config.origin}/login.html#token=${encodeURIComponent(token)}`;
    const response = await fetcher('https://api.mailjet.com/v3.1/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${config.mailjetKey}:${config.mailjetSecret}`).toString('base64')}`,
      },
      body: JSON.stringify({
        Messages: [
          {
            From: {
              Email: config.mailFrom,
              Name: config.mailFromName || 'NorSaga God´s Eye Access',
            },
            To: [{ Email: email }],
            Subject: approval
              ? 'Your NorSaga God’s Eye Access Has Been Approved'
              : 'Your NorSaga God’s Eye Sign-In Link',
            TextPart: approval
              ? `Hello${name ? ` ${name}` : ''},\n\nYour access to NorSaga God’s Eye has been approved.\n\nYou can now sign in and access the app at:\n\n${link}\n\nEnter your approved email address (${email}) and request a sign-in link. We’ll send a single-use link to your inbox. Each sign-in link expires in 10 minutes. If you have already registered a passkey, you can sign in with it.\n\nNorSaga God’s Eye Access`
              : `Hello,\n\nYou requested access to NorSaga God’s Eye. Open the link below and click “Confirm Sign-In”:\n\n${link}\n\nThis link works once and expires in 10 minutes. Do not share it. If you did not request this sign-in, you can ignore this email.\n\nNorSaga God’s Eye`,
            TrackOpens: 'disabled',
            TrackClicks: 'disabled',
          },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.Messages?.[0]?.Status !== 'success') {
      // Provider errors can contain tokens or credentials. Never log their body.
      throw new Error(
        `Mailjet did not confirm acceptance (HTTP ${response.status})`,
      );
    }
    return { accepted: true };
  };
}
