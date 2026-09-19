// practice-web/scripts/lib/parse-dump.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDump } = require('./parse-dump');

test('parses a normal single-answer question', () => {
  const raw = `
Question  1
A company needs low-latency storage.
Which service should it use?
A. Amazon S3
B. Amazon EBS ✅
C. Amazon Glacier
D. AWS Snowball

Question  2
Placeholder for boundary.
A. x
B. y
C. z
D. w ✅
`;
  const { questions, malformed } = parseDump(raw, 'test-part');
  assert.equal(malformed.length, 0);
  assert.equal(questions.length, 2);
  assert.equal(questions[0].number, 1);
  assert.deepEqual(questions[0].correctAnswers, ['B']);
  assert.equal(questions[0].options.B, 'Amazon EBS');
  assert.equal(questions[0].question, 'A company needs low-latency storage.\nWhich service should it use?');
});

test('parses a multi-select ("Choose two") question', () => {
  const raw = `
Question  5
Which combination of solutions will resolve the errors? (Choose two.)
A. Change the target type. ✅
B. Do nothing.
C. Enable detailed monitoring. ✅
D. Delete the load balancer.
`;
  const { questions } = parseDump(raw, 'test-part');
  assert.equal(questions.length, 1);
  assert.deepEqual(questions[0].correctAnswers, ['A', 'C']);
});

test('recovers options that run together without a separating space', () => {
  // Real dump text runs options together like "...group.B. Use a target...".
  // Recoverable because each marker letter is preceded by a period (not a
  // letter) — contrast with the "unrecoverably lost" test below, where a
  // marker letter is glued directly onto the end of a word.
  const raw = `
Question  7
Which service should a solutions architect recommend?
A. Use a simple scaling policy to dynamically scale the group.B. Use a target tracking policy to dynamically scale the group. ✅C. Use an AWS Lambda function to update the group.D. Use CloudWatch alarms to notify an administrator manually
`;
  const { questions, malformed } = parseDump(raw, 'test-part');
  assert.equal(malformed.length, 0);
  assert.equal(questions.length, 1);
  assert.deepEqual(questions[0].correctAnswers, ['B']);
  assert.equal(questions[0].options.A, 'Use a simple scaling policy to dynamically scale the group.');
  assert.equal(questions[0].options.B, 'Use a target tracking policy to dynamically scale the group.');
  assert.equal(questions[0].options.C, 'Use an AWS Lambda function to update the group.');
  assert.equal(questions[0].options.D, 'Use CloudWatch alarms to notify an administrator manually');
});

test('drops a block where the option separator is unrecoverably lost', () => {
  const raw = `
Question  9
Some question text.
A. First optionB. Second optionC. ThirdD without a boundary at all ✅
`;
  const { questions, malformed } = parseDump(raw, 'test-part');
  assert.equal(questions.length, 0);
  assert.equal(malformed.length, 1);
  assert.equal(malformed[0].number, 9);
});

test('drops a block with no correct-answer marker', () => {
  const raw = `
Question  10
Some question text.
A. First
B. Second
C. Third
D. Fourth
`;
  const { questions, malformed } = parseDump(raw, 'test-part');
  assert.equal(questions.length, 0);
  assert.equal(malformed.length, 1);
  assert.equal(malformed[0].reason, 'empty-q-or-no-answer');
});

test('drops a block with 5 options (E marker in D text)', () => {
  // Real exam dumps sometimes have 5+ options. When a 5th option exists,
  // the current 4-option parser would silently absorb it into option D's
  // text, corrupting the data. This test verifies we detect and reject such
  // blocks instead.
  const raw = `
Question  2
Which combination of options is correct? (Choose two.)
A. First option
B. Migrate using DataSync. ✅
C. Manually copy files to EC2.
D. Manually use an operating system copy command to push the data to the EC2 instance.E. Use AWS DataSync to create a suitable location configuration for the on-premises SFTP server. ✅
`;
  const { questions, malformed } = parseDump(raw, 'test-part');
  assert.equal(questions.length, 0);
  assert.equal(malformed.length, 1);
  assert.equal(malformed[0].number, 2);
  assert.equal(malformed[0].reason, 'too-many-options');
});

test('correctly parses options with hyphenated names (VPC-A, VPC-B, etc.)', () => {
  // Real exam questions use service names like VPC-A and VPC-B. The old regex
  // `(?<![A-Za-z])` would match "VPC-B." as a marker because '-' is not a letter,
  // causing false positives. The fixed regex `(?<![A-Za-z0-9-])` excludes both
  // digits and hyphens. This test verifies no false matches occur.
  const raw = `
Question  16
Which solution allows communication between VPC-A and VPC-B with minimal administrative overhead?
A. Set up a VPC peering connection between VPC-A and VPC-B. ✅
B. Set up VPC gateway endpoints for the EC2 instance running in VPC-B.
C. Attach a virtual private gateway to VPC-B and set up routing from VPC-A.
D. Create a private virtual interface (VIF) for the EC2 instance running in VPC-B and add appropriate routes from VPC-A.
`;
  const { questions, malformed } = parseDump(raw, 'test-part');
  assert.equal(malformed.length, 0);
  assert.equal(questions.length, 1);
  assert.equal(questions[0].number, 16);
  assert.deepEqual(questions[0].correctAnswers, ['A']);
  // Verify all options are non-empty (the bug would cause B to be empty)
  assert.ok(questions[0].options.A.length > 0, 'option A should not be empty');
  assert.ok(questions[0].options.B.length > 0, 'option B should not be empty');
  assert.ok(questions[0].options.C.length > 0, 'option C should not be empty');
  assert.ok(questions[0].options.D.length > 0, 'option D should not be empty');
  // Verify exact text for A and B to detect the false match bug
  assert.equal(questions[0].options.A, 'Set up a VPC peering connection between VPC-A and VPC-B.');
  assert.equal(questions[0].options.B, 'Set up VPC gateway endpoints for the EC2 instance running in VPC-B.');
});
