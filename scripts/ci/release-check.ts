import {readFileSync} from 'node:fs';
import {releaseConfiguration} from '../../src/lib/release-readiness';
const checks=releaseConfiguration(process.env,true);
checks.push({key:'release-commit',ready:/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA??''),message:'An exact release commit SHA is required'});
// Staging smoke is a dependency; production smoke runs after deployment. Requiring
// production smoke before production exists would make the release gate circular.
const requiredEvidence=['independentSecurityReview','productionAuthAndMfa','smtpDelivery','offsiteBackupRestore','pitr','alertsAndOnCall','designPartnerApproval'];
let evidence:Record<string,{commit?:string;verifiedAt?:string;reference?:string}>={};
try{evidence=JSON.parse(readFileSync(process.env.RELEASE_EVIDENCE_FILE??'docs/release-evidence.json','utf8'));}catch{}
for(const key of requiredEvidence){const e=evidence[key];checks.push({key,ready:!!e?.reference&&e.commit===process.env.GITHUB_SHA&&!!e.verifiedAt&&Date.now()-new Date(e.verifiedAt).getTime()<7*86400000&&new Date(e.verifiedAt).getTime()<=Date.now()+300000,message:`Release evidence required for ${key} at the release commit`});}
console.log(JSON.stringify({launchReady:checks.every(c=>c.ready),checks},null,2));
if(checks.some(c=>!c.ready))process.exitCode=1;
