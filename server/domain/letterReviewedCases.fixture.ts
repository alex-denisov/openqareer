/** Письма модели с прода 05.11 (G3d), которые CPO прочитал и признал искажёнными; синтетический профиль QA. */
export interface ReviewedLetter {
  readonly letter: number;
  readonly language: 'en' | 'ru';
  readonly body: string;
}

export const REVIEWED_LETTERS: readonly ReviewedLetter[] = [
  {
    letter: 2,
    language: 'en',
    body: "Dear Hiring Lead,\n\nI am writing to apply for the Director, Technology Operations & Sustainment position at Leidos. I want to work at Leidos specifically and have marked it as a company I would like to join.\n\nMy background includes leadership roles in engineering. From 2024 to the present I have been Head of Engineering at Финтех Лаб. Before that, from 2021 to 2023, I was Director of Engineering at Маркет Софт. From 2014 to 2021 I was Head of Engineering at Ритейл Системс. Across these roles I worked on technology operations and engineering leadership.\n\nMy technical background includes Kubernetes, Kafka, Go, Python, and PostgreSQL.\n\nI would be glad to discuss how my experience aligns with the needs of your team.\n\nThank you for your consideration.",
  },
  {
    letter: 4,
    language: 'en',
    body: "I am writing to express my interest in the VP, Operations role at Bjak.\n\nIn my current position as Head of Engineering at Финтех Лаб since 2024, I work on engineering leadership and operations-related initiatives. Before that, from 2021 to 2023, I served as Director of Engineering at Маркет Софт. From 2014 to 2021 I was Head of Engineering at Ритейл Системс.\n\nIn an earlier capacity I managed warehouse and logistics for a federal retail chain, where the team grew from 8 to 35 people.\n\nMy technical background includes Python, Go, Kafka, Kubernetes, and PostgreSQL.\n\nI would welcome the opportunity to discuss how this experience could be relevant to the VP, Operations position at Bjak.",
  },
  {
    letter: 7,
    language: 'ru',
    body: "Рассматриваю позицию VP, Operations в Bjak. Сейчас работаю руководителем разработки в Финтех Лаб, где занимаюсь задачами, связанными с операционной моделью и управлением изменениями.\n\nВ числе проектов и результатов — склад и логистика для федеральной сети магазинов, где команда выросла с 8 до 35 человек, внедрение единой системы KPI для пяти направлений, а также построение операционной модели и управление изменениями. Среди результатов также сокращение срока выполнения заказа с 12 до 7 дней и повышение уровня сервиса с 91 до 97 %.\n\nС 2021 по 2023 год работал директором по разработке в Маркет Софт, а с 2014 по 2021 год — руководителем разработки в Ритейл Системс. В рамках работы также занимался привлечением финдиректора для глубоких финансовых моделей M&A.\n\nБуду рад обсудить, как мой опыт руководства разработкой, работы с операционными процессами, KPI и изменениями может быть применён в Bjak.",
  },
  {
    letter: 8,
    language: 'en',
    body: "Dear Hiring Lead,\n\nI am writing to express my interest in the VP, Operations position at Bjak.\n\nIn my current role as Head of Engineering at Финтех Лаб, where I have been since 2024, I work on engineering leadership across a fintech environment. Previously, from 2021 to 2023, I served as Director of Engineering at Маркет Софт. Before that, from 2014 to 2021, I was Head of Engineering at Ритейл Системс.\n\nLooking further back, I managed warehouse and logistics for a federal retail chain, scaling the team from 8 to 35 people. This operational experience, combined with my engineering leadership background, has given me a perspective on both the technical and operational sides of running systems at scale.\n\nMy technical skill set includes Kubernetes, Kafka, Go, Python, and PostgreSQL.\n\nI would welcome the opportunity to discuss how my background aligns with the needs of Bjak.",
  },
  {
    letter: 9,
    language: 'ru',
    body: "Здравствуйте! Меня заинтересовала позиция Director, Technology Operations & Sustainment в Leidos, и я хотел бы предложить свою кандидатуру.\n\nС 2024 года работаю руководителем разработки в Финтех Лаб. В рамках направления складской и логистической поддержки федеральной сети магазинов команда выросла с 8 до 35 человек. Занимался внедрением единой системы KPI для пяти направлений, а также построением операционной модели и управлением изменениями. Кроме того, привлекал финансового директора для глубоких финансовых моделей M&A.\n\nДо этого, в 2021–2023 годах, работал директором по разработке в Маркет Софт. Там занимался сокращением срока выполнения заказа с 12 до 7 дней и повышением уровня сервиса с 91 до 97 %.\n\nРанее, с 2014 по 2021 год, работал руководителем разработки в Ритейл Системс.\n\nБуду рад обсудить, как мой опыт может быть полезен для задач Technology Operations & Sustainment.",
  },
  {
    letter: 10,
    language: 'en',
    body: "Dear Hiring Lead,\n\nI am writing to apply for the Director, Technology Operations & Sustainment position at Leidos. I want to work specifically at Leidos.\n\nIn my current role as Head of Engineering at Финтех Лаб since 2024, and previously as Director of Engineering at Маркет Софт from 2021 to 2023 and Head of Engineering at Ритейл Системс from 2014 to 2021, I have worked on technology operations and engineering leadership. My work has involved Python, Go, Kafka, Kubernetes, and PostgreSQL.\n\nIn one engagement, I managed warehouse and logistics for a federal retail chain, scaling the team from 8 to 35 people.\n\nI would welcome the opportunity to discuss how this experience aligns with your needs.",
  },
];
