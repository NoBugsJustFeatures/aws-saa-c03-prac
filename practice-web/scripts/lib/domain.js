// Rule-based mapping of a question to one of the four SAA-C03 exam domains:
//   secure       Design Secure Architectures                (30%)
//   resilient    Design Resilient Architectures             (26%)
//   performance  Design High-Performing Architectures       (24%)
//   cost         Design Cost-Optimized Architectures        (20%)
const RULES = {
  secure: [
    /\biam\b/, /\bkms\b/, /encrypt/, /security group/, /network acl|\bnacl\b/, /\bwaf\b/, /\bshield\b/,
    /guardduty/, /macie/, /inspector/, /secrets manager/, /cognito/, /service control polic|\bscp\b/,
    /least privilege/, /\bacm\b|certificate/, /cloudtrail/, /compliance/, /\bmfa\b/, /bucket policy/,
    /federat|\bsaml\b|identity provider|\bsso\b|iam identity center/, /firewall/, /audit/, /\bcmk\b|cmk/,
    /\bpermission/, /access control/, /private ?link|vpc endpoint/, /\bsecurity\b/, /\brole\b/, /\bpolicy\b/,
    /\bssl\b|\btls\b/, /\bhsm\b/, /parameter store/, /restrict access|block public|public access/,
  ],
  resilient: [
    /multi-az|multiple availability zones|availability zone/, /high(ly)? available|high availability/,
    /fault.toleran/, /disaster recovery|\bdr\b/, /fail ?over/, /auto scaling/, /load balanc/, /\bsqs\b|queue/,
    /\bsns\b/, /decoupl|loosely coupled/, /backup/, /replicat/, /\brto\b|\brpo\b/, /cross-region/,
    /eventbridge/, /step functions/, /durab/, /snapshot/, /resilien/, /single point of failure/,
    /without (any )?(data loss|downtime)|minimal downtime|zero downtime/, /recover/, /\bdms\b|migrat/,
  ],
  performance: [
    /latency/, /throughput/, /\biops\b/, /cloudfront/, /elasticache/, /\bdax\b/, /caching|\bcache\b/,
    /global accelerator/, /read replica/, /kinesis/, /athena/, /redshift/, /\bemr\b/, /\bglue\b/,
    /transit gateway/, /direct connect/, /performance/, /\befs\b|\bfsx\b/, /placement group/, /high.performance/,
    /real.time|near real/, /\bstream/, /analytic/, /query/, /scal(e|ing|able)/, /transfer acceleration/,
    /data lake/, /bandwidth/, /ebs.*(io1|io2|gp3)|provisioned iops/, /\bhpc\b/,
  ],
  cost: [
    /cost/, /cheap/, /\bspot\b/, /reserved instance|savings plan/, /glacier/, /lifecycle/, /intelligent.tiering/,
    /\bbudget/, /cost explorer/, /pay.per|pay.as.you.go/, /graviton/, /infrequent(ly)? access/, /archiv/,
    /expens/, /minimi[sz]e (the )?(cost|spend)/, /on.demand/, /storage class/, /right.?siz/, /idle/,
  ],
};
const STRONG_COST = /(most|more|least) cost.effective|lowest cost|minimi[sz]e (the )?cost|cheapest|reduce (the )?cost|cost.optimi/;

function classifyDomain(q) {
  const qt = q.question.toLowerCase();
  const correct = q.correctAnswers.map((l) => (q.options[l] || '').toLowerCase()).join(' ');
  const score = { secure: 0, resilient: 0, performance: 0, cost: 0 };
  for (const [dom, res] of Object.entries(RULES)) {
    for (const re of res) {
      if (re.test(qt)) score[dom] += 1;
      if (re.test(correct)) score[dom] += 1.5; // the answer says more than the scenario
    }
  }
  if (STRONG_COST.test(qt)) score.cost += 4;
  const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
  return ranked[0][1] === 0 ? 'resilient' : ranked[0][0];
}

module.exports = { classifyDomain };
