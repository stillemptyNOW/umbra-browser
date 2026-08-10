'use strict';

/* Chromium's own network error numbering. Anything not listed here falls back
   to the raw description rather than being guessed at. */
const EXPLANATIONS = {
  '-101': ['The connection was reset', 'Something interrupted the connection midway.'],
  '-102': ['The connection was refused', 'The server actively rejected the connection on that port.'],
  '-105': ['This address could not be found', 'The domain name did not resolve. It may be misspelled, or the site may no longer exist.'],
  '-106': ['You appear to be offline', 'Umbra could not reach the network at all.'],
  '-107': ['The secure connection failed', 'The server’s TLS handshake was invalid or unsupported.'],
  '-109': ['That host is unreachable', 'The address resolved, but nothing answered.'],
  '-118': ['The site took too long to answer', 'The connection timed out before the server responded.'],
  '-137': ['This address could not be found', 'DNS resolution failed for this host.'],
  '-200': ['The certificate does not match this site', 'It was issued for a different domain. Umbra will not let you through.'],
  '-201': ['The certificate has expired', 'Umbra will not continue over a connection it cannot verify.'],
  '-202': ['The certificate is not trusted', 'It was not issued by an authority your system trusts.'],
  '-324': ['The server sent an empty reply', 'The connection succeeded but no data came back.'],
};

(async () => {
  await window.umbraPage;

  const params = new URLSearchParams(location.search);
  const url = params.get('url') || '';
  const code = params.get('code') || '0';
  const description = params.get('description') || '';

  const [headline, why] = EXPLANATIONS[code] ||
    ['This page could not be loaded', description || 'The request did not complete.'];

  document.getElementById('headline').textContent = headline;
  document.getElementById('why').textContent = why;
  document.getElementById('addr').textContent = url;
  document.getElementById('code').textContent =
    description ? `${description} (${code})` : `Error ${code}`;
  document.title = headline;

  document.getElementById('retry').onclick = () => {
    if (url) window.umbraInternal?.navigate(url);
  };
  document.getElementById('home').onclick = () =>
    window.umbraInternal?.navigate('umbra://newtab');
})();
