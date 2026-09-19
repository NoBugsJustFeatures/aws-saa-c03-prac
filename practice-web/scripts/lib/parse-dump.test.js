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

test('parses a 5-option question successfully', () => {
  // Real AWS exams often have 5-option "choose two" questions. The parser now
  // generalizes to handle variable option counts (4, 5, or 6). This test uses
  // the real PART-1 Question 10 example to verify 5-option questions parse
  // correctly with all options and correct answers recovered.
  const raw = `
Question  10
Which combination of services is needed for Systems Manager patching? (Choose two.)
A. Systems Manager Patch Manager ✅
B. Systems Manager Session Manager
C. Systems Manager Maintenance Windows ✅
D. AWS Lambda
E. Amazon CloudWatch
`;
  const { questions, malformed } = parseDump(raw, 'test-part');
  assert.equal(malformed.length, 0);
  assert.equal(questions.length, 1);
  assert.equal(questions[0].number, 10);
  // Verify all 5 options exist and are non-empty
  assert.ok(questions[0].options.A, 'option A should exist');
  assert.ok(questions[0].options.B, 'option B should exist');
  assert.ok(questions[0].options.C, 'option C should exist');
  assert.ok(questions[0].options.D, 'option D should exist');
  assert.ok(questions[0].options.E, 'option E should exist');
  // Verify correct answers (should be A and C, the two marked with ✅)
  assert.deepEqual(questions[0].correctAnswers.sort(), ['A', 'C']);
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

test('parses a genuine 4-option question without phantom E/F detection', () => {
  // Ensure the variable-length parser correctly stops at 4 options when only
  // A-D markers exist. This verifies no spurious E or F options are created.
  const raw = `
Question  8
Which AWS service provides serverless computing?
A. EC2
B. Lambda ✅
C. RDS
D. S3
`;
  const { questions, malformed } = parseDump(raw, 'test-part');
  assert.equal(malformed.length, 0);
  assert.equal(questions.length, 1);
  // Verify exactly 4 options exist (no phantom E/F)
  const optionKeys = Object.keys(questions[0].options).sort();
  assert.deepEqual(optionKeys, ['A', 'B', 'C', 'D']);
  assert.deepEqual(questions[0].correctAnswers, ['B']);
});

test('parses a 5-option multi-select question with proper spacing', () => {
  // Another 5-option "choose two" example with standard line-separated formatting.
  // Verifies the variable-length parser correctly handles multi-select with 5 options.
  const raw = `
Question  12
Which combination of services can be used for this architecture? (Choose two.)
A. Amazon EC2 with Elastic Load Balancing ✅
B. AWS Lambda with API Gateway
C. Amazon RDS for database
D. Amazon S3 for storage ✅
E. AWS DynamoDB for NoSQL
`;
  const { questions, malformed } = parseDump(raw, 'test-part');
  assert.equal(malformed.length, 0);
  assert.equal(questions.length, 1);
  assert.equal(questions[0].number, 12);
  // Verify exactly 5 options exist
  const optionKeys = Object.keys(questions[0].options).sort();
  assert.deepEqual(optionKeys, ['A', 'B', 'C', 'D', 'E']);
  // Verify 2 correct answers (A and D marked with ✅)
  assert.deepEqual(questions[0].correctAnswers.sort(), ['A', 'D']);
});

test('drops a block with embedded marker-shaped leftovers', () => {
  // Real data corruption: options from different source questions bled together
  // due to missing block separators, or a repeated correct option's text ended up
  // inside another option's text. These manifest as newline followed by letter-
  // period-space patterns embedded within an option's text. Example: option C
  // accidentally contains the start of option D's text from a different question.
  const raw = `
Question  5
Which S3 storage class minimizes cost for infrequent access?
A. S3 Standard
B. S3 Intelligent-Tiering ✅
C. S3 Standard-IA for infrequent data.
D. For video processing architecture.
Additional text about server configuration and scaling options.
D. Use an Auto Scaling group with Application Load Balancer ✅
`;
  const { questions, malformed } = parseDump(raw, 'test-part');
  assert.equal(questions.length, 0);
  assert.equal(malformed.length, 1);
  assert.equal(malformed[0].number, 5);
  assert.equal(malformed[0].reason, 'embedded-marker-leftover');
});

test('does not false-positive on normal text with capital letters and periods', () => {
  // Ensure the embedded-marker check requires a newline before the letter-period-space.
  // Normal option text legitimately contains "X. " patterns mid-sentence (like abbreviations
  // ending sentences). The check should only flag patterns with a preceding newline.
  // Example: "Use AWS Lambda. This is a different approach..." should not match.
  const raw = `
Question  11
Which service integrates with DynamoDB?
A. AWS Lambda. This service allows serverless execution. ✅
B. Amazon EC2 instance running Node.js for custom processing.
C. AWS Step Functions for workflow orchestration.
D. Amazon SQS for message queuing.
`;
  const { questions, malformed } = parseDump(raw, 'test-part');
  assert.equal(malformed.length, 0);
  assert.equal(questions.length, 1);
  assert.equal(questions[0].number, 11);
  assert.equal(questions[0].options.A, 'AWS Lambda. This service allows serverless execution.');
  assert.deepEqual(questions[0].correctAnswers, ['A']);
});
