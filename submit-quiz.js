import { db } from "hatchable";
import { QUESTIONS } from "../lib/questions.js";
export const access = "public";
export const methods = ["POST"];
export default async function(req,res) {
  const body=req.body||{};
  const learnerId=String(body.learnerId||"").trim();
  const questionId=String(body.questionId||"");
  const answerIndex=Number(body.answerIndex);
  const durationSeconds=Number(body.durationSeconds||0);
  if(!/^[a-zA-Z0-9_-]{8,80}$/.test(learnerId)) return res.status(400).json({error:"learnerId must be 8–80 letters, numbers, underscores, or hyphens."});
  const question=QUESTIONS.find(q=>q.id===questionId);
  if(!question) return res.status(404).json({error:"Question not found."});
  if(!Number.isInteger(answerIndex)||answerIndex<0||answerIndex>=question.choices.length) return res.status(400).json({error:"answerIndex is outside the available choices."});
  if(!Number.isFinite(durationSeconds)||durationSeconds<0||durationSeconds>3600) return res.status(400).json({error:"durationSeconds must be between 0 and 3600."});
  const isCorrect=answerIndex===question.answer;
  const score=isCorrect?100:0;
  await db.query("INSERT INTO learning_events (learner_id, topic_id, question_id, is_correct, score, duration_seconds) VALUES ($1,$2,$3,$4,$5,$6)",[learnerId,question.topicId,question.id,isCorrect,score,Math.round(durationSeconds)]);
  const history=await db.query("SELECT topic_id, AVG(score) AS avg_score, COUNT(*) AS attempts FROM learning_events WHERE learner_id = $1 GROUP BY topic_id",[learnerId]);
  const topicScores={};
  for(const row of history.rows) topicScores[row.topic_id]=Math.round(Number(row.avg_score));
  const eventCount=await db.query("SELECT COUNT(*) AS total FROM learning_events WHERE learner_id = $1",[learnerId]);
  return res.json({ok:true,graded:true,correct:isCorrect,score,questionId:question.id,topicId:question.topicId,topicTitle:question.topicTitle,explanation:question.explanation,topicScores,attemptsByTopic:history.rows.map(row=>({topicId:row.topic_id,attempts:Number(row.attempts),averageScore:Math.round(Number(row.avg_score))})),eventsProcessed:Number(eventCount.rows[0]?.total||0),message:isCorrect?"Correct — your result has been added to your learning history.":"Not quite — review the explanation, then try another question. Your result has been added to your learning history."});
}