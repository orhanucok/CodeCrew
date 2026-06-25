export function formatCost(cost: number): string {
  return cost === 0 ? "$0" : `$${cost.toFixed(4)}`;
}
