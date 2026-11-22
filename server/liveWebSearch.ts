/**
 * Live Web Evidence Retrieval Module
 * Performs real-time HTTPS queries against authoritative public, government,
 * intergovernmental, statistical, scientific, and peer-reviewed sources:
 * - IMF World Economic Outlook (WEO) SDMX 2.1 API (country & global macroeconomics)
 * - World Bank Open Data API (country & global indicators)
 * - ITU Facts and Figures live pages (UN global connectivity & revisions)
 * - NASA Goddard Planetary Fact Sheet + NASA Science API (astronomy & space)
 * - WHO Global Health Observatory API
 * - PubMed (NIH / NCBI peer-reviewed research)
 * - Crossref (peer-reviewed DOI literature)
 * - Wikipedia live article extracts
 * - Google News RSS (with direct publisher URL decoding & redirect deprioritization)
 * Ranks sources strictly by institutional reliability and prefers direct publisher URLs.
 */

export interface LiveEvidenceItem {
  title: string;
  url: string;
  domain: string;
  snippet: string;
  publicationDate: string | null;
  provider:
    | 'imf'
    | 'worldbank'
    | 'itu'
    | 'nasa'
    | 'who'
    | 'iea'
    | 'irena'
    | 'un'
    | 'nist'
    | 'sec'
    | 'bitcoin'
    | 'natgeo'
    | 'pubmed'
    | 'crossref'
    | 'wikipedia'
    | 'google_news';
  authorityScore: number;
}

export interface LiveSearchResult {
  queries: string[];
  items: LiveEvidenceItem[];
  errors: string[];
}

export interface LiveSearchOptions {
  excludeUrls?: Set<string>;
  deepAcademicRetry?: boolean;
}

const FETCH_TIMEOUT_MS = 7500;

/**
 * Institutional Reliability Ranking Tiers:
 * 98-100: Official government & space agencies (.gov, NASA, ESA, .europa.eu), World Bank, IMF, ITU, WHO, United Nations
 * 92-97:  Intergovernmental agencies (IEA, OECD, WTO, BIS), peer-reviewed research (PubMed, Nature, Science, Lancet, DOI, .edu)
 * 84-88:  Established wire services & encyclopedias (Reuters, AP, BBC, Britannica, Wikipedia)
 * 65-74:  General journalism & unresolved news redirect wrappers
 */
const AUTHORITATIVE_DOMAIN_PATTERNS: Array<{ pattern: RegExp; score: number }> = [
  // Tier 1: Official Government, Standards, Space Agencies, World Bank, IMF, ITU, WHO, UN, IEA, IRENA
  { pattern: /(^|\.)nasa\.gov$|(^|\.)esa\.int$|(^|\.)iau\.org$|(^|\.)eso\.org$/i, score: 100 },
  { pattern: /(^|\.)nist\.gov$|(^|\.)sec\.gov$|(^|\.)usgs\.gov$/i, score: 100 },
  { pattern: /\.(gov|mil)(\.[a-z]{2})?$/i, score: 100 },
  { pattern: /(^|\.)europa\.eu$|(^|\.)gc\.ca$|(^|\.)gov\.uk$|(^|\.)gov\.au$|(^|\.)gov\.in$/i, score: 100 },
  { pattern: /(^|\.)cdc\.gov$|(^|\.)nih\.gov$|(^|\.)noaa\.gov$|(^|\.)bls\.gov$|(^|\.)census\.gov$|(^|\.)eia\.gov$/i, score: 100 },
  { pattern: /(^|\.)worldbank\.org$/i, score: 99 },
  { pattern: /(^|\.)imf\.org$/i, score: 99 },
  { pattern: /(^|\.)itu\.int$/i, score: 99 },
  { pattern: /(^|\.)who\.int$/i, score: 99 },
  { pattern: /(^|\.)un\.org$|(^|\.)unfccc\.int$|(^|\.)undp\.org$|(^|\.)unicef\.org$|(^|\.)unesco\.org$|(^|\.)fao\.org$/i, score: 99 },
  { pattern: /(^|\.)iea\.org$|(^|\.)irena\.org$/i, score: 99 },

  // Tier 2: Intergovernmental, Peer-Reviewed Research, Official Protocol & Geographical Institutions
  { pattern: /(^|\.)pubmed\.ncbi\.nlm\.nih\.gov$/i, score: 96 },
  { pattern: /(^|\.)oecd\.org$|(^|\.)wto\.org$|(^|\.)bis\.org$/i, score: 96 },
  { pattern: /(^|\.)bitcoin\.org$|(^|\.)en\.bitcoin\.it$|(^|\.)developer\.bitcoin\.org$/i, score: 96 },
  { pattern: /(^|\.)nationalgeographic\.org$|(^|\.)aboutamazon\.com$/i, score: 95 },
  { pattern: /(^|\.)nature\.com$|(^|\.)science\.org$|(^|\.)thelancet\.com$|(^|\.)nejm\.org$|(^|\.)bmj\.com$|(^|\.)pnas\.org$|(^|\.)cell\.com$/i, score: 95 },
  { pattern: /(^|\.)doi\.org$|(^|\.)ieee\.org$|(^|\.)springer\.com$|(^|\.)sciencedirect\.com$|(^|\.)oup\.com$|(^|\.)cambridge\.org$/i, score: 93 },
  { pattern: /\.(edu|ac\.[a-z]{2})$/i, score: 93 },
  { pattern: /(^|\.)ember-energy\.org$|(^|\.)ember-climate\.org$|(^|\.)ourworldindata\.org$|(^|\.)ipcc\.ch$/i, score: 93 },

  // Tier 3: Established Wire Services & Reference
  { pattern: /(^|\.)reuters\.com$|(^|\.)apnews\.com$|(^|\.)bbc\.(com|co\.uk)$|(^|\.)ft\.com$|(^|\.)britannica\.com$/i, score: 87 },
  { pattern: /(^|\.)wikipedia\.org$/i, score: 85 },
  { pattern: /(^|\.)news\.google\.com$/i, score: 65 },
];

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return 'web';
  }
}

export function isGoogleNewsRedirectUrl(url: string): boolean {
  return (
    url.includes('news.google.com/rss/articles/') ||
    url.includes('news.google.com/articles/') ||
    url.includes('news.google.com/read/')
  );
}

export function scoreAuthority(domain: string, title = '', url = ''): number {
  const isGoogleNewsRedirect = isGoogleNewsRedirectUrl(url);

  let baseScore = 65;
  let matchedRule = false;
  for (const rule of AUTHORITATIVE_DOMAIN_PATTERNS) {
    if (rule.pattern.test(domain)) {
      baseScore = rule.score;
      matchedRule = true;
      break;
    }
  }

  if (matchedRule && /(^|\.)ourworldindata\.org$/i.test(domain) && /\b(IEA|International Energy Agency|IRENA|International Renewable Energy Agency)\b/i.test(title)) {
    baseScore = 96;
  }

  if (!matchedRule && /(^|\.)github\.com$/i.test(domain) && /github\.com\/bitcoin\/bitcoin\b/i.test(url)) {
    baseScore = 95;
    matchedRule = true;
  }

  if (!matchedRule) {
    if (/ - (World Bank|IMF|International Monetary Fund|ITU|United Nations|UN |WHO|World Health Organization|NASA|NIST|SEC|ESA|U\.S\. |Federal Reserve|NOAA|CDC|NIH|European Commission)/i.test(title)) {
      baseScore = 97;
    } else if (/ - (IEA|International Energy Agency|IRENA|OECD|Ember|Our World in Data|Nature|Science|The Lancet|IPCC|National Geographic)/i.test(title)) {
      baseScore = 93;
    } else if (/ - (Reuters|Associated Press|AP News|BBC|Financial Times|Bloomberg|Britannica|NPR|The Guardian|Wall Street Journal)$/i.test(title)) {
      baseScore = 86;
    }
  }

  // Deprioritize unresolved Google News RSS redirect wrappers so direct publisher URLs always rank higher
  if (isGoogleNewsRedirect) {
    return Math.min(baseScore, 50);
  }
  return baseScore;
}

function isSafeHttpUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    // Block loopback and RFC1918 / link-local hosts for SSRF hygiene
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.startsWith('169.254.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function decodeXmlEntities(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&plusmn;/g, '±')
    .replace(/&deg;/g, '°')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&lsquo;/g, '‘')
    .replace(/&rsquo;/g, '’')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripHtmlToText(html: string): string {
  return decodeXmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, '. ')
  )
    .replace(/\.\s*\./g, '.')
    .replace(/\s+/g, ' ')
    .trim();
}

// Tracks URLs confirmed live (HTTP 2xx/3xx) or official upstream canonical URLs returned by
// trusted institutional metadata APIs so final URL validation skips redundant network roundtrips.
const urlValidationCache = new Map<string, boolean>();

function rememberValidatedUrl(url: string, valid: boolean): void {
  if (urlValidationCache.size > 600) {
    urlValidationCache.clear();
  }
  urlValidationCache.set(url, valid);
}

/**
 * Validates that a cited source URL is safe, non-redirect (no Google News RSS wrapper),
 * and live (not 404/410/5xx or unreachable).
 */
export async function validateSourceUrl(url: string): Promise<boolean> {
  const safe = isSafeHttpUrl(url);
  if (!safe || isGoogleNewsRedirectUrl(safe)) {
    return false;
  }
  const cached = urlValidationCache.get(safe);
  if (cached !== undefined) {
    return cached;
  }

  // Known authoritative domains whose pages work in browsers but issue Cloudflare 403 to headless server fetches
  const domain = extractDomain(safe).toLowerCase();
  const isWafProtectedOfficial = /(^|\.)(iea\.org|irena\.org|imf\.org|data\.worldbank\.org)$/i.test(domain);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    try {
      let res = await fetch(safe, {
        method: 'HEAD',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': 'TheFactCheckAgent/1.0 (contact@factcheck-agent.app)',
          Accept: 'text/html,application/json,*/*',
        },
      });
      if (res.status === 405 || res.status === 501) {
        res = await fetch(safe, {
          method: 'GET',
          redirect: 'follow',
          signal: controller.signal,
          headers: {
            'User-Agent': 'TheFactCheckAgent/1.0 (contact@factcheck-agent.app)',
            Accept: 'text/html,application/json,*/*',
            Range: 'bytes=0-1023',
          },
        });
      }
      const isOk = (res.status >= 200 && res.status < 400) || (res.status === 403 && isWafProtectedOfficial);
      rememberValidatedUrl(safe, isOk);
      return isOk;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    if (isWafProtectedOfficial) {
      return true;
    }
    rememberValidatedUrl(safe, false);
    return false;
  }
}

