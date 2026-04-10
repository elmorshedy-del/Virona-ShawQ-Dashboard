export const DEFAULT_MEASURE_OPTIONS = [
  'Impressions',
  'Clicks',
  'Share',
  'Comment',
  'Purchase',
  'Engagement',
  'CTR',
  'Engagement Rate',
  'Conversion Rate',
  'Purchase Rate',
  'Total Budget',
  'Avg Budget'
];

export const DEFAULT_CAMPAIGN_OPTIONS = [
  { campaignId: '', campaignName: 'All Campaigns' },
  { campaignId: 'summer-2024', campaignName: 'Summer 2024' },
  { campaignId: 'brand-awareness', campaignName: 'Brand Awareness' },
  { campaignId: 'retargeting', campaignName: 'Retargeting' },
  { campaignId: 'holiday-special', campaignName: 'Holiday Special' }
];

export const DEFAULT_METRICS = [
  { id: 'impressions', label: 'Impressions', value: '216K', change: '+4.2%', accentColor: 'cyan' },
  { id: 'clicks', label: 'Clicks', value: '25.4K', change: '+5.7%', accentColor: 'indigo' },
  { id: 'share', label: 'Share', value: '1.3K', change: '-2.1%', accentColor: 'teal' },
  { id: 'comment', label: 'Comment', value: '2.6K', change: '+3.8%', accentColor: 'cyan' },
  { id: 'purchase', label: 'Purchase', value: '1.3K', change: '+1.7%', accentColor: 'indigo' },
  { id: 'engagement', label: 'Engagement', value: '29K', change: '+6.3%', accentColor: 'teal' },
  { id: 'ctr', label: 'CTR (click through rate)', value: '11.76%', change: '-0.4%', accentColor: 'cyan' },
  { id: 'engRate', label: 'Engagement Rate', value: '13.56%', change: '+0.8%', accentColor: 'indigo' },
  { id: 'convRate', label: 'Conversion Rate', value: '5.21%', change: '+0.2%', accentColor: 'teal' },
  { id: 'purchRate', label: 'Purchase Rate', value: '0.61%', change: '+0.1%', accentColor: 'cyan' },
  { id: 'totalBudget', label: 'Total Budget', value: '$227.0M', change: '+1.5%', accentColor: 'indigo' },
  { id: 'avgBudget', label: 'Avg Budget', value: '$4.5M', change: '-0.3%', accentColor: 'teal' }
];

export const METRIC_LEFTS = [206, 366, 526, 686, 846, 1006];
export const METRIC_TOPS = [98, 196];

export const DEFAULT_GENDER = {
  female: { count: '46.0K', pct: '(21.2%)' },
  all: { count: '94.2K', pct: '(43.1%)' },
  male: { count: '75.2K', pct: '(34.7%)' }
};

export const DEFAULT_AGE_BARS = [
  { value: 4200, label: '18' },
  { value: 5800 },
  { value: 6800 },
  { value: 7600, label: '20' },
  { value: 8400 },
  { value: 8600 },
  { value: 8200 },
  { value: 7800 },
  { value: 7100 },
  { value: 6200, label: '30' },
  { value: 5100 },
  { value: 3900 },
  { value: 3000 },
  { value: 2100, label: '40' },
  { value: 1600 },
  { value: 1250, label: '50' },
  { value: 980 },
  { value: 720, label: '60' }
];

export const DEFAULT_WEEK_GROUPS = [
  { stories: 8400, casual: 9000, image: 7800, video: 6600 },
  { stories: 10200, casual: 9600, image: 8400, video: 7300, label: '20' },
  { stories: 9000, casual: 7800, image: 7200, video: 6000 },
  { stories: 10800, casual: 9000, image: 8400, video: 6600 },
  { stories: 9600, casual: 8400, image: 7200, video: 7800 },
  { stories: 10500, casual: 9000, image: 7500, video: 6300, label: '25' },
  { stories: 9900, casual: 8700, image: 7200, video: 6600 },
  { stories: 9300, casual: 8400, image: 7200, video: 6900 },
  { stories: 11100, casual: 9300, image: 7800, video: 7200, label: '30' },
  { stories: 10200, casual: 9000, image: 7500, video: 6600 },
  { stories: 9600, casual: 8400, image: 7200, video: 6300 },
  { stories: 10500, casual: 8700, image: 7500, video: 6600 }
];

export const DEFAULT_HOURLY_DATA = [
  { hour: 0, value: 128 },
  { hour: 1, value: 94 },
  { hour: 2, value: 72 },
  { hour: 3, value: 68 },
  { hour: 4, value: 85 },
  { hour: 5, value: 142 },
  { hour: 6, value: 310 },
  { hour: 7, value: 486 },
  { hour: 8, value: 612 },
  { hour: 9, value: 698 },
  { hour: 10, value: 745 },
  { hour: 11, value: 792 },
  { hour: 12, value: 818 },
  { hour: 13, value: 784 },
  { hour: 14, value: 741 },
  { hour: 15, value: 695 },
  { hour: 16, value: 720 },
  { hour: 17, value: 763 },
  { hour: 18, value: 798 },
  { hour: 19, value: 842 },
  { hour: 20, value: 806 },
  { hour: 21, value: 688 },
  { hour: 22, value: 496 },
  { hour: 23, value: 284 }
];

export const DEFAULT_HIGHLIGHTED_DAYS = [5, 9, 12, 16, 20, 24];
export const DASHBOARD_DESIGN_WIDTH = 1186;
export const DASHBOARD_DESIGN_HEIGHT = 706;
