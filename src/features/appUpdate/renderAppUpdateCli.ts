import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppUpdateContainer } from './AppUpdateContainer';
import type { AppUpdateActions, AppUpdateStatusData } from './appUpdateTypes';

const noopActions: AppUpdateActions = {
  onInstall: () => {},
  onEnableAutoUpdate: () => {},
  onWhatsNew: () => {},
  onPostpone: () => {},
  onRestart: () => {},
  onNextLaunch: () => {},
  onCancelDownload: () => {},
  onRetryNow: () => {},
  onForceRestart: () => {},
  onCloseModal: () => {},
  onDismissBanner: () => {},
};

function main() {
  const input = readFileSync(0, 'utf8');
  const status: AppUpdateStatusData = input ? JSON.parse(input) : {};
  const html = renderToStaticMarkup(
    React.createElement(AppUpdateContainer, {
      status,
      actions: noopActions,
    }),
  );
  process.stdout.write(html);
}

main();
