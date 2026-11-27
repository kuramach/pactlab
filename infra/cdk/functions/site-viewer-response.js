// pactlab.ai viewer response (CloudFront Functions, JS runtime 2.0). The stack prepends
// `var LOCALES = {...};` from the site build's /locales.json (T-171).
//
// Remembers the viewer's country (two letters, nothing else) for a day, so the pilot request
// can pre-select it. No geo-IP service, no client-side lookup: CloudFront-Viewer-Country only.

function handler(event) {
  var request = event.request;
  var response = event.response;
  var country = request.headers['cloudfront-viewer-country'];
  if (!country || !/^[A-Z]{2}$/.test(country.value)) return response;
  if (request.cookies && request.cookies[LOCALES.countryCookie]) return response;
  response.cookies = response.cookies || {};
  response.cookies[LOCALES.countryCookie] = { value: country.value, attributes: 'Path=/; Max-Age=86400; SameSite=Lax; Secure' };
  return response;
}
