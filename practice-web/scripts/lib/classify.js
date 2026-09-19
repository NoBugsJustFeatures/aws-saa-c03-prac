const CATEGORIES = [
  {
    slug: '01-compute-services',
    keywords: ['ec2', 'amazon ec2', 'aws lambda', ' lambda', 'amazon ecs', ' ecs ', 'amazon eks', ' eks ',
      'fargate', 'elastic beanstalk', 'lightsail', 'aws batch', 'auto scaling', 'autoscaling',
      'application load balancer', ' alb', 'network load balancer', ' nlb', 'gateway load balancer',
      'placement group', 'spot instance', 'reserved instance', 'on-demand instance', 'dedicated host',
      'ec2 instance', 'amazon machine image', ' ami', 'outposts', 'wavelength', 'local zone', 'nitro',
      'ec2 image builder'],
  },
  {
    slug: '02-storage-services',
    keywords: ['amazon s3', ' s3 ', 's3 bucket', 'elastic block store', ' ebs', 'elastic file system',
      ' efs', 'amazon fsx', ' fsx', 'storage gateway', 'glacier', 'snowball', 'snowcone', 'snowmobile',
      's3 transfer acceleration', 'multipart upload', 'file gateway', 'volume gateway', 'tape gateway',
      's3 glacier', 'cross-region replication', 'storage class'],
  },
  {
    slug: '03-database-services',
    keywords: ['amazon rds', ' rds ', 'aurora', 'dynamodb', 'elasticache', 'redshift', 'documentdb',
      'neptune', 'amazon keyspaces', 'qldb', 'quantum ledger', 'timestream', 'memorydb', 'rds proxy',
      'read replica', 'multi-az'],
  },
  {
    slug: '04-networking-services',
    keywords: ['amazon vpc', ' vpc ', 'subnet', 'route table', 'internet gateway', 'nat gateway',
      'route 53', 'cloudfront', 'direct connect', 'site-to-site vpn', 'transit gateway', 'privatelink',
      'vpc peering', 'global accelerator', 'elastic ip', 'network acl', 'vpc endpoint'],
  },
  {
    slug: '05-security-services',
    keywords: [' iam ', 'identity and access management', 'aws kms', 'key management service',
      'secrets manager', 'guardduty', ' waf', 'web application firewall', 'aws shield', 'cognito',
      'macie', 'security hub', 'amazon inspector', 'certificate manager', ' acm', 'directory service',
      'service control polic', 'iam identity center', 'security group', ' sts ', 'assume role'],
  },
  {
    slug: '06-management-governance',
    keywords: ['cloudwatch', 'cloudtrail', 'aws config', 'systems manager', 'aws organizations',
      'control tower', 'trusted advisor', 'service catalog', 'license manager', 'compute optimizer',
      'cost explorer', 'aws budgets', 'well-architected'],
  },
  {
    slug: '07-application-integration',
    keywords: ['amazon sqs', ' sqs ', 'simple queue service', 'amazon sns', ' sns ',
      'simple notification service', 'eventbridge', 'step functions', 'amazon mq', 'appflow',
      'simple workflow service'],
  },
  {
    slug: '08-developer-tools',
    keywords: ['codecommit', 'codebuild', 'codedeploy', 'codepipeline', 'cloudformation', 'aws cdk',
      'x-ray', 'cloud9', 'codeartifact', 'codestar', 'sam template', 'serverless application model'],
  },
  {
    slug: '09-analytics-bigdata',
    keywords: ['kinesis', 'amazon athena', 'aws glue', 'amazon emr', 'quicksight', 'lake formation',
      'opensearch', 'elasticsearch service', 'data pipeline', 'amazon msk',
      'managed streaming for kafka'],
  },
  {
    slug: '10-migration-transfer',
    keywords: ['database migration service', ' dms ', 'datasync', 'migration hub',
      'application discovery service', 'server migration service', 'transfer family', 'sftp',
      'snowball', 'snowcone', 'snowmobile'],
  },
  {
    slug: '11-api-integration',
    keywords: ['api gateway', 'appsync', 'graphql', 'rest api', 'websocket api'],
  },
  {
    slug: '12-ml-ai',
    keywords: ['sagemaker', 'rekognition', 'comprehend', 'amazon lex', 'amazon polly',
      'amazon translate', 'amazon forecast', 'textract', 'personalize', 'amazon kendra', 'transcribe'],
  },
];

function normalizeText(s) {
  return ` ${String(s).toLowerCase()} `;
}

function countKeywordHits(text, keywords) {
  let hits = 0;
  for (const kw of keywords) {
    if (text.includes(kw)) hits += 1;
  }
  return hits;
}

function scoreCategories(question) {
  const fullText = normalizeText([question.question, ...Object.values(question.options)].join(' '));
  const correctText = normalizeText(
    question.correctAnswers.map((letter) => question.options[letter] || '').join(' ')
  );

  const scores = {};
  for (const cat of CATEGORIES) {
    const baseHits = countKeywordHits(fullText, cat.keywords);
    const correctHits = countKeywordHits(correctText, cat.keywords);
    scores[cat.slug] = baseHits + correctHits;
  }
  return scores;
}

function classify(question) {
  const scores = scoreCategories(question);
  const entries = Object.entries(scores);
  const maxScore = Math.max(...entries.map(([, s]) => s));

  if (maxScore === 0) {
    return { primary: '13-other-services', scores };
  }

  const topCategories = entries.filter(([, s]) => s >= maxScore * 0.8 && s > 0);
  if (topCategories.length >= 3) {
    return { primary: '14-so-sanh-services', scores };
  }

  for (const cat of CATEGORIES) {
    if (scores[cat.slug] === maxScore) {
      return { primary: cat.slug, scores };
    }
  }
  return { primary: '13-other-services', scores };
}

module.exports = { CATEGORIES, scoreCategories, classify };
