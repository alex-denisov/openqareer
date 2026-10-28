import React from 'react';
import { PublicFooter, PublicHeader } from './PublicSiteChrome';

/**
 * B574: on the web the sign-in, sign-up and recovery pages wear the site
 * header and footer; lazy, like the auth pages it frames.
 */
export default function AuthSiteFrame({
  onNavigate,
  signedIn,
  children,
}: {
  readonly onNavigate: (path: string) => void;
  readonly signedIn: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <>
      <PublicHeader onNavigate={onNavigate} signedIn={signedIn} />
      {children}
      <PublicFooter onNavigate={onNavigate} signedIn={signedIn} />
    </>
  );
}
