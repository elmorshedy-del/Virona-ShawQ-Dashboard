import { useState } from 'react';
import {
  Sparkles,
  Rocket,
  Target,
  Users,
  SlidersHorizontal,
  Zap,
  ShieldCheck,
  Database,
  BarChart3,
  CalendarDays,
  PlayCircle,
  ArrowRight,
  CheckCircle2,
  Filter,
  Globe,
  Eye,
  Clock,
  Settings,
  Wand2,
  LayoutGrid,
  Layers
} from 'lucide-react';

const CONCEPTS = [
  {
    id: 'blueprint',
    title: 'Flow Blueprint',
    summary: 'Guided canvas that locks the right decisions in the right order.'
  },
  {
    id: 'deck',
    title: 'Control Deck',
    summary: 'A modular cockpit built for rapid multi-scenario launches.'
  }
];

const FEATURE_PILLS = [
  'Advantage+ placements',
  'Dynamic creative',
  'CBO and ABO',
  'Cost cap and bid cap',
  'Value optimization',
  'Attribution windows',
  'Pixel + CAPI',
  'Catalog sets',
  'A/B tests',
  'Rules automation',
  'Frequency controls',
  'UTM builder'
];

const BLUEPRINT_STEPS = [
  {
    title: 'Objective and Conversion',
    status: 'ready',
    details: [
      'Objective: Sales',
      'Conversion event: Purchase',
      'Optimization: Value',
      'Attribution: 7d click / 1d view'
    ],
    tools: ['Advantage+ campaign', 'Value rules', 'Goal split']
  },
  {
    title: 'Audience Fabric',
    status: 'attention',
    details: [
      'Core: GCC + EU',
      'Lookalike 1-3% + 4-6%',
      'Exclude: 180d purchasers',
      'Advantage+ audience expansion'
    ],
    tools: ['Customer list sync', 'Geo heatmap', 'LTV tiers']
  },
  {
    title: 'Budget and Bidding',
    status: 'ready',
    details: [
      'CBO: 850 / day',
      'Bid strategy: Cost cap',
      'ROAS floor: 1.5x',
      'Pacing guardrails on'
    ],
    tools: ['Dayparting', 'Spend limits', 'Auto scale bands']
  },
  {
    title: 'Placements and Delivery',
    status: 'ready',
    details: [
      'Advantage+ placements on',
      'Reels + Stories weighted',
      'Frequency cap: 2 / 7d',
      'Brand safety blocklist'
    ],
    tools: ['Publisher exclusion', 'Creative fatigue radar', 'Reach boost']
  },
  {
    title: 'Creative System',
    status: 'attention',
    details: [
      'Dynamic creative enabled',
      '3 hooks x 4 bodies x 2 CTAs',
      'Instant experience + catalog',
      'Aspect ratio guardrails'
    ],
    tools: ['UGC library', 'Variant scorer', 'Auto crop']
  },
  {
    title: 'Tracking and QA',
    status: 'ready',
    details: [
      'Pixel + CAPI synced',
      'UTM template attached',
      'Event deduplication OK',
      'Compliance checks passed'
    ],
    tools: ['Tracking QA', 'Policy scan', 'Preview suite']
  }
];

const BLUEPRINT_READINESS = [
  'Pixel and CAPI match rate above 92%',
  'Attribution window aligned to finance model',
  'Budget guardrails locked for scale',
  'Brand safety + exclusions validated',
  'Creative fatigue alerts enabled'
];

const BLUEPRINT_AUTOMATIONS = [
  { label: 'Auto pause on CPA spike', value: 'On' },
  { label: 'Scale winners by 20% every 48h', value: 'On' },
  { label: 'Duplicate winning ads to new geo', value: 'On' },
  { label: 'Auto refresh creative when CTR drops', value: 'On' }
];

