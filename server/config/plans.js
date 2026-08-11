/**
 * Pricing & Subscription Plans Specification & Limits
 */

export const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    price: 0,
    currency: 'BDT',
    billingCycle: 'lifetime',
    creditsPerCycle: 10,
    maxBatchSize: 5,
    features: [
      'BYOK Gemini AI',
      '10 credits lifetime',
      'Basic CSV export',
      'All microstock platforms'
    ]
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: 150,
    currency: 'BDT',
    billingCycle: 'monthly',
    creditsPerCycle: 6000,
    maxBatchSize: 100,
    features: [
      '6,000 images per month',
      'All 8 microstock platforms',
      'Advanced keyword ordering',
      'Priority metadata processing'
    ]
  },
  business: {
    id: 'business',
    name: 'Business',
    price: 500,
    currency: 'BDT',
    billingCycle: 'yearly',
    creditsPerCycle: 18000,
    maxBatchSize: 1000,
    features: [
      '18,000 images per year',
      'Custom CSV schema exporter',
      'Multi-user studio workspace',
      'Priority AI engine'
    ]
  }
};

export function getPlanDetails(planId) {
  const p = String(planId || 'free').toLowerCase();
  return PLANS[p] || PLANS.free;
}
