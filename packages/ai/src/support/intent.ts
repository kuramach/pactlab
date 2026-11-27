/**
 * Deterministic reads of a help question (T-175), run before any model call. The boundary check is a
 * first line only: the assistant has no access to pact or organization data at all (its index is the
 * published corpus), so a question this misses still cannot be answered from anyone's data.
 */
const HOW_TO = /^\s*(how\s+(do|can|should|would)\s+(i|we|you|one)|how\s+to|where\s+(do|can|is|are)|how\s+does|what\s+(is|are)\s+(a|an|the\s+difference)|can\s+(i|we)|is\s+it\s+possible|why\s+(can'?t|does|do|is))\b/i;
const DATA_VERB = /\b(show|list|give|tell|summari[sz]e|read|export|extract|send|reveal|display|print|dump|find|fetch|look\s+up|what('?s|\s+(is|are|was|were|does|do|did))|how\s+(much|many)|which|who\s+(is|are)|status\s+of|value\s+of|worth)\b/i;
const DATA_NOUN = /\b(pacts?|deals?|targets?|data\s*rooms?|findings?|documents?|files?|contracts?|agreements?|valuations?|scenarios?|bids?|offers?|cap\s*tables?|term\s*sheets?|lois?|revenue|arr|mrr|ebitda|customers?|invoices?|rent\s*roll|p&l|members?|users?|team|accounts?|organi[sz]ations?|records?|evidence|claims?|questions?\s+from)\b/i;
const NAMED = /\b(contents?|details|inside)\s+(of|in)\b|\b(pact|deal)\s+(#?\d+|[A-Z][\w&.-]*)/;
const OWNED = /\b(my|our|their|his|her|its|the\s+(seller|buyer|target)['’]?s|someone['’]?s|somebody['’]?s)\b/i;
/** A company's own records ("Acme's findings"), never Pactlab's own pages. */
const POSSESSIVE = /\b(?!Pactlab['’]s)[A-Z][\w&.-]+['’]s\b/;
const OTHERS = /\b(other|another|any|every)\s+(of\s+(the|your)\s+)?(customers?|clients?|organi[sz]ations?|companies|firms|users?|buyers?|sellers?|tenants?)\b/i;

/** True when the question asks for what a pact, deal or organization contains rather than how Pactlab works. */
export function asksForAccountData(question: string): boolean {
  if (OTHERS.test(question) && DATA_NOUN.test(question)) return true;
  if (HOW_TO.test(question)) return false;
  return DATA_VERB.test(question) && DATA_NOUN.test(question) && (OWNED.test(question) || POSSESSIVE.test(question) || NAMED.test(question));
}

const FEATURE_ASK = /\b((can|could|would|will)\s+(you|pactlab|it|they)\s+(please\s+)?(add|build|support|integrate|offer|make)|i\s+wish|it\s+would\s+be\s+(great|nice|good|helpful)|feature\s+request|please\s+add|(do|does)\s+(you|pactlab)\s+(plan|have\s+plans)|any\s+plans?\s+to|is\s+there\s+(an?|any)\s+(integration|plan))\b/i;

/** True when the question reads as asking for something to be built. */
export function looksLikeFeatureRequest(question: string): boolean {
  return FEATURE_ASK.test(question);
}

const MONEY = /(?:[$€£¥₹]\s?\d[\d,.]*\s?(?:k|m|bn|million|billion)?|\b(?:USD|EUR|GBP|JPY|INR)\s?\d[\d,.]*)/gi;
const YEAR = /\b(?:19|20)\d{2}\b/g;
const MONTH_DAY = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}\b/gi;
const squash = (text: string) => text.toLowerCase().replace(/\s+/g, '');

/**
 * Prices and dates an answer states that none of its cited sources state. The assistant never invents a
 * price or a date: an answer with any of these is replaced by the don't-know.
 */
export function unsupportedFigures(answer: string, sources: readonly string[]): string[] {
  const haystack = squash(sources.join('\n'));
  const found = [...(answer.match(MONEY) ?? []), ...(answer.match(YEAR) ?? []), ...(answer.match(MONTH_DAY) ?? [])].map((figure) => figure.trim().replace(/[.,]+$/, ''));
  return [...new Set(found)].filter((figure) => !haystack.includes(squash(figure)));
}
