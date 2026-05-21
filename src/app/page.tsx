import Link from 'next/link';
import { Instrument_Serif, IBM_Plex_Sans } from 'next/font/google';
import {
  Monitor,
  MemoryStick,
  Keyboard,
  CircuitBoard,
  Cpu,
  Mouse,
  Blocks,
  Box,
  HardDrive,
  Zap,
  Snowflake,
  Cable,
  Headphones,
  Laptop,
  Smartphone,
  Home as HomeIcon,
  Package,
  ArrowRight,
  Fan,
  Router,
  Network,
  BatteryCharging,
  Computer,
  Webcam,
  Tv,
  Gamepad2,
  Speaker,
} from 'lucide-react';
import SearchBar from '@/components/SearchBar';
import EmailSignup from '@/components/EmailSignup';
import {
  getHomeCategories,
  getHomeFeaturedEntities,
  type HomeFeaturedEntity,
} from '@/lib/queries/home';
import { CATEGORY_ENTITY_MAP } from '@/lib/category-entity-map';
import { CATEGORY_LABELS } from '@/types';

/* ───────────────────────────────────────────────────────────────────────────
   Homepage v3.2 — editorial-dark direction (2026-05-11)

   v3.2 (2026-05-11):
     - Featured-entry description: replaced hardcoded "An example of a
       canonical entry..." placeholder with deal-context copy computed
       from the entity's bestPrice / allTimeHigh / allTimeLow /
       retailerCount / isAtl / dropPct fields. The placeholder was the
       strongest "this site looks like a demo" signal on the page even
       though the featured entity itself has been data-driven via
       getHomeFeaturedEntities since v3.
     - Mojibake cleanup pass on comments per WORKFLOW Phase-0.5 polish
       discipline (cp1252 → real UTF-8 for em-dashes and section
       dividers). No string-literal mojibake — all em-dashes in user-
       visible strings already use HTML entities (&mdash;).

   v3.1 (2026-05-05):
     - Icon map covers all currently-tracked categories. Previously
       fell through to Package for Case Fans, Routers, Network Switches,
       Hard Drives, UPS, External Storage, Desktop PCs, Webcams, TVs,
       Game Controllers. Speakers fixed from Headphones to Speaker.

   Reference content (Wikipedia-style featured entry, italic serif
   headings, Lucide icons, real horizontal rule dividers, sentence
   case, demoted email signup) all stay.
   ─────────────────────────────────────────────────────────────────────────── */

const serif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  display: 'swap',
});

const sans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

// Lucide icon map. Keys mirror category slugs. Falls back to <Package />
// for unknown keys so adding a new vertical doesn't break the homepage
// even before the icon lands.
const CATEGORY_LUCIDE: Record<string, React.ComponentType<{ size?: number; strokeWidth?: number }>> = {
  monitors: Monitor,
  displays: Monitor,
  ram: MemoryStick,
  memory: MemoryStick,
  keyboards: Keyboard,
  motherboards: CircuitBoard,
  'graphics-cards': Cpu,
  gpus: Cpu,
  'video-cards': Cpu,
  cpus: Cpu,
  processors: Cpu,
  mice: Mouse,
  'pc-cases': Box,
  cases: Box,
  ssds: HardDrive,
  'hard-drives': HardDrive,
  'external-storage': HardDrive,
  storage: HardDrive,
  'power-supplies': Zap,
  psu: Zap,
  'cpu-coolers': Snowflake,
  cooling: Snowflake,
  'case-fans': Fan,
  fans: Fan,
  accessories: Cable,
  controllers: Gamepad2,
  'game-controllers': Gamepad2,
  gamepads: Gamepad2,
  headphones: Headphones,
  audio: Headphones,
  speakers: Speaker,
  laptops: Laptop,
  'desktop-pcs': Computer,
  desktops: Computer,
  cellphones: Smartphone,
  phones: Smartphone,
  'smart-home': HomeIcon,
  routers: Router,
  'network-switches': Network,
  networking: Network,
  'ups-surge-protection': BatteryCharging,
  ups: BatteryCharging,
  webcams: Webcam,
  tvs: Tv,
  televisions: Tv,
  'lego-sets': Blocks,
  'lego-themes': Blocks,
};

function CategoryIcon({ categoryKey, size = 22 }: { categoryKey: string; size?: number }) {
  const Icon = CATEGORY_LUCIDE[categoryKey] ?? Package;
  return <Icon size={size} strokeWidth={1.5} />;
}

const fmtPrice = (n: number) =>
  `$${Math.round(n).toLocaleString('en-CA', { maximumFractionDigits: 0 })}`;

