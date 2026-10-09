import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CareerTariffsView } from './CareerTariffsView';

function main() {
  const input = readFileSync(0, 'utf8');
  const props = input ? JSON.parse(input) : {};
  const html = renderToStaticMarkup(React.createElement(CareerTariffsView, props));
  process.stdout.write(html);
}

main();