const DECK_SCENARIOS = [
  {
    title: 'Scale Sprint',
    meta: 'Volume first',
    budget: '1,200 / day',
    bid: 'Lowest cost',
    forecast: '+32% orders',
    tone: 'emerald'
  },
  {
    title: 'Efficiency Shield',
    meta: 'ROAS defense',
    budget: '650 / day',
    bid: 'Cost cap',
    forecast: '1.9x ROAS',
    tone: 'indigo'
  },
  {
    title: 'Experiment Lab',
    meta: 'Creative discovery',
    budget: '420 / day',
    bid: 'Bid cap',
    forecast: '12 tests',
    tone: 'amber'
  }
];

const DECK_PODS = [
  {
    title: 'UGC Stack',
    meta: '6 creatives',
    body: ['Dynamic creative on', 'Instant experience', 'CTA rotation: Shop Now']
  },
  {
    title: 'Product Catalog',
    meta: '3 sets',
    body: ['Catalog sales', 'Top sellers set', 'Advantage+ creative']
  },
  {
    title: 'Storyline',
    meta: '4 videos',
    body: ['Vertical only', 'Reels optimized', 'Auto captions']
  }
];

const DECK_RULES = [
  'If CPA > 1.3x target for 3 days, reduce budget 20%',
  'If ROAS > 1.6x, add 15% daily budget',
  'If frequency > 2.5, rotate creative pod',
  'If CTR < 0.9%, swap hooks from library'
];

const DECK_SCHEDULE = [
  { label: 'Launch window', value: 'Mon 08:00 - Thu 20:00' },
  { label: 'Learning phase', value: '7 days or 50 conversions' },
  { label: 'Refresh cycle', value: 'Every 14 days' }
];

const TONE_STYLES = {
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  amber: 'bg-amber-50 text-amber-700 border-amber-100',
  slate: 'bg-slate-100 text-slate-600 border-slate-200'
};

