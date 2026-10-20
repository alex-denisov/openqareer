import type { CareerDiaryInterviewPractice } from '../../../shared/careerDiary';
export function InterviewDiaryPractice({ record }: { readonly record: CareerDiaryInterviewPractice }) {
  const session = record.session;
  return <article className="career-diary-record" aria-label="Запись тренировки">
    <h3>Мок-интервью: {session.roleTitle}</h3>
    <p>Источник: сохранённая тренировка. Версия {session.version}. Сохранено {new Date(record.createdAt).toLocaleDateString('ru-RU')}.</p>
    <p>Учебные ответы и разбор не подтверждают карьерные достижения.</p>
    {session.questions.map(question => <details key={question.id}>
      <summary>{question.prompt}</summary>
      {question.answer ? <><p>{question.answer.text}</p><p>Рубрика: {question.answer.evaluation.rubric === 'star' ? 'STAR' : 'проектирование систем'}</p>
        <ul>{Object.entries(question.answer.evaluation.criteria).map(([name, criterion]) => <li key={name}>{criterion.reason}</li>)}</ul>
        {question.answer.evaluation.feedback ? <p>{question.answer.evaluation.feedback}</p> : null}
      </> : <p>{question.skipped ? 'Вопрос пропущен.' : 'Ответ не сохранён.'}</p>}
    </details>)}
  </article>;
}
