import assert from 'node:assert/strict';
import { isPasswordAccepted, NORSAGA_ACCESS_PASSWORD } from './passwordGateCore.js';

assert.equal(isPasswordAccepted(NORSAGA_ACCESS_PASSWORD), true);
assert.equal(isPasswordAccepted('NORSAGA'), false);
assert.equal(isPasswordAccepted(` ${NORSAGA_ACCESS_PASSWORD} `), false);
assert.equal(isPasswordAccepted(''), false);