function ToneBadge({ label, tone = 'slate' }) {
  const classes = TONE_STYLES[tone] || TONE_STYLES.slate;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${classes}`}>
      {label}
    </span>
  );
}

function MetricBar({ label, value, color }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{label}</span>
        <span className="font-semibold text-slate-700">{value}%</span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-slate-100">
        <div
          className={`h-2 rounded-full ${color}`}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

function FeaturePill({ label }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
      {label}
    </span>
  );
}

function FlowStep({ step }) {
  const statusTone = step.status === 'ready' ? 'emerald' : 'amber';
  const statusLabel = step.status === 'ready' ? 'Ready' : 'Needs input';

  return (
    <div className="relative pl-7">
      <div className="absolute left-1 top-4 h-3 w-3 rounded-full bg-slate-400" />
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">{step.title}</div>
            <div className="mt-1 grid gap-1 text-xs text-slate-500">
              {step.details.map((detail) => (
                <div key={detail}>{detail}</div>
              ))}
            </div>
          </div>
          <ToneBadge label={statusLabel} tone={statusTone} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {step.tools.map((tool) => (
            <span
              key={tool}
              className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600"
            >
              {tool}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function NeoMetaTab({ onOpenCampaignLauncher = () => {} }) {
  const [concept, setConcept] = useState('blueprint');
  const activeConcept = CONCEPTS.find((item) => item.id === concept) || CONCEPTS[0];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_#ecfeff,_transparent_55%)] opacity-70" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <Sparkles className="h-4 w-4" />
              NeoMeta
            </div>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">
              Campaign creation re-imagined for elite Meta operators
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Architected to make six and seven figure ad launches feel frictionless and precise.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Import from Meta
            </button>
            <button className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Generate from brief
            </button>
            <button
              onClick={onOpenCampaignLauncher}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
            >
              Open launcher
            </button>
          </div>
        </div>
        <div className="relative mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white/80 p-3">
            <div className="text-xs text-slate-500">Objective</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">Sales - Website</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white/80 p-3">
            <div className="text-xs text-slate-500">Conversion</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">Purchase (Value)</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white/80 p-3">
            <div className="text-xs text-slate-500">Optimization</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">Value + Highest ROAS</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white/80 p-3">
            <div className="text-xs text-slate-500">Attribution</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">7d click / 1d view</div>
          </div>
        </div>
        <div className="relative mt-5 flex flex-wrap gap-2">
          {FEATURE_PILLS.map((pill) => (
            <FeaturePill key={pill} label={pill} />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-slate-900">NeoMeta concepts</div>
          <div className="text-sm text-slate-500">{activeConcept.summary}</div>
        </div>
        <div className="flex rounded-xl bg-slate-100 p-1">
          {CONCEPTS.map((item) => (
            <button
              key={item.id}
              onClick={() => setConcept(item.id)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                concept === item.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {item.title}
            </button>
          ))}
        </div>
      </div>

      {concept === 'blueprint' ? (
        <div className="grid gap-6 xl:grid-cols-[1fr_1.4fr_1fr]">
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Target className="h-4 w-4 text-slate-600" />
                  Intent Compass
                </div>
                <ToneBadge label="Score 86" tone="emerald" />
              </div>
              <div className="mt-4 space-y-3">
                <MetricBar label="Creative coverage" value={82} color="bg-emerald-500" />
                <MetricBar label="Audience signal" value={76} color="bg-sky-500" />
                <MetricBar label="Measurement health" value={92} color="bg-indigo-500" />
              </div>
              <div className="mt-4 grid gap-2 text-xs text-slate-500">
                <div className="flex items-center gap-2">
                  <Eye className="h-4 w-4" />
                  Primary KPI set to Purchase Value
                </div>
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4" />
                  Pixel + CAPI dedupe active
                </div>
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4" />
                  Geo blend optimized for seasonality
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Users className="h-4 w-4 text-slate-600" />
                Audience Fabric
              </div>
              <p className="mt-1 text-xs text-slate-500">
                NeoMeta stitches core, lookalike, and intent pools into a single adaptive cluster.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {['Core: GCC + EU', 'Lookalike 1-6%', 'Past purchasers 180d', 'High LTV buyers', 'Engaged video viewers'].map((chip) => (
                  <span
                    key={chip}
                    className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600"
                  >
                    {chip}
                  </span>
                ))}
              </div>
              <div className="mt-4 grid gap-2 text-xs text-slate-500">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4" />
                  Auto exclusions keep overlap below 8%
                </div>
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4" />
                  Advantage+ audience expansion enabled
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-900">Blueprint rail</div>
              <ToneBadge label="Auto orchestrated" tone="indigo" />
            </div>
            <div className="relative mt-4 space-y-4">
              <div className="absolute left-2 top-0 h-full w-px bg-slate-200" />
              {BLUEPRINT_STEPS.map((step) => (
                <FlowStep key={step.title} step={step} />
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <ShieldCheck className="h-4 w-4 text-slate-600" />
                Launch readiness
              </div>
              <div className="mt-3 space-y-2 text-xs text-slate-500">
                {BLUEPRINT_READINESS.map((item) => (
                  <div key={item} className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Zap className="h-4 w-4 text-slate-600" />
                Automation DNA
              </div>
              <div className="mt-3 space-y-2">
                {BLUEPRINT_AUTOMATIONS.map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600"
                  >
                    <span>{item.label}</span>
                    <span className="font-semibold text-emerald-600">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Settings className="h-4 w-4 text-slate-600" />
                Governance stack
              </div>
              <div className="mt-3 grid gap-2 text-xs text-slate-500">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4" />
                  Tracking template + UTMs locked
                </div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" />
                  Brand safety and compliance scan
                </div>
                <div className="flex items-center gap-2">
                  <PlayCircle className="h-4 w-4" />
                  Auto preview across feeds, stories, reels
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Rocket className="h-4 w-4 text-slate-600" />
                  Scenario studio
                </div>
                <ToneBadge label="3 live scenarios" tone="emerald" />
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {DECK_SCENARIOS.map((scenario) => (
                  <div
                    key={scenario.title}
                    className={`rounded-xl border p-3 ${TONE_STYLES[scenario.tone]}`}
                  >
                    <div className="text-sm font-semibold">{scenario.title}</div>
                    <div className="text-xs opacity-80">{scenario.meta}</div>
                    <div className="mt-3 space-y-1 text-xs">
                      <div>Budget: {scenario.budget}</div>
                      <div>Bid: {scenario.bid}</div>
                      <div>Forecast: {scenario.forecast}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Wand2 className="h-4 w-4 text-slate-600" />
                  Creative pods
                </div>
                <ToneBadge label="Dynamic creative on" tone="indigo" />
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {DECK_PODS.map((pod) => (
                  <div key={pod.title} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-sm font-semibold text-slate-900">{pod.title}</div>
                    <div className="text-xs text-slate-500">{pod.meta}</div>
                    <div className="mt-2 space-y-1 text-xs text-slate-600">
                      {pod.body.map((line) => (
                        <div key={line}>{line}</div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Layers className="h-4 w-4 text-slate-600" />
                  Placement mix
                </div>
                <ToneBadge label="Advantage+ on" tone="emerald" />
              </div>
              <div className="mt-4 space-y-3 text-xs text-slate-500">
                {[
                  { label: 'Feeds', value: 38 },
                  { label: 'Reels', value: 32 },
                  { label: 'Stories', value: 20 },
                  { label: 'Audience Network', value: 10 }
                ].map((row) => (
                  <div key={row.label}>
                    <div className="flex items-center justify-between">
                      <span>{row.label}</span>
                      <span className="font-semibold text-slate-700">{row.value}%</span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-slate-100">
                      <div className="h-2 rounded-full bg-slate-700" style={{ width: `${row.value}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <LayoutGrid className="h-4 w-4 text-slate-600" />
                Audience fabric
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {[
                  'Core: Fashion buyers',
                  'Lookalike 1%',
                  'Lookalike 2-5%',
                  'Retention 30d',
                  'Value based 2x',
                  'Engaged video viewers'
                ].map((chip) => (
                  <span
                    key={chip}
                    className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600"
                  >
                    {chip}
                  </span>
                ))}
              </div>
              <div className="mt-4 grid gap-2 text-xs text-slate-500">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4" />
                  Overlap guardrails active
                </div>
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4" />
                  Advantage+ audience expansion
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <BarChart3 className="h-4 w-4 text-slate-600" />
                Rules and automation
              </div>
              <div className="mt-3 space-y-2 text-xs text-slate-500">
                {DECK_RULES.map((rule) => (
                  <div key={rule} className="rounded-lg bg-slate-50 px-3 py-2">
                    {rule}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <CalendarDays className="h-4 w-4 text-slate-600" />
                Timeline and QA
              </div>
              <div className="mt-3 space-y-2 text-xs text-slate-500">
                {DECK_SCHEDULE.map((item) => (
                  <div key={item.label} className="flex items-center justify-between">
                    <span>{item.label}</span>
                    <span className="font-semibold text-slate-700">{item.value}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1">
                  <Clock className="h-3.5 w-3.5" />
                  Learning phase locks
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1">
                  <Eye className="h-3.5 w-3.5" />
                  Creative QA preview
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-slate-900 p-2 text-white">
            <ArrowRight className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900">Launch control</div>
            <div className="text-xs text-slate-500">NeoMeta will apply guardrails, naming, and QA on deploy.</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Save Blueprint
          </button>
          <button className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Export to CSV
          </button>
          <button
            onClick={onOpenCampaignLauncher}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500"
          >
            Launch Campaign
          </button>
        </div>
      </div>
    </div>
  );
}
