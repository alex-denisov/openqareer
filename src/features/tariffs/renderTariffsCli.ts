import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CareerTariffsViewProps } from './CareerTariffsView';

register(new URL('./renderTariffsCssLoader.mjs', import.meta.url), import.meta.url);

async function main() {
  const { CareerTariffsView } = await import('./CareerTariffsView');
  const input = readFileSync(0, 'utf8');
  const props: CareerTariffsViewProps = input ? JSON.parse(input) : {};
  const html = renderToStaticMarkup(React.createElement(CareerTariffsView, props));
  process.stdout.write(html);
}

await main();
