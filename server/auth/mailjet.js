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
            Subject: 'Din innloggingslenke til NorSaga God’s Eye',
            TextPart: `Hei!\n\nDu ba om å logge inn på NorSaga God’s Eye. Åpne lenken og trykk «Bekreft innlogging»:\n\n${link}\n\nLenken kan brukes én gang og utløper etter 10 minutter. Ikke del den med andre. Hvis du ikke ba om innlogging, kan du ignorere denne e-posten.\n\nNorSaga God’s Eye`,
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
