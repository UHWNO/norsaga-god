// CommonJS entry point for Plesk's Passenger loader.
import('./server/standalone/production.js').catch((error) => {
  console.error('NorSaga startup failed:', error);
  process.exitCode = 1;
});
