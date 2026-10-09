#!/usr/bin/env node

const conversationCount = 100;
const makeConversation = (index) => {
  const turns = 2 + (index % 9);
  return Array.from({ length: turns }, (_, turn) => ({
    role: turn % 2 === 0 ? 'user' : 'assistant',
    content: `Synthetic conversation ${index + 1}, turn ${turn + 1}: candidate described a project decision, its measured outcome, and an unresolved question.`,
  }));
};
const estimates = Array.from({ length: conversationCount }, (_, index) => {
  const input = JSON.stringify(makeConversation(index));
  return Math.ceil(Buffer.byteLength(input, 'utf8') / 4);
}).sort((a, b) => a - b);
const sum = estimates.reduce((total, value) => total + value, 0);
const percentile = (fraction) => estimates[Math.min(estimates.length - 1, Math.ceil(estimates.length * fraction) - 1)];

process.stdout.write([
  '| Measure | Estimated input tokens |',
  '|---|---:|',
  `| Synthetic conversations | ${conversationCount} |`,
  `| Total | ${sum} |`,
  `| Mean per conversation | ${Math.round(sum / conversationCount)} |`,
  `| P50 | ${percentile(0.5)} |`,
  `| P95 | ${percentile(0.95)} |`,
  '',
  'Estimate: UTF-8 JSON bytes / 4; synthetic text only; no model or provider calls.',
  '',
].join('\n'));
