# Public username-site list

`maigretSites.json` contains 70 selected site definitions from the public
Maigret `data.json` dataset. The upstream source is
<https://github.com/soxoj/maigret/blob/main/maigret/resources/data.json> and its
MIT license is included in `MAIGRET-LICENSE`. The subset was captured on
2026-10-04.

Sites were selected when the upstream entry had an HTTPS username profile URL,
a professional or technical tag, a listed Alexa rank no higher than 50,000,
and a supported `message` or `status_code` check. The 37 highest-ranked entries
(Alexa rank at most 5,000) use the `sherlock` adapter id; the remaining 33 use
the `maigret` id. Both ids share the same passive GET implementation, and this
split avoids duplicate requests. Disabled and challenge-tagged
entries, query/search pages, subdomain templates, LinkedIn, and phone or contact
sources are excluded. The set covers public code, technical writing, design,
education, research, and professional community profiles. A match remains a
lead: it never proves account ownership.

The `sherlock` id contains GitHub, Medium, SourceForge, Launchpad, GitLab,
SlideShare, Behance, Dribbble, NPM, Slashdot, DigitalOcean, Instructables,
HuggingFace, Laracast, BitBucket, kofi, DEV Community, Duolingo, ProductHunt,
Gitea, Geeksfor Geeks, Codecanyon, Codecademy, HackerNoon, Speakerdeck, Wattpad,
Hack MD, Teletype, LeetCode, CTAN, OpenCollective, Slides, HackerOne,
MyMiniFactory, OpenSource, Hackaday, and Designs99. These are the 37
highest-ranked eligible HTTPS username-profile entries from the selected
professional/technical upstream subset, ranked at Alexa 5,000 or better. The
remaining 33 eligible entries are checked by the same implementation under the
`maigret` id.

The upstream license covers this dataset subset; it does not establish that
automated requests comply with each destination site's terms. The adapter only
uses public GET requests and remains behind the candidate consent and
owner-approved consent-text gates. Before enabling live checks, review the
terms and robots policies of every selected destination and disable any source
that does not permit this use. Tests use response fixtures and never contact
these sites.

## API references

- HIBP email range search: <https://haveibeenpwned.com/API/V3>. The adapter
  sends only a six-character SHA-1 prefix, discards non-matching suffixes, and
  never falls back to sending a full email address. This endpoint requires a
  subscription tier that supports the range search; a key without that tier is
  reported as a source error.
- Exa Search: <https://exa.ai/docs/reference/search>. The adapter sends POST
  requests with the `x-api-key` header, uses `category: "people"` for one
  request and ordinary name/employer search for the other, requests 5 results
  per query, and retains at most 300 excerpt characters. The API's `image` URL
  is compared locally with the candidate's profile photo URL; that candidate URL
  is not added to the request, and no image search or image fetch is performed.
- Internet Archive CDX: <https://github.com/internetarchive/wayback/blob/master/wayback-cdx-server/README.md>.
  The adapter uses the fixed `web.archive.org/cdx/search/cdx` host, exact URL
  matching, and bounded JSON responses.
