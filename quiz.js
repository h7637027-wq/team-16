import { db } from "hatchable";
import { QUESTIONS } from "../lib/questions.js";
export const access = "public";
export const methods = ["POST"];
export default async function(req,res) {
  const body=req.body||{};
  const requestedTopic=String(body.topicId||"");
  const topicId=requestedTopic==="all"?"":requestedTopic;
  const excludedIds=Array.isArray(body.excludeIds)?body.excludeIds.map(String).slice(0,100):[];
  const learnerId=String(body.learnerId||"");
  let difficulty=requestedTopic==="all"&&body.difficulty==="auto"?"all":body.difficulty==="medium"?"medium":"easy";
  let adaptation={mode:"manual",reason:difficulty==="medium"?"Intermediate difficulty selected manually.":"Foundation difficulty selected manually."};
  if(body.difficulty==="auto"&&requestedTopic!=="all"){
    if(!/^[a-zA-Z0-9_-]{8,80}$/.test(learnerId)) return res.status(400).json({error:"Adaptive difficulty requires a valid learnerId."});
    const result=await db.query("SELECT AVG(score) AS avg_score, COUNT(*) AS attempts, (ARRAY_AGG(score ORDER BY created_at DESC))[1] AS recent_score FROM learning_events WHERE learner_id=$1 AND topic_id=$2",[learnerId,topicId]);
    const row=result.rows[0]||{};
    const attempts=Number(row.attempts||0);
    const average=Number(row.avg_score||0);
    const recent=Number(row.recent_score||0);
    if(attempts===0){difficulty="easy";adaptation={mode:"cold-start",reason:"No assessment history for this topic yet; starting with a foundation question.",attempts:0};}
    else if(attempts>=2&&average>=75&&recent>=60){difficulty="medium";adaptation={mode:"adaptive",reason:"At least two attempts, strong average performance, and a solid recent result support a more challenging question.",attempts,averageScore:Math.round(average),recentScore:Math.round(recent)};}
    else{difficulty="easy";adaptation={mode:"adaptive",reason:attempts<2?"Only one attempt is available, so foundation practice continues until there is more evidence.":recent<average?"Recent performance dipped, so the engine is stepping back to reinforce the concept.":"The topic score suggests more foundation practice will be useful.",attempts,averageScore:Math.round(average),recentScore:Math.round(recent)};}
  }
  let candidates=QUESTIONS.filter(q=>(!topicId||q.topicId===topicId)&&(difficulty==="all"||q.difficulty===difficulty)&&!excludedIds.includes(q.id));
  let fallback=null;
  if(!candidates.length&&requestedTopic!=="all"&&body.allowTopicFallback===true){
    candidates=QUESTIONS.filter(q=>(difficulty==="all"||q.difficulty===difficulty)&&!excludedIds.includes(q.id));
    if(!candidates.length) candidates=QUESTIONS.filter(q=>!excludedIds.includes(q.id));
    if(candidates.length) fallback={mode:"mixed-topic-fallback",reason:"No unused questions remain in this topic at the selected difficulty; Auto practice is continuing with another topic."};
  }
  if(!candidates.length&&requestedTopic!=="all"){
    candidates=QUESTIONS.filter(q=>q.topicId===topicId&&!excludedIds.includes(q.id));
    if(candidates.length) fallback={mode:"difficulty-fallback",reason:"No unused questions remain at this difficulty, so practice is continuing at another difficulty in this topic."};
  }
  if(!candidates.length) return res.status(400).json({error:"No unused questions remain in this session. Restart the session or choose All topics · mixed practice."});
  const questionId=String(body.questionId||"");
  const question=questionId?candidates.find(q=>q.id===questionId):candidates[0];
  if(!question) return res.status(404).json({error:"Question not found for this topic and difficulty."});
  return res.json({ok:true,question:{id:question.id,topicId:question.topicId,topicTitle:question.topicTitle,difficulty:question.difficulty,prompt:question.prompt,choices:question.choices},questionCount:candidates.length,adaptation:fallback||adaptation});
}