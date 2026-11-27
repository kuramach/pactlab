/**
 * Keys a sanitized cassette may hold anywhere in a response body, per
 * provider. The recorder (`scripts/record-cassettes.ts`) prunes recordings to
 * these keys and `cassettes.test.ts` fails on anything else, so a provider
 * payload can never land in the repository whole.
 */
export const CASSETTE_KEYS: Readonly<Record<string, ReadonlySet<string>>> = {
  github: new Set([
    'full_name', 'default_branch', 'visibility', 'private', 'sha', 'commit', 'author', 'committer', 'date', 'email', 'login',
    'stats', 'additions', 'deletions', 'total', 'files', 'filename', 'message',
    // Pull requests, reviews and check runs (T-082).
    'number', 'state', 'draft', 'title', 'user', 'created_at', 'closed_at', 'merged_at', 'head', 'base', 'ref',
    'total_count', 'check_runs', 'status', 'conclusion',
  ]),
  // Jira REST v2/v3 and Agile 1.0 shapes (T-082, T-074); people pseudonymised.
  jira: new Set([
    'deploymentType', 'id', 'name', 'schema', 'custom', 'statusCategory', 'key', 'errorMessages', 'accountId',
    'startAt', 'maxResults', 'total', 'issues', 'fields', 'issuetype', 'status', 'priority', 'created', 'resolutiondate',
    'assignee', 'reporter', 'displayName', 'comment', 'changelog', 'histories', 'items', 'field', 'from', 'to',
    'nextPageToken', 'isLast', 'values', 'type', 'state', 'boardId', 'startDate', 'endDate',
    'customfield_12310293', 'customfield_12310921', 'customfield_12310940', 'customfield_10016', 'customfield_10020',
  ]),
  // RentCast long-term rent estimates (T-158): the figures, the subject's building attributes and each comparable's
  // listing; never owner or tax data. Hand-built from the API reference with synthetic values.
  rentcast: new Set([
    'rent', 'rentRangeLow', 'rentRangeHigh', 'subjectProperty', 'comparables', 'formattedAddress', 'propertyType', 'bedrooms',
    'bathrooms', 'squareFootage', 'yearBuilt', 'price', 'distance', 'daysOld', 'correlation', 'status', 'error', 'message',
     // Property records (T-188): building facts, tax and sale history, and the owner of record (fictional in cassettes).
    'id', 'state', 'lotSize', 'lastSaleDate', 'lastSalePrice', 'ownerOccupied', 'features', 'unitCount', 'floorCount', 'roomCount',
    'garage', 'garageType', 'garageSpaces', 'exteriorType', 'roofType', 'foundationType', 'heating', 'heatingType', 'cooling',
    'coolingType', 'taxAssessments', 'propertyTaxes', 'year', 'value', 'total', 'history', 'event', 'date', 'owner', 'names', 'type',
    'mailingAddress',
    // Date keys of the sale history and year keys of the tax maps.
    '2011-02-03', '2019-05-14', '2023', '2024',
  ]),
  // Google Maps Platform photos (T-188): Street View metadata and a Places text-search hit with its photo references.
  'google-maps': new Set([
    'status', 'pano_id', 'date', 'places', 'id', 'displayName', 'text', 'formattedAddress', 'photos', 'name', 'authorAttributions', 'uri',
  ]),
};
