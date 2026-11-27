// pactlab.ai viewer request (CloudFront Functions, JS runtime 2.0). The stack prepends
// `var LOCALES = {...};` from the site build's /locales.json (T-171).
//
// 1. Language: a first visit to an entry or section-root page with no language prefix is sent
//    (302, path and query kept) to the visitor's language — the one chosen in the switcher
//    (cookie), which always wins, otherwise the one for CloudFront-Viewer-Country. Prefixed
//    URLs, deeper pages, unpublished languages and English never redirect: no loops, and no
//    language becomes canonical by accident (hreflang decides indexing).
// 2. Directory index: /product and /product/ both serve /product/index.html.

function localeRedirect(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  var uri = request.uri;
  var first = uri.split('/')[1];
  if (LOCALES.prefixes.indexOf(first) !== -1) return null;
  var path = uri.length > 1 ? uri.replace(/\/+$/, '') : uri;
  if (LOCALES.entryPaths.indexOf(path) === -1) return null;

  var target;
  var chosen = request.cookies && request.cookies[LOCALES.cookie];
  if (chosen) {
    target = chosen.value;
  } else {
    var country = request.headers['cloudfront-viewer-country'];
    target = country ? LOCALES.countries[country.value.toUpperCase()] : undefined;
  }
  if (!target || LOCALES.published.indexOf(target) === -1) return null;

  return {
    statusCode: 302,
    statusDescription: 'Found',
    headers: {
      location: { value: '/' + target + (path === '/' ? '/' : path + '/') + queryString(request.querystring) },
      'cache-control': { value: 'private, no-store' },
    },
  };
}

function queryString(querystring) {
  var parts = [];
  for (var name in querystring) {
    var entry = querystring[name];
    var values = entry.multiValue ? entry.multiValue : [entry];
    for (var i = 0; i < values.length; i++) parts.push(values[i].value === '' ? name : name + '=' + values[i].value);
  }
  return parts.length ? '?' + parts.join('&') : '';
}

function handler(event) {
  var request = event.request;
  var redirect = localeRedirect(request);
  if (redirect) return redirect;
  var uri = request.uri;
  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html';
  } else if (uri.split('/').pop().indexOf('.') === -1) {
    request.uri = uri + '/index.html';
  }
  return request;
}
