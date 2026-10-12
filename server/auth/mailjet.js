export function createMailjetSender(config, fetcher = fetch) {
  return async ({ email, token }) => {
    // The fragment keeps the token out of proxy logs and link preview requests.
    const link = `${config.origin}/login.html#token=${encodeURIComponent(token)}`;
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
            Subject: 'Your NorSaga God’s Eye Sign-In Link',
            TextPart: `Hello,\n\nYou requested access to NorSaga God’s Eye. Open the link below and click “Confirm Sign-In”:\n\n${link}\n\nThis link works once and expires in 10 minutes. Do not share it. If you did not request this sign-in, you can ignore this email.\n\nNorSaga God’s Eye`,
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