/**
 * Build deal-context copy for the featured entry from the existing fields
 * on HomeFeaturedEntity. Replaces the previous hardcoded "An example of a
 * canonical entry..." text, which read as demo content even though the
 * underlying entity was already data-driven.
 *
 * The featured query (getHomeFeaturedEntities) filters with `isAtl OR
 * dropPct >= 15`, so one of the first three branches always fires in
 * practice. The fallback exists for type safety in case that filter
 * ever loosens.
 */
function buildFeaturedDescription(f: HomeFeaturedEntity): string {
  const peakDropPct = Math.round(f.dropPct);
  const aboveAtl = Math.max(0, f.bestPrice - f.allTimeLow);

  if (f.isAtl) {
    return peakDropPct >= 15
      ? `Currently at its all-time tracked low — a ${peakDropPct}% drop from a tracked peak of ${fmtPrice(f.allTimeHigh)}.`
      : `Currently at its all-time tracked low across ${f.retailerCount} retailer${f.retailerCount === 1 ? '' : 's'}.`;
  }

  if (peakDropPct >= 15 && aboveAtl > 0) {
    return `Down ${peakDropPct}% from a tracked peak of ${fmtPrice(f.allTimeHigh)} — within ${fmtPrice(aboveAtl)} of the all-time low of ${fmtPrice(f.allTimeLow)}.`;
  }

  if (peakDropPct >= 15) {
    return `Down ${peakDropPct}% from a tracked peak of ${fmtPrice(f.allTimeHigh)}.`;
  }

  return `Tracked across ${f.retailerCount} retailer${f.retailerCount === 1 ? '' : 's'}.`;
}

// Re-render every 15 minutes. Homepage doesn't need per-minute freshness.
export const revalidate = 900;

