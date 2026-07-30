export type ToneOfVoice = 'Executive' | 'Confident' | 'Technical' | 'Humanist';
export type TargetPlatform = 'LinkedIn' | 'hh.ru';

export interface PitchGenerationParams {
  candidateRole?: string;
  targetRole?: string;
  companyName?: string;
  jobDescription?: string;
  tone: ToneOfVoice;
  platform: TargetPlatform;
}

export interface GeneratedPitchResult {
  pitchText: string;
  subjectLine: string;
  characterCount: number;
  estimatedReadTimeSec: number;
  highlightedKeywords: string[];
}

export function generateDirectPitch(params: PitchGenerationParams): GeneratedPitchResult {
  const role = params.targetRole || 'VP of Technology / Engineering Director';
  const company = params.companyName || 'Target Enterprise';
  const tone = params.tone;
  const platform = params.platform;

  let subjectLine = '';
  let pitchText = '';
  let keywords: string[] = ['Architecture', 'Leadership', 'ROI', 'Scaling'];

  if (platform === 'LinkedIn') {
    switch (tone) {
      case 'Executive':
        subjectLine = `Exploring Executive Leadership Synergy — ${role}`;
        pitchText = `Hi there! I noticed ${company}'s current expansion in tech leadership. As a ${role} with a track record of driving scalable architecture and leading high-performing teams, I'd love to connect. I recently led an engineering transformation resulting in 40% performance gains. Would you be open to a quick 10-minute sync?`;
        keywords = ['Executive Leadership', 'Scalable Architecture', 'Transformation', 'High-Performing Teams'];
        break;
      case 'Confident':
        subjectLine = `Proven Impact for ${company} — ${role}`;
        pitchText = `Hello! Your recent opening for ${role} aligns directly with my core strength: turning complex technical challenges into scalable, high-velocity engineering outcomes. I've scaled platforms to millions of users while cutting infrastructure costs. Let's discuss how I can bring immediate ROI to ${company}.`;
        keywords = ['Proven Impact', 'High-Velocity', 'ROI', 'Infrastructure Optimization'];
        break;
      case 'Technical':
        subjectLine = `Tech Architecture & Systems Pitch — ${role}`;
        pitchText = `Hi! I've been following ${company}'s tech stack evolution. With deep expertise in React 18, TypeScript, Microservices, and Cloud Native CI/CD pipelines, I build robust, bulletproof software ecosystems. I'd love to share insights on how we can optimize your tech velocity for ${role}.`;
        keywords = ['TypeScript Strict', 'Microservices', 'CI/CD Pipelines', 'Tech Velocity'];
        break;
      case 'Humanist':
        subjectLine = `Building Empowered Tech Teams at ${company}`;
        pitchText = `Hello! What drew me to ${company} is your commitment to engineering culture and user impact. As a ${role}, I focus on fostering psychological safety, empowering developers, and building resilient systems that solve real human problems. I'd welcome the chance to exchange thoughts.`;
        keywords = ['Engineering Culture', 'Team Empowerment', 'Psychological Safety', 'User Impact'];
        break;
    }
  } else {
    // hh.ru Chat Platform
    switch (tone) {
      case 'Executive':
        subjectLine = `Отклик на позицию ${role} в ${company}`;
        pitchText = `Здравствуйте! Меня заинтересовала позиция ${role} в компании ${company}. Обладаю опытом управления IT-департаментами, стратегическим планированием и оптимизацией бюджета разработки. Готов обсудить, как мой опыт ускорит достижение целей вашей команды.`;
        keywords = ['Управление IT', 'Стратегическое планирование', 'Оптимизация бюджета', 'Цели компании'];
        break;
      case 'Confident':
        subjectLine = `Прямой питч: ${role} для ${company}`;
        pitchText = `Добрый день! Имею успешный кейс масштабирования инженерных команд и повышения производительности сервисов на 35%+. Позиция ${role} в ${company} — точный метч по моим компетенциям. Готов подключиться к диалогу и ответить на ключевые вопросы.`;
        keywords = ['Масштабирование команд', 'Рост производительности', 'Прямой метч', 'Кейсы'];
        break;
      case 'Technical':
        subjectLine = `Инженерная экспертиза для позиции ${role}`;
        pitchText = `Приветствую! Специализируюсь на проектировании отказоустойчивых распределенных систем (React, TypeScript, Node.js, Microservices, CI/CD). Тщательно изучил стек ${company} и готов внести в него высшую инженерную надежность на должности ${role}.`;
        keywords = ['Отказоустойчивость', 'Распределенные системы', 'TypeScript', 'Инженерная надежность'];
        break;
      case 'Humanist':
        subjectLine = `Развитие продуктов и команды в ${company}`;
        pitchText = `Здравствуйте! Разделяю ценности ${company} и стремлюсь к созданию качественных продуктов через заботу о команде и пользователях. Обладаю опытом менторства и построения сильной инженерной культуры на позиции ${role}. Буду рад знакомству!`;
        keywords = ['Ценности компании', 'Развитие команды', 'Менторство', 'Инженерная культура'];
        break;
    }
  }

  const characterCount = pitchText.length;
  const estimatedReadTimeSec = Math.max(12, Math.round(characterCount / 18));

  return {
    pitchText,
    subjectLine,
    characterCount,
    estimatedReadTimeSec,
    highlightedKeywords: keywords,
  };
}