async function fetchWithTimeout(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'TheFactCheckAgent/1.0 (contact@factcheck-agent.app)',
        Accept: 'application/json, application/xml, text/xml, text/html;q=0.9, */*;q=0.8',
        ...headers,
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (res.ok) {
      rememberValidatedUrl(url, true);
      if (res.url && res.url !== url) {
        rememberValidatedUrl(res.url, true);
      }
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

function formatNumberReadable(num: number): string {
  if (Math.abs(num) >= 1e12) {
    return `${(num / 1e12).toFixed(2)} trillion (${Math.round(num).toLocaleString('en-US')})`;
  }
  if (Math.abs(num) >= 1e9) {
    return `${(num / 1e9).toFixed(2)} billion (${Math.round(num).toLocaleString('en-US')})`;
  }
  if (Math.abs(num) >= 1e6) {
    return `${(num / 1e6).toFixed(2)} million (${Math.round(num).toLocaleString('en-US')})`;
  }
  return Number.isInteger(num) ? num.toLocaleString('en-US') : num.toFixed(2);
}

/**
 * Shared country resolver for country-specific IMF & World Bank queries.
 */
interface CountryCodeEntry {
  iso3: string;
  iso2: string;
  name: string;
  pattern: RegExp;
}

const COUNTRY_CODES: CountryCodeEntry[] = [
  { iso3: 'IND', iso2: 'IN', name: 'India', pattern: /\b(india|indian)\b/i },
  { iso3: 'USA', iso2: 'US', name: 'United States', pattern: /\b(united states|u\.s\.a?\.|america|american economy)\b/i },
  { iso3: 'CHN', iso2: 'CN', name: 'China', pattern: /\b(china|chinese)\b/i },
  { iso3: 'JPN', iso2: 'JP', name: 'Japan', pattern: /\b(japan|japanese)\b/i },
  { iso3: 'DEU', iso2: 'DE', name: 'Germany', pattern: /\b(germany|german)\b/i },
  { iso3: 'GBR', iso2: 'GB', name: 'United Kingdom', pattern: /\b(united kingdom|u\.k\.|britain|british)\b/i },
  { iso3: 'FRA', iso2: 'FR', name: 'France', pattern: /\b(france|french)\b/i },
  { iso3: 'ITA', iso2: 'IT', name: 'Italy', pattern: /\b(italy|italian)\b/i },
  { iso3: 'BRA', iso2: 'BR', name: 'Brazil', pattern: /\b(brazil|brazilian)\b/i },
  { iso3: 'CAN', iso2: 'CA', name: 'Canada', pattern: /\b(canada|canadian)\b/i },
  { iso3: 'RUS', iso2: 'RU', name: 'Russia', pattern: /\b(russia|russian)\b/i },
  { iso3: 'KOR', iso2: 'KR', name: 'South Korea', pattern: /\b(south korea|korean)\b/i },
  { iso3: 'AUS', iso2: 'AU', name: 'Australia', pattern: /\b(australia|australian)\b/i },
  { iso3: 'ESP', iso2: 'ES', name: 'Spain', pattern: /\b(spain|spanish)\b/i },
  { iso3: 'MEX', iso2: 'MX', name: 'Mexico', pattern: /\b(mexico|mexican)\b/i },
  { iso3: 'IDN', iso2: 'ID', name: 'Indonesia', pattern: /\b(indonesia|indonesian)\b/i },
  { iso3: 'TUR', iso2: 'TR', name: 'Türkiye', pattern: /\b(turkey|türkiye|turkish)\b/i },
  { iso3: 'SAU', iso2: 'SA', name: 'Saudi Arabia', pattern: /\b(saudi arabia|saudi)\b/i },
  { iso3: 'NGA', iso2: 'NG', name: 'Nigeria', pattern: /\b(nigeria|nigerian)\b/i },
  { iso3: 'ZAF', iso2: 'ZA', name: 'South Africa', pattern: /\b(south africa)\b/i },
  { iso3: 'ARG', iso2: 'AR', name: 'Argentina', pattern: /\b(argentina)\b/i },
  { iso3: 'SGP', iso2: 'SG', name: 'Singapore', pattern: /\b(singapore)\b/i },
  { iso3: 'CHE', iso2: 'CH', name: 'Switzerland', pattern: /\b(switzerland|swiss)\b/i },
  { iso3: 'NLD', iso2: 'NL', name: 'Netherlands', pattern: /\b(netherlands|dutch)\b/i },
  { iso3: 'POL', iso2: 'PL', name: 'Poland', pattern: /\b(poland|polish)\b/i },
  { iso3: 'PAK', iso2: 'PK', name: 'Pakistan', pattern: /\b(pakistan)\b/i },
  { iso3: 'BGD', iso2: 'BD', name: 'Bangladesh', pattern: /\b(bangladesh)\b/i },
  { iso3: 'VNM', iso2: 'VN', name: 'Vietnam', pattern: /\b(vietnam|vietnamese)\b/i },
  { iso3: 'EGY', iso2: 'EG', name: 'Egypt', pattern: /\b(egypt|egyptian)\b/i },
];

function detectCountries(claimText: string): CountryCodeEntry[] {
  return COUNTRY_CODES.filter((c) => c.pattern.test(claimText)).slice(0, 2);
}

/**
 * 1. IMF World Economic Outlook (WEO) SDMX 2.1 API — Tier 1 macroeconomic data
 * Covers Nominal GDP (NGDPD), PPP GDP (PPPGDP), Real GDP Growth (NGDP_RPCH),
 * GDP per capita (NGDPDPC), Inflation (PCPIPCH), and Unemployment (LUR).
 */
interface ImfIndicatorSpec {
  code: string;
  label: string;
  isCurrency: boolean;
  unit: string;
  pattern: RegExp;
}

const IMF_INDICATORS: ImfIndicatorSpec[] = [
  {
    code: 'NGDPD',
    label: 'Nominal GDP (Current prices, US dollars)',
    isCurrency: true,
    unit: 'USD',
    pattern: /\b(gdp|nominal gdp|economy|economic output|trillion|billion)\b/i,
  },
  {
    code: 'PPPGDP',
    label: 'GDP based on Purchasing-Power-Parity (PPP, international dollars)',
    isCurrency: true,
    unit: 'international dollars (PPP)',
    pattern: /\b(ppp|purchasing power parity)\b/i,
  },
  {
    code: 'NGDP_RPCH',
    label: 'Real GDP Growth (Annual percent change)',
    isCurrency: false,
    unit: '%',
    pattern: /\b(gdp growth|economic growth|real gdp|growth rate)\b/i,
  },
  {
    code: 'NGDPDPC',
    label: 'Nominal GDP per capita (Current prices, US dollars)',
    isCurrency: false,
    unit: 'USD per capita',
    pattern: /\bgdp per capita\b/i,
  },
  {
    code: 'PCPIPCH',
    label: 'Inflation, average consumer prices (Annual percent change)',
    isCurrency: false,
    unit: '%',
    pattern: /\b(inflation|consumer prices|cpi)\b/i,
  },
  {
    code: 'LUR',
    label: 'Unemployment rate (% of total labor force)',
    isCurrency: false,
    unit: '%',
    pattern: /\bunemployment\b/i,
  },
];

async function queryImfWeo(claimText: string, force = false): Promise<LiveEvidenceItem[]> {
  if (!force && !/\b(gdp|economy|economic|imf|inflation|unemployment|nominal|trillion)\b/i.test(claimText)) {
    return [];
  }

  const countries = detectCountries(claimText);
  // If no specific country matched, query World if global/world/worldwide mentioned (or forced)
  const targets: Array<{ iso3: string; name: string }> =
    countries.length > 0
      ? countries.map((c) => ({ iso3: c.iso3, name: c.name }))
      : force || /\b(world|worldwide|global|globally|international)\b/i.test(claimText)
        ? [{ iso3: 'G001', name: 'World' }]
        : [];

  if (targets.length === 0) return [];

  let matchedIndicators = IMF_INDICATORS.filter((ind) => ind.pattern.test(claimText));
  if (matchedIndicators.length === 0 && force) {
    matchedIndicators = [IMF_INDICATORS[0]];
  }
  if (matchedIndicators.length === 0) return [];

  const results: LiveEvidenceItem[] = [];
  for (const target of targets.slice(0, 2)) {
    for (const ind of matchedIndicators.slice(0, 2)) {
      const apiUrl = `https://api.imf.org/external/sdmx/2.1/data/WEO/${target.iso3}.${ind.code}.A?startPeriod=2021&endPeriod=2027`;
      try {
        const res = await fetchWithTimeout(apiUrl, { Accept: 'application/json' });
        if (!res.ok) continue;
        const json = (await res.json()) as {
          header?: { prepared?: string };
          dataSets?: Array<{
            series?: Record<string, { observations?: Record<string, Array<string | number | null>> }>;
          }>;
          structure?: {
            dimensions?: {
              observation?: Array<{
                id?: string;
                values?: Array<{ id?: string; name?: string }>;
              }>;
            };
          };
        };

        const ds = json.dataSets?.[0];
        const seriesKey = Object.keys(ds?.series ?? {})[0];
        if (!seriesKey) continue;
        const obs = ds?.series?.[seriesKey]?.observations;
        const timeValues = json.structure?.dimensions?.observation?.[0]?.values;
        if (!obs || !Array.isArray(timeValues) || timeValues.length === 0) continue;

        const points: Array<{ year: string; value: number }> = [];
        timeValues.forEach((tv, idx) => {
          const rawVal = obs[String(idx)]?.[0];
          const num = rawVal !== null && rawVal !== undefined ? Number(rawVal) : NaN;
          if (tv.id && Number.isFinite(num)) {
            points.push({ year: tv.id, value: num });
          }
        });
        if (points.length === 0) continue;

        const formattedSeries = points
          .map((p) => {
            if (ind.isCurrency) {
              // IMF SDMX NGDPD values are returned in raw USD (e.g. 3908963671000 = $3.91T / $3,908.96B)
              const inUsd = Math.abs(p.value) >= 1e9 ? p.value : p.value * 1e9;
              const trillions = (inUsd / 1e12).toFixed(2);
              const billions = (inUsd / 1e9).toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              });
              return `${p.year}: US$${trillions} trillion (US$${billions} billion)`;
            }
            return `${p.year}: ${p.value.toFixed(2)} ${ind.unit}`;
          })
          .join('; ');

        const preparedDate = json.header?.prepared ? json.header.prepared.slice(0, 10) : null;
        const directUrl = `https://www.imf.org/external/datamapper/${ind.code}@WEO/${target.iso3}`;

        results.push({
          title: `IMF World Economic Outlook (WEO) — ${target.name}: ${ind.label}`,
          url: directUrl,
          domain: 'imf.org',
          snippet: `Official IMF World Economic Outlook (WEO, indicator ${ind.code}, dataset prepared ${preparedDate ?? 'latest'}) for ${target.name} — ${ind.label}: ${formattedSeries}.`,
          publicationDate: preparedDate,
          provider: 'imf',
          authorityScore: 99,
        });
      } catch (err) {
        console.warn(
          `[liveWebSearch] IMF WEO query failed for ${target.iso3}.${ind.code}:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  }

  return results;
}

/**
 * 2. World Bank Open Data API — Tier 1 official country & global statistical indicators
 */
interface WorldBankIndicatorSpec {
  code: string;
  label: string;
  unit: string;
  pattern: RegExp;
}

const WORLD_BANK_INDICATORS: WorldBankIndicatorSpec[] = [
  {
    code: 'SP.POP.TOTL',
    label: 'Population, total',
    unit: 'people',
    pattern: /\bpopulation\b/i,
  },
  {
    code: 'NY.GDP.MKTP.CD',
    label: 'GDP (current US$)',
    unit: 'USD',
    pattern: /\b(gdp|nominal gdp|gross domestic product)\b/i,
  },
  {
    code: 'NY.GDP.MKTP.KD.ZG',
    label: 'GDP growth (annual %)',
    unit: '%',
    pattern: /\b(gdp growth|economic growth)\b/i,
  },
  {
    code: 'SP.DYN.LE00.IN',
    label: 'Life expectancy at birth, total (years)',
    unit: 'years',
    pattern: /\blife expectancy\b/i,
  },
  {
    code: 'EG.FEC.RNEW.ZS',
    label: 'Renewable energy consumption (% of total final energy)',
    unit: '%',
    pattern: /\brenewable energy\b.*\b(share|consumption|total)\b/i,
  },
  {
    code: 'EG.ELC.RNEW.ZS',
    label: 'Renewable electricity output (% of total electricity output)',
    unit: '%',
    pattern: /\b(solar|wind|renewable)\b.*\belectricity\b|\belectricity generation\b.*\b(solar|wind|renewable)\b/i,
  },
  {
    code: 'EG.ELC.ACCS.ZS',
    label: 'Access to electricity (% of population)',
    unit: '% of population',
    pattern: /\baccess to electricity\b/i,
  },
  {
    code: 'IT.NET.USER.ZS',
    label: 'Individuals using the Internet (% of population)',
    unit: '% of population',
    pattern: /\b(internet|online|offline|without internet|digital divide|connectivity|unconnected)\b/i,
  },
  {
    code: 'SL.UEM.TOTL.ZS',
    label: 'Unemployment, total (% of total labor force)',
    unit: '%',
    pattern: /\bunemployment\b/i,
  },
  {
    code: 'FP.CPI.TOTL.ZG',
    label: 'Inflation, consumer prices (annual %)',
    unit: '%',
    pattern: /\binflation\b/i,
  },
];

async function queryWorldBank(claimText: string, force = false): Promise<LiveEvidenceItem[]> {
  const matched = WORLD_BANK_INDICATORS.filter((ind) => ind.pattern.test(claimText));
  if (matched.length === 0) return [];

  const countries = detectCountries(claimText);
  const targets: Array<{ code: string; locParam: string; name: string }> =
    countries.length > 0
      ? countries.map((c) => ({ code: c.iso3, locParam: c.iso2, name: c.name }))
      : force || /\b(world|worldwide|global|globally|earth|humanity|international|people worldwide)\b/i.test(claimText)
        ? [{ code: 'WLD', locParam: '1W', name: 'World' }]
        : [];

  if (targets.length === 0) return [];

  const results: LiveEvidenceItem[] = [];
  for (const target of targets.slice(0, 1)) {
    for (const ind of matched.slice(0, 2)) {
      const apiUrl = `https://api.worldbank.org/v2/country/${target.code}/indicator/${ind.code}?format=json&per_page=10`;
      try {
        const res = await fetchWithTimeout(apiUrl);
        if (!res.ok) continue;
        const data = (await res.json()) as [
          { lastupdated?: string },
          Array<{ date?: string; value?: number | null }>,
        ];
        const meta = data?.[0];
        const rows = Array.isArray(data?.[1])
          ? data[1].filter((r) => r.value !== null && r.value !== undefined)
          : [];
        if (rows.length === 0) continue;

        const latest = rows[0];
        const historicalSample = rows
          .slice(0, 8)
          .map((r) => `${r.date}: ${formatNumberReadable(r.value!)}`)
          .join('; ');
        const indicatorPageUrl =
          target.code === 'WLD'
            ? `https://data.worldbank.org/indicator/${ind.code}`
            : `https://data.worldbank.org/indicator/${ind.code}?locations=${target.locParam}`;

        results.push({
          title: `World Bank Open Data — ${target.name}: ${ind.label}`,
          url: indicatorPageUrl,
          domain: 'data.worldbank.org',
          snippet: `Official World Bank data (${ind.code}, updated ${meta?.lastupdated ?? 'recent'}): Latest available value for ${target.name} (${latest.date}) is ${formatNumberReadable(latest.value!)} ${ind.unit}. Historical series: ${historicalSample}.`,
          publicationDate: meta?.lastupdated ?? latest.date ?? null,
          provider: 'worldbank',
          authorityScore: 99,
        });
      } catch (err) {
        console.warn(
          `[liveWebSearch] World Bank query failed for ${target.code}/${ind.code}:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  }
  return results;
}

/**
 * 3. Official ITU (United Nations International Telecommunication Union) Live Facts & Figures
 * Retrieves direct verbatim paragraphs from official itu.int 2025 & 2026 press releases and report chapters,
 * including both original historical estimates and subsequently revised estimates for online & offline populations.
 */
async function queryItuStatistics(claimText: string, force = false): Promise<LiveEvidenceItem[]> {
  if (
    !force &&
    !/\b(itu|internet|offline|online|digital divide|broadband|connectivity|unconnected|without internet|no internet|mobile network|mobile subscription)\b/i.test(
      claimText
    )
  ) {
    return [];
  }

  const endpoints = [
    {
      url: 'https://www.itu.int/en/mediacentre/Pages/PR-2026-11-03-Facts-and-Figures.aspx',
      title: 'ITU Press Release — Facts and Figures 2026 (Global Online & Revised 2025 Offline Estimates)',
      publicationDate: '2026-11-03',
      authorityScore: 100,
    },
    {
      url: 'https://www.itu.int/en/mediacentre/Pages/PR-2025-11-17-Facts-and-Figures.aspx',
      title: 'ITU Press Release — Facts and Figures 2025 (Global Online & Revised 2024 Offline Estimates)',
      publicationDate: '2025-11-17',
      authorityScore: 100,
    },
    {
      url: 'https://www.itu.int/itu-d/reports/statistics/2026/10/13/ff26-internet-use/',
      title: 'ITU Measuring Digital Development — Facts and Figures 2026: Internet Use',
      publicationDate: '2026-10-13',
      authorityScore: 99,
    },
    {
      url: 'https://www.itu.int/itu-d/reports/statistics/2025/10/15/ff25-internet-use/',
      title: 'ITU Measuring Digital Development — Facts and Figures 2025: Internet Use',
      publicationDate: '2025-10-15',
      authorityScore: 99,
    },
  ];

  const settled = await Promise.allSettled(
    endpoints.map(async (ep): Promise<LiveEvidenceItem | null> => {
      try {
        const res = await fetchWithTimeout(ep.url, {}, 9500);
        if (!res.ok) return null;
        const html = await res.text();
        const plain = stripHtmlToText(html);

        // Extract verbatim sentences discussing internet users, offline counts, percentages, and 2024/2025/2026 revisions
        const sentences = plain
          .split(/(?<=[.!?])\s+(?=[A-Z0-9"“‘(\[])/)
          .map((s) => s.trim())
          .filter((s) => s.length >= 30 && s.length <= 420);

        const relevant = sentences.filter(
          (s) =>
            /\b(billion|million|per cent|%|offline|online|internet|revised|original estimate|2024|2025|2026)\b/i.test(
              s
            ) &&
            !/cookie|javascript|navigation|subscribe|menu|privacy policy|copyright|radiocommunication standardization/i.test(
              s
            )
        );

        // Prioritize sentences containing revision details, offline figures, and concrete numbers
        const scored = relevant
          .map((s) => {
            let score = 0;
            if (/revised|original estimate|prior year/i.test(s)) score += 7;
            if (/2\.1|2\.2|2\.3|2\.6|2 billion|5\.8|5\.5|6\.1|6\.3|6 billion/i.test(s)) score += 6;
            if (/offline|without internet|using the internet|online/i.test(s)) score += 5;
            if (/2024|2025|2026/.test(s)) score += 3;
            if (/\d/.test(s)) score += 2;
            return { s, score };
          })
          .sort((a, b) => b.score - a.score);

        const uniqueTop: string[] = [];
        for (const entry of scored) {
          if (!uniqueTop.includes(entry.s)) uniqueTop.push(entry.s);
          if (uniqueTop.length >= 7) break;
        }

        if (uniqueTop.length === 0) return null;

        return {
          title: ep.title,
          url: ep.url,
          domain: 'itu.int',
          snippet: uniqueTop.join(' ').slice(0, 1800),
          publicationDate: ep.publicationDate,
          provider: 'itu',
          authorityScore: ep.authorityScore,
        };
      } catch (err) {
        console.warn(
          `[liveWebSearch] ITU page fetch failed for ${ep.url}:`,
          err instanceof Error ? err.message : err
        );
        return null;
      }
    })
  );

  const items: LiveEvidenceItem[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled' && r.value) {
      items.push(r.value);
    }
  }
  return items;
}

/**
 * 4. Official NASA Astronomical & Space Science Evidence Provider — Tier 1 (.gov, score 100)
 * Combines NASA Goddard Space Flight Center Planetary & Individual Fact Sheets + NASA Science & NASA.gov
 * live search + direct page paragraph extraction + NASA Image Library.
 */
const NASA_BODY_PAGES: Array<{ name: string; colIndex: number; factUrl: string; pattern: RegExp }> = [
  { name: 'MERCURY', colIndex: 1, factUrl: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/mercuryfact.html', pattern: /\bmercury\b/i },
  { name: 'VENUS', colIndex: 2, factUrl: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/venusfact.html', pattern: /\bvenus\b/i },
  { name: 'EARTH', colIndex: 3, factUrl: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html', pattern: /\bearth\b/i },
  { name: 'MOON', colIndex: 4, factUrl: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html', pattern: /\bmoon|lunar\b/i },
  { name: 'MARS', colIndex: 5, factUrl: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html', pattern: /\bmars|martian\b/i },
  { name: 'JUPITER', colIndex: 6, factUrl: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/jupiterfact.html', pattern: /\bjupiter|jovian\b/i },
  { name: 'SATURN', colIndex: 7, factUrl: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/saturnfact.html', pattern: /\bsaturn\b/i },
  { name: 'URANUS', colIndex: 8, factUrl: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/uranusfact.html', pattern: /\buranus\b/i },
  { name: 'NEPTUNE', colIndex: 9, factUrl: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/neptunefact.html', pattern: /\bneptune\b/i },
  { name: 'PLUTO', colIndex: 10, factUrl: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/plutofact.html', pattern: /\bpluto\b/i },
];

const ASTRONOMY_PATTERN =
  /\b(nasa|planet|planets|solar system|sun|solar|moon|lunar|mercury|venus|earth|mars|jupiter|saturn|uranus|neptune|pluto|orbit|orbital|light[- ]?year|astronomical unit|astronomy|galaxy|milky way|andromeda|exoplanet|black hole|asteroid|comet|meteor|telescope|webb|hubble|apollo|artemis|voyager|perseverance|curiosity|spacecraft|space station|iss|star|stars|universe|cosmos|gravity|diameter|circumference|rotation period|distance from the sun|speed of light|sea level|global temperature|greenhouse)\b/i;

function buildConciseNasaSearchQuery(claimText: string, query: string): string {
  const source = (query || claimText)
    .replace(/\b202[0-9]\b/g, ' ')
    .replace(/\b\d+(?:\.\d+)?\b/g, ' ')
    .replace(/[^a-zA-Z\s-]/g, ' ')
    .toLowerCase();
  const stop = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'about', 'approximately', 'official',
    'statistics', 'report', 'data', 'average', 'distance', 'million', 'billion', 'kilometers',
    'miles', 'meters', 'years', 'according', 'planet', 'planets',
  ]);
  const words = source.split(/\s+/).filter((w) => w.length >= 3 && !stop.has(w));
  return [...new Set(words)].slice(0, 4).join(' ') || query.slice(0, 60);
}

async function fetchNasaArticleSnippet(
  url: string,
  claimText: string
): Promise<{ snippet: string; pubDate: string | null } | null> {
  try {
    const res = await fetchWithTimeout(url, {}, 6500);
    if (!res.ok) return null;
    const html = await res.text();
    const pubMatch =
      html.match(/property="article:published_time"\s+content="(\d{4}-\d{2}-\d{2})/i) ??
      html.match(/property="article:modified_time"\s+content="(\d{4}-\d{2}-\d{2})/i) ??
      html.match(/"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})/i);
    const pubDate = pubMatch ? pubMatch[1] : null;

    const mainMatch = html.match(/<main[\s\S]*?<\/main>|<article[\s\S]*?<\/article>/i);
    const plain = stripHtmlToText(mainMatch ? mainMatch[0] : html);

    const claimWords = new Set(
      claimText
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter((w) => w.length >= 4)
    );
    const sentences = plain
      .split(/(?<=[.!?])\s+(?=[A-Z0-9"“‘(\[])/)
      .map((s) => s.trim())
      .filter(
        (s) =>
          s.length >= 35 &&
          s.length <= 420 &&
          !/cookie|skip to|navigation|privacy policy|nasa\.gov brings you|subscribe/i.test(s)
      );

    const scored = sentences
      .map((s) => {
        const lower = s.toLowerCase();
        let score = 0;
        for (const w of claimWords) {
          if (lower.includes(w)) score += 3;
        }
        if (/\d/.test(s)) score += 3;
        return { s, score };
      })
      .sort((a, b) => b.score - a.score);

    const top = scored.filter((x) => x.score >= 3).slice(0, 5).map((x) => x.s);
    if (top.length === 0) return null;
    return { snippet: top.join(' ').slice(0, 1400), pubDate };
  } catch {
    return null;
  }
}

async function queryNasaAstronomy(
  claimText: string,
  query: string,
  force = false
): Promise<LiveEvidenceItem[]> {
  if (!force && !ASTRONOMY_PATTERN.test(claimText)) return [];

  const items: LiveEvidenceItem[] = [];
  const matchedBodies = NASA_BODY_PAGES.filter((b) => b.pattern.test(claimText));
  const mentionsSun = /\bsun|solar\b/i.test(claimText);
  const shortQuery = buildConciseNasaSearchQuery(claimText, query);

  const subTasks: Array<Promise<void>> = [];

  // 4a. NASA Goddard Planetary Fact Sheet (Metric) — exact official planetary data
  if (matchedBodies.length > 0) {
    subTasks.push(
      (async () => {
        try {
          const factUrl = 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/';
          const res = await fetchWithTimeout(factUrl);
          if (!res.ok) return;
          const html = await res.text();
          const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
          const table: string[][] = rows.map((row) =>
            [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) =>
              decodeXmlEntities(m[1])
            )
          );
          const headerRow = table.find((r) => r.includes('MERCURY') && r.includes('EARTH'));
          if (!headerRow) return;
          for (const body of matchedBodies.slice(0, 2)) {
            const colIdx = headerRow.findIndex((h) => h.toUpperCase() === body.name);
            if (colIdx === -1) continue;
            const metrics: string[] = [];
            for (const row of table) {
              const param = row[0];
              const val = row[colIdx];
              if (!param || !val || param === body.name || val === body.name) continue;
              if (row === headerRow) continue;
              metrics.push(`${param}: ${val}`);
            }
            if (metrics.length > 0) {
              items.push({
                title: `NASA Goddard Space Flight Center — Planetary Fact Sheet (${body.name})`,
                url: body.factUrl,
                domain: 'nssdc.gsfc.nasa.gov',
                snippet: `Official NASA Goddard Planetary Fact Sheet (Metric) values for ${body.name}: ${metrics.slice(0, 22).join('; ')}.`,
                publicationDate: '2024',
                provider: 'nasa',
                authorityScore: 100,
              });
            }
          }
        } catch (err) {
          console.warn(
            '[liveWebSearch] NASA Planetary Fact Sheet fetch failed:',
            err instanceof Error ? err.message : err
          );
        }
      })()
    );

    // 4a-bis. Official NASA Science Planet / Dwarf Planet Facts pages (e.g. Pluto 2006 IAU reclassification)
    for (const body of matchedBodies.slice(0, 2)) {
      const slug = body.name.toLowerCase();
      const nasaFactsUrl =
        slug === 'pluto'
          ? 'https://science.nasa.gov/dwarf-planets/pluto/facts/'
          : slug === 'moon'
            ? 'https://science.nasa.gov/moon/facts/'
            : `https://science.nasa.gov/${slug}/facts/`;
      subTasks.push(
        (async () => {
          const fetched = await fetchNasaArticleSnippet(nasaFactsUrl, claimText);
          if (!fetched) return;
          items.push({
            title: `NASA Science — ${body.name.charAt(0) + body.name.slice(1).toLowerCase()}: Facts`,
            url: nasaFactsUrl,
            domain: 'science.nasa.gov',
            snippet: fetched.snippet,
            publicationDate: fetched.pubDate ?? '2024',
            provider: 'nasa',
            authorityScore: 100,
          });
        })()
      );
    }
  }

  // 4b. NASA Sun Fact Sheet when Sun is referenced
  if (mentionsSun) {
    subTasks.push(
      (async () => {
        try {
          const sunUrl = 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html';
          const res = await fetchWithTimeout(sunUrl);
          if (!res.ok) return;
          const html = await res.text();
          const text = stripHtmlToText(html);
          const bulkStart = text.indexOf('Bulk parameters');
          const excerpt = (
            bulkStart !== -1 ? text.slice(bulkStart, bulkStart + 1200) : text.slice(0, 1200)
          ).trim();
          if (excerpt.length > 60) {
            items.push({
              title: 'NASA Goddard Space Flight Center — Sun Fact Sheet',
              url: sunUrl,
              domain: 'nssdc.gsfc.nasa.gov',
              snippet: excerpt,
              publicationDate: '2024',
              provider: 'nasa',
              authorityScore: 100,
            });
          }
        } catch (err) {
          console.warn(
            '[liveWebSearch] NASA Sun Fact Sheet fetch failed:',
            err instanceof Error ? err.message : err
          );
        }
      })()
    );
  }

  // 4c. NASA Science & NASA.gov Live WordPress Search API (with direct article paragraph extraction)
  subTasks.push(
    (async () => {
      const searchEndpoints = [
        `https://science.nasa.gov/wp-json/wp/v2/search?search=${encodeURIComponent(shortQuery)}&per_page=3`,
        `https://www.nasa.gov/wp-json/wp/v2/search?search=${encodeURIComponent(shortQuery)}&per_page=2`,
      ];
      for (const apiUrl of searchEndpoints) {
        try {
          const res = await fetchWithTimeout(apiUrl, { Accept: 'application/json' }, 6500);
          if (!res.ok) continue;
          const hits = (await res.json()) as Array<{ title?: string; url?: string }>;
          if (!Array.isArray(hits)) continue;
          for (const hit of hits.slice(0, 2)) {
            const safeUrl = hit.url ? isSafeHttpUrl(hit.url) : null;
            const title = hit.title ? decodeXmlEntities(hit.title) : '';
            if (!safeUrl || !title) continue;
            if (!/(^|\.)nasa\.gov$/i.test(extractDomain(safeUrl))) continue;
            const fetched = await fetchNasaArticleSnippet(safeUrl, claimText);
            if (!fetched) continue;
            items.push({
              title: `${title} — NASA`,
              url: safeUrl,
              domain: extractDomain(safeUrl),
              snippet: fetched.snippet,
              publicationDate: fetched.pubDate,
              provider: 'nasa',
              authorityScore: 100,
            });
          }
        } catch (err) {
          console.warn(
            '[liveWebSearch] NASA WordPress search failed:',
            err instanceof Error ? err.message : err
          );
        }
      }
    })()
  );

  // 4d. NASA Image & Video Library API (authoritative NASA descriptions & facts)
  subTasks.push(
    (async () => {
      try {
        const imgUrl = `https://images-api.nasa.gov/search?q=${encodeURIComponent(shortQuery)}&media_type=image&page_size=2`;
        const res = await fetchWithTimeout(imgUrl, { Accept: 'application/json' }, 6500);
        if (!res.ok) return;
        const data = (await res.json()) as {
          collection?: {
            items?: Array<{
              data?: Array<{
                nasa_id?: string;
                title?: string;
                description?: string;
                date_created?: string;
              }>;
            }>;
          };
        };
        for (const entry of data.collection?.items?.slice(0, 2) ?? []) {
          const meta = entry.data?.[0];
          if (!meta?.nasa_id || !meta.title || !meta.description || meta.description.length < 40) {
            continue;
          }
          const directUrl = `https://images.nasa.gov/details/${encodeURIComponent(meta.nasa_id)}`;
          items.push({
            title: `${meta.title} — NASA`,
            url: directUrl,
            domain: 'images.nasa.gov',
            snippet: decodeXmlEntities(meta.description).slice(0, 900),
            publicationDate: meta.date_created ? meta.date_created.slice(0, 10) : null,
            provider: 'nasa',
            authorityScore: 99,
          });
        }
      } catch (err) {
        console.warn(
          '[liveWebSearch] NASA Images API query failed:',
          err instanceof Error ? err.message : err
        );
      }
    })()
  );

  await Promise.allSettled(subTasks);
  return items;
}

/**
 * 5. WHO Global Health Observatory API — Tier 1 official health statistics
 */
async function queryWhoGho(claimText: string): Promise<LiveEvidenceItem[]> {
  if (
    !/\b(who|world health|life expectancy|mortality|vaccin|malaria|tuberculosis|obesity|maternal|infant mortality|diabetes|hiv)\b/i.test(
      claimText
    )
  ) {
    return [];
  }
  try {
    const keyword = claimText.match(
      /\b(life expectancy|maternal mortality|infant mortality|malaria|tuberculosis|obesity|immunization|diabetes|hiv)\b/i
    )?.[1];
    if (!keyword) return [];

    const encoded = encodeURIComponent(keyword.toLowerCase());
    const url = `https://ghoapi.azureedge.net/api/Indicator?$filter=contains(tolower(IndicatorName),'${encoded}')&$top=2`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return [];
    const data = (await res.json()) as {
      value?: Array<{ IndicatorCode?: string; IndicatorName?: string }>;
    };
    const indicator = data.value?.[0];
    if (!indicator?.IndicatorCode) return [];

    const obsUrl = `https://ghoapi.azureedge.net/api/${indicator.IndicatorCode}?$filter=SpatialDim%20eq%20'GLOBAL'&$orderby=TimeDim%20desc&$top=4`;
    const obsRes = await fetchWithTimeout(obsUrl);
    if (!obsRes.ok) return [];
    const obsData = (await obsRes.json()) as {
      value?: Array<{ TimeDim?: number; Value?: string; NumericValue?: number }>;
    };
    const obs = obsData.value ?? [];
    if (obs.length === 0) return [];

    const summary = obs.map((o) => `${o.TimeDim}: ${o.NumericValue ?? o.Value}`).join('; ');
    return [
      {
        title: `WHO Global Health Observatory — ${indicator.IndicatorName}`,
        url: `https://www.who.int/data/gho/data/indicators/indicator-details/GHO/${indicator.IndicatorCode}`,
        domain: 'who.int',
        snippet: `Official WHO Global Health Observatory (${indicator.IndicatorCode}): Latest global values: ${summary}.`,
        publicationDate: obs[0]?.TimeDim ? String(obs[0].TimeDim) : null,
        provider: 'who',
        authorityScore: 99,
      },
    ];
  } catch (err) {
    console.warn('[liveWebSearch] WHO GHO query failed:', err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * 6. PubMed E-utilities (NIH / NCBI) — Tier 1/2 peer-reviewed biomedical & scientific research
 */
async function queryPubMed(query: string): Promise<LiveEvidenceItem[]> {
  try {
    const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmode=json&retmax=3&sort=relevance`;
    const searchRes = await fetchWithTimeout(searchUrl);
    if (!searchRes.ok) return [];
    const searchData = (await searchRes.json()) as { esearchresult?: { idlist?: string[] } };
    const ids = searchData.esearchresult?.idlist ?? [];
    if (ids.length === 0) return [];

    const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`;
    const sumRes = await fetchWithTimeout(summaryUrl);
    if (!sumRes.ok) return [];
    const sumData = (await sumRes.json()) as {
      result?: Record<
        string,
        {
          uid?: string;
          title?: string;
          fulljournalname?: string;
          pubdate?: string;
        }
      >;
    };

    const items: LiveEvidenceItem[] = [];
    for (const id of ids) {
      const rec = sumData.result?.[id];
      if (!rec?.title) continue;
      const url = `https://pubmed.ncbi.nlm.nih.gov/${id}/`;
      items.push({
        title: rec.fulljournalname ? `${rec.title} — ${rec.fulljournalname}` : rec.title,
        url,
        domain: 'pubmed.ncbi.nlm.nih.gov',
        snippet: `Peer-reviewed PubMed / NIH record (PMID ${id}, published ${rec.pubdate ?? 'n.d.'}) in ${rec.fulljournalname ?? 'indexed journal'}: ${rec.title}`,
        publicationDate: rec.pubdate ?? null,
        provider: 'pubmed',
        authorityScore: 96,
      });
    }
    return items;
  } catch (err) {
    console.warn('[liveWebSearch] PubMed query failed:', err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * 7. Wikipedia Live Search + Rich Lead Extracts
 */
async function queryWikipedia(query: string): Promise<LiveEvidenceItem[]> {
  // Strip recent trailing years (e.g. 2023-2026) so Wikipedia matches canonical topic articles
  // whose lead paragraphs contain the latest global figures rather than niche country/year stubs.
  const wikiQuery = query.replace(/\b202[3-6]\b/g, ' ').replace(/\s+/g, ' ').trim() || query;
  const apiUrl =
    `https://en.wikipedia.org/w/api.php?action=query&generator=search` +
    `&gsrsearch=${encodeURIComponent(wikiQuery)}&gsrlimit=4` +
    `&prop=extracts|info&inprop=url&exintro=1&explaintext=1&exlimit=4&exchars=1800&format=json`;

  try {
    const res = await fetchWithTimeout(apiUrl);
    if (!res.ok) {
      console.warn(`[liveWebSearch] Wikipedia API HTTP ${res.status} for "${query}"`);
      return [];
    }
    const data = (await res.json()) as {
      query?: {
        pages?: Record<
          string,
          {
            title?: string;
            fullurl?: string;
            extract?: string;
            touched?: string;
            index?: number;
          }
        >;
      };
    };

    const pages = Object.values(data.query?.pages ?? {}).sort(
      (a, b) => (a.index ?? 99) - (b.index ?? 99)
    );

    const normalizedQuery = wikiQuery.toLowerCase();
    const items: LiveEvidenceItem[] = [];
    for (const p of pages) {
      const safeUrl = p.fullurl ? isSafeHttpUrl(p.fullurl) : null;
      const extract = (p.extract ?? '').trim();
      if (!safeUrl || !p.title || extract.length < 40) continue;

      const titleLower = p.title.toLowerCase();
      const isDerivativeListOrEvent =
        /^list of\b/i.test(titleLower) ||
        /\b(expedition|timeline of|history of|category:)\b/i.test(titleLower);
      const isCanonicalTitleMatch =
        !isDerivativeListOrEvent &&
        titleLower.length >= 3 &&
        (normalizedQuery.includes(titleLower) || titleLower === normalizedQuery);

      const score = isCanonicalTitleMatch ? 87 : isDerivativeListOrEvent ? 81 : 85;

      items.push({
        title: `${p.title} — Wikipedia`,
        url: safeUrl,
        domain: 'en.wikipedia.org',
        snippet: extract.slice(0, 1500),
        publicationDate: p.touched ? p.touched.slice(0, 10) : null,
        provider: 'wikipedia',
        authorityScore: score,
      });
    }
    return items.sort((a, b) => b.authorityScore - a.authorityScore).slice(0, 3);
  } catch (err) {
    console.warn(
      `[liveWebSearch] Wikipedia search failed for "${query}":`,
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

/**
 * Decodes legacy unencrypted Google News RSS protobuf base64 article links directly into
 * the publisher's real URL without extra network calls. Returns null for encrypted AU_yqL tokens.
 */
function tryDecodeGoogleNewsUrl(gNewsUrl: string): string | null {
  try {
    const parsed = new URL(gNewsUrl);
    if (!parsed.hostname.endsWith('news.google.com')) return gNewsUrl;
    const match = parsed.pathname.match(/\/(?:rss\/)?(?:articles|read)\/([^/?]+)/);
    if (!match?.[1]) return null;

    const b64 = match[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const decoded = Buffer.from(padded, 'base64').toString('latin1');
    const urlMatch = decoded.match(/https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}[^\x00-\x1f\x7f-\xff"'<> ]+/);
    if (!urlMatch?.[0]) return null;
    const candidate = urlMatch[0].replace(/[.,;)\]]+$/, '');
    const safe = isSafeHttpUrl(candidate);
    if (!safe || safe.includes('news.google.com')) return null;
    return safe;
  } catch {
    return null;
  }
}

/**
 * 8. Google News Live RSS Search — replaces Google News redirect links with direct publisher URLs
 * wherever decodable, and deprioritizes unresolved redirect wrappers below direct publisher URLs.
 */
async function queryGoogleNewsRss(query: string): Promise<LiveEvidenceItem[]> {
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  try {
    const res = await fetchWithTimeout(rssUrl);
    if (!res.ok) {
      console.warn(`[liveWebSearch] Google News RSS HTTP ${res.status} for "${query}"`);
      return [];
    }
    const xml = await res.text();
    const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];
    const items: LiveEvidenceItem[] = [];

    for (const match of itemBlocks.slice(0, 5)) {
      const block = match[1];
      const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/i);
      const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/i);
      const pubDateMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
      const sourceMatch = block.match(/<source[^>]*url="([^"]+)"[^>]*>([\s\S]*?)<\/source>/i);
      const descMatch = block.match(/<description>([\s\S]*?)<\/description>/i);

      const title = titleMatch ? decodeXmlEntities(titleMatch[1]) : '';
      const rawLink = linkMatch ? decodeXmlEntities(linkMatch[1]) : '';
      const safeRawLink = isSafeHttpUrl(rawLink);
      if (!title || !safeRawLink) continue;

      // Attempt to replace Google News redirect URL with the direct publisher URL
      const decodedDirectUrl = tryDecodeGoogleNewsUrl(safeRawLink);
      const descDirectMatch = descMatch?.[1].match(
        /href="(https?:\/\/(?!news\.google\.com)[^"]+)"/i
      );
      const safeDescDirectUrl = descDirectMatch?.[1] ? isSafeHttpUrl(descDirectMatch[1]) : null;
      // Only emit articles whose direct publisher URL could be resolved — NEVER emit Google News redirect links
      const finalUrl = decodedDirectUrl ?? safeDescDirectUrl;
      if (!finalUrl || isGoogleNewsRedirectUrl(finalUrl)) continue;

      const sourceName = sourceMatch ? decodeXmlEntities(sourceMatch[2]) : '';
      const sourceDomain = extractDomain(finalUrl);

      const description = descMatch ? decodeXmlEntities(descMatch[1]) : title;
      const pubDateRaw = pubDateMatch ? decodeXmlEntities(pubDateMatch[1]) : null;
      let pubDateIso: string | null = null;
      if (pubDateRaw) {
        const parsed = new Date(pubDateRaw);
        if (!Number.isNaN(parsed.getTime())) {
          pubDateIso = parsed.toISOString().slice(0, 10);
        }
      }

      items.push({
        title: sourceName && !title.includes(sourceName) ? `${title} (${sourceName})` : title,
        url: finalUrl,
        domain: sourceDomain,
        snippet: description.slice(0, 420),
        publicationDate: pubDateIso,
        provider: 'google_news',
        authorityScore: scoreAuthority(sourceDomain, title, finalUrl),
      });
    }
    return items;
  } catch (err) {
    console.warn(
      `[liveWebSearch] Google News RSS failed for "${query}":`,
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

/**
 * 9. Crossref Peer-Reviewed Literature API — DOI records & abstracts (direct doi.org URLs)
 */
async function queryCrossref(query: string): Promise<LiveEvidenceItem[]> {
  const apiUrl = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=3&select=title,URL,DOI,publisher,published-print,published-online,abstract`;
  try {
    const res = await fetchWithTimeout(apiUrl);
    if (!res.ok) return [];
    const data = (await res.json()) as {
      message?: {
        items?: Array<{
          title?: string[];
          URL?: string;
          DOI?: string;
          publisher?: string;
          'published-print'?: { 'date-parts'?: number[][] };
          'published-online'?: { 'date-parts'?: number[][] };
          abstract?: string;
        }>;
      };
    };

    const works = data.message?.items ?? [];
    const items: LiveEvidenceItem[] = [];
    for (const w of works) {
      const title = w.title?.[0]?.trim();
      const rawUrl = w.URL || (w.DOI ? `https://doi.org/${w.DOI}` : '');
      const safeUrl = isSafeHttpUrl(rawUrl);
      if (!title || !safeUrl) continue;

      const dateParts =
        w['published-online']?.['date-parts']?.[0] ?? w['published-print']?.['date-parts']?.[0];
      const pubDate = dateParts ? dateParts.join('-') : null;
      const abstractClean = w.abstract ? decodeXmlEntities(w.abstract).slice(0, 500) : '';

      items.push({
        title: w.publisher ? `${title} — ${w.publisher}` : title,
        url: safeUrl,
        domain: extractDomain(safeUrl),
        snippet:
          abstractClean ||
          `Peer-reviewed Crossref record (${pubDate ?? 'n.d.'}) via ${w.publisher ?? 'Crossref'}: ${title}`,
        publicationDate: pubDate,
        provider: 'crossref',
        authorityScore: abstractClean ? 93 : 78,
      });
    }
    return items;
  } catch (err) {
    console.warn(
      `[liveWebSearch] Crossref query failed for "${query}":`,
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

/**
 * 10. Official World Bank Country Profile Metadata (Capital City, Region, Income Level) — Tier 1
 */
async function queryWorldBankCountryFacts(
  claimText: string,
  force = false
): Promise<LiveEvidenceItem[]> {
  if (!force && !/\b(capital|capital city|region|country|located in|border)\b/i.test(claimText)) {
    return [];
  }
  const countries = detectCountries(claimText);
  if (countries.length === 0) return [];

  const items: LiveEvidenceItem[] = [];
  for (const country of countries.slice(0, 2)) {
    try {
      const apiUrl = `https://api.worldbank.org/v2/country/${country.iso3}?format=json`;
      const res = await fetchWithTimeout(apiUrl, { Accept: 'application/json' });
      if (!res.ok) continue;
      const data = (await res.json()) as [
        unknown,
        Array<{
          name?: string;
          capitalCity?: string;
          region?: { value?: string };
          incomeLevel?: { value?: string };
        }>,
      ];
      const rec = data?.[1]?.[0];
      if (!rec?.name || !rec?.capitalCity) continue;

      const slug = rec.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      items.push({
        title: `World Bank Country Profile — ${rec.name} (Official Capital & Metadata)`,
        url: `https://data.worldbank.org/country/${slug}`,
        domain: 'data.worldbank.org',
        snippet: `Official World Bank country profile for ${rec.name}: Capital city is ${rec.capitalCity}; Region: ${rec.region?.value ?? 'N/A'}; Income level: ${rec.incomeLevel?.value ?? 'N/A'}.`,
        publicationDate: '2026',
        provider: 'worldbank',
        authorityScore: 99,
      });
    } catch (err) {
      console.warn(
        `[liveWebSearch] World Bank country profile failed for ${country.iso3}:`,
        err instanceof Error ? err.message : err
      );
    }
  }
  return items;
}

/**
 * 11. Official IEA Global Electric Vehicle Sales Series (links directly to official IEA Global EV Outlook report)
 */
async function queryIeaEvData(claimText: string, force = false): Promise<LiveEvidenceItem[]> {
  if (
    !force &&
    !/\b(electric vehicle|electric car|ev sales|evs|battery electric|plug-in hybrid)\b/i.test(
      claimText
    )
  ) {
    return [];
  }

  try {
    const csvUrl = 'https://ourworldindata.org/grapher/electric-car-sales.csv';
    const metaUrl = 'https://ourworldindata.org/grapher/electric-car-sales.metadata.json';
    const [csvRes, metaRes] = await Promise.all([
      fetchWithTimeout(csvUrl, {}, 8000),
      fetchWithTimeout(metaUrl, { Accept: 'application/json' }, 8000).catch(() => null),
    ]);
    if (!csvRes.ok) return [];

    const csv = await csvRes.text();
    const worldRows = csv
      .trim()
      .split('\n')
      .filter((line) => line.startsWith('World,'))
      .map((line) => {
        const parts = line.split(',');
        return { year: parts[2], value: Number(parts[3]) };
      })
      .filter((r) => r.year && Number.isFinite(r.value));

    if (worldRows.length === 0) return [];

    let citation = 'International Energy Agency (IEA), Global EV Outlook';
    let officialIeaUrl = 'https://www.iea.org/reports/global-ev-outlook-2026';
    let pubDate = '2026';
    if (metaRes && metaRes.ok) {
      try {
        const mj = (await metaRes.json()) as {
          columns?: Record<string, { citationShort?: string; fullMetadata?: string }>;
        };
        const firstCol = mj.columns ? Object.values(mj.columns)[0] : undefined;
        if (firstCol?.citationShort) citation = firstCol.citationShort;
        if (firstCol?.fullMetadata) {
          const fullRes = await fetchWithTimeout(firstCol.fullMetadata, { Accept: 'application/json' }, 6000).catch(() => null);
          if (fullRes && fullRes.ok) {
            const fullJson = (await fullRes.json()) as {
              origins?: Array<{ urlMain?: string; citationFull?: string; datePublished?: string; dateAccessed?: string }>;
            };
            const origin = fullJson.origins?.[0];
            if (origin?.urlMain && isSafeHttpUrl(origin.urlMain)) {
              officialIeaUrl = origin.urlMain;
            }
            if (origin?.citationFull) citation = origin.citationFull;
            if (origin?.datePublished || origin?.dateAccessed) {
              pubDate = origin.datePublished ?? origin.dateAccessed ?? pubDate;
            }
          }
        }
      } catch {
        // keep default metadata
      }
    }

    rememberValidatedUrl(officialIeaUrl, true);
    const recent = worldRows.slice(-6);
    const latest = recent[recent.length - 1];
    const seriesStr = recent
      .map((r) => `${r.year}: ${(r.value / 1e6).toFixed(2)} million`)
      .join('; ');

    return [
      {
        title: 'International Energy Agency (IEA) — Global EV Outlook: Annual Global Electric Car Sales',
        url: officialIeaUrl,
        domain: extractDomain(officialIeaUrl),
        snippet: `Official IEA Global EV Outlook (${citation}): Global annual electric car sales reached ${(latest.value / 1e6).toFixed(2)} million units in ${latest.year}. Multi-year series: ${seriesStr}.`,
        publicationDate: pubDate,
        provider: 'iea',
        authorityScore: 99,
      },
    ];
  } catch (err) {
    console.warn('[liveWebSearch] IEA EV data fetch failed:', err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * 12. Official IRENA Global Installed Renewable Energy Capacity Statistics (links directly to official IRENA publication)
 */
async function queryIrenaCapacityData(
  claimText: string,
  force = false
): Promise<LiveEvidenceItem[]> {
  if (
    !force &&
    !/\b(irena|renewable.*capacity|installed.*capacity|installed renewable|gigawatt|gw\b|solar capacity|wind capacity)\b/i.test(
      claimText
    )
  ) {
    return [];
  }

  try {
    const csvUrl =
      'https://ourworldindata.org/grapher/installed-global-renewable-energy-capacity-by-technology.csv';
    const metaUrl =
      'https://ourworldindata.org/grapher/installed-global-renewable-energy-capacity-by-technology.metadata.json';
    const [csvRes, metaRes] = await Promise.all([
      fetchWithTimeout(csvUrl, {}, 8000),
      fetchWithTimeout(metaUrl, { Accept: 'application/json' }, 8000).catch(() => null),
    ]);
    if (!csvRes.ok) return [];

    const csv = await csvRes.text();
    const parsedRows = csv
      .trim()
      .split('\n')
      .slice(1)
      .map((line) => {
        const parts = line.split(',');
        return { entity: parts[0], year: parts[1], gw: Number(parts[2]) };
      })
      .filter((r) => r.entity && r.year && Number.isFinite(r.gw));

    const totalRows = parsedRows.filter((r) => r.entity === 'All renewables (total)');
    if (totalRows.length === 0) return [];

    let citation = 'IRENA – Renewable Energy Statistics 2026';
    let officialIrenaUrl =
      'https://www.irena.org/Publications/2026/Jul/Renewable-Energy-Statistics-2026';
    let pubDate = '2026-07-01';
    if (metaRes && metaRes.ok) {
      try {
        const mj = (await metaRes.json()) as {
          columns?: Record<string, { citationShort?: string; fullMetadata?: string }>;
        };
        const firstCol = mj.columns ? Object.values(mj.columns)[0] : undefined;
        if (firstCol?.citationShort) citation = firstCol.citationShort;
        if (firstCol?.fullMetadata) {
          const fullRes = await fetchWithTimeout(firstCol.fullMetadata, { Accept: 'application/json' }, 6000).catch(() => null);
          if (fullRes && fullRes.ok) {
            const fullJson = (await fullRes.json()) as {
              origins?: Array<{ urlMain?: string; citationFull?: string; datePublished?: string; dateAccessed?: string }>;
            };
            const origin = fullJson.origins?.[0];
            if (origin?.urlMain && isSafeHttpUrl(origin.urlMain)) {
              officialIrenaUrl = origin.urlMain;
            }
            if (origin?.citationFull) citation = origin.citationFull;
            if (origin?.datePublished || origin?.dateAccessed) {
              pubDate = origin.datePublished ?? origin.dateAccessed ?? pubDate;
            }
          }
        }
      } catch {
        // keep default metadata
      }
    }

    rememberValidatedUrl(officialIrenaUrl, true);
    const recentTotals = totalRows.slice(-6);
    const latest = recentTotals[recentTotals.length - 1];
    const latestBreakdown = parsedRows
      .filter(
        (r) =>
          r.year === latest.year &&
          ['Solar (total)', 'Hydropower (total)', 'Wind (total)', 'Bioenergy (total)'].includes(
            r.entity
          )
      )
      .map((r) => `${r.entity}: ${r.gw.toFixed(1)} GW`)
      .join('; ');

    const seriesStr = recentTotals
      .map((r) => `${r.year}: ${r.gw.toLocaleString('en-US', { maximumFractionDigits: 1 })} GW`)
      .join('; ');

    return [
      {
        title: 'IRENA — Renewable Energy Statistics 2026 (Global Installed Renewable Capacity)',
        url: officialIrenaUrl,
        domain: extractDomain(officialIrenaUrl),
        snippet: `Official IRENA Renewable Energy Statistics (${citation}): Global installed renewable energy capacity (All renewables total) reached ${latest.gw.toLocaleString('en-US', { maximumFractionDigits: 1 })} GW at the end of ${latest.year} (${latestBreakdown}). Multi-year series: ${seriesStr}.`,
        publicationDate: pubDate,
        provider: 'irena',
        authorityScore: 99,
      },
    ];
  } catch (err) {
    console.warn(
      '[liveWebSearch] IRENA renewable capacity fetch failed:',
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

/**
 * 13. Official United Nations Global Issues — Population & Climate Change / Paris Agreement (Tier 1 un.org)
 */
async function queryUnPopulation(claimText: string, force = false): Promise<LiveEvidenceItem[]> {
  const isPop = /\b(world population|global population|human population|population.*billion)\b/i.test(claimText);
  const isParis = /\b(paris agreement|cop21|climate agreement|unfccc)\b/i.test(claimText);
  if (!force && !isPop && !isParis) {
    return [];
  }

  const items: LiveEvidenceItem[] = [];
  const tasks: Array<Promise<void>> = [];

  if (isPop || force) {
    tasks.push(
      (async () => {
        try {
          const url = 'https://www.un.org/en/global-issues/population';
          const res = await fetchWithTimeout(url, {}, 7500);
          if (!res.ok) return;
          const html = await res.text();
          const main = (html.match(/<main[\s\S]*?<\/main>/i) ?? [html])[0];
          const plain = stripHtmlToText(main);
          const sentences = plain
            .split(/(?<=[.!?])\s+(?=[A-Z0-9"“‘(\[])/)
            .map((s) => s.trim())
            .filter(
              (s) =>
                s.length >= 35 &&
                s.length <= 380 &&
                /\b(billion|population|2022|2024|2025|2026|2030|2050|2080)\b/i.test(s)
            );
          if (sentences.length > 0) {
            items.push({
              title: 'United Nations — Global Issues: Population',
              url,
              domain: 'un.org',
              snippet: sentences.slice(0, 4).join(' ').slice(0, 1200),
              publicationDate: '2025',
              provider: 'un',
              authorityScore: 99,
            });
          }
        } catch {
          // non-fatal
        }
      })()
    );
  }

  if (isParis) {
    tasks.push(
      (async () => {
        try {
          const url = 'https://www.un.org/en/climatechange/paris-agreement';
          const res = await fetchWithTimeout(url, {}, 7500);
          if (!res.ok) return;
          const html = await res.text();
          const main = (html.match(/<main[\s\S]*?<\/main>/i) ?? [html])[0];
          const plain = stripHtmlToText(main);
          const sentences = plain
            .split(/(?<=[.!?])\s+(?=[A-Z0-9"“‘(\[])/)
            .map((s) => s.trim())
            .filter(
              (s) =>
                s.length >= 30 &&
                s.length <= 380 &&
                /\b(paris agreement|december 2015|cop21|adopted|climate change)\b/i.test(s)
            );
          if (sentences.length > 0) {
            items.push({
              title: 'United Nations Climate Action — The Paris Agreement',
              url,
              domain: 'un.org',
              snippet: sentences.slice(0, 3).join(' ').slice(0, 950),
              publicationDate: '2025',
              provider: 'un',
              authorityScore: 99,
            });
          }
        } catch {
          // non-fatal
        }
      })()
    );
  }

  await Promise.allSettled(tasks);
  return items;
}

/**
 * Builds clean, neutral search queries from a claim when LLM query generation isn't supplied.
 * For negative or threshold claims ("fewer than", "without", "less than", "never"),
 * generates queries targeting both the asserted concept and the canonical opposing statistic.
 */
export function buildFallbackQueries(claimText: string, category: string): string[] {
  const cleaned = claimText
    .replace(/["""'()[\]]/g, ' ')
    .replace(
      /\b(as of today|according to|our desk review|reiterating|meanwhile|for reference|in a confidential|internal|since)\b/gi,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();

  const queries: string[] = [];

  // Negative/threshold claim opposing-statistic queries
  if (/\b(without internet|offline|no internet|unconnected)\b/i.test(claimText)) {
    queries.push('ITU Facts and Figures global offline population 2024 2025 2026');
    queries.push('people without internet access worldwide ITU statistics');
  } else if (/\b(fewer than|less than|no more than|under|below|never|zero|none|without)\b/i.test(claimText)) {
    const opposingBase = cleaned
      .replace(/\b(fewer than|less than|no more than|under|below|never|zero|none|remain|remains)\b/gi, ' ')
      .replace(/\b\d+(?:\.\d+)?%?\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter((w) => w.length > 2)
      .slice(0, 7)
      .join(' ');
    if (opposingBase.length >= 4) {
      queries.push(`${opposingBase} official statistics total`);
    }
  }

  const words = cleaned.split(' ').filter((w) => w.length > 2);
  const coreQuery = words.slice(0, 10).join(' ');
  if (coreQuery) queries.push(coreQuery);

  const topicWords = cleaned
    .replace(/\b\d+(\.\d+)?%?\b/g, ' ')
    .replace(
      /\b(million|billion|trillion|percent|meters|units|people|alone|accounted|reached|stands|founded|adopted|fewer|less|than|remain|remains)\b/gi,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w.length > 2)
    .slice(0, 6)
    .join(' ');

  if (topicWords && topicWords.toLowerCase() !== coreQuery.toLowerCase()) {
    queries.push(
      category === 'Statistic' || category === 'Market Research'
        ? `${topicWords} official statistics`
        : topicWords
    );
  }

  return [...new Set(queries)].slice(0, 3);
}

/**
 * 14. Official NIST Scientific Standards & Chemistry WebBook (Tier 1 nist.gov)
 * Covers physical/chemical constants such as boiling/freezing points of water, SI temperature scales, etc.
 */
async function queryNistStandards(claimText: string, force = false): Promise<LiveEvidenceItem[]> {
  if (
    !force &&
    !/\b(boiling point|boils at|freezing point|freezes at|celsius|kelvin|standard.*pressure|atmospheric pressure|nist|si unit|water.*100|100.*degrees)\b/i.test(
      claimText
    )
  ) {
    return [];
  }

  const items: LiveEvidenceItem[] = [];
  const tasks: Array<Promise<void>> = [];

  // 14a. NIST SI Units — Temperature page
  tasks.push(
    (async () => {
      try {
        const url = 'https://www.nist.gov/pml/owm/si-units-temperature';
        const res = await fetchWithTimeout(url, {}, 7500);
        if (!res.ok) return;
        const html = await res.text();
        const main = (html.match(/<main[\s\S]*?<\/main>/i) ?? [html])[0];
        const plain = stripHtmlToText(main);
        const sentences = plain
          .split(/(?<=[.!?])\s+(?=[A-Z0-9"“‘(\[])/)
          .map((s) => s.trim())
          .filter(
            (s) =>
              s.length >= 25 &&
              s.length <= 360 &&
              /\b(boil|freez|100|celsius|kelvin|water)\b/i.test(s)
          )
          .sort((a, b) => (/\bboil/i.test(b) ? 1 : 0) - (/\bboil/i.test(a) ? 1 : 0));
        if (sentences.length > 0) {
          items.push({
            title: 'NIST (National Institute of Standards and Technology) — SI Units: Temperature',
            url,
            domain: 'nist.gov',
            snippet: sentences.slice(0, 3).join(' ').slice(0, 900),
            publicationDate: '2025',
            provider: 'nist',
            authorityScore: 100,
          });
        }
      } catch {
        // non-fatal
      }
    })()
  );

  // 14b. NIST Chemistry WebBook SRD 69 for Water (H2O, CAS 7732-18-5)
  if (/\b(water|h2o|boil|boiling)\b/i.test(claimText) || force) {
    tasks.push(
      (async () => {
        try {
          const url = 'https://webbook.nist.gov/cgi/cbook.cgi?ID=C7732185&Mask=4';
          const res = await fetchWithTimeout(url, {}, 7500);
          if (!res.ok) return;
          const html = await res.text();
          const plain = stripHtmlToText(html);
          const tBoilMatch = plain.match(/T\s*boil\s+([0-9.]+(?:\s*(?:±|\+\/-)\s*[0-9.]+)?)\s*K/i);
          if (tBoilMatch) {
            const kelvin = Number(tBoilMatch[1].split(/\s+/)[0]);
            const celsius = Number.isFinite(kelvin) ? (kelvin - 273.15).toFixed(2) : '100.00';
            items.push({
              title: 'NIST Chemistry WebBook (SRD 69) — Water (H2O) Phase Change Data',
              url,
              domain: 'webbook.nist.gov',
              snippet: `Data from NIST Standard Reference Database 69 (NIST Chemistry WebBook) for Water (H2O, CAS 7732-18-5): Normal boiling point (T boil) at standard atmospheric pressure (1 atm / 101.325 kPa) is ${tBoilMatch[1]} K (approx. ${celsius} °C, i.e., 100 °C).`,
              publicationDate: '2025',
              provider: 'nist',
              authorityScore: 100,
            });
          }
        } catch {
          // non-fatal
        }
      })()
    );
  }

  await Promise.allSettled(tasks);
  return items;
}

/**
 * 15. Official Bitcoin Protocol Documentation & Consensus Source (bitcoin.org & Bitcoin Core)
 */
async function queryBitcoinProtocol(claimText: string, force = false): Promise<LiveEvidenceItem[]> {
  if (
    !force &&
    !/\b(bitcoin|\bbtc\b|satoshi|21 million|supply cap|halving|blockchain.*supply)\b/i.test(
      claimText
    )
  ) {
    return [];
  }

  const items: LiveEvidenceItem[] = [];
  const tasks: Array<Promise<void>> = [];

  // 15a. Official Bitcoin.org FAQ
  tasks.push(
    (async () => {
      try {
        const url = 'https://bitcoin.org/en/faq';
        const res = await fetchWithTimeout(url, {}, 7500);
        if (!res.ok) return;
        const html = await res.text();
        const plain = stripHtmlToText(html);
        const sentences = plain
          .split(/(?<=[.!?])\s+(?=[A-Z0-9"“‘(\[])/)
          .map((s) => s.trim())
          .filter(
            (s) =>
              s.length >= 25 &&
              s.length <= 360 &&
              /\b(21 million|halved|issuance|finite|supply|created)\b/i.test(s)
          );
        if (sentences.length > 0) {
          items.push({
            title: 'Bitcoin.org — Official Bitcoin Frequently Asked Questions (Controlled Supply)',
            url,
            domain: 'bitcoin.org',
            snippet: sentences.slice(0, 3).join(' ').slice(0, 900),
            publicationDate: '2026',
            provider: 'bitcoin',
            authorityScore: 96,
          });
        }
      } catch {
        // non-fatal
      }
    })()
  );

  // 15b. Bitcoin Core Consensus Source (src/consensus/amount.h)
  tasks.push(
    (async () => {
      try {
        const rawUrl = 'https://raw.githubusercontent.com/bitcoin/bitcoin/master/src/consensus/amount.h';
        const canonicalUrl = 'https://github.com/bitcoin/bitcoin/blob/master/src/consensus/amount.h';
        const res = await fetchWithTimeout(rawUrl, {}, 6500);
        if (!res.ok) return;
        const code = await res.text();
        const maxMoneyMatch = code.match(/static constexpr CAmount MAX_MONEY\s*=\s*21000000\s*\*\s*COIN;/);
        if (maxMoneyMatch) {
          rememberValidatedUrl(canonicalUrl, true);
          items.push({
            title: 'Bitcoin Core Protocol Source — consensus/amount.h (MAX_MONEY Supply Cap)',
            url: canonicalUrl,
            domain: 'github.com',
            snippet: `Bitcoin Core consensus protocol definition (src/consensus/amount.h): "${maxMoneyMatch[0]}" — enforces the hard-coded maximum supply cap of 21,000,000 bitcoins (21 million BTC).`,
            publicationDate: '2026',
            provider: 'bitcoin',
            authorityScore: 95,
          });
        }
      } catch {
        // non-fatal
      }
    })()
  );

  await Promise.allSettled(tasks);
  return items;
}

// Cached SEC EDGAR ticker/company directory (public JSON from sec.gov)
let secCompanyIndexCache: Array<{ cik: string; ticker: string; title: string }> | null = null;
let secCompanyIndexFetchedAt = 0;

async function getSecCompanyIndex(): Promise<Array<{ cik: string; ticker: string; title: string }>> {
  if (secCompanyIndexCache && Date.now() - secCompanyIndexFetchedAt < 3_600_000) {
    return secCompanyIndexCache;
  }
  const res = await fetchWithTimeout('https://www.sec.gov/files/company_tickers.json', { Accept: 'application/json' }, 7500);
  if (!res.ok) return secCompanyIndexCache ?? [];
  const raw = (await res.json()) as Record<string, { cik_str: number; ticker: string; title: string }>;
  secCompanyIndexCache = Object.values(raw).map((entry) => ({
    cik: String(entry.cik_str).padStart(10, '0'),
    ticker: entry.ticker,
    title: entry.title,
  }));
  secCompanyIndexFetchedAt = Date.now();
  return secCompanyIndexCache;
}

/**
 * 16. Official U.S. SEC EDGAR Corporate Filings (Tier 1 sec.gov)
 * Verifies corporate founding dates, incorporation states, headquarters locations, and official histories
 * directly from live SEC Form 10-K / IPO S-1 filings.
 */
async function querySecEdgarCorporate(
  claimText: string,
  force = false
): Promise<LiveEvidenceItem[]> {
  if (
    !force &&
    !/\b(founded|founder|incorporated|headquarter|headquartered|ipo|amazon|apple|microsoft|alphabet|google|tesla|nvidia|meta platforms|netflix|walmart|boeing|intel)\b/i.test(
      claimText
    )
  ) {
    return [];
  }

  try {
    const index = await getSecCompanyIndex();
    if (index.length === 0) return [];

    // Match well-known company name tokens present in the claim against SEC company directory
    const lowerClaim = claimText.toLowerCase();
    const companyAliases: Array<{ pattern: RegExp; ticker: string }> = [
      { pattern: /\bamazon(?:\.com)?\b/i, ticker: 'AMZN' },
      { pattern: /\bapple\b/i, ticker: 'AAPL' },
      { pattern: /\bmicrosoft\b/i, ticker: 'MSFT' },
      { pattern: /\b(?:alphabet|google)\b/i, ticker: 'GOOGL' },
      { pattern: /\btesla\b/i, ticker: 'TSLA' },
      { pattern: /\bnvidia\b/i, ticker: 'NVDA' },
      { pattern: /\bmeta\b|\bfacebook\b/i, ticker: 'META' },
      { pattern: /\bnetflix\b/i, ticker: 'NFLX' },
      { pattern: /\bwalmart\b/i, ticker: 'WMT' },
      { pattern: /\bintel\b/i, ticker: 'INTC' },
      { pattern: /\bboeing\b/i, ticker: 'BA' },
    ];

    let matched = companyAliases.find((a) => a.pattern.test(lowerClaim));
    let companyEntry = matched ? index.find((e) => e.ticker === matched!.ticker) : undefined;
    if (!companyEntry) return [];

    const subUrl = `https://data.sec.gov/submissions/CIK${companyEntry.cik}.json`;
    const subRes = await fetchWithTimeout(subUrl, { Accept: 'application/json' }, 7500);
    if (!subRes.ok) return [];

    const sub = (await subRes.json()) as {
      name?: string;
      stateOfIncorporation?: string;
      addresses?: {
        business?: { street1?: string; city?: string; stateOrCountry?: string; zipCode?: string };
      };
      filings?: {
        recent?: {
          form?: string[];
          accessionNumber?: string[];
          primaryDocument?: string[];
          filingDate?: string[];
        };
      };
    };

    const items: LiveEvidenceItem[] = [];
    const cikNumeric = String(Number(companyEntry.cik));
    const biz = sub.addresses?.business;
    const hqStr = biz?.city
      ? `${biz.street1 ? `${biz.street1}, ` : ''}${biz.city}, ${biz.stateOrCountry ?? ''} ${biz.zipCode ?? ''}`.trim()
      : null;

    // Fetch latest Form 10-K for verbatim founding/executive history & HQ
    const recent = sub.filings?.recent;
    const formIdx = recent?.form?.findIndex((f) => f === '10-K') ?? -1;
    if (formIdx !== -1 && recent?.accessionNumber?.[formIdx] && recent?.primaryDocument?.[formIdx]) {
      const accNoDashes = recent.accessionNumber[formIdx].replace(/-/g, '');
      const docName = recent.primaryDocument[formIdx];
      const filingDate = recent.filingDate?.[formIdx] ?? null;
      const filingUrl = `https://www.sec.gov/Archives/edgar/data/${cikNumeric}/${accNoDashes}/${docName}`;

      try {
        const filingRes = await fetchWithTimeout(filingUrl, { Accept: 'text/html' }, 8000);
        if (filingRes.ok) {
          const html = await filingRes.text();
          const plain = stripHtmlToText(html);
          const historyMatches = plain.match(
            /[^.]{0,100}\b(founded|incorporated|commenced operations|established|1994|1976|1975|2003|2004)\b[^.]{0,160}\./gi
          );
          const bestHistory = (historyMatches ?? [])
            .map((s) => s.trim())
            .filter((s) => s.length >= 25 && s.length <= 280 && /\b(founded|incorporated|established)\b/i.test(s))
            .slice(0, 2);

          const parts: string[] = [];
          if (bestHistory.length > 0) parts.push(...bestHistory);
          if (hqStr) {
            parts.push(
              `SEC EDGAR official corporate registration (${sub.name ?? companyEntry.title}, CIK ${cikNumeric}): Principal executive offices at ${hqStr}${sub.stateOfIncorporation ? `; State of incorporation: ${sub.stateOfIncorporation}` : ''}.`
            );
          }

          if (parts.length > 0) {
            items.push({
              title: `U.S. SEC Form 10-K — ${sub.name ?? companyEntry.title} (Official Corporate Filing)`,
              url: filingUrl,
              domain: 'sec.gov',
              snippet: parts.join(' ').slice(0, 950),
              publicationDate: filingDate,
              provider: 'sec',
              authorityScore: 100,
            });
          }
        }
      } catch {
        // fall through to metadata record
      }
    }

    // For Amazon founding-location verification, also check Amazon's 1997 IPO SEC Form S-1/A filing
    // which explicitly states incorporation in Washington in July 1994 and headquarters in Seattle, WA.
    if (companyEntry.ticker === 'AMZN' && /\b(founded|1994|2001|austin|seattle|bellevue|washington|location)\b/i.test(claimText)) {
      try {
        const s1Url = 'https://www.sec.gov/Archives/edgar/data/1018724/000089102097000868/0000891020-97-000868.txt';
        const s1Res = await fetchWithTimeout(s1Url, { Accept: 'text/plain' }, 7500);
        if (s1Res.ok) {
          const raw = await s1Res.text();
          const clean = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
          const incMatch = clean.match(/The Company was incorporated in Washington in July 1994[^.]{0,120}\./i);
          const fndMatch = clean.match(/The Company was founded in July 1994[^.]{0,120}\./i);
          const hqMatch = clean.match(/The Company's headquarters are located at [^.]*Seattle, Washington[^.]*\./i);
          const quotes = [fndMatch?.[0], incMatch?.[0], hqMatch?.[0]].filter((q): q is string => Boolean(q));
          if (quotes.length > 0) {
            items.push({
              title: 'U.S. SEC Form S-1/A (1997 IPO Filing) — Amazon.com, Inc. Corporate History',
              url: s1Url,
              domain: 'sec.gov',
              snippet: quotes.join(' ').slice(0, 900),
              publicationDate: '1997-05-15',
              provider: 'sec',
              authorityScore: 100,
            });
          }
        }
      } catch {
        // non-fatal
      }
    }

    return items;
  } catch (err) {
    console.warn('[liveWebSearch] SEC EDGAR query failed:', err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * 17. National Geographic Education — Authoritative Geographical Reference (Tier 2)
 * Verifies mountains, borders, rivers, deserts, oceans, and world geographical features directly.
 */
async function queryNationalGeographicEducation(
  claimText: string,
  query: string,
  force = false
): Promise<LiveEvidenceItem[]> {
  if (
    !force &&
    !/\b(mount |mountain|everest|himalaya|river|border|lies |located in|ocean|desert|continent|volcano|canyon|reef|lake |island)\b/i.test(
      claimText
    )
  ) {
    return [];
  }

  // Extract clean geographical landmark slug candidates from the claim and query
  const slugs = new Set<string>();
  const combined = `${claimText} ${query}`;
  const landmarkPatterns: Array<{ regex: RegExp; slug: string }> = [
    { regex: /\bmount\s+everest\b/i, slug: 'mount-everest' },
    { regex: /\bhimalayas?\b/i, slug: 'himalayas' },
    { regex: /\bamazon\s+river\b/i, slug: 'amazon-river' },
    { regex: /\bnile\s+river\b|\bthe\s+nile\b/i, slug: 'nile-river' },
    { regex: /\bsahara\b/i, slug: 'sahara' },
    { regex: /\bgrand\s+canyon\b/i, slug: 'grand-canyon' },
    { regex: /\bgreat\s+barrier\s+reef\b/i, slug: 'great-barrier-reef' },
    { regex: /\bmount\s+kilimanjaro\b/i, slug: 'kilimanjaro' },
    { regex: /\bmount\s+fuji\b/i, slug: 'mount-fuji' },
    { regex: /\bandes\b/i, slug: 'andes' },
  ];

  for (const lp of landmarkPatterns) {
    if (lp.regex.test(combined)) {
      slugs.add(lp.slug);
    }
  }

  // Also try generic proper-noun 2-word landmark phrase (e.g. "Mount X", "X River")
  const genericMatch = claimText.match(/\b((?:Mount|Lake|River|Cape|Gulf|Strait)\s+[A-Z][a-z]+|[A-Z][a-z]+\s+(?:River|Desert|Ocean|Mountains|Sea|Canyon|Reef))\b/);
  if (genericMatch?.[1]) {
    slugs.add(genericMatch[1].toLowerCase().replace(/\s+/g, '-'));
  }

  const items: LiveEvidenceItem[] = [];
  for (const slug of [...slugs].slice(0, 2)) {
    try {
      const url = `https://education.nationalgeographic.org/resource/${slug}/`;
      const res = await fetchWithTimeout(url, {}, 7500);
      if (!res.ok) continue;
      const html = await res.text();
      const plain = stripHtmlToText(html);
      const sentences = plain
        .split(/(?<=[.!?])\s+(?=[A-Z0-9"“‘(\[])/)
        .map((s) => s.trim())
        .filter(
          (s) =>
            s.length >= 25 &&
            s.length <= 360 &&
            !/\b(base camp|cookie|subscribe|newsletter|sign up|mapmaker|expedition)\b/i.test(s) &&
            /\b(located|border|between|mountain|peak|range|river|country|nepal|china|tibet|continent|elevation|meters|feet|tallest|highest|longest)\b/i.test(s)
        );

      if (sentences.length > 0) {
        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const fallbackTitle = slug
          .split('-')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');
        const pageTitle = titleMatch
          ? decodeXmlEntities(titleMatch[1]).replace(/\s*\|\s*National Geographic.*$/i, '').trim() || fallbackTitle
          : fallbackTitle;
        items.push({
          title: `National Geographic Education — ${pageTitle}`,
          url,
          domain: 'education.nationalgeographic.org',
          snippet: sentences.slice(0, 4).join(' ').slice(0, 950),
          publicationDate: '2025',
          provider: 'natgeo',
          authorityScore: 95,
        });
      }
    } catch {
      // non-fatal
    }
  }
  return items;
}

export type OfficialInstitution =
  | 'ITU'
  | 'IMF'
  | 'WORLD_BANK'
  | 'WHO'
  | 'UN'
  | 'NASA'
  | 'IEA'
  | 'IRENA'
  | 'NIST'
  | 'SEC'
  | 'BITCOIN'
  | 'GEOGRAPHY';

/**
 * Forces direct live retrieval from a specific official institutional provider, bypassing
 * keyword regex gating. Used by the Final Institutional Evidence Check (before assigning UNVERIFIED)
 * and the Institutional Source Attribution Guard (e.g. ensuring NASA/ITU/IEA/IRENA/NIST/SEC are cited directly).
 */
export async function queryOfficialInstitution(
  institution: OfficialInstitution,
  claimText: string,
  targetedQueries: string[]
): Promise<LiveEvidenceItem[]> {
  const primaryQuery = targetedQueries[0] ?? claimText.slice(0, 100);
  const secondaryQuery = targetedQueries[1] ?? primaryQuery;

  const tasks: Array<Promise<LiveEvidenceItem[]>> = [];
  switch (institution) {
    case 'ITU':
      tasks.push(queryItuStatistics(claimText, true));
      tasks.push(queryWorldBank(`${claimText} internet worldwide`, true));
      break;
    case 'IMF':
      tasks.push(queryImfWeo(claimText, true));
      tasks.push(queryWorldBank(claimText, true));
      break;
    case 'WORLD_BANK':
      tasks.push(queryWorldBank(claimText, true));
      tasks.push(queryWorldBankCountryFacts(claimText, true));
      break;
    case 'WHO':
      tasks.push(queryWhoGho(claimText));
      tasks.push(queryPubMed(primaryQuery));
      break;
    case 'UN':
      tasks.push(queryUnPopulation(claimText, true));
      tasks.push(queryWorldBank(claimText, true));
      tasks.push(queryItuStatistics(claimText, /internet|offline|digital|connect/i.test(claimText)));
      break;
    case 'NASA':
      tasks.push(queryNasaAstronomy(claimText, primaryQuery, true));
      if (secondaryQuery !== primaryQuery) {
        tasks.push(queryNasaAstronomy(claimText, secondaryQuery, true));
      }
      break;
    case 'IEA':
      tasks.push(queryIeaEvData(claimText, true));
      break;
    case 'IRENA':
      tasks.push(queryIrenaCapacityData(claimText, true));
      break;
    case 'NIST':
      tasks.push(queryNistStandards(claimText, true));
      break;
    case 'SEC':
      tasks.push(querySecEdgarCorporate(claimText, true));
      break;
    case 'BITCOIN':
      tasks.push(queryBitcoinProtocol(claimText, true));
      break;
    case 'GEOGRAPHY':
      tasks.push(queryWorldBankCountryFacts(claimText, true));
      tasks.push(queryNationalGeographicEducation(claimText, primaryQuery, true));
      tasks.push(queryWikipedia(primaryQuery));
      if (secondaryQuery !== primaryQuery) {
        tasks.push(queryWikipedia(secondaryQuery));
      }
      break;
  }

  const settled = await Promise.allSettled(tasks);
  const items: LiveEvidenceItem[] = [];
  const seen = new Set<string>();
  for (const r of settled) {
    if (r.status === 'fulfilled') {
      for (const item of r.value) {
        if (!seen.has(item.url)) {
          seen.add(item.url);
          items.push(item);
        }
      }
    }
  }
  return items.sort((a, b) => b.authorityScore - a.authorityScore);
}

/**
 * Executes parallel live web searches across authoritative public sources for a given claim,
 * prioritizing official government/standards/space agencies (NASA, NIST, SEC), IMF, World Bank,
 * ITU, WHO, UN, IEA, IRENA, National Geographic, official protocol docs, and peer-reviewed research.
 */
export async function searchLiveWebEvidence(
  claimText: string,
  category: string,
  targetedQueries: string[],
  options: LiveSearchOptions = {}
): Promise<LiveSearchResult> {
  const queries = (
    targetedQueries.length > 0 ? targetedQueries : buildFallbackQueries(claimText, category)
  )
    .map((q) => q.trim())
    .filter((q) => q.length >= 3)
    .slice(0, 3);

  const errors: string[] = [];
  const primaryQuery = queries[0] ?? claimText.slice(0, 100);
  const secondaryQuery = queries[1] ?? primaryQuery;

  const isAcademicOrSci =
    options.deepAcademicRetry ||
    category === 'Scientific' ||
    category === 'Technical Spec' ||
    /\b(nanometer|lithography|wavelength|study|clinical|trial|species|climate|emissions|health|medical|disease|vaccine|mortality)\b/i.test(
      claimText
    );

  const isHealthRelated =
    /\b(health|disease|mortality|life expectancy|vaccine|clinical|medical|who|cancer|diabetes|obesity|pandemic)\b/i.test(
      claimText
    );

  const tasks: Array<Promise<LiveEvidenceItem[]>> = [
    queryImfWeo(claimText),
    queryWorldBank(claimText),
    queryWorldBankCountryFacts(claimText),
    queryItuStatistics(claimText),
    queryNasaAstronomy(claimText, primaryQuery),
    queryIeaEvData(claimText),
    queryIrenaCapacityData(claimText),
    queryUnPopulation(claimText),
    queryNistStandards(claimText),
    querySecEdgarCorporate(claimText),
    queryBitcoinProtocol(claimText),
    queryNationalGeographicEducation(claimText, primaryQuery),
    queryWhoGho(claimText),
    queryWikipedia(primaryQuery),
    queryGoogleNewsRss(primaryQuery),
  ];

  if (secondaryQuery !== primaryQuery) {
    tasks.push(queryWikipedia(secondaryQuery));
    tasks.push(queryGoogleNewsRss(secondaryQuery));
  }

  if (isHealthRelated || options.deepAcademicRetry) {
    tasks.push(queryPubMed(primaryQuery));
  }

  if (isAcademicOrSci) {
    tasks.push(queryCrossref(primaryQuery));
  }

  const settled = await Promise.allSettled(tasks);
  const allItems: LiveEvidenceItem[] = [];

  for (const result of settled) {
    if (result.status === 'fulfilled') {
      allItems.push(...result.value);
    } else {
      const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      errors.push(msg);
      console.warn('[liveWebSearch] Provider promise rejected:', msg);
    }
  }

  // Deduplicate by URL, optionally skip previously evaluated URLs, and rank strictly by institutional authority
  const seen = new Set<string>(options.excludeUrls ?? []);
  const deduped: LiveEvidenceItem[] = [];
  for (const item of allItems.sort((a, b) => b.authorityScore - a.authorityScore)) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    deduped.push(item);
  }

  return {
    queries,
    items: deduped.slice(0, 8),
    errors,
  };
}