export default async function HomePage() {
  const [rawCategories, featuredList] = await Promise.all([
    getHomeCategories(50),
    getHomeFeaturedEntities(1),
  ]);

  const topCategories = rawCategories.map((c) => ({
    ...c,
    label: CATEGORY_LABELS[c.key] ?? c.label,
    isMigrated: c.key in CATEGORY_ENTITY_MAP,
  }));

  const featured = featuredList[0] ?? null;
  const totalEntries = topCategories.reduce((sum, c) => sum + c.count, 0);
  const categoryCount = topCategories.length;

  return (
    <div className={sans.className}>
      {/* Hero */}
      <section
        style={{
          padding: '5rem 1.5rem 2rem',
          maxWidth: 760,
          margin: '0 auto',
          textAlign: 'center',
        }}
      >
        <h1
          className={`animate-in ${serif.className}`}
          style={{
            fontWeight: 400,
            fontSize: '3.75rem',
            lineHeight: 1.0,
            marginBottom: '1.5rem',
            letterSpacing: '-0.02em',
          }}
        >
          The encyclopedia of
          <br />
          <span className="gradient-text" style={{ fontStyle: 'italic' }}>
            what things are worth.
          </span>
        </h1>
        <p
          className="animate-in animate-delay-1"
          style={{
            color: 'var(--text-secondary)',
            fontSize: '0.9375rem',
            lineHeight: 1.6,
            maxWidth: 540,
            margin: '0 auto 2.25rem',
            opacity: 0.85,
          }}
        >
          Independent. No ads, no sponsored placements, no paywalled price history.
        </p>

        <div
          className="animate-in animate-delay-2"
          style={{ maxWidth: 560, margin: '0 auto', position: 'relative', zIndex: 100 }}
        >
          <SearchBar large />
        </div>
      </section>

      {/* Catalog scope — encyclopedia-framed stat */}
      <section
        style={{
          maxWidth: 720,
          margin: '0 auto 4rem',
          padding: '0 1.5rem',
          textAlign: 'center',
        }}
      >
        <p
          style={{
            fontSize: '0.875rem',
            color: 'var(--text-secondary)',
            letterSpacing: '0.01em',
          }}
        >
          <span
            className={serif.className}
            style={{
              color: 'var(--accent)',
              fontWeight: 400,
              fontSize: '1.5rem',
              fontStyle: 'italic',
              fontVariantNumeric: 'tabular-nums',
              marginRight: '0.375rem',
              verticalAlign: 'baseline',
            }}
          >
            {totalEntries.toLocaleString()}
          </span>
          tracked entries across {categoryCount} categories. Refreshed daily.
        </p>
      </section>

      {/* Featured entry — Wikipedia-style "Today in the encyclopedia" */}
      {featured && (
        <section
          style={{
            maxWidth: 1040,
            margin: '0 auto 5rem',
            padding: '0 1.5rem',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              marginBottom: '1.25rem',
              gap: '0.5rem',
              flexWrap: 'wrap',
            }}
          >
            <p
              style={{
                fontSize: '0.6875rem',
                color: 'var(--text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '0.15em',
                fontWeight: 500,
              }}
            >
              Today in the encyclopedia
            </p>
          </div>

          <Link
            href={`${featured.routePrefix}/${featured.slug}`}
            className="card"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 0,
              textDecoration: 'none',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                aspectRatio: '4 / 3',
                background: 'linear-gradient(135deg, var(--bg-card), var(--bg-primary))',
                borderRight: '1px solid var(--border)',
                position: 'relative',
                overflow: 'hidden',
                minHeight: 240,
              }}
            >
              {featured.imageUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={featured.imageUrl}
                  alt={featured.name}
                  loading="eager"
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    padding: '2rem',
                  }}
                />
              ) : (
                <div
                  style={{
                    display: 'flex',
                    height: '100%',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--text-secondary)',
                    fontSize: '0.75rem',
                  }}
                >
                  No image
                </div>
              )}
            </div>

            <div
              style={{
                padding: '2rem 2.25rem',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                gap: '0.75rem',
              }}
            >
              {featured.brand && (
                <p
                  style={{
                    fontSize: '0.6875rem',
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.12em',
                    fontWeight: 600,
                  }}
                >
                  {featured.brand}
                </p>
              )}
              <h3
                className={serif.className}
                style={{
                  fontSize: '1.875rem',
                  fontWeight: 400,
                  lineHeight: 1.15,
                  letterSpacing: '-0.01em',
                  color: 'var(--text-primary)',
                }}
              >
                {featured.name}
              </h3>
              <p
                style={{
                  fontSize: '0.875rem',
                  color: 'var(--text-secondary)',
                  lineHeight: 1.6,
                  fontStyle: 'italic',
                }}
              >
                {buildFeaturedDescription(featured)}
              </p>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: '0.875rem',
                  marginTop: '0.25rem',
                  flexWrap: 'wrap',
                }}
              >
                <span
                  className={serif.className}
                  style={{
                    fontSize: '1.75rem',
                    fontWeight: 400,
                    color: 'var(--accent)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {fmtPrice(featured.bestPrice)}
                </span>
                {featured.allTimeHigh > featured.bestPrice && (
                  <span
                    style={{
                      fontSize: '0.8125rem',
                      color: 'var(--text-secondary)',
                      textDecoration: 'line-through',
                      fontVariantNumeric: 'tabular-nums',
                      opacity: 0.7,
                    }}
                  >
                    {fmtPrice(featured.allTimeHigh)} peak
                  </span>
                )}
              </div>
              {featured.bestRetailerName && (
                <p
                  style={{
                    fontSize: '0.8125rem',
                    color: 'var(--text-secondary)',
                  }}
                >
                  at {featured.bestRetailerName}
                  {featured.retailerCount > 1 && (
                    <span style={{ opacity: 0.7 }}>
                      {' '}+ {featured.retailerCount - 1} other retailer
                      {featured.retailerCount > 2 ? 's' : ''}
                    </span>
                  )}
                </p>
              )}
              <p
                style={{
                  fontSize: '0.8125rem',
                  color: 'var(--accent)',
                  marginTop: '0.5rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.375rem',
                  fontWeight: 500,
                }}
              >
                Read the full entry <ArrowRight size={14} strokeWidth={2} />
              </p>
            </div>
          </Link>
        </section>
      )}

      {/* Categories — primary navigation */}
      <section style={{ maxWidth: 1200, margin: '0 auto 5rem', padding: '0 1.5rem' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: '0.5rem',
            flexWrap: 'wrap',
            gap: '0.5rem',
          }}
        >
          <h2
            className={serif.className}
            style={{
              fontWeight: 400,
              fontSize: '2rem',
              letterSpacing: '-0.015em',
              fontStyle: 'italic',
            }}
          >
            Browse the catalog
          </h2>
          <Link href="/categories" className="accent-link" style={{ fontSize: '0.875rem' }}>
            All categories <ArrowRight size={12} strokeWidth={2} style={{ display: 'inline', marginLeft: '0.25rem', verticalAlign: 'middle' }} />
          </Link>
        </div>
        <p
          style={{
            fontSize: '0.875rem',
            color: 'var(--text-secondary)',
            marginBottom: '1.75rem',
            maxWidth: 640,
            lineHeight: 1.6,
          }}
        >
          Every product is a canonical entry &mdash; one record per real-world item, with
          current prices and full history.
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
            gap: '0.625rem',
          }}
        >
          {topCategories.map((cat) => (
            <Link
              key={cat.key}
              href={`/c/${cat.key}`}
              className="card"
              style={{
                padding: '1.25rem 1rem',
                textDecoration: 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
                minHeight: 130,
                alignItems: 'flex-start',
              }}
            >
              <span
                style={{
                  color: cat.isMigrated ? 'var(--accent)' : 'var(--text-secondary)',
                  opacity: cat.isMigrated ? 1 : 0.75,
                  display: 'inline-flex',
                }}
              >
                <CategoryIcon categoryKey={cat.key} />
              </span>
              <p
                style={{
                  fontWeight: 600,
                  fontSize: '0.9375rem',
                  color: 'var(--text-primary)',
                  lineHeight: 1.3,
                  marginTop: '0.25rem',
                }}
              >
                {cat.label}
              </p>
              <p
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-secondary)',
                  marginTop: 'auto',
                }}
              >
                <span
                  style={{
                    color: cat.isMigrated ? 'var(--accent)' : 'var(--text-secondary)',
                    fontWeight: cat.isMigrated ? 600 : 400,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {cat.count.toLocaleString()}
                </span>
                {' '}entries
              </p>
            </Link>
          ))}
        </div>
      </section>

      {/* About the encyclopedia — editorial content block */}
      <section
        style={{
          maxWidth: 720,
          margin: '0 auto 5rem',
          padding: '0 1.5rem',
        }}
      >
        <div
          style={{
            borderTop: '1px solid var(--border)',
            paddingTop: '3rem',
          }}
        >
          <h2
            className={serif.className}
            style={{
              fontWeight: 400,
              fontSize: '1.75rem',
              marginBottom: '1.25rem',
              letterSpacing: '-0.01em',
              fontStyle: 'italic',
            }}
          >
            About the encyclopedia
          </h2>
          <p
            style={{
              fontSize: '0.9375rem',
              color: 'var(--text-secondary)',
              lineHeight: 1.75,
              marginBottom: '1rem',
            }}
          >
            TrackAura is a reference catalog of consumer products, not a deals site. Every
            entry is a canonical record of one real-world item &mdash; its specs, current
            prices across the Canadian retailers we cover, and full price history going back
            to when we started tracking.
          </p>
          <p
            style={{
              fontSize: '0.9375rem',
              color: 'var(--text-secondary)',
              lineHeight: 1.75,
              marginBottom: '1.5rem',
            }}
          >
            Free to read. No ads. No paywalled history. No sponsored placements, ever.
          </p>
          <Link
            href="/about"
            className="accent-link"
            style={{ fontSize: '0.875rem', display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}
          >
            Learn more <ArrowRight size={14} strokeWidth={2} />
          </Link>
        </div>
      </section>

      {/* How it works */}
      <section
        style={{
          maxWidth: 800,
          margin: '0 auto 5rem',
          padding: '0 1.5rem',
        }}
      >
        <div
          style={{
            borderTop: '1px solid var(--border)',
            paddingTop: '3rem',
            textAlign: 'center',
          }}
        >
          <h2
            className={serif.className}
            style={{
              fontWeight: 400,
              fontSize: '1.75rem',
              marginBottom: '2rem',
              letterSpacing: '-0.01em',
              fontStyle: 'italic',
            }}
          >
            How it works
          </h2>
          <div className="grid-howitworks">
            {[
              {
                step: '1',
                title: 'Prices get logged',
                desc: 'Every day, our system records prices across the Canadian retailers we cover.',
              },
              {
                step: '2',
                title: 'History builds up',
                desc: 'Over time you get a real price chart, so you can tell a genuine drop from a fake sale.',
              },
              {
                step: '3',
                title: 'You decide when to buy',
                desc: 'Compare the same product across stores, or set a price alert and get emailed when it drops.',
              },
            ].map((item) => (
              <div key={item.step}>
                <div
                  className={serif.className}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: '50%',
                    background: 'var(--accent-glow)',
                    border: '1px solid var(--accent)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 0.875rem',
                    fontWeight: 400,
                    color: 'var(--accent)',
                    fontSize: '1.125rem',
                    fontStyle: 'italic',
                  }}
                >
                  {item.step}
                </div>
                <p
                  style={{
                    fontWeight: 600,
                    marginBottom: '0.375rem',
                    fontSize: '0.9375rem',
                  }}
                >
                  {item.title}
                </p>
                <p
                  style={{
                    fontSize: '0.8125rem',
                    color: 'var(--text-secondary)',
                    lineHeight: 1.6,
                  }}
                >
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Email signup — demoted from earlier in the page */}
      <section
        style={{
          maxWidth: 600,
          margin: '0 auto 4rem',
          padding: '0 1.5rem',
        }}
      >
        <EmailSignup />
      </section>

      {/* Footer blurb */}
      <section
        style={{
          maxWidth: 640,
          margin: '0 auto 5rem',
          padding: '0 1.5rem',
          textAlign: 'center',
        }}
      >
        <p
          style={{
            fontSize: '0.8125rem',
            color: 'var(--text-secondary)',
            lineHeight: 1.7,
            fontStyle: 'italic',
          }}
        >
          Built in Quebec. TrackAura is an independent price tracker, not affiliated with any retailer.{' '}
          <Link href="/about" style={{ color: 'var(--accent)', fontStyle: 'normal' }}>
            Learn more &rarr;
          </Link>
        </p>
      </section>
    </div>
  );
}
