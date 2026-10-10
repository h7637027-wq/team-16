/* LearnPath AI UI controller. The scoring logic lives in /api/analyze. */
const $ = (id) => document.getElementById(id);
const state = { lastResult: null, activeScenario: "normal" };
const scenarioNames = {
  normal: ["Normal progress", "Steady progress with enough evidence to personalize the next topic."],
  "sudden-struggle": ["Sudden Struggle", "A core concept drops sharply; the engine should reprioritize remediation."],
  "fast-learner": ["Fast Learner", "High mastery should accelerate the learner while prerequisites remain respected."],
  "sparse-data": ["Sparse Data", "Limited history should trigger conservative cold-start estimates and useful next steps."],
  "multiple-events": ["Multiple Events", "Several new results arrive together; the engine should process them consistently."]
};
function toast(message) { const el = $("toast"); el.textContent = message; el.classList.add("show"); window.setTimeout(() => el.classList.remove("show"), 2600); }
function safeText(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function updateSliderLabels() { $("quizValue").textContent = $("quizScore").value + "%"; $("codingValue").textContent = $("codingScore").value + "%"; }
$("quizScore").addEventListener("input", updateSliderLabels);
$("codingScore").addEventListener("input", updateSliderLabels);
async function analyze(options = {}) {
  const isScenario = Boolean(options.scenario);
  const payload = isScenario ? { scenario: options.scenario } : {
    studentName: $("studentName").value.trim() || "Demo Student",
    quizScore: Number($("quizScore").value), codingScore: Number($("codingScore").value),
    timeSpentMinutes: Number($("timeSpent").value), historyMode: $("history").value,
    focusTopic: $("focusTopic").value,
    learnerId: localStorage.getItem("learnpath-learner-id")
  };
  $("analyzeBtn").disabled = true; $("analyzeBtn").textContent = "Analyzing…";
  try {
    const started = performance.now();
    const response = await fetch((window.__HATCHABLE__?.api || "/api") + "/analyze", {
      method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "The analysis request failed.");
    data.clientDurationMs = Math.round(performance.now() - started);
    state.lastResult = data; state.activeScenario = data.scenario || "custom";
    render(data);
    if (isScenario) renderScenario(data);
    toast("Learning path recalculated successfully.");
  } catch (error) {
    toast("Could not analyze: " + error.message);
    $("testAssertions").innerHTML = '<p class="empty-state">The test endpoint did not respond. Check the API deployment.</p>';
  } finally {
    $("analyzeBtn").disabled = false; $("analyzeBtn").innerHTML = 'Recalculate learning path <span>→</span>';
  }
}
function render(data) {
  $("greeting").textContent = (data.studentName || "Student") + "'s learning snapshot";
  $("overallMastery").innerHTML = safeText(Math.round(data.overallMastery)) + "<span>%</span>";
  $("overallBar").style.width = Math.max(0, Math.min(100, data.overallMastery)) + "%";
  $("masteryCaption").textContent = data.historyMode === "cold" ? "Initial estimate · cold-start prior" : data.historyMode === "sparse" ? "Conservative estimate · sparse history" : "Weighted estimate across topic mastery";
  $("gapCount").textContent = data.gaps.length;
  $("gapDots").innerHTML = Array.from({length:Math.min(6,Math.max(1,data.gaps.length))},(_,i)=>'<i style="background:'+(i<4?'#f0a0a5':'#ffca83')+'"></i>').join("");
  const critical = data.gaps.length >= 4;
  $("statusPill").textContent = critical ? "Needs focused practice" : data.overallMastery >= 80 ? "Ready to advance" : "Progressing";
  $("statusPill").style.color = critical ? "#ffbc72" : "#74e4ce";
  $("statusPill").style.borderColor = critical ? "#765c3d" : "#345e58";
  const next = data.roadmap[0];
  $("nextTopic").textContent = next ? next.title : "Review complete";
  $("nextReason").textContent = next ? next.reasonShort : "All topics currently mastered";
  $("masteryList").innerHTML = data.topics.map(topic => '<div class="mastery-item"><div class="mastery-meta"><span>'+safeText(topic.title)+'</span><span>'+Math.round(topic.mastery)+'%</span></div><div class="mastery-track"><i class="'+(topic.mastery<60?'low':'')+'" style="width:'+Math.max(0,Math.min(100,topic.mastery))+'%"></i></div></div>').join("");
  $("roadmapSub").textContent = data.roadmap.length + " recommended steps · " + (data.historyMode === "cold" ? "cold-start recommendations" : "ranked by current evidence");
  $("roadmapList").innerHTML = data.roadmap.map((item,i) => '<div class="roadmap-item"><span class="roadmap-step">'+String(i+1).padStart(2,"0")+'</span><div><h4>'+safeText(item.title)+'</h4><p>'+safeText(item.reason)+'</p><div class="roadmap-tags"><span>Mastery '+Math.round(item.mastery)+'%</span><span>Priority '+Number(item.priority).toFixed(2)+'</span><span>'+safeText(item.readiness)+'</span></div></div><span class="roadmap-time">'+safeText(item.minutes)+' min</span></div>').join("") || '<p class="empty-state">No topics need additional practice right now.</p>';
  $("predictedHours").textContent = data.progressPrediction.estimatedStudyHours + " h";
  $("predictedSessions").textContent = data.progressPrediction.estimatedThirtyMinuteSessions + " half-hour sessions";
  $("predictionConfidence").textContent = data.progressPrediction.confidence;
  $("baselineGain").textContent = data.benchmark.baselineGain.toFixed(1) + " pts";
  $("adaptiveGain").textContent = data.benchmark.adaptiveGain.toFixed(1) + " pts";
  $("improvement").textContent = data.benchmark.improvementPct === null ? "N/A" : (data.benchmark.improvementPct >= 0 ? "+" : "") + data.benchmark.improvementPct.toFixed(1) + "%";
  $("baselineTrack").style.width = Math.min(100,data.benchmark.baselineGain*4) + "%";
  $("adaptiveTrack").style.width = Math.min(100,data.benchmark.adaptiveGain*4) + "%";
  document.querySelectorAll(".scenario-card").forEach(card => card.classList.toggle("selected", card.dataset.scenario === data.scenario));
}
function renderScenario(data) {
  const meta = scenarioNames[data.scenario] || ["Custom analysis", "User-provided student performance was analyzed."];
  $("scenarioTitle").textContent = meta[0];
  $("scenarioDescription").textContent = meta[1];
  $("testAssertions").innerHTML = data.tests.map(test => '<div class="assertion '+(test.passed?'pass':'fail')+'"><span class="assertion-mark">'+(test.passed?'✓':'!')+'</span><div><b>'+safeText(test.name)+'</b><p>'+safeText(test.detail)+'</p></div></div>').join("");
}
document.querySelectorAll(".scenario-card").forEach(card => card.addEventListener("click", () => analyze({scenario:card.dataset.scenario})));
$("analyzeBtn").addEventListener("click", () => analyze());
$("focusTopic").addEventListener("change", () => { if (state.lastResult) analyze(); });
updateSliderLabels();
analyze({scenario:"normal"});

const learnerKey = "learnpath-learner-id";
if (!localStorage.getItem(learnerKey)) {
  const generated = (window.crypto && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g,"") : "learner" + Math.random().toString(36).slice(2,14);
  localStorage.setItem(learnerKey, generated.slice(0,48));
}
const learnerId = localStorage.getItem(learnerKey);
let currentQuestion = null;
let selectedAnswer = null;
let questionStartedAt = 0;
let quizSessionActive = false;
let quizSessionTotal = 5;
let quizSessionAnswered = 0;
let quizSessionCorrect = 0;
let quizSessionAsked = [];
function updateQuizProgress(){
  $("quizProgressCount").textContent=quizSessionAnswered+" / "+quizSessionTotal;
  $("quizProgressBar").style.width=Math.round(quizSessionAnswered/Math.max(1,quizSessionTotal)*100)+"%";
  $("quizProgressText").textContent=quizSessionActive?"Session in progress · "+quizSessionCorrect+" correct":"Session complete · "+quizSessionCorrect+" / "+quizSessionTotal+" correct";
}
const topicTitles = {"foundations":"Learning Foundations","algebra":"Algebra Essentials","functions":"Functions & Relationships","probability":"Probability Basics","statistics":"Statistics & Data Literacy","ml-foundations":"Machine Learning Foundations","classification":"Classification Models","model-evaluation":"Model Evaluation","neural-networks":"Neural Network Basics"};
function getSavedTopicScores(){try{return JSON.parse(localStorage.getItem("learnpath-topic-scores")||"{}")}catch{return {}}}
function renderHistory(data){
  $("eventsCount").textContent = data.eventsProcessed;
  $("topicsWithResults").textContent = data.attemptsByTopic.length;
  $("attemptHistory").innerHTML = data.attemptsByTopic.map(item=>'<div class="attempt-row"><span>'+safeText(topicTitles[item.topicId]||item.topicId)+'</span><b>'+item.averageScore+'%</b><small>'+item.attempts+' attempt'+(item.attempts===1?"":"s")+'</small></div>').join("") || '<p class="empty-state">No quiz attempts yet.</p>';
}
async function loadQuestion(){
  if(!quizSessionActive||quizSessionAnswered>=quizSessionTotal){
    quizSessionTotal=Number($("quizQuestionCount").value)||5;
    quizSessionAnswered=0;quizSessionCorrect=0;quizSessionAsked=[];quizSessionActive=true;
    $("quizFeedback").innerHTML="";
    updateQuizProgress();
  }
  const selectedTopic=$("quizTopic").value;
  const topicId=selectedTopic==="auto"?(state.lastResult?.roadmap?.[0]?.id||"foundations"):selectedTopic;
  $("quizStatus").textContent="Loading question "+(quizSessionAnswered+1)+" of "+quizSessionTotal+"…";
  $("loadQuestionBtn").disabled=true;
  try{
    const response=await fetch((window.__HATCHABLE__?.api||"/api")+"/quiz",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({topicId,difficulty:$("quizDifficulty").value,learnerId,excludeIds:quizSessionAsked,allowTopicFallback:selectedTopic==="auto"})});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||"Could not load a question.");
    currentQuestion=data.question;selectedAnswer=null;questionStartedAt=Date.now();quizSessionAsked.push(currentQuestion.id);
    $("quizStatus").textContent="Question "+(quizSessionAnswered+1)+" of "+quizSessionTotal+" · "+currentQuestion.topicTitle+" · "+currentQuestion.difficulty;
    $("questionArea").innerHTML='<p class="question-topic">QUESTION '+(quizSessionAnswered+1)+' / '+quizSessionTotal+' · '+safeText(currentQuestion.topicTitle)+'</p><p class="form-note">'+safeText(data.adaptation?.reason||"Question selected for practice.")+'</p><h4>'+safeText(currentQuestion.prompt)+'</h4><div class="answer-options">'+currentQuestion.choices.map((choice,i)=>'<button type="button" class="answer-option" data-answer="'+i+'"><span>'+String.fromCharCode(65+i)+'</span>'+safeText(choice)+'</button>').join("")+'</div><button type="button" class="btn primary full" id="submitAnswerBtn" disabled>Submit answer →</button>';
    $("quizFeedback").innerHTML="";
    document.querySelectorAll(".answer-option").forEach(button=>button.addEventListener("click",()=>{selectedAnswer=Number(button.dataset.answer);document.querySelectorAll(".answer-option").forEach(b=>b.classList.toggle("chosen",b===button));$("submitAnswerBtn").disabled=false;}));
    $("submitAnswerBtn").addEventListener("click",submitAnswer);
    $("loadQuestionBtn").textContent="Restart quiz session ↻";
  }catch(error){
    $("quizStatus").textContent="Question unavailable";
    $("quizFeedback").textContent=error.message;
    if(error.message.includes("No question is available")){quizSessionActive=false;$("quizStatus").textContent="Question bank limit reached";$("quizFeedback").textContent="This topic/difficulty has no more unused questions. Choose All topics · mixed practice or restart with a shorter session.";}
    toast(error.message);
  }finally{$("loadQuestionBtn").disabled=false;}
}
async function submitAnswer(){
  if(!currentQuestion||selectedAnswer===null)return;
  $("submitAnswerBtn").disabled=true;
  $("submitAnswerBtn").textContent="Checking answer…";
  try{
    const response=await fetch((window.__HATCHABLE__?.api||"/api")+"/submit-quiz",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({learnerId,questionId:currentQuestion.id,answerIndex:selectedAnswer,durationSeconds:Math.min(3600,Math.round((Date.now()-questionStartedAt)/1000))})});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||"Could not submit answer.");
    localStorage.setItem("learnpath-topic-scores",JSON.stringify(data.topicScores));
    quizSessionAnswered++;if(data.correct)quizSessionCorrect++;
    updateQuizProgress();
    $("quizFeedback").innerHTML='<div class="feedback-card '+(data.correct?'correct':'incorrect')+'"><b>'+(data.correct?'✓ Correct answer':'↻ Review this concept')+'</b><p>'+safeText(data.explanation)+'</p><small>'+safeText(data.message)+'</small></div>';
    renderHistory(data);
    await analyze();
    toast("Assessment saved; learning path updated.");
    currentQuestion=null;selectedAnswer=null;
    if(quizSessionAnswered<quizSessionTotal){
      $("questionArea").insertAdjacentHTML("beforeend",'<button type="button" class="btn primary full" id="nextQuestionBtn">Next question →</button>');
      $("nextQuestionBtn").addEventListener("click",loadQuestion);
      $("quizStatus").textContent="Answer saved · "+quizSessionAnswered+" of "+quizSessionTotal+" completed";
    }else{
      quizSessionActive=false;
      $("quizStatus").textContent="Quiz complete · "+quizSessionCorrect+" / "+quizSessionTotal+" correct";
      $("questionArea").insertAdjacentHTML("beforeend",'<div class="feedback-card correct"><b>Session complete</b><p>You scored '+quizSessionCorrect+' out of '+quizSessionTotal+' ('+Math.round(quizSessionCorrect/quizSessionTotal*100)+'%). Start another session to practice again.</p></div>');
      $("loadQuestionBtn").textContent="Start new quiz session ↻";
      updateQuizProgress();
    }
  }catch(error){
    $("quizFeedback").textContent=error.message;
    $("submitAnswerBtn").disabled=false;
    $("submitAnswerBtn").textContent="Retry submission →";
  }
}
$("loadQuestionBtn").addEventListener("click",loadQuestion);