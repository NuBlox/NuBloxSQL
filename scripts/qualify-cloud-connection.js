'use strict';

// Run only against an explicitly configured trusted managed-cloud endpoint.
// This CLI logs structured, credential-free evidence (or a sanitized code).
const qualification = require('./CloudConnectionQualification');

qualification.run(process.env).then(function (evidence) {
  process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');
}, function (error) {
  var code = error && typeof error.code === 'string' &&
    /^[A-Z][A-Z0-9_]*$/.test(error.code) ? error.code : 'UNEXPECTED_FAILURE';
  process.stderr.write('NuBloxSQL cloud qualification failed: ' + code + '\n');
  process.exitCode = 1;
});
