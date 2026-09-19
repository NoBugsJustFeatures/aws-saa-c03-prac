const test = require('node:test');
const assert = require('node:assert/strict');
const { classify } = require('./classify');

test('classifies an EC2/Auto Scaling question as compute', () => {
  const q = {
    question: 'An application runs on Amazon EC2 instances behind an Application Load Balancer with Auto Scaling.',
    options: {
      A: 'Use a simple scaling policy',
      B: 'Use a target tracking policy on the Auto Scaling group',
      C: 'Use AWS Lambda to poll CloudWatch',
      D: 'Use Amazon SQS to buffer requests',
    },
    correctAnswers: ['B'],
  };
  assert.equal(classify(q).primary, '01-compute-services');
});

test('classifies an S3/Storage Gateway question as storage', () => {
  const q = {
    question: 'A company needs low-latency access to data stored in Amazon S3 from an on-premises application.',
    options: {
      A: 'Configure an Amazon S3 File Gateway',
      B: 'Use AWS Lambda',
      C: 'Use Amazon RDS',
      D: 'Use Amazon SQS',
    },
    correctAnswers: ['A'],
  };
  assert.equal(classify(q).primary, '02-storage-services');
});

test('weights keywords found in the correct answer higher than distractors', () => {
  const q = {
    question: 'A company wants a fully managed relational database with automatic failover.',
    options: {
      A: 'Deploy Amazon RDS Multi-AZ for Aurora',
      B: 'Deploy on Amazon EC2 with a custom script and Amazon S3 backups behind an Application Load Balancer with EC2 Auto Scaling',
      C: 'Use AWS Lambda with DynamoDB',
      D: 'Use Amazon EC2 Spot Instances',
    },
    correctAnswers: ['A'],
  };
  // Option B mentions more compute keywords in raw count (EC2 x2, S3, ALB,
  // Auto Scaling), but the CORRECT option (A) is squarely database
  // (RDS, Multi-AZ, Aurora) — the 2x weighting on the correct answer's
  // text should still win it for database.
  assert.equal(classify(q).primary, '03-database-services');
});

test('falls back to other-services when no keywords match', () => {
  const q = {
    question: 'A company wants to reduce paperwork.',
    options: { A: 'Do a thing', B: 'Do another thing', C: 'Do a third thing', D: 'Do nothing' },
    correctAnswers: ['A'],
  };
  assert.equal(classify(q).primary, '13-other-services');
});

test('routes a question spanning 3+ categories to the comparison bucket', () => {
  // The single correct option name-drops one keyword from each of 3
  // categories (storage, compute, networking) with no other category
  // represented anywhere — all 3 land on an equal, non-zero top score.
  const q = {
    question: 'A solutions architect must choose a single option that touches storage, compute, and networking.',
    options: {
      A: 'Use Amazon S3 together with Amazon EC2 and an Amazon VPC',
      B: 'Do nothing at all',
      C: 'Deploy an on-premises server with no cloud services',
      D: 'Use a completely unrelated manual process',
    },
    correctAnswers: ['A'],
  };
  assert.equal(classify(q).primary, '14-so-sanh-services');
});
