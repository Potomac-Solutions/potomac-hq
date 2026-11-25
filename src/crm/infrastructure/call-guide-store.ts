// Call guides and each call's answers (decision 0009, migration 0053).
import type { CallGuideStore, CallGuide } from "../application/ports.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

type Row = Record<string, unknown>;

export function sqliteCallGuideStore(db: Database): CallGuideStore {
  const guides = db.prepare("select situation, title, updated_at, updated_by from call_guide order by case situation when 'first-call' then 1 when 'proposal-follow-up' then 2 when 'project-check-in' then 3 when 'renewal' then 4 else 5 end");
  const questions = db.prepare("select situation, text from call_guide_question order by situation, position");
  const one = db.prepare("select situation, title, updated_at, updated_by from call_guide where situation = ?");
  const questionsFor = db.prepare("select text from call_guide_question where situation = ? order by position");
  const setGuide = db.prepare("update call_guide set title = ?, updated_at = ?, updated_by = ? where situation = ?");
  const clear = db.prepare("delete from call_guide_question where situation = ?");
  const addQuestion = db.prepare("insert into call_guide_question (situation, position, text) values (?, ?, ?)");
  const answers = db.prepare("select guide, position, question, asked, answer from call_answer where call_id = ? order by rowid");
  const saveAnswer = db.prepare(
    "insert into call_answer (call_id, guide, position, question, asked, answer) values (?, ?, ?, ?, ?, ?) on conflict (call_id, guide, position) do update set question = excluded.question, asked = excluded.asked, answer = excluded.answer",
  );
  const guide = (row: Row, list: readonly string[]): CallGuide => ({ situation: String(row["situation"]), title: String(row["title"]), questions: list, updatedAt: String(row["updated_at"]), updatedBy: (row["updated_by"] as Id | null) ?? null });
  const script = db.prepare("select text, updated_at, updated_by from call_script where kind = ?");
  const saveScript = db.prepare("update call_script set text = ?, updated_at = ?, updated_by = ? where kind = ?");
  return {
    script(kind) {
      const row = script.get(kind) as Row | undefined;
      return row ? { text: String(row["text"]), updatedAt: String(row["updated_at"]), updatedBy: (row["updated_by"] as Id | null) ?? null } : null;
    },
    saveScript(kind, text, at, userId) {
      saveScript.run(text, at, userId, kind);
    },
    all() {
      const bySituation = new Map<string, string[]>();
      for (const row of questions.all()) {
        const list = bySituation.get(String(row["situation"])) ?? [];
        list.push(String(row["text"]));
        bySituation.set(String(row["situation"]), list);
      }
      return guides.all().map((row) => guide(row as Row, bySituation.get(String(row["situation"])) ?? []));
    },
    get(situation) {
      const row = one.get(situation) as Row | undefined;
      return row ? guide(row, questionsFor.all(situation).map((q) => String(q["text"]))) : null;
    },
    save(situation, title, list, at, userId) {
      setGuide.run(title, at, userId, situation);
      clear.run(situation);
      list.forEach((text, index) => addQuestion.run(situation, index + 1, text));
    },
    answers: (callId) => answers.all(callId).map((row) => ({ guide: String(row["guide"]), position: Number(row["position"]), question: String(row["question"]), asked: row["asked"] === 1, answer: String(row["answer"]) })),
    saveAnswer(callId, row) {
      saveAnswer.run(callId, row.guide, row.position, row.question, row.asked ? 1 : 0, row.answer);
    },
  };
}
