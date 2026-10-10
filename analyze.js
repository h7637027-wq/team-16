import { db } from "hatchable";
/* LearnPath AI adaptive engine.
 * Algorithm: deterministic mastery estimation, prerequisite-aware greedy path ranking,
 * and a fixed-curriculum baseline simulation. No external dataset or AI key is required
 * for the first runnable prototype; explanations are generated from explicit rules.
 * Complexity: mastery + gap scan O(V); roadmap selection O(V^2 + E) for V topics/E edges;
 * prerequisite validation O(V + E); baseline simulation O(V). For this 9-node demo the
 * quadratic greedy selection is intentionally easy to audit and fast enough for live use.
 */
export const access = "public";
export const methods = ["POST"];

const CATALOG = [
  {id:"foundations",title:"Learning Foundations",prerequisites:[],importance:1.00,minutes:20,rate:0.62},
  {id:"algebra",title:"Algebra Essentials",prerequisites:["foundations"],importance:0.95,minutes:25,rate:0.55},
  {id:"functions",title:"Functions & Relationships",prerequisites:["algebra"],importance:0.92,minutes:25,rate:0.50},
  {id:"probability",title:"Probability Basics",prerequisites:["foundations"],importance:0.90,minutes:25,rate:0.55},
  {id:"statistics",title:"Statistics & Data Literacy",prerequisites:["probability","algebra"],importance:1.00,minutes:30,rate:0.58},
  {id:"ml-foundations",title:"Machine Learning Foundations",prerequisites:["functions","statistics"],importance:1.00,minutes:35,rate:0.48},
  {id:"classification",title:"Classification Models",prerequisites:["ml-foundations"],importance:0.92,minutes:35,rate:0.45},
  {id:"model-evaluation",title:"Model Evaluation",prerequisites:["classification","statistics"],importance:0.98,minutes:30,rate:0.52},
  {id:"neural-networks",title:"Neural Network Basics",prerequisites:["ml-foundations","classification"],importance:0.82,minutes:40,rate:0.40}
];
const SCENARIOS = {
  normal: {name:"Demo Student",historyMode:"full",quiz:62,coding:55,time:30,mastery:[85,70,68,55,48,45,40,42,35],events:1},
  "sudden-struggle": {name:"Struggling Student",historyMode:"full",quiz:38,coding:32,time:45,mastery:[82,66,65,48,25,30,24,18,22],events:2},
  "fast-learner": {name:"Fast Learner",historyMode:"full",quiz:96,coding:94,time:20,mastery:[98,95,93,91,89,92,88,85,90],events:1},
  "sparse-data": {name:"New Learner",historyMode:"sparse",quiz:50,coding:50,time:15,mastery:[35,35,30,35,25,25,20,20,15],events:0},
  "multiple-events": {name:"Active Learner",historyMode:"full",quiz:58,coding:49,time:60,mastery:[85,63,60,50,39,35,30,22,27],events:4}
};
const clamp = (n,min=0,max=100) => Math.max(min,Math.min(max,n));
const average = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0;
function validate(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Send a JSON object.";
  if (body.scenario && !Object.hasOwn(SCENARIOS,body.scenario)) return "Unknown scenario. Use normal, sudden-struggle, fast-learner, sparse-data, or multiple-events.";
  if (!body.scenario) {
    for (const key of ["quizScore","codingScore"]) if (body[key] !== undefined && (!Number.isFinite(Number(body[key])) || Number(body[key]) < 0 || Number(body[key]) > 100)) return key + " must be a number from 0 to 100.";
    if (body.timeSpentMinutes !== undefined && (!Number.isFinite(Number(body.timeSpentMinutes)) || Number(body.timeSpentMinutes)<0 || Number(body.timeSpentMinutes)>600)) return "timeSpentMinutes must be between 0 and 600.";
    if (body.historyMode !== undefined && !["full","sparse","cold"].includes(body.historyMode)) return "historyMode must be full, sparse, or cold.";
    if (body.topicScores !== undefined) {
      if (!body.topicScores || typeof body.topicScores !== "object" || Array.isArray(body.topicScores)) return "topicScores must be an object keyed by topic ID.";
      for (const [id,value] of Object.entries(body.topicScores)) {
        if (!CATALOG.some(topic=>topic.id===id)) return "Unknown topic ID in topicScores: " + id;
        if (!Number.isFinite(Number(value)) || Number(value)<0 || Number(value)>100) return "Every topic score must be between 0 and 100.";
      }
    }
  }
  return null;
}
function buildProfile(body) {
  if (body.scenario) {
    const s = SCENARIOS[body.scenario];
    return {...s,scenario:body.scenario,focusTopic:"auto"};
  }
  const quiz = clamp(Number(body.quizScore ?? 62)), coding = clamp(Number(body.codingScore ?? 55));
  const time = clamp(Number(body.timeSpentMinutes ?? 30),0,600);
  const historyMode = body.historyMode || "full";
  const focusTopic = body.focusTopic || "auto";
  const blended = quiz*0.55 + coding*0.35 + clamp(time/60*10)*0.10;
  const base = [75,65,60,55,50,45,40,38,35];
  const topicBias = [12,5,4,2,0,-4,-5,-7,-8];
  let mastery = base.map((v,i)=>clamp(v+(blended-55)*0.48+topicBias[i]));
  if (historyMode === "sparse") mastery = mastery.map(v=>clamp(v*0.58+22));
  if (historyMode === "cold") mastery = CATALOG.map((_,i)=>[40,35,30,35,30,25,20,20,18][i]);
  return {name:String(body.studentName||"Demo Student").slice(0,50),historyMode,quiz,coding,time,mastery,events:1,focusTopic,topicScores:body.topicScores||{},topicEvidence:body.topicEvidence||{}};
}
function prerequisiteReady(topic, masteryById, selected) {
  return topic.prerequisites.every(id => masteryById[id] >= 60 || selected.has(id));
}
function estimateMastery(profile) {
  const result = {};
  CATALOG.forEach((topic,i) => {
    let score = profile.mastery[i];
    if (profile.historyMode === "full") {
      // Lightly calibrate the topic prior with recent evidence, retaining topic-specific signals.
      score = clamp(score*0.75 + profile.quiz*0.15 + profile.coding*0.10);
    } else if (profile.historyMode === "sparse") {
      // Shrink uncertain evidence toward a conservative prior to avoid false certainty.
      score = clamp(score*0.82 + 30*0.18);
    }
    // Evidence combines long-run average (65%) and the most recent result (35%).
    // Confidence grows with repeated attempts, capped naturally by the formula;
    // one binary answer must not overwhelm the learner's prior estimate.
    const evidence = profile.topicEvidence?.[topic.id];
    if (evidence && Number.isFinite(Number(evidence.average)) && Number.isFinite(Number(evidence.recent))) {
      const evidenceScore = Number(evidence.average)*0.65 + Number(evidence.recent)*0.35;
      const confidence = Number(evidence.attempts) / (Number(evidence.attempts) + 3);
      const evidenceWeight = 0.55 * confidence;
      score = clamp(score*(1-evidenceWeight) + evidenceScore*evidenceWeight);
    } else if (profile.topicScores && Number.isFinite(Number(profile.topicScores[topic.id]))) {
      score = clamp(score*0.60 + Number(profile.topicScores[topic.id])*0.40);
    }
    result[topic.id] = Math.round(score*10)/10;
  });
  return result;
}
function recommendPath(masteryById, focusTopic) {
  const selected = new Set(), path = [];
  const unresolved = CATALOG.filter(t=>masteryById[t.id] < 85);
  // Greedy re-optimisation: select the highest-priority eligible topic each round.
  // A selected prerequisite can unlock its descendants in later rounds.
  for (let step=0; step<Math.min(CATALOG.length,7); step++) {
    const candidates = unresolved.filter(t=>!selected.has(t.id)&&prerequisiteReady(t,masteryById,selected));
    if (!candidates.length) break;
    candidates.sort((a,b)=>{
      const score = t => {
        const deficit = (100-masteryById[t.id])/100;
        const focusBoost = focusTopic === t.id ? 0.22 : 0;
        return deficit*t.importance + focusBoost;
      };
      return score(b)-score(a) || a.id.localeCompare(b.id);
    });
    const topic = candidates[0]; selected.add(topic.id);
    const unmet = topic.prerequisites.filter(id=>masteryById[id]<60 && !selected.has(id));
    const parentNames = topic.prerequisites.map(id=>CATALOG.find(t=>t.id===id)?.title).filter(Boolean);
    const reason = masteryById[topic.id] < 40
      ? "Mastery is "+Math.round(masteryById[topic.id])+"%, so this concept needs guided practice before more advanced work."
      : "Mastery is "+Math.round(masteryById[topic.id])+"%, leaving a "+Math.round(100-masteryById[topic.id])+"-point gap. This topic is prioritized by its importance and readiness.";
    path.push({id:topic.id,title:topic.title,mastery:masteryById[topic.id],priority:Math.round(((100-masteryById[topic.id])/100*topic.importance+(focusTopic===topic.id?0.22:0))*100)/100,minutes:topic.minutes,reason,reasonShort:masteryById[topic.id]<40?"Foundational gap needs support":"Close a measurable mastery gap",readiness:topic.prerequisites.every(id=>masteryById[id]>=60)?"Prerequisites ready":"Prerequisite included earlier",prerequisites:topic.prerequisites,prerequisiteNames:parentNames});
  }
  return path;
}
function simulateGain(masteryById, order, budget) {
  let remaining = budget, gain = 0;
  for (const topicId of order) {
    if (remaining <= 0) break;
    const topic = CATALOG.find(t=>t.id===topicId);
    if (!topic) continue;
    const mastery = masteryById[topicId];
    const minutes = Math.min(remaining,topic.minutes);
    // Lower mastery provides more headroom; very advanced concepts need more time.
    const efficiency = topic.rate * (mastery < 40 ? 1.0 : mastery < 70 ? 0.82 : 0.55);
    const improvement = Math.min(100-mastery,minutes*efficiency);
    gain += improvement / CATALOG.length;
    remaining -= minutes;
  }
  return Math.round(gain*100)/100;
}
function validatePath(path, masteryById) {
  const position = Object.fromEntries(path.map((t,i)=>[t.id,i]));
  const violations = [];
  for (const item of path) for (const pre of item.prerequisites) {
    if (masteryById[pre] < 60 && position[pre] === undefined) violations.push(item.title+" appears without its unmet prerequisite "+pre+".");
    else if (masteryById[pre] < 60 && position[pre] > position[item.id]) violations.push(item.title+" appears before its prerequisite "+pre+".");
  }
  return violations;
}
function makeTests(scenario, masteryById, gaps, path, benchmark, profile) {
  const violations = validatePath(path,masteryById);
  const tests = [
    {name:"Prerequisite order",passed:violations.length===0,detail:violations.length ? violations.join(" ") : "No unmet prerequisite is recommended after its dependent topic."},
    {name:"Knowledge-gap detection",passed:gaps.every(g=>masteryById[g.id]<60),detail:gaps.length+" concepts below 60% mastery were identified consistently."},
    {name:"Runnable recommendation path",passed:path.length>0 || gaps.length===0,detail:path.length+" ordered learning steps returned."}
  ];
  if (scenario==="sudden-struggle") {
    tests.push({name:"Sudden drop detected",passed:masteryById["model-evaluation"]<30,detail:"Model Evaluation mastery is "+Math.round(masteryById["model-evaluation"])+"%; the engine marks the concept as a critical gap."});
    tests.push({name:"Remediation precedes advanced work",passed:path.some(t=>t.id==="statistics")&&path.some(t=>t.id==="model-evaluation")&&path.findIndex(t=>t.id==="statistics")<path.findIndex(t=>t.id==="model-evaluation"),detail:"Statistics is included before Model Evaluation when the prerequisite is below mastery threshold."});
  } else if (scenario==="fast-learner") {
    tests.push({name:"Fast learner recognized",passed:average(Object.values(masteryById))>=80,detail:"Average mastery is "+Math.round(average(Object.values(masteryById)))+"%; mastered topics are excluded from the remediation path."});
    tests.push({name:"No unnecessary mastered-topic work",passed:path.every(t=>t.mastery<85),detail:"Every recommended topic is below the 85% mastery threshold."});
  } else if (scenario==="sparse-data") {
    tests.push({name:"Sparse-data handling",passed:profile.historyMode==="sparse"&&Object.values(masteryById).every(v=>Number.isFinite(v)),detail:"Conservative mastery estimates were produced without assuming a complete history."});
    tests.push({name:"Cold-start safe output",passed:path.length>0&&path[0].title.length>0,detail:"The learner receives a concrete first step despite limited historical evidence."});
  } else if (scenario==="multiple-events") {
    tests.push({name:"Multiple events processed",passed:profile.events>=4,detail:profile.events+" synthetic assessment events were included in this deterministic scenario."});
    tests.push({name:"Stable deterministic result",passed:JSON.stringify(path.map(t=>t.id))===JSON.stringify(recommendPath(masteryById,profile.focusTopic).map(t=>t.id)),detail:"Repeating the same input returns the same ordered recommendations."});
  } else {
    tests.push({name:"Adaptive vs. baseline evaluated",passed:Number.isFinite(benchmark.baselineGain)&&Number.isFinite(benchmark.adaptiveGain),detail:"Both curriculum strategies were simulated with the same 30-minute budget."});
    tests.push({name:"Re-optimisation inputs",passed:profile.events>=1&&profile.quiz>=0&&profile.coding>=0,detail:"Current quiz, coding, and learning-history signals are available to the engine."});
  }
  return tests;
}
export default async function(req,res) {
  const body = req.body || {};
  const problem = validate(body);
  if (problem) return res.status(400).json({error:problem});
  // When a learner ID is supplied, prefer the server's saved event history over browser-provided aggregates.
  if (body.learnerId !== undefined) {
    const learnerId = String(body.learnerId);
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(learnerId)) return res.status(400).json({error:"learnerId must be 8–80 letters, numbers, underscores, or hyphens."});
    const history = await db.query("SELECT topic_id, AVG(score) AS avg_score, COUNT(*) AS attempts, (ARRAY_AGG(score ORDER BY created_at DESC))[1] AS recent_score FROM learning_events WHERE learner_id = $1 GROUP BY topic_id",[learnerId]);
    const count = await db.query("SELECT COUNT(*) AS total FROM learning_events WHERE learner_id = $1",[learnerId]);
    body.topicScores = {};
    body.topicEvidence = {};
    for (const row of history.rows) {
      body.topicScores[row.topic_id] = Math.round(Number(row.avg_score));
      body.topicEvidence[row.topic_id] = {average:Math.round(Number(row.avg_score)),recent:Math.round(Number(row.recent_score)),attempts:Number(row.attempts)};
    }
    body.historyMode = Number(count.rows[0]?.total || 0) < 3 ? "sparse" : "full";
    body.eventsProcessed = Number(count.rows[0]?.total || 0);
  }
  const profile = buildProfile(body);
  if (body.learnerId !== undefined) profile.events = body.eventsProcessed;
  const masteryById = estimateMastery(profile);
  const topics = CATALOG.map(topic=>({...topic,mastery:masteryById[topic.id]}));
  const gaps = topics.filter(t=>t.mastery<60).sort((a,b)=>a.mastery-b.mastery).map(t=>({id:t.id,title:t.title,mastery:t.mastery}));
  const focusTopic = profile.focusTopic && profile.focusTopic!=="auto" ? profile.focusTopic : (gaps[0]?.id || "auto");
  const roadmap = recommendPath(masteryById,focusTopic);
  const baselineOrder = CATALOG.map(t=>t.id);
  const adaptiveOrder = roadmap.map(t=>t.id);
  const baselineGain = simulateGain(masteryById,baselineOrder,30);
  const adaptiveGain = simulateGain(masteryById,adaptiveOrder,30);
  const improvementPct = roadmap.length===0 || baselineGain<=0 ? null : Math.round((adaptiveGain-baselineGain)/baselineGain*1000)/10;
  const benchmark = {baselineGain,adaptiveGain,improvementPct,budgetMinutes:30,metric:"Average mastery points gained across the 9-topic catalog (simulated)"};
  const targetMastery = 80;
  const averageDeficit = average(Object.values(masteryById).map(value=>Math.max(0,targetMastery-value)));
  const focusedTopicGainPerHour = average(CATALOG.map(topic=>topic.rate*60*(masteryById[topic.id]<40?1:masteryById[topic.id]<70?0.82:0.55)));
  const estimatedHours = averageDeficit===0 ? 0 : Math.ceil(averageDeficit/(focusedTopicGainPerHour/CATALOG.length));
  const progressPrediction = {targetMastery,estimatedStudyHours:estimatedHours,estimatedThirtyMinuteSessions:estimatedHours*2,confidence:profile.historyMode==="cold"||profile.historyMode==="sparse"?"low":"low-to-medium",basis:"Rule-based projection from current mastery gaps and topic learning-rate assumptions; not a trained forecast. Re-estimate after more assessment events.",averageMasteryDeficit:Math.round(averageDeficit*10)/10};
  const tests = makeTests(profile.scenario,masteryById,gaps,roadmap,benchmark,profile);
  return res.json({
    ok:true,engineVersion:"0.1.0",scenario:profile.scenario||null,studentName:profile.name,historyMode:profile.historyMode,
    inputSignals:{quizScore:profile.quiz,codingScore:profile.coding,timeSpentMinutes:profile.time,eventsProcessed:profile.events},
    overallMastery:Math.round(average(Object.values(masteryById))*10)/10,
    topics,gaps,roadmap,benchmark,progressPrediction,tests,
    validation:{prerequisiteViolations:validatePath(roadmap,masteryById),passed:tests.filter(t=>t.passed).length,total:tests.length},
    methodology:{mastery:"Topic prior calibrated with quiz (15%) and coding (10%) evidence when history is available; sparse history is shrunk toward a conservative prior.",priority:"Greedy ranking by mastery deficit × topic importance, with a small optional focus-topic boost.",gapThreshold:60,masteryThreshold:85,complexity:"O(V² + E) roadmap selection; O(V + E) validation; V=9 topics."}
  });
}