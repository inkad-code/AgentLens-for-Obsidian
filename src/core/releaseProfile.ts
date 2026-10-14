// Single Fetch includes the manual Single and Bulk workflows. Auto/Activity stay disabled.
// Fixed at build time; saved settings and server capabilities cannot enable review-only exclusions.
export const SINGLE_FETCH_REVIEW = process.env.AGENTLENS_RELEASE_PROFILE === "single-fetch-review";

export function requireFullRelease(): void {
  if (SINGLE_FETCH_REVIEW) throw new Error("Auto Fetch and Activity are unavailable in this review package.");
}
