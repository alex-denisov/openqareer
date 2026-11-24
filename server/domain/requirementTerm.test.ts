import { describe, expect, it } from 'vitest';
import { termAppears } from './requirementTerm';

describe('требование в тексте — только целым термином (B785)', () => {
  it.each([
    ['Go', 'Вывод продукта: go-to-market (GTM)'],
    ['Go', 'Go-to-market стратегия'],
    ['Go', 'Go to market с нуля'],
    ['Go', 'Ready to go'],
    ['Go', 'Google Cloud и Golang'],
    ['C', 'Сервис на C++'],
    ['C', 'Сервис на C#'],
    ['C', 'C-level переговоры'],
    ['C++', 'Сервис на C#'],
    ['C#', 'Сервис на C++'],
    ['R', 'Руководил R&D'],
    ['NET', 'Платформа .NET'],
    ['.NET', 'ASP.NET MVC'],
    ['Java', 'JavaScript'],
    ['Node', 'Node.js'],
  ])('%s нет в «%s»', (term, text) => expect(termAppears(term, text)).toBe(false));

  it.each([
    ['Go', 'Стек: Go, Kotlin'],
    ['Go', 'Go/Kotlin'],
    ['Go', 'Go-разработчик'],
    ['Go', 'Писал на Go.'],
    ['C', 'Прошивки на C'],
    ['C++', 'Сервис на C++.'],
    ['C#', 'C#, .NET'],
    ['.NET', 'Платформа (.NET)'],
    ['R', 'Анализ на R и Python'],
    ['Node.js', 'node.js и React'],
    ['CI/CD', 'Настроил CI/CD'],
    ['project management', 'Project-management office'],
    ['kubernetes', 'Kubernetes-кластер'],
    ['управление проектами', 'Управление проектами, бюджет'],
  ])('%s есть в «%s»', (term, text) => expect(termAppears(term, text)).toBe(true));
});
